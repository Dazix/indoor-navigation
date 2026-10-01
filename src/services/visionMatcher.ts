import type { MapNode } from '../types/map';
import type { MatchResult, PixelSource } from '../types/vision';
import { angleDiffDeg } from './geometry';
import { TO_URL_PARAM } from './mapSharing';

/** Length of the stored MobileNet embedding after downsampling (keeps exported JSON compact). */
export const EMBEDDING_SIZE = 256;

/**
 * Cosine similarity of two vectors, clamped to [0, 1].
 * Vectors of different length come from different extractors and are not comparable, so they score 0.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return Math.max(0, Math.min(1, dot / Math.sqrt(normA * normB)));
}

function normalize(values: ArrayLike<number>): number[] {
  let sumSq = 0;
  for (let i = 0; i < values.length; i++) sumSq += (values[i] as number) ** 2;
  const norm = Math.sqrt(sumSq) || 1;
  return Array.from(values, (v) => Number((v / norm).toFixed(4)));
}

/** Strided downsampling of a raw embedding to `size` dimensions, then L2 normalization. */
export function compactEmbedding(raw: ArrayLike<number>, size = EMBEDDING_SIZE): number[] {
  const step = Math.max(1, Math.floor(raw.length / size));
  const picked: number[] = [];
  for (let i = 0; i < raw.length && picked.length < size; i += step) picked.push(raw[i] as number);
  return normalize(picked);
}

/**
 * Mean of every learned vector of the given length across the map, or null when there are none.
 * In a large uniform room all views share most of their features ("looks like the open space");
 * subtracting this mean before comparing leaves what tells the places apart.
 */
export function meanEmbedding(nodes: Record<string, MapNode>, size = EMBEDDING_SIZE): number[] | null {
  const sum = new Array<number>(size).fill(0);
  let count = 0;
  for (const node of Object.values(nodes)) {
    for (const sample of node.embeddings) {
      if (sample.vector.length !== size) continue;
      for (let i = 0; i < size; i++) sum[i] = (sum[i] as number) + (sample.vector[i] as number);
      count++;
    }
  }
  return count === 0 ? null : sum.map((v) => v / count);
}

/** Cosine similarity of `a` and `b` after subtracting `center` from both; see `meanEmbedding`. */
export function centeredCosineSimilarity(
  a: readonly number[],
  b: readonly number[],
  center: readonly number[],
): number {
  if (a.length !== center.length || b.length !== center.length) return cosineSimilarity(a, b);
  return cosineSimilarity(
    a.map((v, i) => v - (center[i] as number)),
    b.map((v, i) => v - (center[i] as number)),
  );
}

/** Number of vertical strips a frame is split into (left half, right half). */
export const TILE_COUNT = 2;
/** Length of a stored MobileNet tile vector. */
export const TILE_EMBEDDING_SIZE = 128;
/** Share of the tile similarity in the score of a view that has tiles; the rest is the whole frame. */
export const TILE_WEIGHT = 0.5;

/**
 * Per tile position, the mean of every learned tile vector of the given length, or null when no view
 * has tiles of that size. The counterpart of `meanEmbedding` for the halves of the frame.
 */
export function meanTileEmbeddings(
  nodes: Record<string, MapNode>,
  size = TILE_EMBEDDING_SIZE,
): number[][] | null {
  const sums = Array.from({ length: TILE_COUNT }, () => new Array<number>(size).fill(0));
  let count = 0;
  for (const node of Object.values(nodes)) {
    for (const sample of node.embeddings) {
      const tiles = sample.tiles;
      if (tiles?.length !== TILE_COUNT || tiles.some((t) => t.length !== size)) continue;
      tiles.forEach((tile, t) => {
        const sum = sums[t] as number[];
        for (let i = 0; i < size; i++) sum[i] = (sum[i] as number) + (tile[i] as number);
      });
      count++;
    }
  }
  return count === 0 ? null : sums.map((sum) => sum.map((v) => v / count));
}

/**
 * Mean similarity of the live tiles to the stored ones, position by position, or null when either
 * side has no tiles or they do not fit (other extractor, older map).
 */
function tileSimilarity(
  live: readonly (readonly number[])[] | null,
  stored: readonly (readonly number[])[] | undefined,
  centers: readonly (readonly number[])[] | null,
): number | null {
  if (live?.length !== TILE_COUNT || stored?.length !== TILE_COUNT) return null;
  let sum = 0;
  for (let t = 0; t < TILE_COUNT; t++) {
    const a = live[t] as readonly number[];
    const b = stored[t] as readonly number[];
    if (a.length === 0 || a.length !== b.length) return null;
    const center = centers?.[t];
    sum += center ? centeredCosineSimilarity(a, b, center) : cosineSimilarity(a, b);
  }
  return sum / TILE_COUNT;
}

