import { describe, expect, it } from 'vitest';
import type { MapNode } from '../../types/map';
import type { EmbeddingSample } from '../../types/vision';
import { ldaFeatures, rankProjected, trainLda } from '../ldaProjection';

/** Small deterministic generator, so the tests do not flake. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIM = 6;
/** What each place looks like, apart from the noise; four places that differ in every direction. */
const SIGNATURES = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [-1, -1, -1],
];

/**
 * A view of place `place`: the place shows only in the first dimension, while a strong random
 * offset along the other dimensions (what varies between views) dominates the raw vector.
 */
function view(place: number, rand: () => number): { vector: number[]; tiles: number[][] } {
  const noise = () => (rand() - 0.5) * 6;
  const small = () => (rand() - 0.5) * 0.2;
  const shared = noise();
  const [a, b, c] = SIGNATURES[place % SIGNATURES.length] as [number, number, number];
  const whole = [a * 0.6 + small(), shared, shared + noise() * 0.3, b * 0.6 + small(), c * 0.6 + small(), 1];
  const tile = () => [b * 0.3 + small(), shared, c * 0.3 + small()];
  return { vector: whole, tiles: [tile(), tile()] };
}

function sample(
  { vector, tiles }: { vector: number[]; tiles: number[][] },
  headingDeg?: number,
): EmbeddingSample {
  return { id: 's', vector, tiles, thumbnail: `thumb-${vector[0]}`, timestamp: 0, headingDeg };
}

function node(id: string, embeddings: EmbeddingSample[]): MapNode {
  return { id, x: 0, y: 0, label: id, markerCode: '', embeddings };
}

function trainingMap(places: number, viewsPerPlace: number, seed = 1) {
  const rand = rng(seed);
  const nodes: Record<string, MapNode> = {};
  for (let p = 0; p < places; p++) {
    nodes[`p${p}`] = node(
      `p${p}`,
      Array.from({ length: viewsPerPlace }, () => sample(view(p, rand))),
    );
  }
  return nodes;
}

describe('ldaFeatures', () => {
  it('joins the whole-frame vector and the tiles', () => {
    expect(ldaFeatures([1, 2], [[3], [4]])).toEqual([1, 2, 3, 4]);
  });

  it('needs tiles', () => {
    expect(ldaFeatures([1, 2], null)).toBeNull();
    expect(ldaFeatures([1, 2], [[3]])).toBeNull();
  });
});

describe('trainLda', () => {
  it('projects to at most one dimension fewer than there are places', () => {
    const model = trainLda(trainingMap(4, 12));
    expect(model).not.toBeNull();
    expect(model?.basis.length).toBeLessThanOrEqual(3);
    expect(model?.basis[0]).toHaveLength(2 * 3 + DIM);
  });

  it('is not trained without two places', () => {
    expect(trainLda(trainingMap(1, 10))).toBeNull();
    expect(trainLda({})).toBeNull();
  });

  it('is not trained when no place has two views', () => {
    expect(trainLda(trainingMap(3, 1))).toBeNull();
  });

  it('is not trained when a place has no view with tiles', () => {
    const nodes = trainingMap(3, 8);
    nodes.p1 = node('p1', [{ ...sample(view(1, rng(9))), tiles: undefined }]);
    expect(trainLda(nodes)).toBeNull();
  });

  it('is not trained on vectors too big to factor quickly', () => {
    const huge = (id: string) =>
      node(
        id,
        Array.from({ length: 2 }, () =>
          sample({ vector: new Array<number>(2000).fill(1), tiles: [[1], [1]] }),
        ),
      );
    expect(trainLda({ a: huge('a'), b: huge('b') })).toBeNull();
  });

  it('copes with a place that has a single view', () => {
    const nodes = trainingMap(3, 8);
    nodes.p2 = node('p2', [sample(view(2, rng(5)))]);
    expect(trainLda(nodes)).not.toBeNull();
  });
});

describe('rankProjected', () => {
  const nodes = trainingMap(4, 14);
  const model = trainLda(nodes);

  it('recognizes new views of a place despite the noise that dominates the raw vector', () => {
    const rand = rng(77);
    let right = 0;
    let total = 0;
    for (let p = 0; p < 4; p++) {
      for (let i = 0; i < 20; i++) {
        const live = view(p, rand);
        const ranked = rankProjected(model as NonNullable<typeof model>, live.vector, live.tiles, nodes);
        total++;
        if (ranked?.[0]?.node.id === `p${p}`) right++;
      }
    }
    expect(right / total).toBeGreaterThan(0.9);
  });

  it('reports a percent score and the thumbnail of the best view', () => {
    const live = view(2, rng(3));
    const ranked = rankProjected(model as NonNullable<typeof model>, live.vector, live.tiles, nodes);
    expect(ranked?.[0]?.score).toBeGreaterThan(0);
    expect(ranked?.[0]?.score).toBeLessThanOrEqual(100);
    expect(ranked?.[0]?.thumbnail).toMatch(/^thumb-/);
    const scores = (ranked ?? []).map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('skips places that are no longer on the map', () => {
    const live = view(1, rng(4));
    const rest = Object.fromEntries(Object.entries(nodes).filter(([id]) => id !== 'p0'));
    const ranked = rankProjected(model as NonNullable<typeof model>, live.vector, live.tiles, rest);
    expect(ranked?.map((r) => r.node.id)).not.toContain('p0');
  });

  it('gives way to the caller when the live frame has no tiles or another size', () => {
    const live = view(1, rng(4));
    const m = model as NonNullable<typeof model>;
    expect(rankProjected(m, live.vector, null, nodes)).toBeNull();
    expect(rankProjected(m, [1, 2, 3], [[1], [2]], nodes)).toBeNull();
  });
});
