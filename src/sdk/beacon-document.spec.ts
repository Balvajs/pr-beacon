import { describe, expect, it } from 'vitest';

import type { BeaconDocument, ReplaceMode, TableRowMessage } from './beacon-document.ts';
import {
  parseBeacon,
  renderBeacon,
  serializeBeacon,
  updateMarkdowns,
  updateTables,
} from './beacon-document.ts';

// ---------------------------------------------------------------------------
// Helpers — string-level wrappers mirroring how PrBeacon renders the beacon
// ---------------------------------------------------------------------------

const emptyTables: Record<'fails' | 'messages' | 'warnings', TableRowMessage[]> = {
  fails: [],
  messages: [],
  warnings: [],
};

const renderTables = ({
  oldBeacon,
  newTables,
  contentIdsToUpdate,
  replaceMode,
}: {
  oldBeacon: string | undefined;
  newTables: BeaconDocument['tables'];
  contentIdsToUpdate: string[];
  replaceMode?: ReplaceMode;
}): string =>
  serializeBeacon({
    document: updateTables({
      contentIdsToUpdate,
      document: parseBeacon(oldBeacon),
      newTables,
      replaceMode,
    }),
  });

const renderMarkdowns = ({
  oldBeacon,
  newMarkdowns,
  contentIdsToUpdate,
}: {
  oldBeacon: string | undefined;
  newMarkdowns: BeaconDocument['markdowns'];
  contentIdsToUpdate: string[];
}): string =>
  serializeBeacon({
    document: updateMarkdowns({
      contentIdsToUpdate,
      document: parseBeacon(oldBeacon),
      newMarkdowns,
    }),
  });

// ---------------------------------------------------------------------------
// Parse & serialize
// ---------------------------------------------------------------------------

describe('parseBeacon', () => {
  it('returns an empty document for undefined input', () => {
    expect(parseBeacon(undefined)).toEqual({
      markdowns: [],
      tables: { fails: [], messages: [], warnings: [] },
    });
  });

  it('drops content that is not part of a known section', () => {
    expect(parseBeacon('<!--some-content-->')).toEqual({
      markdowns: [],
      tables: { fails: [], messages: [], warnings: [] },
    });
  });

  it('parses rows and markdown sections back into the structure', () => {
    const document: BeaconDocument = {
      markdowns: [{ id: 'report', message: '## Coverage\n\n94%' }],
      tables: {
        fails: [{ icon: '💥', id: 'ci/job', message: 'Broken' }],
        messages: [{ icon: '📖', message: 'No id row' }],
        warnings: [],
      },
    };

    expect(parseBeacon(serializeBeacon({ document }))).toEqual(document);
  });

  it('round-trips messages containing nested HTML tables with newlines (marked output shape)', () => {
    const document: BeaconDocument = {
      markdowns: [],
      tables: {
        fails: [],
        messages: [
          {
            icon: '📖',
            id: 'ci/job',
            message: '<table>\n<tr>\n<td>94%</td>\n</tr>\n</table>',
          },
          { icon: '📖', id: 'ci/other', message: 'second row' },
        ],
        warnings: [],
      },
    };

    expect(parseBeacon(serializeBeacon({ document }))).toEqual(document);
  });

  it('round-trips IDs that need HTML escaping in data-id attributes', () => {
    const document: BeaconDocument = {
      markdowns: [],
      tables: {
        fails: [{ icon: '🚫', id: 'a&b"<c>', message: 'entry' }],
        messages: [],
        warnings: [],
      },
    };

    const serialized = serializeBeacon({ document });
    expect(serialized).toContain('data-id="a&amp;b&quot;&lt;c&gt;"');
    expect(parseBeacon(serialized)).toEqual(document);
  });

  it('strips the footer so it never accumulates across renders', () => {
    const serialized = serializeBeacon({
      document: parseBeacon(undefined),
      footer: 'Generated <code>now</code> for sha1',
    });

    const reSerialized = serializeBeacon({
      document: parseBeacon(serialized),
      footer: 'Generated <code>later</code> for sha2',
    });

    expect(reSerialized).not.toContain('sha1');
    expect(reSerialized.match(/<p align="right">/g)).toHaveLength(1);
  });
});

