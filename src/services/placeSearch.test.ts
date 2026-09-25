import { describe, expect, it } from 'vitest';
import { addNode } from './mapEditing';
import { createBlankMap } from './mapLibrary';
import { normalizeText, searchPlaces } from './placeSearch';

let map = createBlankMap('Search');
map = addNode(map, { id: 'k', x: 10, y: 10, label: 'Kuchyňka', markerCode: 'LOC-1' });
map = addNode(map, { id: 'm', x: 20, y: 10, label: 'Zasedačka Malá', markerCode: 'MEET-2' });
map = addNode(map, { id: 'r', x: 30, y: 10, label: 'Recepce', markerCode: 'LOC-3' });
map = {
  ...map,
  rooms: [
    { id: 'room1', x: 0, y: 0, w: 5, h: 5, label: 'Kancelář 101', nodeId: 'r', color: '#fff' },
    { id: 'room2', x: 0, y: 0, w: 5, h: 5, label: 'Sklad', nodeId: 'ghost', color: '#fff' },
  ],
};

const ids = (query: string) => searchPlaces(map, query).map((m) => m.nodeId);

describe('searchPlaces', () => {
  it('ignores case and diacritics', () => {
    expect(normalizeText('  Kuchyňka ')).toBe('kuchynka');
    expect(ids('KUCHYN')).toEqual(['k']);
    expect(ids('zasedacka')).toEqual(['m']);
  });

  it('ranks name prefixes before word prefixes and substrings', () => {
    expect(ids('ma')).toEqual(['m']);
    expect(ids('ce')).toEqual(['r']);
    map = addNode(map, { id: 'x', x: 40, y: 10, label: 'Malý sál', markerCode: '' });
    expect(ids('mal')).toEqual(['x', 'm']);
  });

  it('finds rooms and marker codes, one result per node', () => {
    expect(searchPlaces(map, 'kancel')).toEqual([
      { nodeId: 'r', label: 'Kancelář 101', kind: 'room', detail: 'Recepce' },
    ]);
    expect(ids('meet')).toEqual(['m']);
    expect(ids('sklad')).toEqual([]);
    expect(ids('loc')).toEqual(['k', 'r']);
  });

  it('returns nothing for an empty query', () => {
    expect(searchPlaces(map, '   ')).toEqual([]);
  });
});
