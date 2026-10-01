import type { MapData, MapNode } from '../types/map';
import type { EmbeddingSample } from '../types/vision';
import type { EmbeddingModelId } from './embeddingModels';

/** What a model switch does to a map's learned views. */
export interface SwitchPlan {
  /** Views with a stored frame, which can be embedded again. */
  recomputable: number;
  /** Views recorded before frames were stored; they have nothing to recompute from and are removed. */
  removed: number;
}

export function planModelSwitch(nodes: Record<string, MapNode>): SwitchPlan {
  let recomputable = 0;
  let removed = 0;
  for (const node of Object.values(nodes)) {
    for (const sample of node.embeddings) {
      if (sample.frame) recomputable++;
      else removed++;
    }
  }
  return { recomputable, removed };
}

export type FrameEmbedder = (frame: string) => Promise<{ vector: number[]; tiles: number[][] }>;

export interface RecomputeOptions {
  /** Share 0–1 of the views that are done. */
  onProgress?: (share: number) => void;
  /** Resolves the call to null when it turns true, so a closed dialog stops the work. */
  isCancelled?: () => boolean;
}

/**
 * Embeds every stored frame again with the currently loaded model and returns the new views per node.
 * Views without a stored frame are left out. The result is null when cancelled.
 */
export async function recomputeViews(
  nodes: Record<string, MapNode>,
  embed: FrameEmbedder,
  { onProgress, isCancelled }: RecomputeOptions = {},
): Promise<Record<string, EmbeddingSample[]> | null> {
  const total = planModelSwitch(nodes).recomputable;
  const result: Record<string, EmbeddingSample[]> = {};
  let done = 0;

  for (const node of Object.values(nodes)) {
    const views: EmbeddingSample[] = [];
    for (const sample of node.embeddings) {
      if (!sample.frame) continue;
      if (isCancelled?.()) return null;
      const { vector, tiles } = await embed(sample.frame);
      views.push({ ...sample, vector, tiles });
      onProgress?.(++done / total);
    }
    result[node.id] = views;
  }
  return result;
}

/**
 * The map with the given model and the views recomputed by it. Nodes get exactly the views in
 * `views`; a node missing from it keeps none, since its old vectors belong to the previous model.
 */
export function withEmbeddingModel(
  map: MapData,
  model: EmbeddingModelId,
  views: Record<string, EmbeddingSample[]>,
): MapData {
  return {
    ...map,
    metadata: { ...map.metadata, embeddingModel: model },
    nodes: Object.fromEntries(
      Object.entries(map.nodes).map(([id, node]) => [id, { ...node, embeddings: views[id] ?? [] }]),
    ),
  };
}
