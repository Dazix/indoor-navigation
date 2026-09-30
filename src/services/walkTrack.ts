import type { Point } from '../types/map';
import { normalizeDeg } from './geometry';

/** Steps counted since some starting point, plus the direction they went in. */
export interface WalkTrack {
  steps: number;
  /** Steps taken while an absolute compass heading was known. */
  headingSteps: number;
  /** Displacement in meters in the compass frame. */
  east: number;
  north: number;
}

export const EMPTY_WALK: WalkTrack = { steps: 0, headingSteps: 0, east: 0, north: 0 };

/** Adds one step of `stepLengthM` taken facing `headingDeg` (compass degrees, null when unknown). */
export function addStep(track: WalkTrack, stepLengthM: number, headingDeg: number | null): WalkTrack {
  if (headingDeg === null) return { ...track, steps: track.steps + 1 };
  const rad = (normalizeDeg(headingDeg) * Math.PI) / 180;
  return {
    steps: track.steps + 1,
    headingSteps: track.headingSteps + 1,
    east: track.east + stepLengthM * Math.sin(rad),
    north: track.north + stepLengthM * Math.cos(rad),
  };
}

/** Share of steps that needs a known heading before the displacement can be trusted. */
export const MIN_HEADING_SHARE = 0.8;

/**
 * Displacement in meters on the floor plan (x to the right, y down), or null when too many steps
 * were taken without a compass heading. `northOffsetDeg` is the compass heading the top of the
 * plan faces.
 */
export function planDisplacement(track: WalkTrack, northOffsetDeg: number): Point | null {
  if (track.steps === 0) return { x: 0, y: 0 };
  if (track.headingSteps < track.steps * MIN_HEADING_SHARE) return null;
  const rad = (normalizeDeg(northOffsetDeg) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: track.east * cos - track.north * sin,
    y: -(track.north * cos + track.east * sin),
  };
}