/** Views recorded within this many degrees of the live heading count in full. */
export const HEADING_FREE_DEG = 45;
/** Factor for a view recorded facing the opposite way. Views in between fall off linearly. */
export const HEADING_MIN_FACTOR = 0.85;

/**
 * Weight of a stored view for a live heading: an open space looks different in each direction, so
 * views taken facing elsewhere count a little less. Unknown headings on either side count in full.
 */
export function headingFactor(sampleDeg: number | undefined, liveDeg: number | null | undefined): number {
  if (sampleDeg === undefined || liveDeg === null || liveDeg === undefined) return 1;
  const off = Math.max(0, angleDiffDeg(sampleDeg, liveDeg) - HEADING_FREE_DEG);
  return 1 - (1 - HEADING_MIN_FACTOR) * (off / (180 - HEADING_FREE_DEG));
}

export interface RankOptions {
  /** Minimum score in percent for a node to be included. */
  minScore?: number;
  limit?: number;
  /** Ranking bonus per node id in percent points (see `proximityBoosts`); shown scores stay raw. */
  boosts?: Readonly<Record<string, number>>;
  /** Map-wide mean vector (see `meanEmbedding`) removed before comparing; omit for plain cosine. */
  center?: readonly number[] | null;
  /** Compass heading of the live camera; views recorded facing elsewhere are weighted down. */
  heading?: number | null;
  /** Live left/right tile vectors; views that have tiles are then also compared by layout. */
  tiles?: readonly (readonly number[])[] | null;
  /** Per-tile mean vectors (see `meanTileEmbeddings`) removed before comparing tiles. */
  tileCenters?: readonly (readonly number[])[] | null;
}

/** Scores every trained node by its best-matching learned viewpoint (nearest neighbour), best first. */
export function rankMatches(
  liveVector: readonly number[],
  nodes: Record<string, MapNode>,
  {
    minScore = 0,
    limit = Infinity,
    boosts = {},
    center = null,
    heading = null,
    tiles = null,
    tileCenters = null,
  }: RankOptions = {},
): MatchResult[] {
  const results: MatchResult[] = [];
  const similarity = (a: readonly number[], b: readonly number[]) =>
    center ? centeredCosineSimilarity(a, b, center) : cosineSimilarity(a, b);

  for (const node of Object.values(nodes)) {
    let best = 0;
    let thumbnail: string | null = null;

    if (node.embeddings.length > 0) {
      for (const sample of node.embeddings) {
        const whole = similarity(liveVector, sample.vector);
        const layout = tileSimilarity(tiles, sample.tiles, tileCenters);
        const blended = layout === null ? whole : whole * (1 - TILE_WEIGHT) + layout * TILE_WEIGHT;
        const sim = blended * headingFactor(sample.headingDeg, heading);
        if (sim > best) {
          best = sim;
          thumbnail = sample.thumbnail;
        }
      }
    } else if (node.fingerprint) {
      best = cosineSimilarity(liveVector, node.fingerprint);
    } else {
      continue;
    }

    const score = Math.round(best * 100);
    if (score >= minScore) results.push({ node, score, thumbnail, boost: boosts[node.id] ?? 0 });
  }

  return results.sort((a, b) => rankValue(b) - rankValue(a)).slice(0, limit);
}

function rankValue(result: MatchResult): number {
  return result.score + (result.boost ?? 0);
}

export interface AutoMatchOptions {
  /** Raw similarity in percent the best match needs. */
  minScore: number;
  /** Ranking lead in percent points the best match needs over the runner-up. */
  minMargin: number;
}

/**
 * The best match when it is safe to confirm automatically: strong enough and clearly ahead of the
 * runner-up. Similar-looking rooms score almost the same, so a high score alone is not enough.
 */
export function pickAutoMatch(
  ranked: readonly MatchResult[],
  { minScore, minMargin }: AutoMatchOptions,
): MatchResult | null {
  const [top, second] = ranked;
  if (!top || top.score < minScore) return null;
  if (second && rankValue(top) - rankValue(second) < minMargin) return null;
  return top;
}

