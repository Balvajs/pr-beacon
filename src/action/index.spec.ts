import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetInput = vi.fn();
const mockSetFailed = vi.fn();
vi.mock('@actions/core', () => ({
  getInput: mockGetInput,
  setFailed: mockSetFailed,
}));

const mockSubmitPrBeacon = vi.fn();
vi.mock('../sdk/index', () => ({
  submitPrBeacon: mockSubmitPrBeacon,
}));

// We also need to mock `node:fs` for JSON file reading tests
const mockReadFileSync = vi.fn();
vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
}));

type PrBeaconLike = {
  fail: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  message: ReturnType<typeof vi.fn>;
  markdown: ReturnType<typeof vi.fn>;
};

const makePrBeaconMock = (): PrBeaconLike => ({
  fail: vi.fn(),
  markdown: vi.fn(),
  message: vi.fn(),
  warn: vi.fn(),
});

// Helper that runs the action module fresh on each test
const loadAndRunAction = async (): Promise<void> => {
  // The action module runs code at the top level (not inside a function), so we
  // Need to dynamic-import it to run it. Vitest's module cache must be cleared
  // Between tests so the top-level code re-executes.
  vi.resetModules();
  await import('./index');
  // Flush the event loop so the awaited submitPrBeacon resolves
  await vi.dynamicImportSettled();
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no inputs set (return '' for unknown inputs)
  mockGetInput.mockReturnValue('');
  mockSubmitPrBeacon.mockImplementation(
    async (cb: (beacon: PrBeaconLike) => void | Promise<void>) => {
      const beacon = makePrBeaconMock();
      await cb(beacon);
      return { action: 'create', commentBody: '' };
    },
  );
});

describe('action – token handling', () => {
  it('sets GITHUB_TOKEN env var from the token input', async () => {
    mockGetInput.mockImplementation((name: string) => (name === 'token' ? 'my-token' : ''));
    await loadAndRunAction();
    expect(process.env.GITHUB_TOKEN).toBe('my-token');
  });
});

describe('action – individual inputs', () => {
  let capturedBeacon: PrBeaconLike;

  beforeEach(() => {
    capturedBeacon = makePrBeaconMock();
    mockSubmitPrBeacon.mockImplementation(
      async (cb: (beacon: PrBeaconLike) => void | Promise<void>) => {
        await cb(capturedBeacon);
        return { action: 'create', commentBody: '' };
      },
    );
  });

  it('calls prBeacon.fail() when fail input is provided', async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'token') {
        return 'tok';
      }
      if (name === 'fail') {
        return 'Something broke';
      }
      return '';
    });

    await loadAndRunAction();

    expect(capturedBeacon.fail).toHaveBeenCalledWith(
      'Something broke',
      expect.objectContaining({ markdownToHtml: true }),
    );
  });

  it('calls prBeacon.warn() when warn input is provided', async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'token') {
        return 'tok';
      }
      if (name === 'warn') {
        return 'Suspicious thing';
      }
      return '';
    });

    await loadAndRunAction();

    expect(capturedBeacon.warn).toHaveBeenCalledWith(
      'Suspicious thing',
      expect.objectContaining({ markdownToHtml: true }),
    );
  });

  it('calls prBeacon.message() when message input is provided', async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'token') {
        return 'tok';
      }
      if (name === 'message') {
        return 'Hello';
      }
      return '';
    });

    await loadAndRunAction();

    expect(capturedBeacon.message).toHaveBeenCalledWith(
      'Hello',
      expect.objectContaining({ markdownToHtml: true }),
    );
  });

  it('forwards icon and id meta to fail()', async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'token') {
        return 'tok';
      }
      if (name === 'fail') {
        return 'error';
      }
      if (name === 'fail-icon') {
        return '❌';
      }
      if (name === 'fail-id') {
        return 'my-id';
      }
      return '';
    });

    await loadAndRunAction();

    expect(capturedBeacon.fail).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ icon: '❌', id: 'my-id' }),
    );
  });

  it('calls prBeacon.markdown() when markdown input is provided', async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'token') {
        return 'tok';
      }
      if (name === 'markdown') {
        return '## My Section';
      }
      if (name === 'markdown-id') {
        return 'section-id';
      }
      return '';
    });

    await loadAndRunAction();

    expect(capturedBeacon.markdown).toHaveBeenCalledWith('## My Section', { id: 'section-id' });
  });

  it('calls prBeacon.markdown() with empty string id when markdown-id is not provided', async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'token') {
        return 'tok';
      }
      if (name === 'markdown') {
        return '## My Section';
      }
      return '';
    });

    await loadAndRunAction();

    expect(capturedBeacon.markdown).toHaveBeenCalledWith('## My Section', { id: undefined });
  });
});

