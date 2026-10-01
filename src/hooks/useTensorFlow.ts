import { useCallback, useSyncExternalStore } from 'react';
import type { MobileNet } from '@tensorflow-models/mobilenet';
import { resolveEmbeddingModel, type EmbeddingModelId } from '../services/embeddingModels';
import {
  compactEmbedding,
  cropToFrameAspect,
  EMBEDDING_SIZE,
  extractFallbackEmbedding,
  loadImage,
  splitIntoTiles,
  TILE_EMBEDDING_SIZE,
} from '../services/visionMatcher';
import type { EmbeddingEngine, ModelStatus, PixelSource } from '../types/vision';

type TF = typeof import('@tensorflow/tfjs');

interface LoadedModel {
  tf: TF;
  model: MobileNet;
}

// Module-level singleton: one model is held at a time, downloaded once and shared by every component.
interface LoaderState {
  status: ModelStatus;
  /** The model `status` is about; null before anything was requested. */
  modelId: EmbeddingModelId | null;
}
let state: LoaderState = { status: 'idle', modelId: null };
let loaded: (LoadedModel & { modelId: EmbeddingModelId }) | null = null;
let loadPromise: Promise<LoadedModel | null> | null = null;
/** Counts load requests, so a load that was overtaken by a newer one can tell. */
let latestRequest = 0;
const listeners = new Set<() => void>();

function setState(next: LoaderState) {
  state = next;
  listeners.forEach((l) => {
    l();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Frees the weights of the model that is being replaced. */
function releaseLoaded() {
  // MobileNet keeps its graph model in a field it does not expose.
  (loaded?.model as unknown as { model?: { dispose?: () => void } } | undefined)?.model?.dispose?.();
  loaded = null;
}

/**
 * Lazily downloads TensorFlow.js and the given MobileNet v2 (vendored weights). Loading another model
 * replaces the one in memory. Resolves to null when the model cannot be loaded, in which case the
 * colour-grid fallback extractor is used.
 */
export function loadMobileNet(modelId: EmbeddingModelId): Promise<LoadedModel | null> {
  if (loaded?.modelId === modelId) return Promise.resolve(loaded);
  if (loadPromise && state.modelId === modelId) return loadPromise;

  const info = resolveEmbeddingModel(modelId);
  const request = ++latestRequest;
  const promise: Promise<LoadedModel | null> = (async () => {
    // A load for another model may still be running; its result is discarded below.
    releaseLoaded();
    setState({ status: 'loading', modelId });
    try {
      const [tf, mobilenet] = await Promise.all([
        import('@tensorflow/tfjs'),
        import('@tensorflow-models/mobilenet'),
      ]);
      if (!(await tf.setBackend('webgl'))) await tf.setBackend('cpu');
      await tf.ready();
      const model = await mobilenet.load({
        version: 2,
        alpha: info.alpha,
        modelUrl: `${import.meta.env.BASE_URL}${info.path}/model.json`,
        inputRange: [0, 1],
      });
      // Warm-up run compiles the WebGL shaders so the first real frame is not slow.
      tf.tidy(() => model.infer(tf.zeros([224, 224, 3]), true));
      if (request !== latestRequest) return null; // a newer request took over while this one downloaded
      loaded = { tf, model, modelId };
      setState({ status: 'ready', modelId });
      return loaded;
    } catch (err) {
      console.warn('MobileNet could not be loaded, using the fallback extractor.', err);
      if (request === latestRequest) {
        loadPromise = null; // allow a retry later
        setState({ status: 'error', modelId });
      }
      return null;
    }
  })();
  loadPromise = promise;
  return promise;
}

export interface Embedding {
  vector: number[];
  engine: EmbeddingEngine;
  /** Vectors of the left and right half of the frame, from the same engine as `vector`. */
  tiles: number[][];
}

type SingleEmbedding = Pick<Embedding, 'vector' | 'engine'>;

/** Embeds one already cropped image. `allowModel` false forces the fallback extractor. */
async function embedSource(source: PixelSource, size: number, allowModel: boolean): Promise<SingleEmbedding> {
  if (loaded && allowModel) {
    const { tf, model } = loaded;
    // tidy() frees every intermediate tensor; only the returned embedding survives until dispose().
    const tensor = tf.tidy(() => model.infer(source, true));
    try {
      return { vector: compactEmbedding(await tensor.data(), size), engine: 'mobilenet' };
    } catch (err) {
      console.error('MobileNet inference failed, using the fallback extractor.', err);
    } finally {
      tensor.dispose();
    }
  }
  return { vector: extractFallbackEmbedding(source), engine: 'fallback' };
}

/**
 * Extracts a feature vector from a frame, plus one for each half of it. Every tensor is released
 * before returning. If the model fails on the whole frame, the halves use the fallback too, so all
 * vectors of one embedding come from the same engine.
 */
export async function embedFrame(rawSource: PixelSource): Promise<Embedding> {
  const source = cropToFrameAspect(rawSource);
  const whole = await embedSource(source, EMBEDDING_SIZE, true);
  const tiles: number[][] = [];
  for (const tile of splitIntoTiles(source)) {
    tiles.push((await embedSource(tile, TILE_EMBEDDING_SIZE, whole.engine === 'mobilenet')).vector);
  }
  return { ...whole, tiles };
}

/** Embeds a stored frame (see `captureFrame`), the same way a live frame is embedded. */
export async function embedStoredFrame(dataUrl: string): Promise<Embedding> {
  return embedFrame(await loadImage(dataUrl));
}

/** Number of live tensors; exposed for leak checks during development. */
export function liveTensorCount(): number | null {
  return loaded?.tf.memory().numTensors ?? null;
}

if (import.meta.env.DEV) {
  // `__indoorNavTensors()` in the dev console should stay constant while the scanner runs.
  Object.assign(globalThis, { __indoorNavTensors: liveTensorCount });
}

/** `modelId` is the model of the map in use; the status is `idle` until that very model was requested. */
export function useTensorFlow(modelId: EmbeddingModelId) {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  const current: ModelStatus = snapshot.modelId === modelId ? snapshot.status : 'idle';
  const load = useCallback(() => loadMobileNet(modelId), [modelId]);
  const engine: EmbeddingEngine = current === 'ready' ? 'mobilenet' : 'fallback';
  return { status: current, engine, load, embed: embedFrame, embedStored: embedStoredFrame };
}
