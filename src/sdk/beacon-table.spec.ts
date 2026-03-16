import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReplaceMode } from './beacon-table.ts';
import { emptyTablesTemplate, updateTables } from './beacon-table.ts';

// Mock @actions/core before importing the module under test
vi.mock('@actions/core', () => ({
  info: vi.fn(),
}));

// Mock picocolors to return the string unchanged for predictable assertions
vi.mock('picocolors', () => ({
  default: {
    bold: (str: string): string => str,
    red: (str: string): string => str,
    yellow: (str: string): string => str,
  },
}));

beforeEach(vi.clearAllMocks);

describe('emptyTablesTemplate', () => {
  it('contains all three section tags', () => {
    expect(emptyTablesTemplate).toContain('<!--fails-section--><!--fails-section-end-->');
    expect(emptyTablesTemplate).toContain('<!--warnings-section--><!--warnings-section-end-->');
    expect(emptyTablesTemplate).toContain('<!--messages-section--><!--messages-section-end-->');
  });
});

describe('updateTables – create path', () => {
  it('inserts a fails table when there are fail messages', () => {
    const result = updateTables({
      contentIdsToUpdate: ['ci/test'],
      newTables: {
        fails: [{ id: 'ci/test', message: 'Something broke' }],
        messages: [],
        warnings: [],
      },
      oldBeacon: emptyTablesTemplate,
    });

    expect(result).toContain('<table>');
    expect(result).toContain('Something broke');
    expect(result).toContain('data-id="ci/test"');
    expect(result).toContain('Fails');
  });

  it('inserts a warnings table when there are warning messages', () => {
    const result = updateTables({
      contentIdsToUpdate: ['ci/test'],
      newTables: {
        fails: [],
        messages: [],
        warnings: [{ id: 'ci/test', message: 'Watch out' }],
      },
      oldBeacon: emptyTablesTemplate,
    });

    expect(result).toContain('Watch out');
    expect(result).toContain('Warnings');
  });

  it('inserts a messages table when there are messages', () => {
    const result = updateTables({
      contentIdsToUpdate: ['ci/test'],
      newTables: {
        fails: [],
        messages: [{ id: 'ci/test', message: 'Hello world' }],
        warnings: [],
      },
      oldBeacon: emptyTablesTemplate,
    });

    expect(result).toContain('Hello world');
    expect(result).toContain('Messages');
  });

  it.each([
    { icon: '🚫', tableType: 'fails' },
    { icon: '⚠️', tableType: 'warnings' },
    { icon: '📖', tableType: 'messages' },
  ] as const)('uses the default icon ($icon) for the $tableType table', ({ tableType, icon }) => {
    const result = updateTables({
      contentIdsToUpdate: ['ci/test'],
      newTables: {
        fails: tableType === 'fails' ? [{ id: 'ci/test', message: 'entry' }] : [],
        messages: tableType === 'messages' ? [{ id: 'ci/test', message: 'entry' }] : [],
        warnings: tableType === 'warnings' ? [{ id: 'ci/test', message: 'entry' }] : [],
      },
      oldBeacon: emptyTablesTemplate,
    });

    expect(result).toContain(icon);
  });

  it('uses a custom icon when provided', () => {
    const result = updateTables({
      contentIdsToUpdate: ['ci/test'],
      newTables: {
        fails: [{ icon: '❌', id: 'ci/test', message: 'fail' }],
        messages: [],
        warnings: [],
      },
      oldBeacon: emptyTablesTemplate,
    });

    expect(result).toContain('❌');
  });

  it('omits data-id attribute when no id is provided', () => {
    const result = updateTables({
      contentIdsToUpdate: [],
      newTables: {
        fails: [{ message: 'anonymous fail' }],
        messages: [],
        warnings: [],
      },
      oldBeacon: emptyTablesTemplate,
    });

    expect(result).not.toContain('data-id');
    expect(result).toContain('anonymous fail');
  });

  it('produces no table element when no messages are provided', () => {
    const result = updateTables({
      contentIdsToUpdate: ['ci/test'],
      newTables: { fails: [], messages: [], warnings: [] },
      oldBeacon: emptyTablesTemplate,
    });

    expect(result).not.toContain('<table>');
  });
});

