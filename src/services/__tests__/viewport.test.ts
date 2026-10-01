import { describe, expect, it } from 'vitest';
import {
  clampView,
  displaySize,
  fitView,
  mapToDisplay,
  markerBaseScale,
  nodeDotScale,
  parseMapRotationPref,
  resolveRotated,
  rotatedMapTransform,
  shouldRotateMap,
  snapStep,
  viewBoxOf,
  zoomAround,
} from '../viewport';

const size = { width: 100, height: 50 };

describe('map viewport', () => {
  it('fits the whole map by default', () => {
    expect(viewBoxOf(fitView(size), size)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
  });

  it('keeps zoom in range and the view inside the map', () => {
    expect(clampView({ zoom: 0.2, cx: 0, cy: 0 }, size)).toEqual({ zoom: 1, cx: 50, cy: 25 });
    expect(clampView({ zoom: 2, cx: 100, cy: 0 }, size)).toEqual({ zoom: 2, cx: 75, cy: 12.5 });
    expect(clampView({ zoom: 50, cx: 50, cy: 25 }, size).zoom).toBe(8);
  });

  it('zooms around an anchor that stays fixed on screen', () => {
    const view = zoomAround(fitView(size), 2, { x: 50, y: 25 }, size);
    expect(view).toEqual({ zoom: 2, cx: 50, cy: 25 });
    const corner = zoomAround(fitView(size), 4, { x: 0, y: 0 }, size);
    expect(viewBoxOf(corner, size)).toEqual({ x: 0, y: 0, w: 25, h: 12.5 });
  });

  it('keeps marker size on a phone-width map and shrinks it on a large one', () => {
    expect(markerBaseScale(360, 100)).toBe(1);
    expect(markerBaseScale(1000, 100)).toBe(0.5);
    expect(markerBaseScale(0, 100)).toBe(1);
  });

  it('draws node dots smaller on a phone-width map only', () => {
    expect(nodeDotScale(360)).toBe(0.8);
    expect(nodeDotScale(800)).toBe(1);
    expect(nodeDotScale(0)).toBe(1);
  });

  it('uses a finer snap when zoomed in', () => {
    expect([snapStep(1), snapStep(2), snapStep(6)]).toEqual([0.5, 0.25, 0.1]);
  });
});

describe('map rotation', () => {
  it('swaps the canvas sides only when rotated', () => {
    expect(displaySize(size, false)).toEqual(size);
    expect(displaySize(size, true)).toEqual({ width: 50, height: 100 });
  });

  it('turns the map 90° counter-clockwise', () => {
    expect(mapToDisplay({ x: 0, y: 0 }, size, true)).toEqual({ x: 0, y: 100 });
    expect(mapToDisplay({ x: 100, y: 0 }, size, true)).toEqual({ x: 0, y: 0 });
    expect(mapToDisplay({ x: 100, y: 50 }, size, true)).toEqual({ x: 50, y: 0 });
    expect(mapToDisplay({ x: 50, y: 25 }, size, true)).toEqual({ x: 25, y: 50 });
    expect(mapToDisplay({ x: 30, y: 10 }, size, false)).toEqual({ x: 30, y: 10 });
  });

  it('uses an SVG transform that matches mapToDisplay', () => {
    expect(rotatedMapTransform(size)).toBe('matrix(0 -1 1 0 0 100)');
  });

  it('turns a wide map on a portrait screen and not on a landscape one', () => {
    expect(shouldRotateMap({ width: 360, height: 700 }, size, false)).toBe(true);
    expect(shouldRotateMap({ width: 1200, height: 700 }, size, false)).toBe(false);
  });

  it('turns a tall map on a landscape screen', () => {
    expect(shouldRotateMap({ width: 360, height: 700 }, { width: 50, height: 100 }, false)).toBe(false);
    expect(shouldRotateMap({ width: 700, height: 360 }, { width: 50, height: 100 }, false)).toBe(true);
  });

  it('never turns a square map', () => {
    expect(shouldRotateMap({ width: 360, height: 700 }, { width: 100, height: 100 }, false)).toBe(false);
    expect(shouldRotateMap({ width: 360, height: 700 }, { width: 100, height: 100 }, true)).toBe(true);
  });

  it('keeps the current state while the gain is small', () => {
    // 100×50 map in a 100×110 box: turning gains 1.1×, between the two thresholds.
    const box = { width: 100, height: 110 };
    expect(shouldRotateMap(box, size, false)).toBe(false);
    expect(shouldRotateMap(box, size, true)).toBe(true);
    expect(shouldRotateMap({ width: 0, height: 0 }, size, true)).toBe(true);
  });

  it('lets a manual choice override auto, and keeps the editor upright in auto', () => {
    const phone = { width: 360, height: 700 };
    expect(resolveRotated('auto', false, phone, size, false)).toBe(true);
    expect(resolveRotated('auto', true, phone, size, false)).toBe(false);
    expect(resolveRotated('normal', false, phone, size, false)).toBe(false);
    expect(resolveRotated('rotated', true, { width: 1200, height: 700 }, size, false)).toBe(true);
  });

  it('parses a stored preference', () => {
    expect(parseMapRotationPref('rotated')).toBe('rotated');
    expect(parseMapRotationPref('sideways')).toBeNull();
    expect(parseMapRotationPref(null)).toBeNull();
  });
});