/** Node id from a location link (`…?to=<node id>`), or null when `code` is not such a link. */
function linkedNodeId(code: string): string | null {
  if (!/^https?:\/\//i.test(code)) return null;
  try {
    return new URL(code).searchParams.get(TO_URL_PARAM);
  } catch {
    return null;
  }
}

/**
 * Resolves a scanned QR/barcode or typed code to a node: location link, marker code, node id or
 * exact label.
 */
export function findNodeByCode(nodes: Record<string, MapNode>, code: string): MapNode | null {
  const linked = linkedNodeId(code.trim());
  if (linked !== null) return nodes[linked] ?? null;
  const wanted = code.trim().toUpperCase();
  if (!wanted) return null;
  const all = Object.values(nodes);
  return (
    all.find((n) => n.markerCode.toUpperCase() === wanted) ??
    all.find((n) => n.id.toUpperCase() === wanted) ??
    all.find((n) => n.label.toUpperCase() === wanted) ??
    null
  );
}

export function isTrained(node: MapNode): boolean {
  return node.embeddings.length > 0 || (node.fingerprint?.length ?? 0) > 0;
}

let scratchCanvas: HTMLCanvasElement | null = null;

function getContext(width: number, height: number): CanvasRenderingContext2D {
  scratchCanvas ??= document.createElement('canvas');
  scratchCanvas.width = width;
  scratchCanvas.height = height;
  const ctx = scratchCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context is not available');
  return ctx;
}

/**
 * Lightweight descriptor used when MobileNet is unavailable: mean RGB colour of an 8×8 grid
 * over a 64×48 downscaled frame (192-D), L2 normalized.
 */
export function extractFallbackEmbedding(source: PixelSource): number[] {
  const W = 64;
  const H = 48;
  const CELLS = 8;
  const cw = W / CELLS;
  const ch = H / CELLS;
  const ctx = getContext(W, H);
  ctx.drawImage(source, 0, 0, W, H);
  const pixels = ctx.getImageData(0, 0, W, H).data;

  const vector: number[] = [];
  for (let cy = 0; cy < CELLS; cy++) {
    for (let cx = 0; cx < CELLS; cx++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = cy * ch; y < (cy + 1) * ch; y++) {
        for (let x = cx * cw; x < (cx + 1) * cw; x++) {
          const idx = (y * W + x) * 4;
          r += pixels[idx] as number;
          g += pixels[idx + 1] as number;
          b += pixels[idx + 2] as number;
        }
      }
      const count = cw * ch * 255;
      vector.push(r / count, g / count, b / count);
    }
  }
  return normalize(vector);
}

/**
 * Every frame is centre-cropped to this width / height ratio before embedding or thumbnailing,
 * so vectors do not depend on the native aspect ratio of the phone's camera.
 */
export const FRAME_ASPECT = 3 / 4;
const FRAME_WIDTH = 336;
const FRAME_HEIGHT = 448;

/** Largest centred rectangle of `aspect` (width / height) that fits into a `width` × `height` frame. */
export function centerCropRect(width: number, height: number, aspect = FRAME_ASPECT) {
  const sw = Math.min(width, height * aspect);
  const sh = sw / aspect;
  return { sx: (width - sw) / 2, sy: (height - sh) / 2, sw, sh };
}

function pixelSize(source: PixelSource): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) return { width: source.videoWidth, height: source.videoHeight };
  if (source instanceof HTMLImageElement) return { width: source.naturalWidth, height: source.naturalHeight };
  return { width: source.width, height: source.height };
}

let frameCanvas: HTMLCanvasElement | null = null;

/** Centre-crops a frame to `FRAME_ASPECT`. The returned canvas is reused by the next call. */
export function cropToFrameAspect(source: PixelSource): PixelSource {
  const { width, height } = pixelSize(source);
  if (width <= 0 || height <= 0) return source;
  frameCanvas ??= document.createElement('canvas');
  frameCanvas.width = FRAME_WIDTH;
  frameCanvas.height = FRAME_HEIGHT;
  const ctx = frameCanvas.getContext('2d');
  if (!ctx) return source;
  const { sx, sy, sw, sh } = centerCropRect(width, height);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
  return frameCanvas;
}

const tileCanvases: HTMLCanvasElement[] = [];

/** Left and right half of an already cropped frame. The returned canvases are reused by the next call. */
export function splitIntoTiles(frame: PixelSource): PixelSource[] {
  const { width, height } = pixelSize(frame);
  const tileWidth = Math.floor(width / TILE_COUNT);
  return Array.from({ length: TILE_COUNT }, (_, t) => {
    const canvas = (tileCanvases[t] ??= document.createElement('canvas'));
    canvas.width = tileWidth;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(frame, t * tileWidth, 0, tileWidth, height, 0, 0, tileWidth, height);
    return canvas;
  });
}

/** Small JPEG preview of the current frame for the viewpoint gallery. */
export function captureThumbnail(source: PixelSource, width = 90, height = 120): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(cropToFrameAspect(source), 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.5);
}

export function isFrameReady(source: PixelSource | null): source is PixelSource {
  if (!source) return false;
  if (source instanceof HTMLVideoElement) {
    return source.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && source.videoWidth > 0;
  }
  return true;
}