describe('serializeBeacon', () => {
  it('contains all three section tags for an empty document', () => {
    const result = serializeBeacon({ document: parseBeacon(undefined) });

    expect(result).toContain('<!--fails-section--><!--fails-section-end-->');
    expect(result).toContain('<!--warnings-section--><!--warnings-section-end-->');
    expect(result).toContain('<!--messages-section--><!--messages-section-end-->');
  });

  it('is idempotent through a parse/serialize round-trip', () => {
    const serialized = renderTables({
      contentIdsToUpdate: ['ci/test'],
      newTables: { ...emptyTables, fails: [{ id: 'ci/test', message: 'Something broke' }] },
      oldBeacon: undefined,
    });

    expect(serializeBeacon({ document: parseBeacon(serialized) })).toBe(serialized);
  });
});

// ---------------------------------------------------------------------------
// Table updates
// ---------------------------------------------------------------------------

describe('updateTables – create path', () => {
  it('inserts a fails table when there are fail messages', () => {
    const result = renderTables({
      contentIdsToUpdate: ['ci/test'],
      newTables: { ...emptyTables, fails: [{ id: 'ci/test', message: 'Something broke' }] },
      oldBeacon: undefined,
    });

    expect(result).toContain('<table>');
    expect(result).toContain('Something broke');
    expect(result).toContain('data-id="ci/test"');
    expect(result).toContain('Fails');
  });

  it('inserts a warnings table when there are warning messages', () => {
    const result = renderTables({
      contentIdsToUpdate: ['ci/test'],
      newTables: { ...emptyTables, warnings: [{ id: 'ci/test', message: 'Watch out' }] },
      oldBeacon: undefined,
    });

    expect(result).toContain('Watch out');
    expect(result).toContain('Warnings');
  });

  it('inserts a messages table when there are messages', () => {
    const result = renderTables({
      contentIdsToUpdate: ['ci/test'],
      newTables: { ...emptyTables, messages: [{ id: 'ci/test', message: 'Hello world' }] },
      oldBeacon: undefined,
    });

    expect(result).toContain('Hello world');
    expect(result).toContain('Messages');
  });

  it.each([
    { icon: '🚫', tableType: 'fails' },
    { icon: '⚠️', tableType: 'warnings' },
    { icon: '📖', tableType: 'messages' },
  ] as const)('uses the default icon ($icon) for the $tableType table', ({ tableType, icon }) => {
    const result = renderTables({
      contentIdsToUpdate: ['ci/test'],
      newTables: { ...emptyTables, [tableType]: [{ id: 'ci/test', message: 'entry' }] },
      oldBeacon: undefined,
    });

    expect(result).toContain(icon);
  });

  it('uses a custom icon when provided', () => {
    const result = renderTables({
      contentIdsToUpdate: ['ci/test'],
      newTables: { ...emptyTables, fails: [{ icon: '❌', id: 'ci/test', message: 'fail' }] },
      oldBeacon: undefined,
    });

    expect(result).toContain('❌');
  });

  it('omits data-id attribute when no id is provided', () => {
    const result = renderTables({
      contentIdsToUpdate: [],
      newTables: { ...emptyTables, fails: [{ message: 'anonymous fail' }] },
      oldBeacon: undefined,
    });

    expect(result).not.toContain('data-id');
    expect(result).toContain('anonymous fail');
  });

  it('produces no table element when no messages are provided', () => {
    const result = renderTables({
      contentIdsToUpdate: ['ci/test'],
      newTables: emptyTables,
      oldBeacon: undefined,
    });

    expect(result).not.toContain('<table>');
  });
});

