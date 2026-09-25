import { describe, expect, it } from 'vitest';
import { clampView, fitView, snapStep, viewBoxOf, zoomAround } from './viewport';

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

  it('uses a finer snap when zoomed in', () => {
    expect([snapStep(1), snapStep(2), snapStep(6)]).toEqual([0.5, 0.25, 0.1]);
  });
});
