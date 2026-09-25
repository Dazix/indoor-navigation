import type { MapData } from '../types/map';

export interface PlaceMatch {
  /** Node to navigate to or select. */
  nodeId: string;
  label: string;
  kind: 'location' | 'room';
  /** Location label shown under a room name, or the marker code of a location. */
  detail: string;
}

/** Lower case without diacritics, so "kuch" finds "Kuchyňka". */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** 0 for a name starting with the query, 1 for a word starting with it, 2 for any match, null for none. */
function rank(text: string, query: string): number | null {
  const t = normalizeText(text);
  if (t.startsWith(query)) return 0;
  if (t.split(/[\s\-_/.,()]+/).some((word) => word.startsWith(query))) return 1;
  return t.includes(query) ? 2 : null;
}

/**
 * Locations (by name or marker code) and rooms (by name) matching `query`, best matches first.
 * Each node appears once; rooms only when their linked node exists.
 */
export function searchPlaces(map: MapData, query: string, limit = 8): PlaceMatch[] {
  const q = normalizeText(query);
  if (!q) return [];

  const best = new Map<string, { match: PlaceMatch; score: number }>();
  const offer = (match: PlaceMatch, score: number | null) => {
    if (score === null) return;
    const current = best.get(match.nodeId);
    if (!current || score < current.score) best.set(match.nodeId, { match, score });
  };

  for (const node of Object.values(map.nodes)) {
    const byLabel = rank(node.label, q);
    const byCode = node.markerCode ? rank(node.markerCode, q) : null;
    const score = byLabel ?? (byCode === null ? null : byCode + 3);
    offer({ nodeId: node.id, label: node.label, kind: 'location', detail: node.markerCode }, score);
  }
  for (const room of map.rooms) {
    const node = map.nodes[room.nodeId];
    if (!node) continue;
    offer({ nodeId: node.id, label: room.label, kind: 'room', detail: node.label }, rank(room.label, q));
  }

  return [...best.values()]
    .sort((a, b) => a.score - b.score || a.match.label.localeCompare(b.match.label))
    .slice(0, limit)
    .map(({ match }) => match);
}
