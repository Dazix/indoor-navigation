import { describe, expect, it } from 'vitest';
import type { MapNode } from '../../types/map';
import type { EmbeddingSample } from '../../types/vision';
import { createBlankMap } from '../mapLibrary';
import { planModelSwitch, recomputeViews, withEmbeddingModel } from '../modelSwitch';

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
    expect(planModelSwitch(nodes)).toEqual({ recomputable: 2, removed: 1 });
  });
});

describe('recomputeViews', () => {
  const embed = (frame: string) => Promise.resolve({ vector: [frame.length, 0], tiles: [[1], [2]] });

  it('embeds each stored frame again, keeps the rest of the view and drops views without a frame', async () => {
    const progress: number[] = [];
    const result = await recomputeViews(nodes, embed, { onProgress: (share) => progress.push(share) });

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
    expect(await recomputeViews(nodes, embed, { isCancelled: () => true })).toBeNull();
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
