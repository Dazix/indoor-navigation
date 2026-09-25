import type { MapNode, Point } from './map';

export type AppMode = 'user' | 'editor' | 'ar';

export type EditorTool = 'select' | 'add_node' | 'link_nodes' | 'delete';

/** Browser permission state for camera and motion sensors. */
export type SensorPermission = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported';

/** Where the user is heading next along the active route. */
export interface NavigationStep {
  node: MapNode;
  /**
   * Bearing on the map from the user to the next route vertex (`node` or a corridor bend before
   * it), degrees clockwise from the top of the floor plan.
   */
  bearingDeg: number;
  /** Walking distance to `node` along the route. */
  distanceM: number;
}

export interface RouteProgress {
  /** Interpolated user position along the route. */
  position: Point;
  /** Meters left to the destination. */
  remainingM: number;
  /** Index into the route points of the next vertex (node or bend) to reach. */
  nextIndex: number;
}
