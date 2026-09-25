import type { MapData, MapMetadata, MapNode, Point } from '../types/map';
import type { EmbeddingSample } from '../types/vision';

/** Pure, immutable editor operations on a map. */

export function createNodeId(): string {
  return `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function addNode(map: MapData, node: Omit<MapNode, 'embeddings'>): MapData {
  return { ...map, nodes: { ...map.nodes, [node.id]: { ...node, embeddings: [] } } };
}

export function updateNode(map: MapData, id: string, patch: Partial<Omit<MapNode, 'id'>>): MapData {
  const node = map.nodes[id];
  if (!node) return map;
  return { ...map, nodes: { ...map.nodes, [id]: { ...node, ...patch } } };
}

export function moveNode(map: MapData, id: string, to: Point): MapData {
  return updateNode(map, id, { x: to.x, y: to.y });
}

/** Removes a node together with its corridors. Rooms linked to it stay but become non-navigable. */
export function deleteNode(map: MapData, id: string): MapData {
  if (!(id in map.nodes)) return map;
  const nodes = Object.fromEntries(Object.entries(map.nodes).filter(([key]) => key !== id));
  return { ...map, nodes, edges: map.edges.filter(([a, b]) => a !== id && b !== id) };
}

function sameEdge(a: string, b: string, [u, v]: [string, string]): boolean {
  return (u === a && v === b) || (u === b && v === a);
}

/** Adds a corridor between two nodes, or removes it when it already exists. */
export function toggleEdge(map: MapData, a: string, b: string): MapData {
  if (a === b || !(a in map.nodes) || !(b in map.nodes)) return map;
  const exists = map.edges.some((e) => sameEdge(a, b, e));
  return {
    ...map,
    edges: exists ? map.edges.filter((e) => !sameEdge(a, b, e)) : [...map.edges, [a, b]],
  };
}

export function setEmbeddings(map: MapData, id: string, embeddings: EmbeddingSample[]): MapData {
  // Once a node has walkthrough samples the legacy fingerprint is no longer needed.
  return updateNode(map, id, { embeddings, fingerprint: undefined });
}

export interface MapSize {
  width: number;
  height: number;
}

/** Length of the longer map side in units. */
export const MAP_LONG_SIDE = 100;

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Map extent for a width / height ratio: the longer side is MAP_LONG_SIDE units. */
export function mapSize(ratio: number): MapSize {
  if (!Number.isFinite(ratio) || ratio <= 0) return { width: MAP_LONG_SIDE, height: MAP_LONG_SIDE };
  return ratio >= 1
    ? { width: MAP_LONG_SIDE, height: Math.max(1, round1(MAP_LONG_SIDE / ratio)) }
    : { width: Math.max(1, round1(MAP_LONG_SIDE * ratio)), height: MAP_LONG_SIDE };
}

/**
 * Changes the map's width / height ratio. Nodes and rooms are rescaled with the canvas so they
 * stay on the same spot of the (stretched-to-fit) floor plan.
 */
export function setMapAspect(map: MapData, ratio: number): MapData {
  const { width, height } = mapSize(ratio);
  const sx = width / map.metadata.width;
  const sy = height / map.metadata.height;
  if (sx === 1 && sy === 1) return map;
  const nodes = Object.fromEntries(
    Object.entries(map.nodes).map(([id, n]) => [id, { ...n, x: round1(n.x * sx), y: round1(n.y * sy) }]),
  );
  const rooms = map.rooms.map((r) => ({
    ...r,
    x: round1(r.x * sx),
    y: round1(r.y * sy),
    w: Math.max(0.1, round1(r.w * sx)),
    h: Math.max(0.1, round1(r.h * sy)),
  }));
  return { ...map, nodes, rooms, metadata: { ...map.metadata, width, height } };
}

/** Quarter turns (0–3) contained in the floor plan rotation. */
export function floorPlanQuarterTurns(rotationDeg: number): number {
  return ((Math.round(rotationDeg / 90) % 4) + 4) % 4;
}

/** Canvas ratio that shows an image of `imageRatio` undistorted under the map's floor plan rotation. */
export function canvasRatioForImage(map: MapData, imageRatio: number): number {
  return floorPlanQuarterTurns(map.metadata.floorPlanRotationDeg) % 2 ? 1 / imageRatio : imageRatio;
}

/** Sets the floor plan; with the image's width / height ratio the map takes that ratio too. */
export function setFloorPlan(map: MapData, floorPlanImage: string | null, imageRatio?: number): MapData {
  let next: MapData = { ...map, floorPlanImage };
  if (floorPlanImage && imageRatio) {
    next = updateMetadata(next, { floorPlanRotationDeg: 0 });
    next = setMapAspect(next, imageRatio);
  }
  return next;
}

/** Largest fine rotation; staying below 45° keeps the quarter-turn count unambiguous. */
export const MAX_FINE_ROTATION_DEG = 44.5;

/** Fine rotation of the floor plan image on top of its quarter turns. */
export function floorPlanFineDeg(rotationDeg: number): number {
  return rotationDeg - Math.round(rotationDeg / 90) * 90;
}

/** Sets the fine rotation (±MAX_FINE_ROTATION_DEG) of the floor plan image, keeping its quarter turns. */
export function setFloorPlanFineRotation(map: MapData, fineDeg: number): MapData {
  const quarters = floorPlanQuarterTurns(map.metadata.floorPlanRotationDeg);
  const fine = Math.max(-MAX_FINE_ROTATION_DEG, Math.min(MAX_FINE_ROTATION_DEG, fineDeg));
  return updateMetadata(map, { floorPlanRotationDeg: quarters * 90 + fine });
}

/**
 * Turns the whole design by 90° (clockwise when `clockwise`): floor plan, nodes and rooms. The
 * canvas swaps its sides and the compass offset follows, so navigation keeps working.
 */
export function rotateMap90(map: MapData, clockwise: boolean): MapData {
  const { width: w, height: h } = map.metadata;
  const turn = (p: Point): Point => (clockwise ? { x: h - p.y, y: p.x } : { x: p.y, y: w - p.x });
  const nodes = Object.fromEntries(Object.entries(map.nodes).map(([id, n]) => [id, { ...n, ...turn(n) }]));
  const rooms = map.rooms.map((r) => {
    const a = turn({ x: r.x, y: r.y });
    const b = turn({ x: r.x + r.w, y: r.y + r.h });
    return {
      ...r,
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: r.h,
      h: r.w,
    };
  });
  const delta = clockwise ? 90 : -90;
  const { floorPlanRotationDeg, northOffsetDeg } = map.metadata;
  return {
    ...map,
    nodes,
    rooms,
    metadata: {
      ...map.metadata,
      width: h,
      height: w,
      floorPlanRotationDeg: ((((floorPlanRotationDeg + delta + 180) % 360) + 360) % 360) - 180,
      northOffsetDeg: (((northOffsetDeg - delta) % 360) + 360) % 360,
    },
  };
}

export function updateMetadata(map: MapData, patch: Partial<MapMetadata>): MapData {
  return { ...map, metadata: { ...map.metadata, ...patch } };
}

/** Real-world length of the map's longer side in metres. */
export function longSideMeters(metadata: MapMetadata): number {
  return Math.max(metadata.width, metadata.height) * metadata.metersPerUnit;
}

/** Scale (m / unit) that makes the longer map side `meters` long. */
export function metersPerUnitForLongSide(metadata: MapMetadata, meters: number): number {
  return meters / Math.max(metadata.width, metadata.height);
}

/** Clamps a point into the map and rounds it to `step` units. */
export function snapToMap({ x, y }: Point, size: MapSize, step = 0.5): Point {
  const snap = (v: number, max: number) =>
    Math.round(Math.round(Math.min(max, Math.max(0, v)) / step) * step * 100) / 100;
  return { x: snap(x, size.width), y: snap(y, size.height) };
}
