import { useCallback, useSyncExternalStore } from 'react';
import type { MobileNet } from '@tensorflow-models/mobilenet';
import { compactEmbedding, extractFallbackEmbedding } from '../services/visionMatcher';
import type { EmbeddingEngine, ModelStatus, PixelSource } from '../types/vision';

type TF = typeof import('@tensorflow/tfjs');

interface LoadedModel {
  tf: TF;
  model: MobileNet;
}

const MODEL_URL = `${import.meta.env.BASE_URL}models/mobilenet_v2_050/model.json`;

// Module-level singleton: the model is downloaded once and shared by every component.
let status: ModelStatus = 'idle';
let loaded: LoadedModel | null = null;
let loadPromise: Promise<LoadedModel | null> | null = null;
const listeners = new Set<() => void>();

function setStatus(next: ModelStatus) {
  status = next;
  listeners.forEach((l) => {
    l();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Lazily downloads TensorFlow.js and MobileNet v2 (vendored weights). Resolves to null when
 * the model cannot be loaded, in which case the colour-grid fallback extractor is used.
 */
export function loadMobileNet(): Promise<LoadedModel | null> {
  loadPromise ??= (async () => {
    setStatus('loading');
    try {
      const [tf, mobilenet] = await Promise.all([
        import('@tensorflow/tfjs'),
        import('@tensorflow-models/mobilenet'),
      ]);
      if (!(await tf.setBackend('webgl'))) await tf.setBackend('cpu');
      await tf.ready();
      const model = await mobilenet.load({ version: 2, alpha: 0.5, modelUrl: MODEL_URL, inputRange: [0, 1] });
      // Warm-up run compiles the WebGL shaders so the first real frame is not slow.
      tf.tidy(() => model.infer(tf.zeros([224, 224, 3]), true));
      loaded = { tf, model };
      setStatus('ready');
      return loaded;
    } catch (err) {
      console.warn('MobileNet could not be loaded, using the fallback extractor.', err);
      loadPromise = null; // allow a retry later
      setStatus('error');
      return null;
    }
  })();
  return loadPromise;
}

export interface Embedding {
  vector: number[];
  engine: EmbeddingEngine;
}

/** Extracts a feature vector from a frame. Every tensor is released before returning. */
export async function embedFrame(source: PixelSource): Promise<Embedding> {
  if (loaded) {
    const { tf, model } = loaded;
    // tidy() frees every intermediate tensor; only the returned embedding survives until dispose().
    const tensor = tf.tidy(() => model.infer(source, true));
    try {
      return { vector: compactEmbedding(await tensor.data()), engine: 'mobilenet' };
    } catch (err) {
      console.error('MobileNet inference failed, using the fallback extractor.', err);
    } finally {
      tensor.dispose();
    }
  }
  return { vector: extractFallbackEmbedding(source), engine: 'fallback' };
}

/** Number of live tensors; exposed for leak checks during development. */
export function liveTensorCount(): number | null {
  return loaded?.tf.memory().numTensors ?? null;
}

if (import.meta.env.DEV) {
  // `__indoorNavTensors()` in the dev console should stay constant while the scanner runs.
  Object.assign(globalThis, { __indoorNavTensors: liveTensorCount });
}

export function useTensorFlow() {
  const current = useSyncExternalStore(subscribe, () => status);
  const load = useCallback(() => loadMobileNet(), []);
  const engine: EmbeddingEngine = current === 'ready' ? 'mobilenet' : 'fallback';
  return { status: current, engine, load, embed: embedFrame };
}
