import type { MapNode } from './map';

/** One learned viewpoint of a place: a compact feature vector plus a small preview image. */
export interface EmbeddingSample {
  id: string;
  /** JPEG data URL, ~120x90 px. */
  thumbnail: string;
  /** L2-normalized feature vector (256-D from MobileNet, 192-D from the fallback extractor). */
  vector: number[];
  timestamp: number;
}

export interface MatchResult {
  node: MapNode;
  /** Similarity in percent, 0–100. */
  score: number;
  thumbnail: string | null;
}

export type EmbeddingEngine = 'mobilenet' | 'fallback';

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Anything MobileNet and a 2D canvas can read pixels from. */
export type PixelSource = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement;
