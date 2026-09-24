import type { MapData, Point } from '../types/map';
import type { NavigationStep, RouteProgress } from '../types/navigation';
import { bearingBetween, distance, pathLength, pointAlongPath } from './geometry';
import { findShortestPath } from './pathfinding';

export interface Route {
  /** Node ids from the user's location to the destination. */
  path: string[];
  points: Point[];
  totalM: number;
  progress: RouteProgress;
  /** Next waypoint to walk to, or null once the destination is reached. */
  next: NavigationStep | null;
  arrived: boolean;
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

  const points = path.flatMap((id) => {
    const node = map.nodes[id];
    return node ? [{ x: node.x, y: node.y }] : [];
  });
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

  const nextId = path[along.nextIndex];
  const nextNode = nextId ? map.nodes[nextId] : undefined;
  const next: NavigationStep | null = nextNode
    ? {
        node: nextNode,
        bearingDeg: bearingBetween(along.point, nextNode),
        distanceM: distance(along.point, nextNode) * mpu,
      }
    : null;

  return { path, points, totalM, progress, next, arrived: next === null };
}

/** Rounds meters for display: "12 m", or "Here" under one meter. */
export function formatDistance(meters: number): string {
  return meters < 1 ? 'Here' : `${Math.round(meters)} m`;
}
