import { describe, expect, it } from 'vitest';

import { updateMarkdowns } from './beacon-markdown';

const emptyBeacon = '';

describe('updateMarkdowns – create path', () => {
  it('appends a new markdown section when no existing section is present', () => {
    const result = updateMarkdowns({
      contentIdsToUpdate: ['section-a'],
      newMarkdowns: [{ id: 'section-a', message: '## Hello' }],
      oldBeacon: emptyBeacon,
    });

    expect(result).toContain('<!--markdown-section-a-->');
    expect(result).toContain('## Hello');
    expect(result).toContain('<!--markdown-section-a-end-->');
  });

  it('wraps the message content between start and end tags with newlines', () => {
    const result = updateMarkdowns({
      contentIdsToUpdate: [],
      newMarkdowns: [{ id: 'my-id', message: 'My content' }],
      oldBeacon: emptyBeacon,
    });

    expect(result).toContain('<!--markdown-my-id-->\n\nMy content\n<!--markdown-my-id-end-->');
  });

  it('appends multiple sections in order', () => {
    const result = updateMarkdowns({
      contentIdsToUpdate: [],
      newMarkdowns: [
        { id: 'alpha', message: 'Alpha content' },
        { id: 'beta', message: 'Beta content' },
      ],
      oldBeacon: emptyBeacon,
    });

    const alphaIdx = result.indexOf('<!--markdown-alpha-->');
    const betaIdx = result.indexOf('<!--markdown-beta-->');

    expect(alphaIdx).toBeGreaterThanOrEqual(0);
    expect(betaIdx).toBeGreaterThan(alphaIdx);
    expect(result).toContain('Alpha content');
    expect(result).toContain('Beta content');
  });
});

describe('updateMarkdowns – update path', () => {
  it('replaces an existing section with the same id', () => {
    const firstPass = updateMarkdowns({
      contentIdsToUpdate: ['my-section'],
      newMarkdowns: [{ id: 'my-section', message: 'Old content' }],
      oldBeacon: emptyBeacon,
    });

    const secondPass = updateMarkdowns({
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
    const beacon = updateMarkdowns({
      contentIdsToUpdate: [],
      newMarkdowns: [
        { id: 'keep', message: 'Keep me' },
        { id: 'remove', message: 'Remove me' },
      ],
      oldBeacon: emptyBeacon,
    });

    // Now update with only the "keep" section in contentIdsToUpdate, passing only "keep"
    const result = updateMarkdowns({
      contentIdsToUpdate: ['remove'],
      newMarkdowns: [{ id: 'keep', message: 'Keep me' }],
      oldBeacon: beacon,
    });

    expect(result).toContain('Keep me');
    expect(result).not.toContain('Remove me');
    expect(result).not.toContain('<!--markdown-remove-->');
  });

  it('does not remove sections not listed in contentIdsToUpdate', () => {
    const beacon = updateMarkdowns({
      contentIdsToUpdate: [],
      newMarkdowns: [
        { id: 'a', message: 'Section A' },
        { id: 'b', message: 'Section B' },
      ],
      oldBeacon: emptyBeacon,
    });

    // ContentIdsToUpdate does not include 'b', so 'b' stays untouched
    const result = updateMarkdowns({
      contentIdsToUpdate: ['a'],
      newMarkdowns: [],
      oldBeacon: beacon,
    });

    expect(result).not.toContain('Section A');
    expect(result).toContain('Section B');
  });
});

describe('updateMarkdowns – no-op', () => {
  it('returns the same beacon when newMarkdowns is empty and no ids need removal', () => {
    const beacon = '<!--some-content-->';
    const result = updateMarkdowns({
      contentIdsToUpdate: [],
      newMarkdowns: [],
      oldBeacon: beacon,
    });

    expect(result).toBe(beacon);
  });
});