describe('updateTables – append path', () => {
  it('appends a new row to an existing table', () => {
    // First pass – create the table
    const firstPass = renderTables({
      contentIdsToUpdate: ['ci/job-a'],
      newTables: { ...emptyTables, fails: [{ id: 'ci/job-a', message: 'First fail' }] },
      oldBeacon: undefined,
    });

    // Second pass – append with a different ID so rows are not removed
    const secondPass = renderTables({
      contentIdsToUpdate: ['ci/job-b'],
      newTables: { ...emptyTables, fails: [{ id: 'ci/job-b', message: 'Second fail' }] },
      oldBeacon: firstPass,
    });

    expect(secondPass).toContain('First fail');
    expect(secondPass).toContain('Second fail');
  });
});

describe('updateTables – contentIdsToUpdate removal', () => {
  it('removes existing rows matching contentIdsToUpdate before inserting new ones', () => {
    const firstPass = renderTables({
      contentIdsToUpdate: ['ci/job'],
      newTables: { ...emptyTables, fails: [{ id: 'ci/job', message: 'old message' }] },
      oldBeacon: undefined,
    });

    const secondPass = renderTables({
      contentIdsToUpdate: ['ci/job'],
      newTables: { ...emptyTables, fails: [{ id: 'ci/job', message: 'new message' }] },
      oldBeacon: firstPass,
    });

    expect(secondPass).not.toContain('old message');
    expect(secondPass).toContain('new message');
  });

  it('removes the table entirely when all rows for the id are cleared', () => {
    const withTable = renderTables({
      contentIdsToUpdate: ['ci/job'],
      newTables: { ...emptyTables, fails: [{ id: 'ci/job', message: 'will be removed' }] },
      oldBeacon: undefined,
    });

    const cleared = renderTables({
      contentIdsToUpdate: ['ci/job'],
      newTables: emptyTables,
      oldBeacon: withTable,
    });

    expect(cleared).not.toContain('<table>');
    expect(cleared).not.toContain('will be removed');
  });
});

