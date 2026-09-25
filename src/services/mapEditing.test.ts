import { describe, expect, it } from 'vitest';
import { edgeBends, insertBend } from './corridors';
import { createBlankMap } from './mapLibrary';
import {
  addNode,
  canvasRatioForImage,
  deleteNode,
  floorPlanFineDeg,
  longSideMeters,
  mapSize,
  metersPerUnitForLongSide,
  metersPerUnitForSegment,
  rotateMap90,
  setEmbeddings,
  setFloorPlan,
  setFloorPlanFineRotation,
  setMapAspect,
  snapToMap,
  toggleEdge,
  updateNode,
} from './mapEditing';

function sampleMap() {
  let map = createBlankMap('Test');
  map = addNode(map, { id: 'a', x: 10, y: 10, label: 'A', markerCode: 'LOC-A' });
  map = addNode(map, { id: 'b', x: 20, y: 10, label: 'B', markerCode: 'LOC-B' });
  map = addNode(map, { id: 'c', x: 30, y: 10, label: 'C', markerCode: 'LOC-C' });
  return toggleEdge(toggleEdge(map, 'a', 'b'), 'b', 'c');
}

describe('map editing', () => {
  it('toggles corridors regardless of direction', () => {
    const map = sampleMap();
    expect(map.edges).toEqual([
      ['a', 'b'],
      ['b', 'c'],
    ]);
    expect(toggleEdge(map, 'b', 'a').edges).toEqual([['b', 'c']]);
  });

  it('ignores self-loops and unknown nodes', () => {
    const map = sampleMap();
    expect(toggleEdge(map, 'a', 'a')).toBe(map);
    expect(toggleEdge(map, 'a', 'ghost')).toBe(map);
  });

  it('deletes a node with its corridors', () => {
    const map = deleteNode(sampleMap(), 'b');
    expect(Object.keys(map.nodes)).toEqual(['a', 'c']);
    expect(map.edges).toEqual([]);
  });

  it('updates node fields without mutating the original', () => {
    const map = sampleMap();
    const next = updateNode(map, 'a', { label: 'Lobby' });
    expect(next.nodes.a?.label).toBe('Lobby');
    expect(map.nodes.a?.label).toBe('A');
  });

  it('replaces the legacy fingerprint when embeddings are saved', () => {
    const map = updateNode(sampleMap(), 'a', { fingerprint: [1, 0] });
    const sample = { id: 's', thumbnail: 'data:image/jpeg;base64,', vector: [1], timestamp: 0 };
    const next = setEmbeddings(map, 'a', [sample]);
    expect(next.nodes.a?.embeddings).toEqual([sample]);
    expect(next.nodes.a?.fingerprint).toBeUndefined();
  });

  it('snaps points into the map space', () => {
    const size = { width: 100, height: 60 };
    expect(snapToMap({ x: -4, y: 42.26 }, size)).toEqual({ x: 0, y: 42.5 });
    expect(snapToMap({ x: 130, y: 70.1 }, size)).toEqual({ x: 100, y: 60 });
    expect(snapToMap({ x: 12.345, y: 7.07 }, size, 0.1)).toEqual({ x: 12.3, y: 7.1 });
  });
});

