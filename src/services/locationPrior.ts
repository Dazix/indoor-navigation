import type { MapData, Point } from '../types/map';
import { distance } from './geometry';
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
export function graphDistances(map: MapData, startId: string): Map<string, number> {
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

/** What pedestrian dead reckoning measured since the fix. */
export interface WalkEstimate {
  /** Distance walked in meters (step count × step length). */
  distanceM: number;
  /** Displacement on the floor plan in meters (x right, y down), or null without a usable compass. */
  displacementM: Point | null;
}

/** Position error of a dead-reckoned estimate even right after the fix, in meters. */
export const BASE_SIGMA_M = 2;
/** Error growth per meter walked: step length and compass heading both drift. */
export const DRIFT_PER_M = 0.25;
/** Weight of the walked-distance ring next to the compass-based estimate, which may be off indoors. */
const RING_WEIGHT = 0.5;

/** Bell curve: 1 at zero error, about 0.6 at one sigma. */
function bell(error: number, sigma: number): number {
  return Math.exp(-0.5 * (error / sigma) ** 2);
}

/**
 * Likelihood 0–1 of a place `graphM` walking meters from the fix after `walkedM` meters of steps.
 * Places around that distance are likeliest; nearer ones stay possible, since the user may have
 * looped back, and farther ones fade with the drift.
 */
export function ringLikelihood(graphM: number, walkedM: number, sigma: number): number {
  if (graphM > walkedM) return bell(graphM - walkedM, sigma);
  return walkedM === 0 ? 1 : 0.5 + 0.5 * (graphM / walkedM);
}

/**
 * Score bonus per node id for places where the user probably is. It is a bonus rather than a
 * filter, because after the app was closed or the phone put away the user may be anywhere; a
 * stale or unknown fix simply gives nothing. It fades with the age of the fix.
 *
 * Without a walk estimate (no motion sensor) it is a disc around the fix that fades with walking
 * distance. With one it follows the user: the compass displacement from the fix node when available,
 * together with a ring at the walked distance along the corridors.
 */
export function proximityBoosts(
  map: MapData,
  fix: LocationFix | null,
  now: number,
  walk: WalkEstimate | null = null,
): Record<string, number> {
  const fixNode = fix ? map.nodes[fix.nodeId] : undefined;
  if (!fix || !fixNode) return {};
  const freshness = Math.min(1, 1 - (now - fix.at) / BOOST_MAX_AGE_MS);
  if (freshness <= 0) return {};

  const mpu = map.metadata.metersPerUnit;
  const sigma = BASE_SIGMA_M + DRIFT_PER_M * (walk?.distanceM ?? 0);
  const estimate = walk?.displacementM
    ? { x: fixNode.x + walk.displacementM.x / mpu, y: fixNode.y + walk.displacementM.y / mpu }
    : null;

  const boosts: Record<string, number> = {};
  for (const [id, units] of graphDistances(map, fix.nodeId)) {
    let proximity: number;
    if (!walk) {
      proximity = 1 - (units * mpu) / BOOST_RADIUS_M;
    } else {
      const ring = ringLikelihood(units * mpu, walk.distanceM, sigma);
      const node = map.nodes[id];
      proximity =
        estimate && node ? Math.max(bell(distance(node, estimate) * mpu, sigma), RING_WEIGHT * ring) : ring;
    }
    if (proximity > 0) boosts[id] = MAX_BOOST * proximity * freshness;
  }
  return boosts;
}
