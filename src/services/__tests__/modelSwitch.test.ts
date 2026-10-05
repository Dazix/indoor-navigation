import { describe, expect, it } from 'vitest';
import type { MapNode } from '../../types/map';
import type { EmbeddingSample } from '../../types/vision';
import { createBlankMap } from '../mapLibrary';
import { parseMapData } from '../mapStorage';
import {
  mergeViewCache,
  planModelSwitch,
  recomputeViews,
  stripViewCache,
  withEmbeddingModel,
} from '../modelSwitch';

const A = 'mobilenet-v2-050';
const B = 'mobilenet-v2-100';

function view(id: string, frame?: string): EmbeddingSample {
  return {
    id,
    thumbnail: 'data:image/jpeg;base64,AA',
    frame,
    vector: [1, 0],
    tiles: [[1], [0]],
    timestamp: 1,
  };
}

function node(id: string, views: EmbeddingSample[]): MapNode {
  return { id, x: 1, y: 1, label: id, markerCode: '', embeddings: views };
}

const nodes = {
  a: node('a', [view('a1', 'data:image/jpeg;base64,F1'), view('a2')]),
  b: node('b', [view('b1', 'data:image/jpeg;base64,F2')]),
  c: node('c', []),
};

describe('planModelSwitch', () => {
  it('counts views that can be recomputed and views that would be lost', () => {
    expect(planModelSwitch(nodes)).toEqual({ recomputable: 2, removed: 1, cached: 0 });
  });
});

describe('recomputeViews', () => {
  const embed = (frame: string) => Promise.resolve({ vector: [frame.length, 0], tiles: [[1], [2]] });

  it('embeds each stored frame again, keeps the rest of the view and drops views without a frame', async () => {
    const progress: number[] = [];
    const result = await recomputeViews(nodes, embed, {
      from: A,
      to: B,
      onProgress: (share) => progress.push(share),
    });

    expect(result?.a?.map((v) => v.id)).toEqual(['a1']);
    expect(result?.a?.[0]).toMatchObject({
      thumbnail: 'data:image/jpeg;base64,AA',
      frame: 'data:image/jpeg;base64,F1',
      vector: ['data:image/jpeg;base64,F1'.length, 0],
      tiles: [[1], [2]],
    });
    expect(result?.c).toEqual([]);
    expect(progress).toEqual([0.5, 1]);
  });

  it('stops when cancelled', async () => {
    expect(await recomputeViews(nodes, embed, { from: A, to: B, isCancelled: () => true })).toBeNull();
  });

  it('moves the old vectors to the cache and brings them back without embedding again', async () => {
    const calls: string[] = [];
    const counting = (frame: string) => {
      calls.push(frame);
      return embed(frame);
    };
    const forward = await recomputeViews(nodes, counting, { from: A, to: B });
    expect(calls).toHaveLength(2);
    expect(forward?.a?.[0]?.alt?.[A]).toEqual({ vector: [1, 0], tiles: [[1], [0]] });

    const back = await recomputeViews(
      Object.fromEntries(
        Object.entries(nodes).map(([id, n]) => [id, { ...n, embeddings: forward?.[id] ?? [] }]),
      ),
      counting,
      { from: B, to: A },
    );
    expect(calls).toHaveLength(2);
    expect(back?.a?.[0]).toMatchObject({ vector: [1, 0], tiles: [[1], [0]] });
    expect(back?.a?.[0]?.alt?.[B]?.vector).toEqual(forward?.a?.[0]?.vector);
    expect(back?.a?.[0]?.alt?.[A]).toBeUndefined();
  });

  it('embeds only the views without cached vectors and counts progress over those', async () => {
    const cached: EmbeddingSample = {
      ...view('a1', 'data:image/jpeg;base64,F1'),
      alt: { [B]: { vector: [9, 9] } },
    };
    const mixed = { a: node('a', [cached, view('a3', 'data:image/jpeg;base64,F3')]) };
    expect(planModelSwitch(mixed, B)).toEqual({ recomputable: 2, removed: 0, cached: 1 });

    const calls: string[] = [];
    const progress: number[] = [];
    const result = await recomputeViews(
      mixed,
      (frame) => {
        calls.push(frame);
        return embed(frame);
      },
      { from: A, to: B, onProgress: (share) => progress.push(share) },
    );
    expect(calls).toEqual(['data:image/jpeg;base64,F3']);
    expect(progress).toEqual([1]);
    expect(result?.a?.[0]?.vector).toEqual([9, 9]);
  });
});

