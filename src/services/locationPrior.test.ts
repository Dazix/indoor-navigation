import { describe, expect, it } from 'vitest';
import type { MapData, MapNode } from '../types/map';
import { BOOST_MAX_AGE_MS, MAX_BOOST, proximityBoosts } from './locationPrior';

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
