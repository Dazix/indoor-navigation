import type { Point } from '../types/map';
import type { MapSize } from './mapEditing';

/** Zoomed view of the map: `zoom` × magnification centred on (cx, cy) in map units. */
export interface MapView {
  zoom: number;
  cx: number;
  cy: number;
}

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

/**
 * Screen pixels per map unit up to which markers keep their designed size. A phone-width map stays
 * below it; a large desktop map would blow nodes and routes up, so they are shrunk back to it.
 */
const MARKER_MAX_PX_PER_UNIT = 5;

/** Marker size multiplier at 1× zoom for a map drawn `widthPx` wide on screen. */
export function markerBaseScale(widthPx: number, mapWidth: number): number {
  const pxPerUnit = widthPx / mapWidth;
  return pxPerUnit > MARKER_MAX_PX_PER_UNIT ? MARKER_MAX_PX_PER_UNIT / pxPerUnit : 1;
}

export function fitView(size: MapSize): MapView {
  return { zoom: 1, cx: size.width / 2, cy: size.height / 2 };
}

/** Keeps the zoom in range and the visible area inside the map. */
export function clampView(view: MapView, size: MapSize): MapView {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom));
  const halfW = size.width / zoom / 2;
  const halfH = size.height / zoom / 2;
  return {
    zoom,
    cx: Math.min(size.width - halfW, Math.max(halfW, view.cx)),
    cy: Math.min(size.height - halfH, Math.max(halfH, view.cy)),
  };
}

export function viewBoxOf(view: MapView, size: MapSize): ViewBox {
  const w = size.width / view.zoom;
  const h = size.height / view.zoom;
  return { x: view.cx - w / 2, y: view.cy - h / 2, w, h };
}

/** Zooms to `zoom` while the map point `anchor` stays at the same place on screen. */
export function zoomAround(view: MapView, zoom: number, anchor: Point, size: MapSize): MapView {
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  const k = view.zoom / next;
  return clampView(
    { zoom: next, cx: anchor.x - (anchor.x - view.cx) * k, cy: anchor.y - (anchor.y - view.cy) * k },
    size,
  );
}

/** Snap step for placing points: finer when zoomed in for precise drawing. */
export function snapStep(zoom: number): number {
  return zoom >= 4 ? 0.1 : zoom >= 2 ? 0.25 : 0.5;
}
