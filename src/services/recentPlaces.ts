import type { MapData } from '../types/map';
import type { PlaceMatch } from './placeSearch';

/** How many recently picked places a search field offers. */
export const RECENT_LIMIT = 5;

const STORAGE_PREFIX = 'indoor_nav_recent_places_v1:';

/** Puts `id` first, drops its earlier occurrence and keeps at most `limit` ids. */
export function addRecent(ids: readonly string[], id: string, limit = RECENT_LIMIT): string[] {
  return [id, ...ids.filter((x) => x !== id)].slice(0, limit);
}

/** Decodes stored JSON; anything that is not a list of strings yields an empty history. */
export function parseRecent(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string').slice(0, RECENT_LIMIT);
}

/** Recent ids as search results, newest first. Locations deleted since are left out. */
export function resolveRecent(map: MapData, ids: readonly string[]): PlaceMatch[] {
  const matches: PlaceMatch[] = [];
  for (const id of ids) {
    const node = map.nodes[id];
    if (node) matches.push({ nodeId: node.id, label: node.label, kind: 'location', detail: node.markerCode });
  }
  return matches;
}

/** History of one map, shared by all of its search fields. Empty when storage is unavailable. */
export function loadRecent(mapId: string): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + mapId);
    return raw === null ? [] : parseRecent(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Best effort: a full or blocked storage only costs the history. */
export function saveRecent(mapId: string, ids: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + mapId, JSON.stringify(ids));
  } catch {
    // ignore
  }
}
