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

/** A map drawn narrower than this on screen is on a phone. */
const PHONE_MAP_MAX_PX = 520;
/** Node dots are drawn this much smaller on a phone, where the map is small and the dots crowd it. */
const PHONE_NODE_SHRINK = 0.8;

/** Size multiplier of the node dots (not labels or hit areas) for a map drawn `widthPx` wide. */
export function nodeDotScale(widthPx: number): number {
  return widthPx > 0 && widthPx < PHONE_MAP_MAX_PX ? PHONE_NODE_SHRINK : 1;
}

export function fitView(size: MapSize): MapView {
  return { zoom: 1, cx: size.width / 2, cy: size.height / 2 };
}

/**
 * Share of the visible span the view may be dragged past the map edge, so content under an overlay
 * (search panel, controls) can be pulled into the clear.
 */
export const PAN_SLACK = 0.3;

/** Keeps the zoom in range and the visible area inside the map, give or take `slack` of the visible span. */
export function clampView(view: MapView, size: MapSize, slack = 0): MapView {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom));
  const halfW = size.width / zoom / 2;
  const halfH = size.height / zoom / 2;
  const slackW = halfW * 2 * slack;
  const slackH = halfH * 2 * slack;
  return {
    zoom,
    cx: Math.min(size.width - halfW + slackW, Math.max(halfW - slackW, view.cx)),
    cy: Math.min(size.height - halfH + slackH, Math.max(halfH - slackH, view.cy)),
  };
}

export function viewBoxOf(view: MapView, size: MapSize): ViewBox {
  const w = size.width / view.zoom;
  const h = size.height / view.zoom;
  return { x: view.cx - w / 2, y: view.cy - h / 2, w, h };
}

/** Zooms to `zoom` while the map point `anchor` stays at the same place on screen. */
export function zoomAround(view: MapView, zoom: number, anchor: Point, size: MapSize, slack = 0): MapView {
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  const k = view.zoom / next;
  return clampView(
    { zoom: next, cx: anchor.x - (anchor.x - view.cx) * k, cy: anchor.y - (anchor.y - view.cy) * k },
    size,
    slack,
  );
}

/** User's choice of map orientation: follow the screen shape or force one. */
export type MapRotationPref = 'auto' | 'normal' | 'rotated';

export function parseMapRotationPref(raw: unknown): MapRotationPref | null {
  return raw === 'auto' || raw === 'normal' || raw === 'rotated' ? raw : null;
}

/** Size of the canvas the map is drawn in: the sides swap when the map is turned a quarter. */
export function displaySize(size: MapSize, rotated: boolean): MapSize {
  return rotated ? { width: size.height, height: size.width } : size;
}

/** Where a map point lands in the canvas; a rotated map is turned 90° counter-clockwise. */
export function mapToDisplay(p: Point, size: MapSize, rotated: boolean): Point {
  return rotated ? { x: p.y, y: size.width - p.x } : p;
}

/** SVG transform that turns the map content 90° counter-clockwise into the swapped canvas. */
export function rotatedMapTransform(size: MapSize): string {
  return `matrix(0 -1 1 0 0 ${size.width})`;
}

/** Turning the map has to enlarge it this much to switch on, or shrink it this much to switch off. */
const ROTATE_GAIN = 1.25;

/** Whether turning the map by 90° fits it much better into a `box` of pixels; in between it keeps `wasRotated`. */
export function shouldRotateMap(
  box: { width: number; height: number },
  size: MapSize,
  wasRotated: boolean,
): boolean {
  if (box.width <= 0 || box.height <= 0) return wasRotated;
  const normal = Math.min(box.width / size.width, box.height / size.height);
  const turned = Math.min(box.width / size.height, box.height / size.width);
  const gain = turned / normal;
  if (gain > ROTATE_GAIN) return true;
  if (gain < 1 / ROTATE_GAIN) return false;
  return wasRotated;
}

/** Whether the map is shown turned. Auto only turns it in navigation, the editor keeps the plan upright. */
export function resolveRotated(
  pref: MapRotationPref,
  isEditor: boolean,
  box: { width: number; height: number },
  size: MapSize,
  wasRotated: boolean,
): boolean {
  if (pref === 'rotated') return true;
  if (pref === 'normal' || isEditor) return false;
  return shouldRotateMap(box, size, wasRotated);
}

/** Snap step for placing points: finer when zoomed in for precise drawing. */
export function snapStep(zoom: number): number {
  return zoom >= 4 ? 0.1 : zoom >= 2 ? 0.25 : 0.5;
}
