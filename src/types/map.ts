import type { EmbeddingSample } from './vision';

export interface Point {
  x: number;
  y: number;
}

/** Navigation waypoint. Coordinates are in map units (0–width / 0–height, see MapMetadata). */
export interface MapNode extends Point {
  id: string;
  label: string;
  /** Code printed in the QR / barcode marker placed at this spot. */
  markerCode: string;
  embeddings: EmbeddingSample[];
  /** Single-vector fingerprint from maps created before walkthrough learning existed. */
  fingerprint?: number[];
}

/**
 * Undirected walkable corridor between two node ids. The optional third element holds bend
 * points (corners without a name or marker), ordered from the first node to the second.
 */
export type Edge = [string, string] | [string, string, Point[]];

export interface Room {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  /** Node users navigate to when they tap this room. */
  nodeId: string;
  color: string;
}

export interface MapMetadata {
  name: string;
  version: number;
  /** Real-world length of one map unit, used for distances and pedestrian dead reckoning. */
  metersPerUnit: number;
  /** Compass heading (degrees clockwise from magnetic north) that the top of the floor plan faces. */
  northOffsetDeg: number;
  /** Map extent in units. Units are square; the longer side is 100, the other follows the plan's ratio. */
  width: number;
  height: number;
  /** Rotation of the floor plan image only (degrees clockwise); nodes and rooms are not affected. */
  floorPlanRotationDeg: number;
}

/** Lightweight entry in the map library; the full MapData lives in IndexedDB. */
export interface MapSummary {
  id: string;
  name: string;
  updatedAt: number;
  /** URL the map was loaded from via a share link; loading the same link again updates this map. */
  sourceUrl?: string;
}

export interface MapLibrary {
  activeMapId: string | null;
  maps: MapSummary[];
}

export interface MapData {
  metadata: MapMetadata;
  /** Data URL of an uploaded image, or a path relative to the app base URL. */
  floorPlanImage: string | null;
  nodes: Record<string, MapNode>;
  edges: Edge[];
  rooms: Room[];
}
