import { describe, expect, it } from 'vitest';
import { addNode } from '../mapEditing';
import { createBlankMap } from '../mapLibrary';
import { addRecent, parseRecent, resolveRecent } from '../recentPlaces';

describe('addRecent', () => {
  it('puts the newest id first', () => {
    expect(addRecent(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
  });

  it('moves a repeated id to the front instead of duplicating it', () => {
    expect(addRecent(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
  });

  it('keeps at most five ids', () => {
    const ids = addRecent(['a', 'b', 'c', 'd', 'e'], 'f');
    expect(ids).toEqual(['f', 'a', 'b', 'c', 'd']);
  });
});

describe('parseRecent', () => {
  it('accepts a list of strings', () => {
    expect(parseRecent(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('falls back to an empty history for other shapes', () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent({ 0: 'a' })).toEqual([]);
    expect(parseRecent('a')).toEqual([]);
  });

  it('drops entries that are not strings and caps the length', () => {
    expect(parseRecent(['a', 1, null, 'b'])).toEqual(['a', 'b']);
    expect(parseRecent(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toHaveLength(5);
  });
});

describe('resolveRecent', () => {
  let map = createBlankMap('Recent');
  map = addNode(map, { id: 'k', x: 10, y: 10, label: 'Kuchyňka', markerCode: 'LOC-1' });
  map = addNode(map, { id: 'r', x: 20, y: 10, label: 'Recepce', markerCode: 'LOC-2' });

  it('keeps the order and shows the marker code as detail', () => {
    expect(resolveRecent(map, ['r', 'k'])).toEqual([
      { nodeId: 'r', label: 'Recepce', kind: 'location', detail: 'LOC-2' },
      { nodeId: 'k', label: 'Kuchyňka', kind: 'location', detail: 'LOC-1' },
    ]);
  });

  it('leaves out locations that no longer exist', () => {
    expect(resolveRecent(map, ['ghost', 'k']).map((m) => m.nodeId)).toEqual(['k']);
  });
});