describe('action – json-file input', () => {
  let capturedBeacon: PrBeaconLike;

  beforeEach(() => {
    capturedBeacon = makePrBeaconMock();
    mockSubmitPrBeacon.mockImplementation(
      async (cb: (beacon: PrBeaconLike) => void | Promise<void>) => {
        await cb(capturedBeacon);
        return { action: 'create', commentBody: '' };
      },
    );
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'token') {
        return 'tok';
      }
      if (name === 'json-file') {
        return '/tmp/payload.json';
      }
      return '';
    });
  });

  it('reads and parses the JSON file and applies its rows', async () => {
    const jsonPayload = {
      fails: [{ id: 'ci/job', message: 'JSON fail' }],
      markdowns: [{ id: 'md1', message: '## Section' }],
      messages: ['JSON msg'],
      warnings: [{ id: 'ci/job', message: 'JSON warn' }],
    };
    mockReadFileSync.mockReturnValue(JSON.stringify(jsonPayload));

    await loadAndRunAction();

    expect(capturedBeacon.fail).toHaveBeenCalledWith(
      'JSON fail',
      expect.objectContaining({ id: 'ci/job' }),
    );
    expect(capturedBeacon.warn).toHaveBeenCalledWith(
      'JSON warn',
      expect.objectContaining({ id: 'ci/job' }),
    );
    expect(capturedBeacon.message).toHaveBeenCalledWith(
      'JSON msg',
      expect.objectContaining({ markdownToHtml: true }),
    );
    expect(capturedBeacon.markdown).toHaveBeenCalledWith('## Section', { id: 'md1' });
  });

  it('skips empty rows from the JSON payload', async () => {
    const jsonPayload = {
      fails: [{ id: 'ci/job', message: '   ' }],
    };
    mockReadFileSync.mockReturnValue(JSON.stringify(jsonPayload));

    await loadAndRunAction();

    expect(capturedBeacon.fail).not.toHaveBeenCalled();
  });
});

describe('action – content-ids-to-update input', () => {
  it('parses comma-separated content ids and passes them to submitPrBeacon', async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'token') {
        return 'tok';
      }
      if (name === 'content-ids-to-update') {
        return 'ci/job-a, ci/job-b';
      }
      return '';
    });

    await loadAndRunAction();

    expect(mockSubmitPrBeacon).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        contentIdsToUpdate: ['ci/job-a', 'ci/job-b'],
      }),
    );
  });
});

describe('action – fail-on-fail-message input', () => {
  it('passes shouldFailOnFailMessage=true when input is "true"', async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'token') {
        return 'tok';
      }
      if (name === 'fail-on-fail-message') {
        return 'true';
      }
      return '';
    });

    await loadAndRunAction();

    expect(mockSubmitPrBeacon).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ shouldFailOnFailMessage: true }),
    );
  });

  it('passes shouldFailOnFailMessage=false when input is not "true"', async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'token') {
        return 'tok';
      }
      return '';
    });

    await loadAndRunAction();

    expect(mockSubmitPrBeacon).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ shouldFailOnFailMessage: false }),
    );
  });
});

describe('action – error handling', () => {
  it('calls setFailed when submitPrBeacon throws', async () => {
    mockGetInput.mockImplementation((name: string) => (name === 'token' ? 'tok' : ''));
    mockSubmitPrBeacon.mockRejectedValue(new Error('Something went wrong'));

    await loadAndRunAction();

    expect(mockSetFailed).toHaveBeenCalledWith('Something went wrong');
  });

  it('calls setFailed with stringified error for non-Error rejections', async () => {
    mockGetInput.mockImplementation((name: string) => (name === 'token' ? 'tok' : ''));
    mockSubmitPrBeacon.mockRejectedValue('raw string error');

    await loadAndRunAction();

    expect(mockSetFailed).toHaveBeenCalledWith('raw string error');
  });
});
