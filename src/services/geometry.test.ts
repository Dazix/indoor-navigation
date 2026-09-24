import { describe, expect, it } from 'vitest';
import { bearingBetween, normalizeDeg, pathLength, pointAlongPath } from './geometry';

describe('bearingBetween', () => {
  const origin = { x: 50, y: 50 };

  it('measures clockwise from the top of the map', () => {
    expect(bearingBetween(origin, { x: 50, y: 10 })).toBeCloseTo(0);
    expect(bearingBetween(origin, { x: 90, y: 50 })).toBeCloseTo(90);
    expect(bearingBetween(origin, { x: 50, y: 90 })).toBeCloseTo(180);
    expect(bearingBetween(origin, { x: 10, y: 50 })).toBeCloseTo(270);
  });
});

describe('normalizeDeg', () => {
  it('wraps into [0, 360)', () => {
    expect(normalizeDeg(-90)).toBe(270);
    expect(normalizeDeg(720)).toBe(0);
  });
});

describe('pointAlongPath', () => {
  const path = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];

  it('computes total length', () => {
    expect(pathLength(path)).toBe(20);
  });

  it('interpolates inside a segment', () => {
    expect(pointAlongPath(path, 5)).toEqual({ point: { x: 5, y: 0 }, nextIndex: 1 });
    expect(pointAlongPath(path, 15)).toEqual({ point: { x: 10, y: 5 }, nextIndex: 2 });
  });

  it('moves to the next segment exactly at a vertex', () => {
    expect(pointAlongPath(path, 10)).toEqual({ point: { x: 10, y: 0 }, nextIndex: 2 });
  });

  it('clamps to both ends', () => {
    expect(pointAlongPath(path, -3)).toEqual({ point: { x: 0, y: 0 }, nextIndex: 1 });
    expect(pointAlongPath(path, 99)).toEqual({ point: { x: 10, y: 10 }, nextIndex: 3 });
    expect(pointAlongPath([], 1)).toBeNull();
  });
});
