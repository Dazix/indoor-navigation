import { describe, expect, it } from 'vitest';
import type { MapData, MapNode } from '../../types/map';
import type { MatchResult } from '../../types/vision';
import {
  AUTO_CONFIDENT,
  FILTER_MIX,
  buildFilterModel,
  initialBelief,
  pickConfidentMatch,
  predictBelief,
  rankBelief,
  updateBelief,
} from '../positionFilter';

function node(id: string, x: number): MapNode {
  return { id, x, y: 0, label: id, markerCode: '', embeddings: [] };
}

// a — b — c in a line, 10 units (5 m) apart; d is not connected.
const map: MapData = {
  metadata: {
    name: 'test',
    version: 1,
    metersPerUnit: 0.5,
    northOffsetDeg: 0,
    width: 100,
    height: 100,
    floorPlanRotationDeg: 0,
  },
  floorPlanImage: null,
  nodes: { a: node('a', 0), b: node('b', 10), c: node('c', 20), d: node('d', 90) },
  edges: [
    ['a', 'b'],
    ['b', 'c'],
  ],
  rooms: [],
};
const model = buildFilterModel(map, ['a', 'b', 'c', 'd']);

function match(id: string, score: number, thumbnail: string | null = null): MatchResult {
  return { node: node(id, 0), score, thumbnail };
}

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

describe('buildFilterModel', () => {
  it('measures walking distances between the places in meters', () => {
    expect(model.distM[0]).toEqual([0, 5, 10, Infinity]);
    expect(model.distM[2]?.[0]).toBe(10);
  });

  it('marks places that are not connected as unreachable', () => {
    expect(model.distM[3]?.[0]).toBe(Infinity);
    expect(model.distM[3]?.[3]).toBe(0);
  });
});

