import { describe, expect, it } from 'vitest';
import { addNode, toggleEdge } from './mapEditing';
import { createBlankMap } from './mapLibrary';
import { computeRoute, formatDistance } from './navigation';

// L-shaped corridor: a (10,90) → b (10,50) → c (50,50); 1 unit = 0.5 m, so 20 m + 20 m.
let map = createBlankMap('Route test');
map = { ...map, metadata: { ...map.metadata, metersPerUnit: 0.5 } };
map = addNode(map, { id: 'a', x: 10, y: 90, label: 'A', markerCode: '' });
map = addNode(map, { id: 'b', x: 10, y: 50, label: 'B', markerCode: '' });
map = addNode(map, { id: 'c', x: 50, y: 50, label: 'C', markerCode: '' });
map = toggleEdge(toggleEdge(map, 'a', 'b'), 'b', 'c');

describe('computeRoute', () => {
  it('returns path, length and the first step heading up the map', () => {
    const route = computeRoute(map, 'a', 'c');
    expect(route?.path).toEqual(['a', 'b', 'c']);
    expect(route?.totalM).toBe(40);
    expect(route?.next).toMatchObject({ bearingDeg: 0, distanceM: 20 });
    expect(route?.next?.node.id).toBe('b');
    expect(route?.arrived).toBe(false);
  });

  it('advances the position with walked distance and turns right after the corner', () => {
    const route = computeRoute(map, 'a', 'c', 30);
    expect(route?.progress).toEqual({ position: { x: 30, y: 50 }, remainingM: 10, nextIndex: 2 });
    expect(route?.next?.node.id).toBe('c');
    expect(route?.next?.bearingDeg).toBeCloseTo(90);
  });

  it('reports arrival at the end of the route or when already there', () => {
    expect(computeRoute(map, 'a', 'c', 100)).toMatchObject({ arrived: true, next: null });
    expect(computeRoute(map, 'c', 'c')).toMatchObject({ arrived: true, totalM: 0 });
  });

  it('returns null without a route', () => {
    expect(computeRoute(map, 'a', null)).toBeNull();
    expect(
      computeRoute(addNode(map, { id: 'x', x: 90, y: 90, label: 'X', markerCode: '' }), 'a', 'x'),
    ).toBeNull();
  });
});

describe('formatDistance', () => {
  it('rounds to whole meters', () => {
    expect(formatDistance(0.4)).toBe('Here');
    expect(formatDistance(12.6)).toBe('13 m');
  });
});
