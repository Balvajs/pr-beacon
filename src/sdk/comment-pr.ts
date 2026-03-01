import type { PaginatingEndpoints } from '@octokit/plugin-paginate-rest';
import { sleep, retry } from 'radashi';

import { getOctokit, getPrContext } from './get-octokit';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 500;

type PrComment =
  PaginatingEndpoints['GET /repos/{owner}/{repo}/issues/{issue_number}/comments']['response']['data'][0];

const findBeaconComment = async (
  octokit: ReturnType<typeof getOctokit>,
  prContext: ReturnType<typeof getPrContext>,
  commentFooter: string,
): Promise<PrComment | undefined> => {
  for await (const page of octokit.paginate.iterator(
    'GET /repos/{owner}/{repo}/issues/{issue_number}/comments',
    prContext,
  )) {
    const found = page.data.find((comment) => Boolean(comment.body?.includes(commentFooter)));

    if (found) {
      return found;
    }
  }

  return undefined;
};

/**
 * Function that adds comment to the PR found in Github Action context
 *
 * Operates in `upsert` mode which creates sticky comment (it stays in the same place in the PR comment section).
 *
 * Uses optimistic locking with read-after-write verification to handle concurrent writes from
 * parallel CI jobs. If another job overwrites the comment between our write and the verification
 * read, we retry up to MAX_RETRIES times, re-fetching the latest body each time so no update
 * is ever lost.
 */
export const commentPr = async ({
  githubToken,
  markdown,
  commentId,
}: {
  /**
   * Github token with `issues: write` and `pull-requests: write` scope, used for authentication when calling Github API
   */
  githubToken: string;
  /**
   * Content of the comment in markdown format
   * or update function that takes previous body (undefined if previous comment doesn't exist) and returns new body
   */
  markdown: string | ((previousBody: string | undefined) => string);
  /**
   * Comment ID unique in context of single PR
   * Used for identification of comment when being removed or replaced
   */
  commentId: string;
}): Promise<{ action: 'upsert' | 'create'; commentBody: string }> => {
  const octokit = getOctokit({ token: githubToken });
  const prContext = getPrContext();

  const commentFooter = `<!--dx-github-pr-generated-comment:${commentId}-->`;

  let attempts = 0;
  return retry({ delay: RETRY_DELAY_MS, times: MAX_RETRIES }, async () => {
    // Re-fetch on every attempt so we always build on the latest body
    const existingComment = await findBeaconComment(octokit, prContext, commentFooter);

    const previousBody = existingComment?.body?.replace(commentFooter, '');
    const body =
      typeof markdown === 'string'
        ? `${markdown}\n${commentFooter}`
        : `${markdown(previousBody)}\n${commentFooter}`;

    if (existingComment === undefined) {
      await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        ...prContext,
        body,
      });

      return { action: 'create', commentBody: body };
    }

    await octokit.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
      ...prContext,
      body,
      comment_id: existingComment.id,
    });

    // Read back to verify our write was not clobbered by a concurrent job
    await sleep(RETRY_DELAY_MS);
    const { data: verification } = await octokit.request(
      'GET /repos/{owner}/{repo}/issues/comments/{comment_id}',
      { ...prContext, comment_id: existingComment.id },
    );

    if (verification.body === body) {
      return { action: 'upsert', commentBody: body };
    }

    attempts += 1;

    throw new Error(
      `Failed to write PR beacon comment after ${attempts} attempts due to concurrent updates.`,
    );
  });
};
