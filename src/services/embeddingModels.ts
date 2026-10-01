/**
 * Models that turn a camera frame into the vector used for recognition. Vectors of different models
 * cannot be compared (both are 256-D, so the length does not tell them apart), which is why a map
 * records the model its views were computed with.
 */
export const EMBEDDING_MODEL_IDS = ['mobilenet-v2-050', 'mobilenet-v2-100'] as const;

export type EmbeddingModelId = (typeof EMBEDDING_MODEL_IDS)[number];

export interface EmbeddingModelInfo {
  id: EmbeddingModelId;
  /** Short name for menus and status lines. */
  label: string;
  /** MobileNet width multiplier; the loader needs it together with the weights' location. */
  alpha: 0.5 | 1;
  /** Folder of the vendored TF.js graph model, relative to the app base (see `npm run fetch-model`). */
  path: string;
  /** Download on first use, in MB. */
  sizeMb: number;
  description: string;
}

export const EMBEDDING_MODELS: Record<EmbeddingModelId, EmbeddingModelInfo> = {
  'mobilenet-v2-050': {
    id: 'mobilenet-v2-050',
    label: 'MobileNet v2, alpha 0.5',
    alpha: 0.5,
    path: 'models/mobilenet_v2_050',
    sizeMb: 7.5,
    description: 'Faster and smaller.',
  },
  'mobilenet-v2-100': {
    id: 'mobilenet-v2-100',
    label: 'MobileNet v2, alpha 1.0',
    alpha: 1,
    path: 'models/mobilenet_v2_100',
    sizeMb: 14,
    description: 'Richer features, slower scanning and a larger download.',
  },
};

/** Model of maps that do not name one: every map recorded before the choice existed. */
export const DEFAULT_EMBEDDING_MODEL: EmbeddingModelId = 'mobilenet-v2-050';

export function resolveEmbeddingModel(id: EmbeddingModelId | undefined): EmbeddingModelInfo {
  return EMBEDDING_MODELS[id ?? DEFAULT_EMBEDDING_MODEL];
}
