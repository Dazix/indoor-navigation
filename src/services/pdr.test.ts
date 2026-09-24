import { describe, expect, it } from 'vitest';
import { createStepDetector, type MotionSample } from './pdr';

const G = 9.81;
const RATE_HZ = 50;

/** Simulated phone in hand: gravity on z plus a vertical bounce at the given cadence. */
function walk(seconds: number, stepsPerSecond: number, amplitude: number, noise = 0): MotionSample[] {
  const samples: MotionSample[] = [];
  for (let i = 0; i < seconds * RATE_HZ; i++) {
    const t = (i / RATE_HZ) * 1000;
    const bounce = amplitude * Math.sin(2 * Math.PI * stepsPerSecond * (t / 1000));
    const jitter = noise ? noise * Math.sin(i * 12.9898) : 0;
    samples.push({ x: 0.2, y: 0.3, z: G + bounce + jitter, t });
  }
  return samples;
}

function countSteps(samples: MotionSample[], detector = createStepDetector()): number {
  return samples.filter((s) => detector(s)).length;
}

describe('createStepDetector', () => {
  it('counts steps of a regular 2 Hz walk', () => {
    const steps = countSteps(walk(10, 2, 3));
    expect(steps).toBeGreaterThanOrEqual(18);
    expect(steps).toBeLessThanOrEqual(20);
  });

  it('ignores a phone lying still or small tremor', () => {
    expect(countSteps(walk(10, 2, 0))).toBe(0);
    expect(countSteps(walk(10, 5, 0.3, 0.2))).toBe(0);
  });

  it('suppresses peaks closer than minIntervalMs', () => {
    // 5 "steps" per second are faster than a human walks; with 400 ms spacing at most 2.5/s pass.
    const steps = countSteps(walk(10, 5, 3), createStepDetector({ minIntervalMs: 400 }));
    expect(steps).toBeLessThanOrEqual(25);
    expect(steps).toBeGreaterThan(0);
  });
});
