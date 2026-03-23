import { randomUUID } from 'node:crypto';

import { warning } from '@actions/core';
import type { PaginatingEndpoints } from '@octokit/plugin-paginate-rest';
import { retry } from 'radashi';

import { getOctokit, getPrContext } from './get-octokit.ts';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 500;
const JITTER_MIN_FACTOR = 0.5;
const WRITE_NONCE_PATTERN = /\n<!--write-nonce:[a-f0-9-]+-->/g;

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
 * Uses a write nonce with read-after-write verification to mitigate concurrent writes from
 * parallel CI jobs. Each write embeds a unique nonce; if the nonce is missing from the
 * verification read, another job overwrote us and we retry up to MAX_RETRIES times,
 * re-fetching the latest body each time to reduce the chance of lost updates under concurrent writers.
 * Retry delays are jittered to desynchronize concurrent jobs.
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

  return retry(
    {
      backoff: () =>
        Math.floor(RETRY_DELAY_MS * JITTER_MIN_FACTOR + Math.random() * RETRY_DELAY_MS),
      times: MAX_RETRIES,
    },
    async () => {
      // Re-fetch on every attempt so we always build on the latest body
      const existingComment = await findBeaconComment(octokit, prContext, commentFooter);

      const previousBody = existingComment?.body
        ?.replace(WRITE_NONCE_PATTERN, '')
        .replace(commentFooter, '');
      const bodyContent = typeof markdown === 'string' ? markdown : markdown(previousBody);
      const nonce = `<!--write-nonce:${randomUUID()}-->`;
      const body = `${bodyContent}\n${nonce}\n${commentFooter}`;

      if (existingComment === undefined) {
        await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
          ...prContext,
          body,
        });

        return { action: 'create' as const, commentBody: body };
      }

      await octokit.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
        ...prContext,
        body,
        comment_id: existingComment.id,
      });

      // Read back to verify our write was not clobbered by a concurrent job
      const { data: verification } = await octokit.request(
        'GET /repos/{owner}/{repo}/issues/comments/{comment_id}',
        { ...prContext, comment_id: existingComment.id },
      );

      if (verification.body?.includes(nonce)) {
        return { action: 'upsert' as const, commentBody: body };
      }

      throw new Error('Write was clobbered by a concurrent update.');
    },
  ).catch(() => {
    // Fail silently if we can't update the comment after max attempts, to avoid breaking the build
    warning(`Failed to update PR comment after ${MAX_RETRIES} attempts due to concurrent updates.`);

    return { action: 'upsert' as const, commentBody: '' };
  });
};