describe('updateTables – append path', () => {
  it('appends a new row to an existing table', () => {
    // First pass – create the table
    const firstpass = updateTables({
      contentIdsToUpdate: ['ci/job-a'],
      newTables: {
        fails: [{ id: 'ci/job-a', message: 'First fail' }],
        messages: [],
        warnings: [],
      },
      oldBeacon: emptyTablesTemplate,
    });

    // Second pass – append with a different ID so rows are not removed
    const secondPass = updateTables({
      contentIdsToUpdate: ['ci/job-b'],
      newTables: {
        fails: [{ id: 'ci/job-b', message: 'Second fail' }],
        messages: [],
        warnings: [],
      },
      oldBeacon: firstpass,
    });

    expect(secondPass).toContain('First fail');
    expect(secondPass).toContain('Second fail');
  });
});

describe('updateTables – contentIdsToUpdate removal', () => {
  it('removes existing rows matching contentIdsToUpdate before inserting new ones', () => {
    const firstPass = updateTables({
      contentIdsToUpdate: ['ci/job'],
      newTables: {
        fails: [{ id: 'ci/job', message: 'old message' }],
        messages: [],
        warnings: [],
      },
      oldBeacon: emptyTablesTemplate,
    });

    const secondPass = updateTables({
      contentIdsToUpdate: ['ci/job'],
      newTables: {
        fails: [{ id: 'ci/job', message: 'new message' }],
        messages: [],
        warnings: [],
      },
      oldBeacon: firstPass,
    });

    expect(secondPass).not.toContain('old message');
    expect(secondPass).toContain('new message');
  });

  it('removes the table entirely when all rows for the id are cleared', () => {
    const withTable = updateTables({
      contentIdsToUpdate: ['ci/job'],
      newTables: {
        fails: [{ id: 'ci/job', message: 'will be removed' }],
        messages: [],
        warnings: [],
      },
      oldBeacon: emptyTablesTemplate,
    });

    const cleared = updateTables({
      contentIdsToUpdate: ['ci/job'],
      newTables: { fails: [], messages: [], warnings: [] },
      oldBeacon: withTable,
    });

    expect(cleared).not.toContain('<table>');
    expect(cleared).not.toContain('will be removed');
  });
});

