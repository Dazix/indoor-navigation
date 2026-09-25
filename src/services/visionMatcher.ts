import type { MapNode } from '../types/map';
import type { MatchResult, PixelSource } from '../types/vision';
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

export interface RankOptions {
  /** Minimum score in percent for a node to be included. */
  minScore?: number;
  limit?: number;
}

/** Scores every trained node by its best-matching learned viewpoint (nearest neighbour), best first. */
export function rankMatches(
  liveVector: readonly number[],
  nodes: Record<string, MapNode>,
  { minScore = 0, limit = Infinity }: RankOptions = {},
): MatchResult[] {
  const results: MatchResult[] = [];

  for (const node of Object.values(nodes)) {
    let best = 0;
    let thumbnail: string | null = null;

    if (node.embeddings.length > 0) {
      for (const sample of node.embeddings) {
        const sim = cosineSimilarity(liveVector, sample.vector);
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
    if (score >= minScore) results.push({ node, score, thumbnail });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
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

/** Small JPEG preview of the current frame for the viewpoint gallery. */
export function captureThumbnail(source: PixelSource, width = 120, height = 90): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.5);
}

export function isFrameReady(source: PixelSource | null): source is PixelSource {
  if (!source) return false;
  if (source instanceof HTMLVideoElement) {
    return source.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && source.videoWidth > 0;
  }
  return true;
}
