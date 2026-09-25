import type { MapData, Point } from '../types/map';
import type { NavigationStep, RouteProgress } from '../types/navigation';
import { corridorPoints, findEdgeIndex } from './corridors';
import { bearingBetween, distance, pathLength, pointAlongPath } from './geometry';
import { findShortestPath } from './pathfinding';

export interface Route {
  /** Node ids from the user's location to the destination. */
  path: string[];
  /** Route polyline: the path's nodes with the corridors' bend points in between. */
  points: Point[];
  /** For every point, the index into `path` of the node it leads to (a node maps to itself). */
  pointNodeIndex: number[];
  totalM: number;
  progress: RouteProgress;
  /** Index into `path` of the next node to reach; equals `path.length` once arrived. */
  nextNodeIndex: number;
  /** Next waypoint to walk to, or null once the destination is reached. */
  next: NavigationStep | null;
  arrived: boolean;
}

/** Expands a node path into its polyline, following each corridor's bend points. */
function routePolyline(map: MapData, path: string[]): { points: Point[]; pointNodeIndex: number[] } {
  const points: Point[] = [];
  const pointNodeIndex: number[] = [];
  path.forEach((id, i) => {
    const node = map.nodes[id];
    if (!node) return;
    const prev = path[i - 1];
    const edge = prev === undefined ? undefined : map.edges[findEdgeIndex(map.edges, prev, id)];
    const leg =
      prev !== undefined && edge
        ? corridorPoints(map.nodes, edge, prev).slice(1)
        : [{ x: node.x, y: node.y }];
    for (const p of leg) {
      points.push(p);
      pointNodeIndex.push(i);
    }
  });
  return { points, pointNodeIndex };
}

/**
 * Computes the route from `from` to `to` and where the user is on it after walking `walkedM`
 * meters (pedestrian dead reckoning). Returns null when there is no route.
 */
export function computeRoute(
  map: MapData,
  from: string | null,
  to: string | null,
  walkedM = 0,
): Route | null {
  const path = findShortestPath(from, to, map.nodes, map.edges);
  if (path.length === 0) return null;

  const { points, pointNodeIndex } = routePolyline(map, path);
  const mpu = map.metadata.metersPerUnit;
  const totalM = pathLength(points) * mpu;
  const along = pointAlongPath(points, walkedM / mpu);
  if (!along) return null;

  const walked = Math.min(Math.max(walkedM, 0), totalM);
  const progress: RouteProgress = {
    position: along.point,
    remainingM: totalM - walked,
    nextIndex: along.nextIndex,
  };

  const nextNodeIndex = pointNodeIndex[along.nextIndex] ?? path.length;
  const nextId = path[nextNodeIndex];
  const nextNode = nextId ? map.nodes[nextId] : undefined;
  const nextVertex = points[along.nextIndex];
  let next: NavigationStep | null = null;
  if (nextNode && nextVertex) {
    // Walk to the next vertex (it may be a corridor bend) and on through the bends to the node.
    const toNode = points.slice(along.nextIndex, pointNodeIndex.lastIndexOf(nextNodeIndex) + 1);
    next = {
      node: nextNode,
      bearingDeg: bearingBetween(along.point, nextVertex),
      distanceM: (distance(along.point, nextVertex) + pathLength(toNode)) * mpu,
    };
  }

  return { path, points, pointNodeIndex, totalM, progress, nextNodeIndex, next, arrived: next === null };
}

/** Rounds meters for display: "12 m", or "Here" under one meter. */
export function formatDistance(meters: number): string {
  return meters < 1 ? 'Here' : `${Math.round(meters)} m`;
}
