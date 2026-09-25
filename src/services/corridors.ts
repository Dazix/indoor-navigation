import type { Edge, MapData, MapNode, Point } from '../types/map';

/** Pure, immutable operations on corridors (edges) and their bend points. */

export function sameEdge(a: string, b: string, [u, v]: Edge): boolean {
  return (u === a && v === b) || (u === b && v === a);
}

export function findEdgeIndex(edges: readonly Edge[], a: string, b: string): number {
  return edges.findIndex((e) => sameEdge(a, b, e));
}

/** Bend points of a corridor, ordered from its first node to its second. */
export function edgeBends(edge: Edge): Point[] {
  return edge[2] ?? [];
}

function withBends([u, v]: Edge, bends: Point[]): Edge {
  return bends.length > 0 ? [u, v, bends] : [u, v];
}

/**
 * Polyline of a corridor including both end nodes, walked from `fromId` (the first node by
 * default). Empty when an end node is missing.
 */
export function corridorPoints(nodes: Record<string, MapNode>, edge: Edge, fromId?: string): Point[] {
  const [u, v] = edge;
  const a = nodes[u];
  const b = nodes[v];
  if (!a || !b) return [];
  const points = [
    { x: a.x, y: a.y },
    ...edgeBends(edge).map((p) => ({ x: p.x, y: p.y })),
    { x: b.x, y: b.y },
  ];
  return fromId === v && fromId !== u ? points.reverse() : points;
}

function replaceEdge(map: MapData, edgeIndex: number, edge: Edge): MapData {
  return { ...map, edges: map.edges.map((e, i) => (i === edgeIndex ? edge : e)) };
}

/** Inserts a bend into segment `segmentIndex` (0 = from the first node to the first bend). */
export function insertBend(map: MapData, edgeIndex: number, segmentIndex: number, point: Point): MapData {
  const edge = map.edges[edgeIndex];
  if (!edge) return map;
  const bends = [...edgeBends(edge)];
  const at = Math.max(0, Math.min(bends.length, segmentIndex));
  bends.splice(at, 0, { x: point.x, y: point.y });
  return replaceEdge(map, edgeIndex, withBends(edge, bends));
}

export function moveBend(map: MapData, edgeIndex: number, bendIndex: number, point: Point): MapData {
  const edge = map.edges[edgeIndex];
  if (!edge || !edgeBends(edge)[bendIndex]) return map;
  const bends = edgeBends(edge).map((p, i) => (i === bendIndex ? { x: point.x, y: point.y } : p));
  return replaceEdge(map, edgeIndex, withBends(edge, bends));
}

export function deleteBend(map: MapData, edgeIndex: number, bendIndex: number): MapData {
  const edge = map.edges[edgeIndex];
  if (!edge || !edgeBends(edge)[bendIndex]) return map;
  return replaceEdge(
    map,
    edgeIndex,
    withBends(
      edge,
      edgeBends(edge).filter((_, i) => i !== bendIndex),
    ),
  );
}

/** Removes a corridor; both of its nodes stay. */
export function deleteEdge(map: MapData, edgeIndex: number): MapData {
  if (!map.edges[edgeIndex]) return map;
  return { ...map, edges: map.edges.filter((_, i) => i !== edgeIndex) };
}

/** Applies `fn` to every bend point of every corridor (for canvas rotation / rescaling). */
export function mapBends(edges: readonly Edge[], fn: (p: Point) => Point): Edge[] {
  return edges.map((edge) => (edge[2] ? withBends(edge, edge[2].map(fn)) : edge));
}

export interface PolylineHit {
  /** Segment from `points[segmentIndex]` to `points[segmentIndex + 1]`. */
  segmentIndex: number;
  /** Closest point on that segment. */
  point: Point;
  distance: number;
}

/** Closest point to `p` on a polyline, or null for fewer than two points. */
export function nearestOnPolyline(points: readonly Point[], p: Point): PolylineHit | null {
  let best: PolylineHit | null = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const point = { x: a.x + dx * t, y: a.y + dy * t };
    const distance = Math.hypot(p.x - point.x, p.y - point.y);
    if (!best || distance < best.distance) best = { segmentIndex: i - 1, point, distance };
  }
  return best;
}