describe('stripViewCache', () => {
  it('removes the cache from every view and leaves the rest', () => {
    const cached = { ...view('a1', 'data:image/jpeg;base64,F1'), alt: { [B]: { vector: [9, 9] } } };
    const map = { ...createBlankMap('M'), nodes: { a: node('a', [cached]) } };
    const stripped = stripViewCache(map);
    expect(stripped.nodes.a?.embeddings[0]).not.toHaveProperty('alt');
    expect(stripped.nodes.a?.embeddings[0]?.vector).toEqual([1, 0]);
    expect(map.nodes.a.embeddings[0]).toHaveProperty('alt');
  });
});

describe('mergeViewCache', () => {
  const FRAME = 'data:image/jpeg;base64,F1';
  const mapOf = (model: typeof A | typeof B, views: EmbeddingSample[]) => {
    const blank = createBlankMap('M');
    return {
      ...blank,
      metadata: { ...blank.metadata, embeddingModel: model },
      nodes: { a: node('a', views) },
    };
  };

  it('keeps the cache of a view with the same id and frame', () => {
    const local = mapOf(A, [{ ...view('a1', FRAME), alt: { [B]: { vector: [9, 9] } } }]);
    const merged = mergeViewCache(mapOf(A, [view('a1', FRAME)]), local);
    expect(merged.nodes.a?.embeddings[0]?.alt).toEqual({ [B]: { vector: [9, 9] } });
  });

  it('drops the cache of a view whose frame changed and ignores new views', () => {
    const local = mapOf(A, [{ ...view('a1', FRAME), alt: { [B]: { vector: [9, 9] } } }]);
    const pulled = mapOf(A, [view('a1', 'data:image/jpeg;base64,F2'), view('a2', FRAME)]);
    const merged = mergeViewCache(pulled, local);
    expect(merged.nodes.a?.embeddings.map((v) => v.alt)).toEqual([undefined, undefined]);
  });

  it('caches the local vectors when the pulled map uses another model', () => {
    const local = mapOf(A, [{ ...view('a1', FRAME), alt: { [B]: { vector: [9, 9] } } }]);
    const merged = mergeViewCache(mapOf(B, [{ ...view('a1', FRAME), vector: [7, 7] }]), local);
    // The pulled B vectors stay active; its own entry is not duplicated in the cache.
    expect(merged.nodes.a?.embeddings[0]).toMatchObject({ vector: [7, 7], alt: { [A]: { vector: [1, 0] } } });
    expect(merged.nodes.a?.embeddings[0]?.alt).not.toHaveProperty(B);
  });

  it('returns the pulled map as it is without a local one', () => {
    const pulled = mapOf(A, [view('a1', FRAME)]);
    expect(mergeViewCache(pulled, null)).toBe(pulled);
  });
});

describe('view cache in storage', () => {
  it('survives the map schema and rejects unknown models', () => {
    const cached = {
      ...view('a1', 'data:image/jpeg;base64,F1'),
      alt: { [B]: { vector: [9, 9], tiles: [[1]] } },
    };
    const map = { ...createBlankMap('M'), nodes: { a: node('a', [cached]) } };
    const parsed = parseMapData(JSON.parse(JSON.stringify(map)));
    expect(parsed.ok && parsed.data.nodes.a?.embeddings[0]?.alt).toEqual(cached.alt);

    const bad = {
      ...map,
      nodes: { a: node('a', [{ ...cached, alt: { 'mobilenet-v9': { vector: [1] } } as never }]) },
    };
    expect(parseMapData(JSON.parse(JSON.stringify(bad))).ok).toBe(false);
  });
});

describe('withEmbeddingModel', () => {
  it('records the model and replaces the views of every node', () => {
    const map = { ...createBlankMap('M'), nodes };
    const next = withEmbeddingModel(map, 'mobilenet-v2-100', {
      a: [view('a1', 'data:image/jpeg;base64,F1')],
    });

    expect(next.metadata.embeddingModel).toBe('mobilenet-v2-100');
    expect(next.nodes.a?.embeddings.map((v) => v.id)).toEqual(['a1']);
    // A node missing from the recomputed views keeps none: its old vectors belong to the other model.
    expect(next.nodes.b?.embeddings).toEqual([]);
    expect(next.nodes.a?.label).toBe('a');
  });
});
