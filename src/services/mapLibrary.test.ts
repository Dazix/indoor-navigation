import { describe, expect, it } from 'vitest';
import type { MapLibrary } from '../types/map';
import { parseMapData } from './mapStorage';
import {
  addToLibrary,
  createBlankMap,
  findBySource,
  parseLibrary,
  removeFromLibrary,
  uniqueName,
  updateSummary,
} from './mapLibrary';

const library: MapLibrary = {
  activeMapId: 'b',
  maps: [
    { id: 'a', name: 'HQ', updatedAt: 1 },
    { id: 'b', name: 'Branch', updatedAt: 3 },
    { id: 'c', name: 'Lab', updatedAt: 2 },
  ],
};

describe('map library', () => {
  it('creates a blank map that passes validation', () => {
    const map = createBlankMap('New office');
    expect(parseMapData(map)).toEqual({ ok: true, data: map });
  });

  it('adds and activates a map, replacing an entry with the same id', () => {
    const next = addToLibrary(library, { id: 'a', name: 'HQ renamed', updatedAt: 9 });
    expect(next.activeMapId).toBe('a');
    expect(next.maps.filter((m) => m.id === 'a')).toEqual([{ id: 'a', name: 'HQ renamed', updatedAt: 9 }]);
    expect(addToLibrary(library, { id: 'd', name: 'D', updatedAt: 0 }, false).activeMapId).toBe('b');
  });

  it('falls back to the most recently updated map when the active one is removed', () => {
    expect(removeFromLibrary(library, 'b')).toEqual({
      activeMapId: 'c',
      maps: [library.maps[0], library.maps[2]],
    });
    expect(removeFromLibrary(library, 'a').activeMapId).toBe('b');
    expect(
      removeFromLibrary({ activeMapId: 'x', maps: [{ id: 'x', name: 'X', updatedAt: 0 }] }, 'x'),
    ).toEqual({
      activeMapId: null,
      maps: [],
    });
  });

  it('updates a summary in place', () => {
    expect(updateSummary(library, 'c', { name: 'Lab 2' }).maps[2]).toEqual({
      id: 'c',
      name: 'Lab 2',
      updatedAt: 2,
    });
  });

  it('generates unique names', () => {
    expect(uniqueName(library, 'Office')).toBe('Office');
    expect(uniqueName(library, 'HQ')).toBe('HQ (2)');
    expect(uniqueName(addToLibrary(library, { id: 'z', name: 'HQ (2)', updatedAt: 0 }), 'HQ')).toBe('HQ (3)');
  });

  it('validates the stored library index', () => {
    expect(parseLibrary(library)).toEqual(library);
    expect(parseLibrary({ activeMapId: 1, maps: [] })).toBeNull();
  });

  it('keeps the share link a map was loaded from and finds it again', () => {
    const url = 'https://example.com/hq.json';
    const withSource = addToLibrary(library, { id: 'd', name: 'Shared', updatedAt: 4, sourceUrl: url });
    expect(parseLibrary(withSource)).toEqual(withSource);
    expect(findBySource(withSource, url)?.id).toBe('d');
    expect(findBySource(library, url)).toBeUndefined();
  });
});
