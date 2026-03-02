import type * as Radashi from 'radashi';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commentPr } from './comment-pr.ts';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRequest = vi.fn();
const mockPaginateIterator = vi.fn();

vi.mock('./get-octokit.ts', () => ({
  getOctokit: vi.fn(() => ({
    paginate: {
      iterator: mockPaginateIterator,
    },
    request: mockRequest,
  })),
  getPrContext: vi.fn(() => ({
    issue_number: 42,
    owner: 'test-owner',
    pull_number: 42,
    repo: 'test-repo',
  })),
}));

vi.mock('radashi', async (importOriginal) => {
  const actual = await importOriginal<typeof Radashi>();
  return {
    ...actual,
    // Make retry execute the function once immediately without delays
    retry: vi.fn(async (_opts: unknown, fn: () => Promise<unknown>) => fn()),
    sleep: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FOOTER = '<!--dx-github-pr-generated-comment:PR-BEACON-->';

type IteratorPage = { data: { id: number; body: string }[] };

const makeAsyncIterator = (pages: IteratorPage[]): AsyncGenerator<IteratorPage, void, unknown> =>
  (async function* generate(): AsyncGenerator<IteratorPage, void, unknown> {
    for (const page of pages) {
      yield page;
    }
  })();

beforeEach(vi.clearAllMocks);

describe('commentPr – create (no existing comment)', () => {
  it('creates a new comment when none exists and returns action=create', async () => {
    mockPaginateIterator.mockReturnValue(makeAsyncIterator([{ data: [] }]));
    mockRequest.mockResolvedValue({ data: { body: 'body', id: 99 } });

    const result = await commentPr({
      commentId: 'PR-BEACON',
      githubToken: 'tok',
      markdown: 'Hello PR',
    });

    expect(result.action).toBe('create');
    expect(result.commentBody).toContain('Hello PR');
    expect(result.commentBody).toContain(FOOTER);

    // Should have called POST
    expect(mockRequest).toHaveBeenCalledWith(
      'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
      expect.objectContaining({ body: expect.stringContaining('Hello PR') as unknown }),
    );
  });

  it('supports a markdown function instead of a string (create)', async () => {
    mockPaginateIterator.mockReturnValue(makeAsyncIterator([{ data: [] }]));
    mockRequest.mockResolvedValue({ data: {} });

    const result = await commentPr({
      commentId: 'PR-BEACON',
      githubToken: 'tok',
      markdown: (prev) => `prev was: ${String(prev)}`,
    });

    expect(result.commentBody).toContain('prev was: undefined');
  });
});

describe('commentPr – upsert (existing comment)', () => {
  it('patches the existing comment and returns action=upsert', async () => {
    const existingBody = `Old body\n${FOOTER}`;
    mockPaginateIterator.mockReturnValue(
      makeAsyncIterator([{ data: [{ body: existingBody, id: 7 }] }]),
    );
    // PATCH + verification GET
    const newBody = `New body\n${FOOTER}`;
    // Mock PATCH response (empty), then GET verification response with new body
    mockRequest
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: { body: newBody, id: 7 } });

    const result = await commentPr({
      commentId: 'PR-BEACON',
      githubToken: 'tok',
      markdown: 'New body',
    });

    expect(result.action).toBe('upsert');
    expect(mockRequest).toHaveBeenCalledWith(
      'PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}',
      expect.objectContaining({ comment_id: 7 }),
    );
  });

  it('passes the previous comment body (without footer) to the markdown function', async () => {
    const previousContent = 'This is the old content';
    const existingBody = `${previousContent}\n${FOOTER}`;
    mockPaginateIterator.mockReturnValue(
      makeAsyncIterator([{ data: [{ body: existingBody, id: 11 }] }]),
    );

    let receivedPrev: string | undefined;
    const newContent = 'Updated content';
    mockRequest
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: { body: `${newContent}\n${FOOTER}`, id: 11 } });

    await commentPr({
      commentId: 'PR-BEACON',
      githubToken: 'tok',
      markdown: (prev) => {
        receivedPrev = prev;
        return newContent;
      },
    });

    // The footer should have been stripped from the previous body
    expect(receivedPrev).not.toContain(FOOTER);
    expect(receivedPrev).toContain(previousContent);
  });
});

describe('commentPr – retry on concurrent update', () => {
  it('retries when the verification read does not match the written body', async () => {
    const existingBody = `Old\n${FOOTER}`;
    // Return the existing comment on each attempt
    mockPaginateIterator.mockImplementation(() =>
      makeAsyncIterator([{ data: [{ body: existingBody, id: 5 }] }]),
    );

    // Patch succeeds but verification shows a different body (clobbered)
    // Expected full body would be: `My update${FOOTER}`
    // Mock: PATCH attempt 1 succeeds, GET verification returns clobbered body
    mockRequest
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: { body: 'CLOBBERED', id: 5 } });

    // The retry wrapper from radashi is mocked to only run once. After exhausting
    // Retries the implementation swallows the error and resolves silently.
    const result = await commentPr({
      commentId: 'PR-BEACON',
      githubToken: 'tok',
      markdown: 'My update',
    });

    expect(result).toEqual({ action: 'upsert', commentBody: '' });
  });
});
