import { beforeEach, describe, expect, it, vi } from 'vitest';

import { submitPrBeacon } from './index.ts';
import { PrBeacon } from './pr-beacon.ts';

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

vi.mock('@actions/github', () => ({
  context: {
    issue: { number: 1, owner: 'owner', repo: 'repo' },
    job: 'job',
    payload: { pull_request: { head: { sha: 'sha1' } } },
    workflow: 'workflow',
  },
}));

const { mockSubmit } = vi.hoisted(() => ({ mockSubmit: vi.fn() }));

vi.mock('./pr-beacon.ts', () => {
  const PrBeaconMock = vi.fn(function PrBeaconFn(this: Record<string, unknown>) {
    this.fail = vi.fn();
    this.warn = vi.fn();
    this.message = vi.fn();
    this.markdown = vi.fn();
    this.hasFails = vi.fn().mockReturnValue(false);
    this._submit = mockSubmit;
  });
  return { PrBeacon: PrBeaconMock };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockSubmit.mockResolvedValue({ action: 'create', commentBody: 'body' });
});

describe('submitPrBeacon', () => {
  it('creates a PrBeacon instance and calls _submit', async () => {
    await submitPrBeacon(vi.fn());

    expect(PrBeacon).toHaveBeenCalledTimes(1);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it('passes options to PrBeacon constructor and _submit', async () => {
    const options = {
      contentIdsToUpdate: ['ci/job'],
      githubToken: 'tok',
    };

    await submitPrBeacon(vi.fn(), options);

    expect(PrBeacon).toHaveBeenCalledWith(options);
    expect(mockSubmit).toHaveBeenCalledWith(options);
  });

  it('executes the callback with the prBeacon instance', async () => {
    const callback = vi.fn();

    await submitPrBeacon(callback);

    const instance = vi.mocked(PrBeacon).mock.results[0]?.value as unknown;
    expect(callback).toHaveBeenCalledWith(instance);
  });

  it('awaits async callbacks', async () => {
    let resolved = false;
    const asyncCallback = async (): Promise<void> => {
      await Promise.resolve();
      resolved = true;
    };

    await submitPrBeacon(asyncCallback);

    expect(resolved).toBe(true);
  });

  it('returns the result from _submit', async () => {
    const expected = { action: 'upsert' as const, commentBody: 'result body' };
    mockSubmit.mockResolvedValue(expected);

    const result = await submitPrBeacon(vi.fn());

    expect(result).toEqual(expected);
  });
});
