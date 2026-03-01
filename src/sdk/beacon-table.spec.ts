import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { emptyTablesTemplate, updateTables } from './beacon-table';

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
