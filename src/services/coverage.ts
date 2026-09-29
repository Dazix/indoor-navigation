import type { EmbeddingSample } from '../types/vision';
import { cosineSimilarity, EMBEDDING_SIZE } from './visionMatcher';

/** Two frames at least this similar count as the same view (heuristic for MobileNet embeddings). */
export const SAME_VIEW_SIMILARITY = 0.85;
/** Distinct views that make a place well covered. */
export const GOOD_VIEWS = 8;
/** Below this many distinct views a place is only recognised from about one spot. */
export const MIN_VIEWS = 4;
/** Number of latest frames that must all repeat known views before the user is told to move. */
export const REPEAT_WINDOW = 4;

export type CoverageLevel = 'low' | 'ok' | 'good';

export interface CoverageReport {
  /** Number of clearly different views among the samples. */
  views: number;
  level: CoverageLevel;
  /** 0–1 progress towards `GOOD_VIEWS`. */
  progress: number;
}

/**
 * Greedy clustering in recording order: a sample is a new view when it is not similar to any
 * earlier new view. Returns one flag per sample.
 */
export function markNewViews(
  samples: readonly EmbeddingSample[],
  threshold = SAME_VIEW_SIMILARITY,
): boolean[] {
  const leaders: number[][] = [];
  return samples.map((sample) => {
    const known = leaders.some((leader) => cosineSimilarity(leader, sample.vector) >= threshold);
    if (!known) leaders.push(sample.vector);
    return !known;
  });
}

/** Only MobileNet vectors are comparable enough to judge coverage; the colour fallback is not. */
function judgeable(samples: readonly EmbeddingSample[]): EmbeddingSample[] {
  return samples.filter((s) => s.vector.length === EMBEDDING_SIZE);
}

/** Coverage of a place, or null when its samples cannot be judged (none, or colour fallback only). */
export function coverageReport(samples: readonly EmbeddingSample[]): CoverageReport | null {
  const usable = judgeable(samples);
  if (usable.length === 0) return null;
  const views = markNewViews(usable).filter(Boolean).length;
  const level: CoverageLevel = views >= GOOD_VIEWS ? 'good' : views >= MIN_VIEWS ? 'ok' : 'low';
  return { views, level, progress: Math.min(1, views / GOOD_VIEWS) };
}

/**
 * True when the latest frames only repeat views recorded earlier, i.e. the user stands still or
 * keeps pointing the same way. False until there are enough frames to tell.
 */
export function isRepeating(samples: readonly EmbeddingSample[], window = REPEAT_WINDOW): boolean {
  const usable = judgeable(samples);
  if (usable.length <= window) return false;
  return !markNewViews(usable).slice(-window).some(Boolean);
}
