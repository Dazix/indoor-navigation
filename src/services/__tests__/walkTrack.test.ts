import { describe, expect, it } from 'vitest';
import { addStep, EMPTY_WALK, planDisplacement, type WalkTrack } from '../walkTrack';

function walkSteps(count: number, headingDeg: number | null, from: WalkTrack = EMPTY_WALK): WalkTrack {
  let track = from;
  for (let i = 0; i < count; i++) track = addStep(track, 0.7, headingDeg);
  return track;
}

describe('planDisplacement', () => {
  it('maps a walk towards north to "up" on a plan that faces north', () => {
    const d = planDisplacement(walkSteps(10, 0), 0);
    expect(d?.x).toBeCloseTo(0);
    expect(d?.y).toBeCloseTo(-7);
  });

  it('maps east to the right and south to down', () => {
    const east = planDisplacement(walkSteps(10, 90), 0);
    expect(east?.x).toBeCloseTo(7);
    expect(east?.y).toBeCloseTo(0);
    const south = planDisplacement(walkSteps(10, 180), 0);
    expect(south?.y).toBeCloseTo(7);
  });

  it('follows the compass heading the plan faces', () => {
    // The top of the plan faces east, so walking east goes up the plan.
    const d = planDisplacement(walkSteps(10, 90), 90);
    expect(d?.x).toBeCloseTo(0);
    expect(d?.y).toBeCloseTo(-7);
  });

  it('cancels out when walking back', () => {
    const d = planDisplacement(walkSteps(10, 180, walkSteps(10, 0)), 0);
    expect(d?.x).toBeCloseTo(0);
    expect(d?.y).toBeCloseTo(0);
  });

  it('is unknown when too many steps lacked a heading, and zero before any step', () => {
    expect(planDisplacement(walkSteps(10, null, walkSteps(5, 0)), 0)).toBeNull();
    expect(planDisplacement(walkSteps(1, null, walkSteps(9, 0)), 0)).not.toBeNull();
    expect(planDisplacement(EMPTY_WALK, 0)).toEqual({ x: 0, y: 0 });
  });
});
