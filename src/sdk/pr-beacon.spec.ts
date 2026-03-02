import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  setFailed: vi.fn(),
}));

vi.mock('picocolors', () => ({
  default: {
    bold: (str: string): string => str,
    red: (str: string): string => str,
    yellow: (str: string): string => str,
  },
}));

const { mockCommentPr } = vi.hoisted(() => ({ mockCommentPr: vi.fn() }));
vi.mock('./comment-pr', () => ({
  commentPr: mockCommentPr,
}));

vi.mock('@actions/github', () => ({
  context: {
    issue: { number: 1, owner: 'owner', repo: 'repo' },
    job: 'my-job',
    payload: { pull_request: { head: { sha: 'abc123' } } },
    workflow: 'my-workflow',
  },
}));

vi.mock('./get-octokit', () => ({
  getOctokit: vi.fn(() => ({
    paginate: vi.fn().mockResolvedValue([]),
    request: vi.fn().mockResolvedValue({ data: {} }),
  })),
  getPrContext: vi.fn(() => ({
    issue_number: 1,
    owner: 'owner',
    pull_number: 1,
    repo: 'repo',
  })),
}));

import { setFailed } from '@actions/core';

import { commentPr } from './comment-pr';
import { PrBeacon } from './pr-beacon';

const getRenderedBody = (): string => {
  const firstCall = vi.mocked(commentPr).mock.calls.at(0);
  if (!firstCall) {
    throw new TypeError('commentPr was not called');
  }
  const [{ markdown }] = firstCall;
  if (typeof markdown !== 'function') {
    throw new TypeError('Expected markdown to be a function');
  }
  // Parameter is string | undefined (required, not optional) – passing undefined is intentional
  // oxlint-disable-next-line unicorn/no-useless-undefined
  return markdown(undefined);
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultToken = 'ghp_token';
const mockCommentResult = { action: 'create' as const, commentBody: 'body' };

beforeEach(() => {
  vi.clearAllMocks();
  mockCommentPr.mockResolvedValue(mockCommentResult);
});

describe('PrBeacon constructor', () => {
  it('accepts a github token via parameter', () => {
    expect(() => new PrBeacon({ githubToken: defaultToken })).not.toThrow();
  });

  it('reads the token from GITHUB_TOKEN env var', () => {
    process.env.GITHUB_TOKEN = defaultToken;
    expect(() => new PrBeacon()).not.toThrow();
    delete process.env.GITHUB_TOKEN;
  });

  it('throws when no token is available', () => {
    delete process.env.GITHUB_TOKEN;
    expect(() => new PrBeacon()).toThrow(/GitHub token is not provided/);
  });
});

describe('PrBeacon accumulation', () => {
  it('hasFails returns false initially', () => {
    const beacon = new PrBeacon({ githubToken: defaultToken });
    expect(beacon.hasFails()).toBe(false);
  });

  it('hasFails returns true after fail() is called', () => {
    const beacon = new PrBeacon({ githubToken: defaultToken });
    beacon.fail('oops');
    expect(beacon.hasFails()).toBe(true);
  });

  it('hasFails returns false when only warn() is called', () => {
    const beacon = new PrBeacon({ githubToken: defaultToken });
    beacon.warn('just a warning');
    expect(beacon.hasFails()).toBe(false);
  });

  it('hasFails returns false when only message() is called', () => {
    const beacon = new PrBeacon({ githubToken: defaultToken });
    beacon.message('just a message');
    expect(beacon.hasFails()).toBe(false);
  });

  it('fail() adds a row with default content id', async () => {
    const beacon = new PrBeacon({ githubToken: defaultToken });
    beacon.fail('fail msg');

    await beacon._submit({ contentIdsToUpdate: ['my-workflow/my-job'] });

    expect(getRenderedBody()).toContain('fail msg');
  });

  it('warn() adds a row to the warnings table', async () => {
    const beacon = new PrBeacon({ githubToken: defaultToken });
    beacon.warn('warn msg');

    await beacon._submit({ contentIdsToUpdate: ['my-workflow/my-job'] });

    const body = getRenderedBody();
    expect(body).toContain('warn msg');
    expect(body).toContain('Warnings');
  });

  it('message() adds a row to the messages table', async () => {
    const beacon = new PrBeacon({ githubToken: defaultToken });
    beacon.message('info msg');

    await beacon._submit({ contentIdsToUpdate: ['my-workflow/my-job'] });

    const body = getRenderedBody();
    expect(body).toContain('info msg');
    expect(body).toContain('Messages');
  });

  it('markdown() appends markdown section', async () => {
    const beacon = new PrBeacon({ githubToken: defaultToken });
    beacon.markdown('## Heading\ncontent', { id: 'my-section' });

    await beacon._submit({ contentIdsToUpdate: ['my-workflow/my-job'] });

    const body = getRenderedBody();
    expect(body).toContain('## Heading');
    expect(body).toContain('<!--markdown-my-section-->');
  });
});

describe('PrBeacon markdownToHtml option', () => {
  it('converts markdown to HTML when markdownToHtml=true', async () => {
    const beacon = new PrBeacon({ githubToken: defaultToken });
    beacon.fail('**bold text**', { markdownToHtml: true });

    await beacon._submit({ contentIdsToUpdate: ['my-workflow/my-job'] });

    // Marked converts **bold** to <strong>bold</strong>
    expect(getRenderedBody()).toContain('<strong>');
  });

  it('keeps plain text when markdownToHtml is not set', async () => {
    const beacon = new PrBeacon({ githubToken: defaultToken });
    beacon.fail('**raw text**');

    await beacon._submit({ contentIdsToUpdate: ['my-workflow/my-job'] });

    expect(getRenderedBody()).toContain('**raw text**');
  });
});

describe('PrBeacon._submit', () => {
  it('calls commentPr with commentId PR-BEACON', async () => {
    const beacon = new PrBeacon({ githubToken: defaultToken });
    await beacon._submit();

    expect(mockCommentPr).toHaveBeenCalledWith(expect.objectContaining({ commentId: 'PR-BEACON' }));
  });

  it('calls setFailed when shouldFailOnFailMessage=true and there are fails', async () => {
    const beacon = new PrBeacon({ githubToken: defaultToken });
    beacon.fail('critical error');

    await beacon._submit({ shouldFailOnFailMessage: true });

    expect(setFailed).toHaveBeenCalledWith(expect.stringContaining('1 errors'));
  });

  it('does not call setFailed when shouldFailOnFailMessage=false', async () => {
    const beacon = new PrBeacon({ githubToken: defaultToken });
    beacon.fail('error');

    await beacon._submit({ shouldFailOnFailMessage: false });

    expect(setFailed).not.toHaveBeenCalled();
  });

  it('adds a footer timestamp to the generated body', async () => {
    const beacon = new PrBeacon({ githubToken: defaultToken });
    await beacon._submit();

    const body = getRenderedBody();
    expect(body).toContain('Generated');
    // Head sha from mock context
    expect(body).toContain('abc123');
  });

  it('returns the result from commentPr', async () => {
    const beacon = new PrBeacon({ githubToken: defaultToken });
    const result = await beacon._submit();

    expect(result).toEqual(mockCommentResult);
  });
});