describe('updateTables – in-place replaceMode (default)', () => {
  it('preserves row ordering when re-running a job', () => {
    // Job A and Job B both add rows
    const afterJobA = renderTables({
      contentIdsToUpdate: ['ci/job-a'],
      newTables: { ...emptyTables, messages: [{ id: 'ci/job-a', message: 'Row A original' }] },
      oldBeacon: undefined,
    });

    const afterJobB = renderTables({
      contentIdsToUpdate: ['ci/job-b'],
      newTables: { ...emptyTables, messages: [{ id: 'ci/job-b', message: 'Row B' }] },
      oldBeacon: afterJobA,
    });

    // Re-run Job A — updated row should appear BEFORE Row B
    const afterRerunA = renderTables({
      contentIdsToUpdate: ['ci/job-a'],
      newTables: { ...emptyTables, messages: [{ id: 'ci/job-a', message: 'Row A updated' }] },
      oldBeacon: afterJobB,
    });

    expect(afterRerunA).toContain('Row A updated');
    expect(afterRerunA).toContain('Row B');
    expect(afterRerunA).not.toContain('Row A original');
    expect(afterRerunA.indexOf('Row A updated')).toBeLessThan(afterRerunA.indexOf('Row B'));
  });

  it('falls back to append when no existing row matches the ID', () => {
    const initial = renderTables({
      contentIdsToUpdate: ['ci/job-a'],
      newTables: { ...emptyTables, messages: [{ id: 'ci/job-a', message: 'Row A' }] },
      oldBeacon: undefined,
    });

    // New ID with no previous row — should be appended
    const result = renderTables({
      contentIdsToUpdate: ['ci/job-b'],
      newTables: { ...emptyTables, messages: [{ id: 'ci/job-b', message: 'Row B new' }] },
      oldBeacon: initial,
    });

    expect(result).toContain('Row A');
    expect(result).toContain('Row B new');
    expect(result.indexOf('Row A')).toBeLessThan(result.indexOf('Row B new'));
  });

  it('replaces only the first duplicate old row and removes the rest', () => {
    const initial = renderTables({
      contentIdsToUpdate: ['ci/job'],
      newTables: {
        ...emptyTables,
        messages: [
          { id: 'ci/job', message: 'Row 1' },
          { id: 'ci/job', message: 'Row 2' },
        ],
      },
      oldBeacon: undefined,
    });

    expect(initial).toContain('Row 1');
    expect(initial).toContain('Row 2');

    // Re-run with single new row — should replace at first position, remove second
    const result = renderTables({
      contentIdsToUpdate: ['ci/job'],
      newTables: { ...emptyTables, messages: [{ id: 'ci/job', message: 'Row updated' }] },
      oldBeacon: initial,
    });

    expect(result).toContain('Row updated');
    expect(result).not.toContain('Row 1');
    expect(result).not.toContain('Row 2');
  });

  it('inserts multiple new rows with the same ID together at the replaced position', () => {
    const initial = renderTables({
      contentIdsToUpdate: ['ci/job-a'],
      newTables: { ...emptyTables, messages: [{ id: 'ci/job-a', message: 'Row A' }] },
      oldBeacon: undefined,
    });

    const withB = renderTables({
      contentIdsToUpdate: ['ci/job-b'],
      newTables: { ...emptyTables, messages: [{ id: 'ci/job-b', message: 'Row B' }] },
      oldBeacon: initial,
    });

    // Re-run job A with multiple rows
    const result = renderTables({
      contentIdsToUpdate: ['ci/job-a'],
      newTables: {
        ...emptyTables,
        messages: [
          { id: 'ci/job-a', message: 'Row A first' },
          { id: 'ci/job-a', message: 'Row A second' },
        ],
      },
      oldBeacon: withB,
    });

    expect(result).toContain('Row A first');
    expect(result).toContain('Row A second');
    expect(result).toContain('Row B');
    expect(result.indexOf('Row A first')).toBeLessThan(result.indexOf('Row A second'));
    expect(result.indexOf('Row A second')).toBeLessThan(result.indexOf('Row B'));
  });

  it('handles the same ID across different table types without cross-table collision', () => {
    // Job writes both a warning and a message with the same ID
    const initial = renderTables({
      contentIdsToUpdate: ['ci/job'],
      newTables: {
        ...emptyTables,
        messages: [{ id: 'ci/job', message: 'Msg original' }],
        warnings: [{ id: 'ci/job', message: 'Warn original' }],
      },
      oldBeacon: undefined,
    });

    expect(initial).toContain('Msg original');
    expect(initial).toContain('Warn original');

    // Re-run: update both table types with the same ID
    const result = renderTables({
      contentIdsToUpdate: ['ci/job'],
      newTables: {
        ...emptyTables,
        messages: [{ id: 'ci/job', message: 'Msg updated' }],
        warnings: [{ id: 'ci/job', message: 'Warn updated' }],
      },
      oldBeacon: initial,
    });

    expect(result).toContain('Msg updated');
    expect(result).toContain('Warn updated');
    expect(result).not.toContain('Msg original');
    expect(result).not.toContain('Warn original');

    // Verify rows are in their correct table sections
    const warningsSection = result.match(
      /<!--warnings-section-->[\s\S]*?<!--warnings-section-end-->/,
    )?.[0];
    const messagesSection = result.match(
      /<!--messages-section-->[\s\S]*?<!--messages-section-end-->/,
    )?.[0];

    expect(warningsSection).toContain('Warn updated');
    expect(warningsSection).not.toContain('Msg updated');
    expect(messagesSection).toContain('Msg updated');
    expect(messagesSection).not.toContain('Warn updated');
  });

  it('handles an ID that moves between table types on re-run', () => {
    // First run: ci/job produces a message
    const initial = renderTables({
      contentIdsToUpdate: ['ci/job'],
      newTables: { ...emptyTables, messages: [{ id: 'ci/job', message: 'All good' }] },
      oldBeacon: undefined,
    });

    // Re-run: ci/job now produces a warning instead of a message
    const result = renderTables({
      contentIdsToUpdate: ['ci/job'],
      newTables: { ...emptyTables, warnings: [{ id: 'ci/job', message: 'Something suspicious' }] },
      oldBeacon: initial,
    });

    expect(result).toContain('Something suspicious');
    expect(result).not.toContain('All good');

    // Warning row must be in warnings section, not messages
    const warningsSection = result.match(
      /<!--warnings-section-->[\s\S]*?<!--warnings-section-end-->/,
    )?.[0];
    const messagesSection = result.match(
      /<!--messages-section-->[\s\S]*?<!--messages-section-end-->/,
    )?.[0];

    expect(warningsSection).toContain('Something suspicious');
    expect(messagesSection).not.toContain('Something suspicious');
  });
});

