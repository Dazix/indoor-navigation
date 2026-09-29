import type { MapData } from '../types/map';
import { buildGraph } from './pathfinding';

/** Last location the user confirmed (scan, QR code or manual pick). */
export interface LocationFix {
  nodeId: string;
  /** `Date.now()` when it was confirmed. */
  at: number;
}

/** Largest score bonus in percent points, for the fix node itself right after it was confirmed. */
export const MAX_BOOST = 10;
/** Places further than this (walking distance) from the fix get no bonus. */
export const BOOST_RADIUS_M = 15;
/** After this long the fix is considered stale and gives no bonus. */
export const BOOST_MAX_AGE_MS = 5 * 60_000;

/** Walking distance in map units from `startId` to every reachable node (Dijkstra). */
function graphDistances(map: MapData, startId: string): Map<string, number> {
  const graph = buildGraph(map.nodes, map.edges);
  const dist = new Map<string, number>([[startId, 0]]);
  const open = new Set<string>([startId]);
  while (open.size > 0) {
    let current = '';
    let best = Infinity;
    for (const id of open) {
      const d = dist.get(id) ?? Infinity;
      if (d < best) {
        best = d;
        current = id;
      }
    }
    open.delete(current);
    for (const next of graph.get(current) ?? []) {
      const d = best + next.cost;
      if (d < (dist.get(next.id) ?? Infinity)) {
        dist.set(next.id, d);
        open.add(next.id);
      }
    }
  }
  return dist;
}

/**
 * Score bonus per node id for places near the last fix. Fades linearly with walking distance and
 * with the age of the fix. It is a bonus rather than a filter, because after the app was closed or
 * the phone put away the user may be anywhere; a stale or unknown fix simply gives nothing.
 */
export function proximityBoosts(map: MapData, fix: LocationFix | null, now: number): Record<string, number> {
  if (!fix || !(fix.nodeId in map.nodes)) return {};
  const freshness = 1 - (now - fix.at) / BOOST_MAX_AGE_MS;
  if (freshness <= 0) return {};

  const boosts: Record<string, number> = {};
  for (const [id, units] of graphDistances(map, fix.nodeId)) {
    const proximity = 1 - (units * map.metadata.metersPerUnit) / BOOST_RADIUS_M;
    if (proximity > 0) boosts[id] = MAX_BOOST * proximity * Math.min(1, freshness);
  }
  return boosts;
}
