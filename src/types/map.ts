import type { EmbeddingSample } from './vision';

export interface Point {
  x: number;
  y: number;
}

/** Navigation waypoint. Coordinates are in map units (0–100 on both axes of the floor plan). */
export interface MapNode extends Point {
  id: string;
  label: string;
  /** Code printed in the QR / barcode marker placed at this spot. */
  markerCode: string;
  embeddings: EmbeddingSample[];
  /** Single-vector fingerprint from maps created before walkthrough learning existed. */
  fingerprint?: number[];
}

/** Undirected walkable corridor between two node ids. */
export type Edge = [string, string];

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
}

/** Lightweight entry in the map library; the full MapData lives in IndexedDB. */
export interface MapSummary {
  id: string;
  name: string;
  updatedAt: number;
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
