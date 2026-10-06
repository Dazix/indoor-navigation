import type { MapData, MapNode } from '../types/map';
import type { MatchResult } from '../types/vision';
import { BASE_SIGMA_M, DRIFT_PER_M, MAX_BOOST, graphDistances, ringLikelihood } from './locationPrior';
import { AUTO_MATCH } from './visionMatcher';

/**
 * Recursive Bayesian filter over the trained places of a map: the belief says how likely the user is
 * at each of them. Every camera frame first moves the belief along the corridors (by the walked
 * distance, when a step counter is available) and then reweights it with how well the frame matches
 * each place. Unlike averaging the last few frames, evidence builds up over the whole scan, and a
 * place the user cannot have walked to in the meantime loses weight.
 */

/** Strength of one frame: the belief in a place is multiplied by exp(GAMMA × similarity in 0–1). */
export const FILTER_GAMMA = 5;
/** Share of the belief spread evenly over all places after every step, so a wrong belief can be left. */
export const FILTER_MIX = 0.02;
/** Without a step counter: weight of staying where the belief is, against moving to another place. */
const STAY_WEIGHT = 1.5;
/** Without a step counter: walking distance in meters that still counts as likely between two frames. */
const FREE_MOVE_M = 8;
/** Walked distance in meters below which the user counts as standing still. */
const STILL_M = 0.5;
/** How much likelier the place of a fresh location fix is than a distant place in the initial belief. */
const PRIOR_STRENGTH = 4;

export interface FilterModel {
  /** The places the belief is about, in the order of the belief array. */
  ids: string[];
  /** `distM[i][j]` is the walking distance in meters from place i to place j, Infinity when not connected. */
  distM: number[][];
}

/** Walking distances between the given places; build it once per map, not per frame. */
export function buildFilterModel(map: MapData, ids: readonly string[]): FilterModel {
  const metersPerUnit = map.metadata.metersPerUnit;
  const distM = ids.map((from) => {
    const units = graphDistances(map, from);
    return ids.map((to) => (units.get(to) ?? Infinity) * metersPerUnit);
  });
  return { ids: [...ids], distM };
}

function normalized(weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  return sum > 0 ? weights.map((w) => w / sum) : weights.map(() => 1 / weights.length);
}

/**
 * The belief before the first frame: even over all places, tilted towards the neighbourhood of a
 * recent fix. `boosts` are the percent-point bonuses of `proximityBoosts`; no place is ruled out,
 * since the user may have gone anywhere since the fix.
 */
export function initialBelief(model: FilterModel, boosts: Readonly<Record<string, number>> = {}): number[] {
  return normalized(model.ids.map((id) => 1 + (PRIOR_STRENGTH * (boosts[id] ?? 0)) / MAX_BOOST));
}

/** Likelihood of moving from place i to place j; `walkedM` is null without a step counter. */
function transition(distM: number, walkedM: number | null): number {
  if (walkedM === null) return distM === 0 ? STAY_WEIGHT : Math.exp(-0.5 * (distM / FREE_MOVE_M) ** 2);
  return ringLikelihood(distM, walkedM, BASE_SIGMA_M + DRIFT_PER_M * walkedM);
}

/**
 * Moves the belief by one step. `walkedM` is the distance in meters walked since the previous frame,
 * or null when the device has no step counter, in which case any short move is allowed. A user who
 * stands still keeps the belief where it is.
 */
export function predictBelief(
  model: FilterModel,
  belief: readonly number[],
  walkedM: number | null,
): number[] {
  const n = belief.length;
  if (n === 0) return [];
  const moved = new Array<number>(n).fill(0);
  const still = walkedM !== null && walkedM < STILL_M;
  for (let i = 0; i < n; i++) {
    const mass = belief[i] as number;
    if (still) {
      moved[i] = (moved[i] as number) + mass;
      continue;
    }
    const row = (model.distM[i] as number[]).map((d) => transition(d, walkedM));
    const total = row.reduce((a, b) => a + b, 0);
    for (let j = 0; j < n; j++)
      moved[j] =
        (moved[j] as number) + (total > 0 ? (mass * (row[j] as number)) / total : j === i ? mass : 0);
  }
  return moved.map((m) => (1 - FILTER_MIX) * m + FILTER_MIX / n);
}

/** Reweights the belief with the similarity (0–1) of the latest frame to each place, in the order of `ids`. */
export function updateBelief(
  belief: readonly number[],
  similarities: readonly number[],
  gamma = FILTER_GAMMA,
): number[] {
  return normalized(belief.map((b, j) => b * Math.exp(gamma * (similarities[j] ?? 0))));
}

/**
 * The places by belief, most likely first. `score` and `thumbnail` come from the latest frame (the raw
 * similarity the user knows from the list), `confidence` is the belief 0–1.
 */
export function rankBelief(
  model: FilterModel,
  belief: readonly number[],
  nodes: Record<string, MapNode>,
  frame: readonly MatchResult[],
  limit = Infinity,
): MatchResult[] {
  const byNode = new Map(frame.map((result) => [result.node.id, result]));
  const ranked: MatchResult[] = [];
  model.ids.forEach((id, i) => {
    const node = nodes[id];
    if (!node) return;
    const result = byNode.get(id);
    ranked.push({
      node,
      score: result?.score ?? 0,
      thumbnail: result?.thumbnail ?? null,
      boost: 0,
      confidence: belief[i],
    });
  });
  return ranked.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)).slice(0, limit);
}

export interface ConfidentMatchOptions {
  /** Belief 0–1 the best place needs. */
  minConfidence: number;
  /** Raw similarity in percent the best place needs in the latest frame. */
  minScore: number;
}

/** What the scanner needs to confirm a place without asking: a belief that has built up, backed by the frame. */
export const AUTO_CONFIDENT: ConfidentMatchOptions = { minConfidence: 0.95, minScore: AUTO_MATCH.minScore };

/** The best place when it is safe to confirm automatically, otherwise null. */
export function pickConfidentMatch(
  ranked: readonly MatchResult[],
  { minConfidence, minScore }: ConfidentMatchOptions,
): MatchResult | null {
  const top = ranked[0];
  if (!top || (top.confidence ?? 0) < minConfidence || top.score < minScore) return null;
  return top;
}
