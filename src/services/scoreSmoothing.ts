import type { MatchResult } from '../types/vision';

/** `frames` with `frame` appended, keeping only the newest `size` frames. */
export function pushFrame<T>(frames: readonly T[], frame: T, size: number): T[] {
  return [...frames, frame].slice(-size);
}

interface Tally {
  /** Newest appearance of the node; its location bonus is the one that counts. */
  latest: MatchResult;
  sum: number;
  bestScore: number;
  thumbnail: string | null;
}

/**
 * Averages the ranking of the last few camera frames. A single frame of an open space can jump to
 * a look-alike place; a place that keeps scoring high over several frames is the one to trust.
 *
 * A node absent from a frame counts as 0 in that frame, so one lucky frame cannot carry a place.
 * The thumbnail is from the frame where the place matched best.
 */
export function smoothMatches(frames: readonly (readonly MatchResult[])[], limit = Infinity): MatchResult[] {
  const tallies = new Map<string, Tally>();
  for (const frame of frames) {
    for (const result of frame) {
      const tally = tallies.get(result.node.id) ?? { latest: result, sum: 0, bestScore: -1, thumbnail: null };
      tally.latest = result;
      tally.sum += result.score;
      if (result.score > tally.bestScore) {
        tally.bestScore = result.score;
        tally.thumbnail = result.thumbnail;
      }
      tallies.set(result.node.id, tally);
    }
  }

  return [...tallies.values()]
    .map(({ latest, sum, thumbnail }) => ({
      node: latest.node,
      score: Math.round(sum / frames.length),
      thumbnail,
      boost: latest.boost ?? 0,
    }))
    .sort((a, b) => b.score + b.boost - (a.score + a.boost))
    .slice(0, limit);
}
