import type { EmbeddingModelId } from '../services/embeddingModels';
import type { MapNode } from './map';

/** One learned viewpoint of a place: a compact feature vector plus a small preview image. */
export interface EmbeddingSample {
  id: string;
  /** JPEG data URL, ~120x90 px. */
  thumbnail: string;
  /**
   * The frame the vectors were computed from (JPEG data URL, see `captureFrame`). With it the vectors
   * can be recomputed by another model. Missing in views recorded before this existed.
   */
  frame?: string;
  /** L2-normalized feature vector (256-D from MobileNet, 192-D from the fallback extractor). */
  vector: number[];
  timestamp: number;
  /**
   * Compass heading of the camera in degrees when the view was recorded. Missing in older maps
   * and when the device has no absolute compass.
   */
  headingDeg?: number;
  /**
   * Feature vectors of the left and right half of the frame. They keep the layout of the scene, so
   * rooms that are mirror images of each other (window left vs. right of the TV) can be told apart.
   * Missing in older maps; such views are compared on the whole frame only.
   */
  tiles?: number[][];
  /**
   * Vectors of the same `frame` computed by the other models, keyed by model id. `vector` and `tiles`
   * always belong to the map's active model; switching models swaps them with this cache so nothing
   * is embedded twice. Local only: it is left out of exports, share links and cloud sync.
   */
  alt?: Partial<Record<EmbeddingModelId, ViewVectors>>;
}

/** The vectors a model computed for one view. */
export interface ViewVectors {
  vector: number[];
  tiles?: number[][];
}

export interface MatchResult {
  node: MapNode;
  /** Similarity in percent, 0–100. */
  score: number;
  thumbnail: string | null;
  /** Ranking bonus in percent points from the location prior; `score` stays the raw similarity. */
  boost?: number;
}

export type EmbeddingEngine = 'mobilenet' | 'fallback';

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Anything MobileNet and a 2D canvas can read pixels from. */
export type PixelSource = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement;