describe('updateTables – append replaceMode', () => {
  const replaceMode: ReplaceMode = 'append';

  it('appends updated rows after existing rows', () => {
    const afterJobA = renderTables({
      contentIdsToUpdate: ['ci/job-a'],
      newTables: { ...emptyTables, messages: [{ id: 'ci/job-a', message: 'Row A original' }] },
      oldBeacon: undefined,
      replaceMode,
    });

    const afterJobB = renderTables({
      contentIdsToUpdate: ['ci/job-b'],
      newTables: { ...emptyTables, messages: [{ id: 'ci/job-b', message: 'Row B' }] },
      oldBeacon: afterJobA,
      replaceMode,
    });

    // Re-run Job A — updated row should appear AFTER Row B (append behavior)
    const afterRerunA = renderTables({
      contentIdsToUpdate: ['ci/job-a'],
      newTables: { ...emptyTables, messages: [{ id: 'ci/job-a', message: 'Row A updated' }] },
      oldBeacon: afterJobB,
      replaceMode,
    });

    expect(afterRerunA).toContain('Row A updated');
    expect(afterRerunA).toContain('Row B');
    expect(afterRerunA).not.toContain('Row A original');
    expect(afterRerunA.indexOf('Row B')).toBeLessThan(afterRerunA.indexOf('Row A updated'));
  });
});

// ---------------------------------------------------------------------------
// Markdown updates
// ---------------------------------------------------------------------------

describe('updateMarkdowns – create path', () => {
  it('appends a new markdown section when no existing section is present', () => {
    const result = renderMarkdowns({
      contentIdsToUpdate: ['section-a'],
      newMarkdowns: [{ id: 'section-a', message: '## Hello' }],
      oldBeacon: undefined,
    });

    expect(result).toContain('<!--markdown-section-a-->');
    expect(result).toContain('## Hello');
    expect(result).toContain('<!--markdown-section-a-end-->');
  });

  it('wraps the message content between start and end tags with newlines', () => {
    const result = renderMarkdowns({
      contentIdsToUpdate: [],
      newMarkdowns: [{ id: 'my-id', message: 'My content' }],
      oldBeacon: undefined,
    });

    expect(result).toContain('<!--markdown-my-id-->\n\nMy content\n<!--markdown-my-id-end-->');
  });

  it('appends multiple sections in order', () => {
    const result = renderMarkdowns({
      contentIdsToUpdate: [],
      newMarkdowns: [
        { id: 'alpha', message: 'Alpha content' },
        { id: 'beta', message: 'Beta content' },
      ],
      oldBeacon: undefined,
    });

    const alphaIndex = result.indexOf('<!--markdown-alpha-->');
    const betaIndex = result.indexOf('<!--markdown-beta-->');

    expect(alphaIndex).toBeGreaterThanOrEqual(0);
    expect(betaIndex).toBeGreaterThan(alphaIndex);
    expect(result).toContain('Alpha content');
    expect(result).toContain('Beta content');
  });
});

