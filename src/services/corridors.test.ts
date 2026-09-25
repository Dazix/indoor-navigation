import { describe, expect, it } from 'vitest';
import {
  corridorPoints,
  deleteBend,
  deleteEdge,
  edgeBends,
  findEdgeIndex,
  insertBend,
  mapBends,
  moveBend,
  nearestOnPolyline,
} from './corridors';
import { createBlankMap } from './mapLibrary';
import { addNode, toggleEdge } from './mapEditing';

function sampleMap() {
  let map = createBlankMap('Test');
  map = addNode(map, { id: 'a', x: 10, y: 10, label: 'A', markerCode: 'LOC-A' });
  map = addNode(map, { id: 'b', x: 30, y: 30, label: 'B', markerCode: 'LOC-B' });
  return toggleEdge(map, 'a', 'b');
}

describe('corridors', () => {
  it('finds corridors regardless of direction', () => {
    const map = sampleMap();
    expect(findEdgeIndex(map.edges, 'b', 'a')).toBe(0);
    expect(findEdgeIndex(map.edges, 'a', 'x')).toBe(-1);
  });

  it('inserts, moves and deletes bend points', () => {
    let map = insertBend(sampleMap(), 0, 0, { x: 30, y: 10 });
    expect(map.edges[0]).toEqual(['a', 'b', [{ x: 30, y: 10 }]]);

    map = insertBend(map, 0, 0, { x: 20, y: 10 });
    expect(edgeBends(map.edges[0] ?? ['a', 'b'])).toEqual([
      { x: 20, y: 10 },
      { x: 30, y: 10 },
    ]);

    map = moveBend(map, 0, 1, { x: 30, y: 12 });
    expect(edgeBends(map.edges[0] ?? ['a', 'b'])[1]).toEqual({ x: 30, y: 12 });

    map = deleteBend(deleteBend(map, 0, 0), 0, 0);
    expect(map.edges[0]).toEqual(['a', 'b']);
  });

  it('ignores unknown corridors and bends', () => {
    const map = sampleMap();
    expect(insertBend(map, 5, 0, { x: 1, y: 1 })).toBe(map);
    expect(moveBend(map, 0, 0, { x: 1, y: 1 })).toBe(map);
    expect(deleteBend(map, 0, 0)).toBe(map);
    expect(deleteEdge(map, 3)).toBe(map);
  });

  it('builds the polyline in the walking direction', () => {
    const map = insertBend(sampleMap(), 0, 0, { x: 30, y: 10 });
    const edge = map.edges[0] ?? ['a', 'b'];
    expect(corridorPoints(map.nodes, edge)).toEqual([
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
    ]);
    expect(corridorPoints(map.nodes, edge, 'b')).toEqual([
      { x: 30, y: 30 },
      { x: 30, y: 10 },
      { x: 10, y: 10 },
    ]);
    expect(corridorPoints(map.nodes, ['a', 'missing'])).toEqual([]);
  });

  it('deletes a corridor but keeps its nodes', () => {
    const map = deleteEdge(sampleMap(), 0);
    expect(map.edges).toEqual([]);
    expect(Object.keys(map.nodes)).toEqual(['a', 'b']);
  });

  it('maps bend points of all corridors', () => {
    const map = insertBend(sampleMap(), 0, 0, { x: 30, y: 10 });
    expect(mapBends(map.edges, (p) => ({ x: p.y, y: p.x }))).toEqual([['a', 'b', [{ x: 10, y: 30 }]]]);
  });

  it('projects a point onto the closest segment', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(nearestOnPolyline(points, { x: 4, y: 2 })).toEqual({
      segmentIndex: 0,
      point: { x: 4, y: 0 },
      distance: 2,
    });
    expect(nearestOnPolyline(points, { x: 12, y: 6 })?.segmentIndex).toBe(1);
    expect(nearestOnPolyline(points, { x: -5, y: 0 })?.point).toEqual({ x: 0, y: 0 });
    expect(nearestOnPolyline([{ x: 0, y: 0 }], { x: 1, y: 1 })).toBeNull();
  });
});
