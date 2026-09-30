import { describe, expect, it } from 'vitest';
import type { MapData, MapNode } from '../../types/map';
import { BOOST_MAX_AGE_MS, MAX_BOOST, proximityBoosts } from '../locationPrior';

function node(id: string, x: number): MapNode {
  return { id, x, y: 0, label: id, markerCode: '', embeddings: [] };
}

// a — b — c in a line, 10 units apart; d is not connected.
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

describe('proximityBoosts', () => {
  const fix = { nodeId: 'a', at: 1000 };

  it('gives the full bonus to the fix node and less to more distant ones', () => {
    const boosts = proximityBoosts(map, fix, 1000);
    expect(boosts['a']).toBeCloseTo(MAX_BOOST);
    // b is 10 units = 5 m away (radius 15 m), c is 10 m away
    expect(boosts['b']).toBeCloseTo(MAX_BOOST * (1 - 5 / 15));
    expect(boosts['c']).toBeCloseTo(MAX_BOOST * (1 - 10 / 15));
    expect(boosts['a']).toBeGreaterThan(boosts['b'] as number);
    expect(boosts['b']).toBeGreaterThan(boosts['c'] as number);
  });

  it('skips unreachable nodes', () => {
    expect(proximityBoosts(map, fix, 1000)['d']).toBeUndefined();
  });

  it('fades with the age of the fix and stops when it is stale', () => {
    const fresh = proximityBoosts(map, fix, 1000)['a'] as number;
    const older = proximityBoosts(map, fix, 1000 + BOOST_MAX_AGE_MS / 2)['a'] as number;
    expect(older).toBeCloseTo(fresh / 2);
    expect(proximityBoosts(map, fix, 1000 + BOOST_MAX_AGE_MS)).toEqual({});
  });

  it('returns nothing without a fix or when the fix node is not on the map', () => {
    expect(proximityBoosts(map, null, 1000)).toEqual({});
    expect(proximityBoosts(map, { nodeId: 'gone', at: 1000 }, 1000)).toEqual({});
  });
});

describe('proximityBoosts with a walk estimate', () => {
  // 1 unit = 1 m. b is a junction: a and c lie on a line through it, d branches off to the south.
  const junction: MapData = {
    ...map,
    metadata: { ...map.metadata, metersPerUnit: 1 },
    nodes: { a: node('a', 0), b: node('b', 20), c: node('c', 40), d: { ...node('d', 20), y: 20 } },
    edges: [
      ['a', 'b'],
      ['b', 'c'],
      ['b', 'd'],
    ],
  };
  const fixAtB = { nodeId: 'b', at: 1000 };
  const boost = (boosts: Record<string, number>, id: string) => boosts[id] ?? 0;

  it('favours the fix node when the user has not walked', () => {
    const boosts = proximityBoosts(junction, fixAtB, 1000, { distanceM: 0, displacementM: { x: 0, y: 0 } });
    expect(boost(boosts, 'b')).toBeCloseTo(MAX_BOOST);
    expect(boost(boosts, 'a')).toBeLessThan(0.1);
  });

  it('treats places at the walked distance as likeliest when no heading is known', () => {
    const boosts = proximityBoosts(junction, fixAtB, 1000, { distanceM: 20, displacementM: null });
    // a, c and d are all 20 m of corridor away; b, where the user may have looped back, is less likely.
    expect(boost(boosts, 'a')).toBeCloseTo(MAX_BOOST);
    expect(boost(boosts, 'c')).toBeCloseTo(boost(boosts, 'a'));
    expect(boost(boosts, 'd')).toBeCloseTo(boost(boosts, 'a'));
    expect(boost(boosts, 'b')).toBeLessThan(boost(boosts, 'a'));
  });

  it('uses the compass displacement to pick the branch', () => {
    const east = proximityBoosts(junction, fixAtB, 1000, { distanceM: 20, displacementM: { x: 20, y: 0 } });
    expect(boost(east, 'c')).toBeCloseTo(MAX_BOOST);
    expect(boost(east, 'c')).toBeGreaterThan(boost(east, 'a') + 4);
    expect(boost(east, 'c')).toBeGreaterThan(boost(east, 'd') + 4);

    const south = proximityBoosts(junction, fixAtB, 1000, { distanceM: 20, displacementM: { x: 0, y: 20 } });
    expect(boost(south, 'd')).toBeGreaterThan(boost(south, 'c') + 4);
  });

  it('keeps the walked-distance prior at half weight when the compass points the wrong way', () => {
    const wrong = proximityBoosts(junction, fixAtB, 1000, { distanceM: 20, displacementM: { x: -20, y: 0 } });
    // The compass says west (a); c is still on a corridor 20 m away.
    expect(boost(wrong, 'a')).toBeCloseTo(MAX_BOOST);
    expect(boost(wrong, 'c')).toBeCloseTo(MAX_BOOST / 2);
  });

  it('widens with the distance walked and still fades with the age of the fix', () => {
    const near = proximityBoosts(junction, fixAtB, 1000, { distanceM: 5, displacementM: null });
    const far = proximityBoosts(junction, fixAtB, 1000, { distanceM: 40, displacementM: null });
    // Two sigmas off the walked distance: nodes 20 m away score higher when the error is larger.
    expect(boost(far, 'a')).toBeGreaterThan(boost(near, 'a'));

    const old = proximityBoosts(junction, fixAtB, 1000 + BOOST_MAX_AGE_MS / 2, {
      distanceM: 20,
      displacementM: null,
    });
    expect(boost(old, 'a')).toBeCloseTo(MAX_BOOST / 2);
  });
});
