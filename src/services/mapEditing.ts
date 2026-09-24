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

export function setFloorPlan(map: MapData, floorPlanImage: string | null): MapData {
  return { ...map, floorPlanImage };
}

export function updateMetadata(map: MapData, patch: Partial<MapMetadata>): MapData {
  return { ...map, metadata: { ...map.metadata, ...patch } };
}

/** Clamps a point to the 0–100 map space and rounds it to 0.5 units. */
export function snapToMap({ x, y }: Point): Point {
  const snap = (v: number) => Math.round(Math.min(100, Math.max(0, v)) * 2) / 2;
  return { x: snap(x), y: snap(y) };
}
