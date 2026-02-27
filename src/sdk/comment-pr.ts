import type { PaginatingEndpoints } from '@octokit/plugin-paginate-rest';

import { getOctokit, getPrContext } from './get-octokit';

/**
 * Function that adds comment to the PR found in Github Action context
 *
 * Operates in `upsert` mode which creates sticky comment (it stays in the same place in the PR comment section)
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

  let previousPrComment:
    | PaginatingEndpoints['GET /repos/{owner}/{repo}/issues/{issue_number}/comments']['response']['data'][0]
    | undefined;

  // Paginate through comments until comment with footer is found
  for await (const prComments of octokit.paginate.iterator(
    'GET /repos/{owner}/{repo}/issues/{issue_number}/comments',
    prContext,
  )) {
    previousPrComment = prComments.data.find((comment) =>
      Boolean(comment.body?.includes(commentFooter)),
    );

    if (previousPrComment) {
      break;
    }
  }

  const body =
    typeof markdown === 'string'
      ? `${markdown}\n${commentFooter}`
      : `${markdown(previousPrComment?.body?.replace(commentFooter, ''))}${commentFooter}`;

  if (!previousPrComment) {
    await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
      ...prContext,
      body,
    });

    return { action: 'create', commentBody: body };
  }

  await octokit.request('POST /repos/{owner}/{repo}/issues/comments/{comment_id}', {
    ...prContext,
    body,
    comment_id: previousPrComment.id,
  });

  return { action: 'upsert', commentBody: body };
};