describe('updateTables – in-place replaceMode (default)', () => {
  it('preserves row ordering when re-running a job', () => {
    // Job A and Job B both add rows
    const afterJobA = updateTables({
      contentIdsToUpdate: ['ci/job-a'],
      newTables: {
        fails: [],
        messages: [{ id: 'ci/job-a', message: 'Row A original' }],
        warnings: [],
      },
      oldBeacon: emptyTablesTemplate,
    });

    const afterJobB = updateTables({
      contentIdsToUpdate: ['ci/job-b'],
      newTables: {
        fails: [],
        messages: [{ id: 'ci/job-b', message: 'Row B' }],
        warnings: [],
      },
      oldBeacon: afterJobA,
    });

    // Re-run Job A — updated row should appear BEFORE Row B
    const afterRerunA = updateTables({
      contentIdsToUpdate: ['ci/job-a'],
      newTables: {
        fails: [],
        messages: [{ id: 'ci/job-a', message: 'Row A updated' }],
        warnings: [],
      },
      oldBeacon: afterJobB,
    });

    expect(afterRerunA).toContain('Row A updated');
    expect(afterRerunA).toContain('Row B');
    expect(afterRerunA).not.toContain('Row A original');
    expect(afterRerunA.indexOf('Row A updated')).toBeLessThan(afterRerunA.indexOf('Row B'));
  });

  it('falls back to append when no existing row matches the ID', () => {
    const initial = updateTables({
      contentIdsToUpdate: ['ci/job-a'],
      newTables: {
        fails: [],
        messages: [{ id: 'ci/job-a', message: 'Row A' }],
        warnings: [],
      },
      oldBeacon: emptyTablesTemplate,
    });

    // New ID with no previous row — should be appended
    const result = updateTables({
      contentIdsToUpdate: ['ci/job-b'],
      newTables: {
        fails: [],
        messages: [{ id: 'ci/job-b', message: 'Row B new' }],
        warnings: [],
      },
      oldBeacon: initial,
    });

    expect(result).toContain('Row A');
    expect(result).toContain('Row B new');
    expect(result.indexOf('Row A')).toBeLessThan(result.indexOf('Row B new'));
  });

  it('replaces only the first duplicate old row and removes the rest', () => {
    // Manually create a beacon with duplicate rows for the same ID
    const initial = updateTables({
      contentIdsToUpdate: ['ci/job'],
      newTables: {
        fails: [],
        messages: [
          { id: 'ci/job', message: 'Row 1' },
          { id: 'ci/job', message: 'Row 2' },
        ],
        warnings: [],
      },
      oldBeacon: emptyTablesTemplate,
    });

    expect(initial).toContain('Row 1');
    expect(initial).toContain('Row 2');

    // Re-run with single new row — should replace at first position, remove second
    const result = updateTables({
      contentIdsToUpdate: ['ci/job'],
      newTables: {
        fails: [],
        messages: [{ id: 'ci/job', message: 'Row updated' }],
        warnings: [],
      },
      oldBeacon: initial,
    });

    expect(result).toContain('Row updated');
    expect(result).not.toContain('Row 1');
    expect(result).not.toContain('Row 2');
  });

  it('inserts multiple new rows with the same ID together at the placeholder position', () => {
    const initial = updateTables({
      contentIdsToUpdate: ['ci/job-a'],
      newTables: {
        fails: [],
        messages: [{ id: 'ci/job-a', message: 'Row A' }],
        warnings: [],
      },
      oldBeacon: emptyTablesTemplate,
    });

    const withB = updateTables({
      contentIdsToUpdate: ['ci/job-b'],
      newTables: {
        fails: [],
        messages: [{ id: 'ci/job-b', message: 'Row B' }],
        warnings: [],
      },
      oldBeacon: initial,
    });

    // Re-run job A with multiple rows
    const result = updateTables({
      contentIdsToUpdate: ['ci/job-a'],
      newTables: {
        fails: [],
        messages: [
          { id: 'ci/job-a', message: 'Row A first' },
          { id: 'ci/job-a', message: 'Row A second' },
        ],
        warnings: [],
      },
      oldBeacon: withB,
    });

    expect(result).toContain('Row A first');
    expect(result).toContain('Row A second');
    expect(result).toContain('Row B');
    expect(result.indexOf('Row A first')).toBeLessThan(result.indexOf('Row A second'));
    expect(result.indexOf('Row A second')).toBeLessThan(result.indexOf('Row B'));
  });
});

describe('updateTables – append replaceMode', () => {
  const replaceMode: ReplaceMode = 'append';

  it('appends updated rows after existing rows', () => {
    const afterJobA = updateTables({
      contentIdsToUpdate: ['ci/job-a'],
      newTables: {
        fails: [],
        messages: [{ id: 'ci/job-a', message: 'Row A original' }],
        warnings: [],
      },
      oldBeacon: emptyTablesTemplate,
      replaceMode,
    });

    const afterJobB = updateTables({
      contentIdsToUpdate: ['ci/job-b'],
      newTables: {
        fails: [],
        messages: [{ id: 'ci/job-b', message: 'Row B' }],
        warnings: [],
      },
      oldBeacon: afterJobA,
      replaceMode,
    });

    // Re-run Job A — updated row should appear AFTER Row B (append behavior)
    const afterRerunA = updateTables({
      contentIdsToUpdate: ['ci/job-a'],
      newTables: {
        fails: [],
        messages: [{ id: 'ci/job-a', message: 'Row A updated' }],
        warnings: [],
      },
      oldBeacon: afterJobB,
      replaceMode,
    });

    expect(afterRerunA).toContain('Row A updated');
    expect(afterRerunA).toContain('Row B');
    expect(afterRerunA).not.toContain('Row A original');
    expect(afterRerunA.indexOf('Row B')).toBeLessThan(afterRerunA.indexOf('Row A updated'));
  });
});
