import type { Point } from '../types/map';

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Normalizes any angle to [0, 360). */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Bearing from `a` to `b` in degrees clockwise from the top of the map
 * (0 = up, 90 = right). Map y grows downwards, as in SVG.
 */
export function bearingBetween(a: Point, b: Point): number {
  return normalizeDeg((Math.atan2(b.x - a.x, a.y - b.y) * 180) / Math.PI);
}

export function pathLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distance(points[i - 1] as Point, points[i] as Point);
  }
  return total;
}

export interface PointOnPath {
  point: Point;
  /** Index of the first path vertex not yet reached. Equals `points.length` at the end. */
  nextIndex: number;
}

/** Walks `travelled` units along a polyline and returns the reached point. Clamped to both ends. */
export function pointAlongPath(points: readonly Point[], travelled: number): PointOnPath | null {
  const first = points[0];
  if (!first) return null;
  if (travelled <= 0) return { point: { x: first.x, y: first.y }, nextIndex: 1 };

  let remaining = travelled;
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1] as Point;
    const to = points[i] as Point;
    const segment = distance(from, to);
    if (remaining < segment) {
      const t = remaining / segment;
      return { point: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, nextIndex: i };
    }
    remaining -= segment;
  }

  const last = points[points.length - 1] as Point;
  return { point: { x: last.x, y: last.y }, nextIndex: points.length };
}