describe('map size and aspect ratio', () => {
  it('keeps the longer side at 100 units', () => {
    expect(mapSize(16 / 9)).toEqual({ width: 100, height: 56.3 });
    expect(mapSize(0.5)).toEqual({ width: 50, height: 100 });
    expect(mapSize(1)).toEqual({ width: 100, height: 100 });
    expect(mapSize(NaN)).toEqual({ width: 100, height: 100 });
  });

  it('rescales nodes and rooms with the canvas', () => {
    let map = sampleMap();
    map = {
      ...map,
      rooms: [{ id: 'r', x: 10, y: 20, w: 40, h: 50, label: 'R', nodeId: 'a', color: '#fff' }],
    };
    const wide = setMapAspect(map, 2);
    expect([wide.metadata.width, wide.metadata.height]).toEqual([100, 50]);
    expect(wide.nodes.a).toMatchObject({ x: 10, y: 5 });
    expect(wide.rooms[0]).toMatchObject({ x: 10, y: 10, w: 40, h: 25 });
    expect(setMapAspect(map, 1)).toBe(map);
  });

  it('takes the ratio of a new floor plan image', () => {
    const map = setFloorPlan(sampleMap(), 'data:image/png;base64,', 4 / 3);
    expect([map.metadata.width, map.metadata.height]).toEqual([100, 75]);
    expect(setFloorPlan(map, null).metadata.height).toBe(75);
  });

  it('converts the longer side to metres and back', () => {
    const { metadata } = setMapAspect(sampleMap(), 0.5);
    expect(metersPerUnitForLongSide(metadata, 42)).toBeCloseTo(0.42);
    expect(longSideMeters({ ...metadata, metersPerUnit: 0.42 })).toBeCloseTo(42);
  });

  it('derives the scale from one measured line', () => {
    expect(metersPerUnitForSegment({ x: 10, y: 10 }, { x: 30, y: 10 }, 5)).toBeCloseTo(0.25);
    expect(metersPerUnitForSegment({ x: 0, y: 0 }, { x: 3, y: 4 }, 10)).toBeCloseTo(2);
  });

  it('rejects a measured line that gives no valid scale', () => {
    const a = { x: 10, y: 10 };
    expect(metersPerUnitForSegment(a, a, 5)).toBeNull();
    expect(metersPerUnitForSegment(a, { x: 20, y: 10 }, 0)).toBeNull();
    expect(metersPerUnitForSegment(a, { x: 20, y: 10 }, NaN)).toBeNull();
    expect(metersPerUnitForSegment(a, { x: 10.5, y: 10 }, 100)).toBeNull();
  });
});

describe('rotation', () => {
  it('turns the whole design by 90° and swaps the canvas sides', () => {
    let map = setMapAspect(sampleMap(), 2); // 100 × 50, node a at (10, 5)
    map = { ...map, rooms: [{ id: 'r', x: 0, y: 0, w: 20, h: 10, label: 'R', nodeId: 'a', color: '#fff' }] };
    const cw = rotateMap90(map, true);
    expect([cw.metadata.width, cw.metadata.height]).toEqual([50, 100]);
    expect(cw.nodes.a).toMatchObject({ x: 45, y: 10 });
    expect(cw.rooms[0]).toMatchObject({ x: 40, y: 0, w: 10, h: 20 });
    expect(cw.metadata.floorPlanRotationDeg).toBe(90);
    expect(cw.metadata.northOffsetDeg).toBe(270);

    const back = rotateMap90(cw, false);
    expect(back.nodes.a).toMatchObject({ x: 10, y: 5 });
    expect(back.rooms[0]).toMatchObject({ x: 0, y: 0, w: 20, h: 10 });
    expect(back.metadata).toMatchObject({
      width: 100,
      height: 50,
      floorPlanRotationDeg: 0,
      northOffsetDeg: 0,
    });
  });

  it('moves corridor bends with the canvas', () => {
    const map = insertBend(sampleMap(), 0, 0, { x: 10, y: 20 });
    expect(edgeBends(setMapAspect(map, 2).edges[0] ?? ['a', 'b'])).toEqual([{ x: 10, y: 10 }]);
    const cw = rotateMap90(map, true);
    expect(edgeBends(cw.edges[0] ?? ['a', 'b'])).toEqual([{ x: 80, y: 10 }]);
    expect(rotateMap90(cw, false).edges).toEqual(map.edges);
  });

  it('straightens only the image and keeps its quarter turns', () => {
    const turned = rotateMap90(sampleMap(), true);
    const fine = setFloorPlanFineRotation(turned, 3.5);
    expect(fine.metadata.floorPlanRotationDeg).toBe(93.5);
    expect(floorPlanFineDeg(fine.metadata.floorPlanRotationDeg)).toBe(3.5);
    expect(fine.nodes).toBe(turned.nodes);
    expect(floorPlanFineDeg(setFloorPlanFineRotation(turned, 80).metadata.floorPlanRotationDeg)).toBe(44.5);
  });

  it('fits the canvas to a quarter-turned image', () => {
    const turned = rotateMap90(sampleMap(), true);
    expect(canvasRatioForImage(turned, 2)).toBe(0.5);
    expect(canvasRatioForImage(sampleMap(), 2)).toBe(2);
  });
});