describe('updateMarkdowns – update path', () => {
  it('replaces an existing section with the same id', () => {
    const firstPass = renderMarkdowns({
      contentIdsToUpdate: ['my-section'],
      newMarkdowns: [{ id: 'my-section', message: 'Old content' }],
      oldBeacon: undefined,
    });

    const secondPass = renderMarkdowns({
      contentIdsToUpdate: ['my-section'],
      newMarkdowns: [{ id: 'my-section', message: 'New content' }],
      oldBeacon: firstPass,
    });

    expect(secondPass).not.toContain('Old content');
    expect(secondPass).toContain('New content');
    // Only one start tag should exist
    expect(secondPass.match(/<!--markdown-my-section-->/g)).toHaveLength(1);
  });
});

describe('updateMarkdowns – removal path', () => {
  it('removes sections whose ids are in contentIdsToUpdate but not in newMarkdowns', () => {
    // First, create a beacon with two sections
    const beacon = renderMarkdowns({
      contentIdsToUpdate: [],
      newMarkdowns: [
        { id: 'keep', message: 'Keep me' },
        { id: 'remove', message: 'Remove me' },
      ],
      oldBeacon: undefined,
    });

    // Now update with only the "keep" section in contentIdsToUpdate, passing only "keep"
    const result = renderMarkdowns({
      contentIdsToUpdate: ['remove'],
      newMarkdowns: [{ id: 'keep', message: 'Keep me' }],
      oldBeacon: beacon,
    });

    expect(result).toContain('Keep me');
    expect(result).not.toContain('Remove me');
    expect(result).not.toContain('<!--markdown-remove-->');
  });

  it('does not remove sections not listed in contentIdsToUpdate', () => {
    const beacon = renderMarkdowns({
      contentIdsToUpdate: [],
      newMarkdowns: [
        { id: 'a', message: 'Section A' },
        { id: 'b', message: 'Section B' },
      ],
      oldBeacon: undefined,
    });

    // ContentIdsToUpdate does not include 'b', so 'b' stays untouched
    const result = renderMarkdowns({
      contentIdsToUpdate: ['a'],
      newMarkdowns: [],
      oldBeacon: beacon,
    });

    expect(result).not.toContain('Section A');
    expect(result).toContain('Section B');
  });
});

describe('updateMarkdowns – no-op', () => {
  it('returns an equal document when newMarkdowns is empty and no ids need removal', () => {
    const document = parseBeacon(
      '<!--markdown-existing-->\n\nExisting content\n<!--markdown-existing-end-->',
    );

    const result = updateMarkdowns({
      contentIdsToUpdate: [],
      document,
      newMarkdowns: [],
    });

    expect(result).toEqual(document);
  });
});

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

describe('renderBeacon', () => {
  it('renders tables, markdowns, and footer end-to-end across two runs', () => {
    const firstRun = renderBeacon({
      contentIdsToUpdate: ['ci/job'],
      footer: 'Generated <code>first time</code> for sha1',
      newMarkdowns: [{ id: 'ci/job', message: '## Report v1' }],
      newTables: { ...emptyTables, fails: [{ id: 'ci/job', message: 'Broken v1' }] },
      previousBody: undefined,
    });

    expect(firstRun).toContain('Broken v1');
    expect(firstRun).toContain('## Report v1');
    expect(firstRun).toContain('Generated <code>first time</code> for sha1');

    const secondRun = renderBeacon({
      contentIdsToUpdate: ['ci/job'],
      footer: 'Generated <code>second time</code> for sha2',
      newMarkdowns: [{ id: 'ci/job', message: '## Report v2' }],
      newTables: { ...emptyTables, fails: [{ id: 'ci/job', message: 'Broken v2' }] },
      previousBody: firstRun,
    });

    expect(secondRun).toContain('Broken v2');
    expect(secondRun).toContain('## Report v2');
    expect(secondRun).not.toContain('Broken v1');
    expect(secondRun).not.toContain('## Report v1');
    expect(secondRun).not.toContain('sha1');
    expect(secondRun.match(/<p align="right">/g)).toHaveLength(1);
  });
});
