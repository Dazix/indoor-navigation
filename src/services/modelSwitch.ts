import type { MapData, MapNode } from '../types/map';
import type { EmbeddingSample } from '../types/vision';
import { EMBEDDING_MODEL_IDS, resolveEmbeddingModel, type EmbeddingModelId } from './embeddingModels';

/** What a model switch does to a map's learned views. */
export interface SwitchPlan {
  /** Views with a stored frame, which can be embedded again. */
  recomputable: number;
  /** Views recorded before frames were stored; they have nothing to recompute from and are removed. */
  removed: number;
  /** Of the recomputable views, those that already have vectors of the target model cached. */
  cached: number;
}

export function planModelSwitch(nodes: Record<string, MapNode>, to?: EmbeddingModelId): SwitchPlan {
  let recomputable = 0;
  let removed = 0;
  let cached = 0;
  for (const node of Object.values(nodes)) {
    for (const sample of node.embeddings) {
      if (!sample.frame) removed++;
      else {
        recomputable++;
        if (to && sample.alt?.[to]) cached++;
      }
    }
  }
  return { recomputable, removed, cached };
}

/** The map without the local cache of other models' vectors, for everything that leaves the device. */
export function stripViewCache(map: MapData): MapData {
  return {
    ...map,
    nodes: Object.fromEntries(Object.entries(map.nodes).map(([id, node]) => [id, stripNodeCache(node)])),
  };
}

export function stripNodeCache(node: MapNode): MapNode {
  if (!node.embeddings.some((sample) => sample.alt)) return node;
  return {
    ...node,
    embeddings: node.embeddings.map((sample) => {
      const copy = { ...sample };
      delete copy.alt;
      return copy;
    }),
  };
}

/**
 * Carries the local cache over to a map pulled from the cloud, which has none. A view keeps it when the
 * local one has the same id and frame, since the same frame always gives the same vectors. When the
 * pulled map uses another model than the local one, the local vectors join the cache too.
 */
export function mergeViewCache(pulled: MapData, local: MapData | null): MapData {
  if (!local) return pulled;
  const pulledModel = resolveEmbeddingModel(pulled.metadata.embeddingModel).id;
  const localModel = resolveEmbeddingModel(local.metadata.embeddingModel).id;
  return {
    ...pulled,
    nodes: Object.fromEntries(
      Object.entries(pulled.nodes).map(([id, node]) => {
        const localViews = new Map(local.nodes[id]?.embeddings.map((view) => [view.id, view]));
        return [
          id,
          {
            ...node,
            embeddings: node.embeddings.map((view) => {
              const before = localViews.get(view.id);
              if (!before?.frame || before.frame !== view.frame) return view;
              const alt: NonNullable<EmbeddingSample['alt']> = {};
              for (const model of EMBEDDING_MODEL_IDS) {
                if (model === pulledModel) continue;
                const vectors =
                  model === localModel ? { vector: before.vector, tiles: before.tiles } : before.alt?.[model];
                if (vectors) alt[model] = vectors;
              }
              return Object.keys(alt).length > 0 ? { ...view, alt } : view;
            }),
          },
        ];
      }),
    ),
  };
}

export type FrameEmbedder = (frame: string) => Promise<{ vector: number[]; tiles: number[][] }>;

export interface RecomputeOptions {
  /** Model the views currently belong to; their vectors move to the cache. */
  from: EmbeddingModelId;
  /** Model to switch to; cached vectors of it are reused instead of embedding the frame. */
  to: EmbeddingModelId;
  /** Share 0–1 of the views that are done. */
  onProgress?: (share: number) => void;
  /** Resolves the call to null when it turns true, so a closed dialog stops the work. */
  isCancelled?: () => boolean;
}

/**
 * Returns the views per node as the target model sees them. A view takes its vectors from the cache
 * when it has them, otherwise its stored frame is embedded with the currently loaded model. The
 * vectors it had move to the cache. Views without a stored frame are left out. The result is null
 * when cancelled.
 */
export async function recomputeViews(
  nodes: Record<string, MapNode>,
  embed: FrameEmbedder,
  { from, to, onProgress, isCancelled }: RecomputeOptions,
): Promise<Record<string, EmbeddingSample[]> | null> {
  const plan = planModelSwitch(nodes, to);
  const total = plan.recomputable - plan.cached;
  const result: Record<string, EmbeddingSample[]> = {};
  let done = 0;

  for (const node of Object.values(nodes)) {
    const views: EmbeddingSample[] = [];
    for (const sample of node.embeddings) {
      if (!sample.frame) continue;
      if (isCancelled?.()) return null;
      let next = sample.alt?.[to];
      if (!next) {
        next = await embed(sample.frame);
        onProgress?.(++done / total);
      }
      const kept = Object.entries(sample.alt ?? {}).filter(([id]) => id !== to);
      const cache = Object.fromEntries([...kept, [from, { vector: sample.vector, tiles: sample.tiles }]]);
      views.push({ ...sample, vector: next.vector, tiles: next.tiles, alt: cache });
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
