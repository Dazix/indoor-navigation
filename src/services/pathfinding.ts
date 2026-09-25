import type { Edge, MapNode } from '../types/map';
import { corridorPoints } from './corridors';
import { distance, pathLength } from './geometry';

export type Graph = Map<string, { id: string; cost: number }[]>;

/**
 * Builds an undirected adjacency list weighted by corridor length (through its bend points).
 * Edges to missing nodes are skipped.
 */
export function buildGraph(nodes: Record<string, MapNode>, edges: readonly Edge[]): Graph {
  const graph: Graph = new Map();
  for (const edge of edges) {
    const [u, v] = edge;
    const a = nodes[u];
    const b = nodes[v];
    if (!a || !b || u === v) continue;
    const cost = pathLength(corridorPoints(nodes, edge));
    if (!graph.has(u)) graph.set(u, []);
    if (!graph.has(v)) graph.set(v, []);
    graph.get(u)?.push({ id: v, cost });
    graph.get(v)?.push({ id: u, cost });
  }
  return graph;
}

/**
 * Shortest walkable route between two nodes (A* with a straight-line heuristic).
 * Returns the node ids from start to target, or an empty array when unreachable.
 */
export function findShortestPath(
  startId: string | null,
  targetId: string | null,
  nodes: Record<string, MapNode>,
  edges: readonly Edge[],
): string[] {
  if (!startId || !targetId) return [];
  const start = nodes[startId];
  const target = nodes[targetId];
  if (!start || !target) return [];
  if (startId === targetId) return [startId];

  const graph = buildGraph(nodes, edges);
  const gScore = new Map<string, number>([[startId, 0]]);
  const cameFrom = new Map<string, string>();
  const closed = new Set<string>();
  // Office graphs have tens of nodes, so a linear-scan open set is simpler and fast enough.
  const open = new Map<string, number>([[startId, distance(start, target)]]);

  while (open.size > 0) {
    let current = '';
    let best = Infinity;
    for (const [id, f] of open) {
      if (f < best) {
        best = f;
        current = id;
      }
    }

    if (current === targetId) {
      const path = [current];
      let step = cameFrom.get(current);
      while (step !== undefined) {
        path.push(step);
        step = cameFrom.get(step);
      }
      return path.reverse();
    }

    open.delete(current);
    closed.add(current);
    const currentG = gScore.get(current) ?? Infinity;

    for (const { id, cost } of graph.get(current) ?? []) {
      if (closed.has(id)) continue;
      const tentative = currentG + cost;
      if (tentative < (gScore.get(id) ?? Infinity)) {
        cameFrom.set(id, current);
        gScore.set(id, tentative);
        const node = nodes[id];
        open.set(id, tentative + (node ? distance(node, target) : 0));
      }
    }
  }

  return [];
}