describe('initialBelief', () => {
  it('is even without a fix', () => {
    expect(initialBelief(model)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it('tilts towards the fix but rules nothing out', () => {
    const belief = initialBelief(model, { a: 10, b: 5 });
    expect(sum(belief)).toBeCloseTo(1);
    expect(belief[0]).toBeGreaterThan(belief[1] as number);
    expect(belief[1]).toBeGreaterThan(belief[2] as number);
    expect(belief[3]).toBeGreaterThan(0);
  });
});

describe('updateBelief', () => {
  it('favours the place that looks most like the frame', () => {
    const belief = updateBelief(initialBelief(model), [0.8, 0.5, 0.5, 0.5]);
    expect(sum(belief)).toBeCloseTo(1);
    expect(belief[0]).toBeGreaterThan(belief[1] as number);
  });

  it('leaves the belief alone when all places look equally alike', () => {
    const before = [0.1, 0.2, 0.3, 0.4];
    const after = updateBelief(before, [0.6, 0.6, 0.6, 0.6]);
    after.forEach((p, i) => {
      expect(p).toBeCloseTo(before[i] as number);
    });
  });

  it('builds up evidence over frames', () => {
    const frame = [0.7, 0.5, 0.5, 0.5];
    const once = updateBelief(initialBelief(model), frame);
    const twice = updateBelief(once, frame);
    expect(twice[0]).toBeGreaterThan(once[0] as number);
  });

  it('does not reach automatic confidence from a single strong frame', () => {
    const belief = updateBelief(initialBelief(model), [0.95, 0.3, 0.3, 0.3]);
    expect(Math.max(...belief)).toBeLessThan(AUTO_CONFIDENT.minConfidence);
  });
});

describe('predictBelief', () => {
  const atA = [1, 0, 0, 0];

  it('keeps the belief when the user stands still', () => {
    const next = predictBelief(model, atA, 0);
    expect(sum(next)).toBeCloseTo(1);
    expect(next[0]).toBeCloseTo(1 - FILTER_MIX + FILTER_MIX / 4);
  });

  it('moves the belief to the places the walked distance leads to', () => {
    const next = predictBelief(model, atA, 5);
    expect(sum(next)).toBeCloseTo(1);
    expect(next[1]).toBeGreaterThan(next[0] as number);
    expect(next[1]).toBeGreaterThan(next[2] as number);
  });

  it('never moves belief to a place that cannot be reached, apart from the recovery floor', () => {
    expect(predictBelief(model, atA, 20)[3]).toBeCloseTo(FILTER_MIX / 4);
  });

  it('allows short moves without a step counter, nearer places more likely', () => {
    const next = predictBelief(model, atA, null);
    expect(sum(next)).toBeCloseTo(1);
    expect(next[0]).toBeGreaterThan(next[1] as number);
    expect(next[1]).toBeGreaterThan(next[2] as number);
    expect(next[2]).toBeGreaterThan(next[3] as number);
  });

  it('handles a model without places', () => {
    expect(predictBelief(buildFilterModel(map, []), [], 3)).toEqual([]);
  });

  it('lets the walk decide between two places that look the same', () => {
    const moved = predictBelief(model, atA, 5);
    const belief = updateBelief(moved, [0.5, 0.6, 0.6, 0.5]);
    expect(belief[1]).toBeGreaterThan(belief[2] as number);
  });
});

describe('recovery', () => {
  it('leaves a wrong belief once the frames keep pointing elsewhere', () => {
    let belief = initialBelief(model);
    for (let i = 0; i < 6; i++) belief = updateBelief(predictBelief(model, belief, 0), [0.9, 0.1, 0.1, 0.1]);
    expect(belief[0]).toBeGreaterThan(0.9);
    for (let i = 0; i < 3; i++) belief = updateBelief(predictBelief(model, belief, 0), [0.1, 0.1, 0.9, 0.1]);
    expect(belief.indexOf(Math.max(...belief))).toBe(2);
  });
});

describe('rankBelief', () => {
  const belief = [0.1, 0.6, 0.3, 0];

  it('orders by belief and takes score and thumbnail from the latest frame', () => {
    const ranked = rankBelief(model, belief, map.nodes, [match('c', 70, 'c.jpg'), match('b', 55)]);
    expect(ranked.map((r) => r.node.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(ranked[0]).toMatchObject({ score: 55, thumbnail: null, confidence: 0.6 });
    expect(ranked[1]).toMatchObject({ score: 70, thumbnail: 'c.jpg' });
  });

  it('scores a place missing from the frame as 0', () => {
    const ranked = rankBelief(model, belief, map.nodes, []);
    expect(ranked.every((r) => r.score === 0)).toBe(true);
  });

  it('skips places that are no longer on the map and honours the limit', () => {
    const nodes = Object.fromEntries(Object.entries(map.nodes).filter(([id]) => id !== 'b'));
    expect(rankBelief(model, belief, nodes, []).map((r) => r.node.id)).toEqual(['c', 'a', 'd']);
    expect(rankBelief(model, belief, map.nodes, [], 2)).toHaveLength(2);
  });
});

describe('pickConfidentMatch', () => {
  const ranked = (confidence: number, score: number): MatchResult[] => [
    { ...match('a', score), confidence },
    { ...match('b', 10), confidence: 1 - confidence },
  ];

  it('confirms a place the belief has built up on and the frame backs', () => {
    expect(pickConfidentMatch(ranked(0.98, 85), AUTO_CONFIDENT)?.node.id).toBe('a');
  });

  it('asks when the belief is not strong enough', () => {
    expect(pickConfidentMatch(ranked(0.8, 90), AUTO_CONFIDENT)).toBeNull();
  });

  it('asks when the frame itself does not look like the place', () => {
    expect(pickConfidentMatch(ranked(0.99, 60), AUTO_CONFIDENT)).toBeNull();
  });

  it('finds nothing in an empty list', () => {
    expect(pickConfidentMatch([], AUTO_CONFIDENT)).toBeNull();
  });
});
