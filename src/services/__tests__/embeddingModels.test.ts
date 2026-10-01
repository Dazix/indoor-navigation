import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_MODEL_IDS,
  EMBEDDING_MODELS,
  resolveEmbeddingModel,
} from '../embeddingModels';

describe('embedding models', () => {
  it('uses alpha 0.5 for maps that name no model', () => {
    expect(resolveEmbeddingModel(undefined).id).toBe('mobilenet-v2-050');
    expect(DEFAULT_EMBEDDING_MODEL).toBe('mobilenet-v2-050');
  });

  it('describes every listed model with its own folder', () => {
    const paths = EMBEDDING_MODEL_IDS.map((id) => EMBEDDING_MODELS[id].path);
    expect(new Set(paths).size).toBe(EMBEDDING_MODEL_IDS.length);
    for (const id of EMBEDDING_MODEL_IDS) expect(resolveEmbeddingModel(id).id).toBe(id);
  });
});
