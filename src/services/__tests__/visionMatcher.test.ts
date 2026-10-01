import { describe, expect, it } from 'vitest';
import type { MapNode } from '../../types/map';
import {
  centerCropRect,
  centeredCosineSimilarity,
  compactEmbedding,
  cosineSimilarity,
  EMBEDDING_SIZE,
  findNodeByCode,
  HEADING_MIN_FACTOR,
  headingFactor,
  meanEmbedding,
  meanTileEmbeddings,
  pickAutoMatch,
  rankMatches,
} from '../visionMatcher';

function trained(id: string, vectors: number[][]): MapNode {
  return {
    id,
    x: 0,
    y: 0,
    label: id,
    markerCode: '',
    embeddings: vectors.map((vector, i) => ({
      id: `${id}-${i}`,
      thumbnail: `thumb-${id}-${i}`,
      vector,
      timestamp: i,
    })),
  };
}

describe('centerCropRect', () => {
  it('crops the sides of a landscape frame to 3:4', () => {
    const r = centerCropRect(640, 480);
    expect(r.sh).toBeCloseTo(480);
    expect(r.sw).toBeCloseTo(360);
    expect(r.sx).toBeCloseTo(140);
    expect(r.sy).toBeCloseTo(0);
  });

  it('crops top and bottom of a frame taller than 3:4', () => {
    const r = centerCropRect(360, 800);
    expect(r.sw).toBeCloseTo(360);
    expect(r.sh).toBeCloseTo(480);
    expect(r.sy).toBeCloseTo(160);
  });

  it('keeps a 3:4 frame untouched', () => {
    expect(centerCropRect(480, 640)).toEqual({ sx: 0, sy: 0, sw: 480, sh: 640 });
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical and parallel vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('clamps opposite vectors to 0', () => {
    expect(cosineSimilarity([1, 1], [-1, -1])).toBe(0);
  });

  it('returns 0 for empty, zero or mismatched-length vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
});

describe('compactEmbedding', () => {
  it('downsamples to the target size with unit norm', () => {
    const raw = Float32Array.from({ length: 1280 }, (_, i) => (i % 7) + 1);
    const compact = compactEmbedding(raw);
    expect(compact).toHaveLength(EMBEDDING_SIZE);
    const norm = Math.hypot(...compact);
    expect(norm).toBeCloseTo(1, 2);
  });

  it('keeps short vectors whole', () => {
    expect(compactEmbedding([3, 4], 256)).toEqual([0.6, 0.8]);
  });
});

describe('findNodeByCode', () => {
  const nodes: Record<string, MapNode> = {
    kitchen: { ...trained('kitchen', []), label: 'Kitchen', markerCode: 'LOC-KITCHEN' },
    lobby: { ...trained('lobby', []), label: 'Lobby', markerCode: 'LOC-LOBBY' },
  };

  it('matches marker code, id or label case-insensitively', () => {
    expect(findNodeByCode(nodes, ' loc-kitchen ')?.id).toBe('kitchen');
    expect(findNodeByCode(nodes, 'LOBBY')?.id).toBe('lobby');
    expect(findNodeByCode(nodes, 'kitchen')?.id).toBe('kitchen');
  });

  it('resolves a scanned location link to its node', () => {
    expect(findNodeByCode(nodes, 'https://example.com/app/?to=kitchen')?.id).toBe('kitchen');
    expect(findNodeByCode(nodes, ' https://example.com/?map=m.json&to=lobby ')?.id).toBe('lobby');
    expect(findNodeByCode(nodes, 'https://example.com/?to=ghost')).toBeNull();
  });

  it('returns null for unknown or empty codes', () => {
    expect(findNodeByCode(nodes, 'LOC-NOPE')).toBeNull();
    expect(findNodeByCode(nodes, '  ')).toBeNull();
  });
});

describe('rankMatches', () => {
  const nodes: Record<string, MapNode> = {
    kitchen: trained('kitchen', [
      [1, 0, 0],
      [0.9, 0.1, 0],
    ]),
    office: trained('office', [[0, 1, 0]]),
    lobby: { ...trained('lobby', []), fingerprint: [0.7, 0.7, 0] },
    untrained: trained('untrained', []),
  };

  it('ranks nodes by their best viewpoint and returns its thumbnail', () => {
    const results = rankMatches([1, 0, 0], nodes);
    expect(results.map((r) => r.node.id)).toEqual(['kitchen', 'lobby', 'office']);
    expect(results[0]).toMatchObject({ score: 100, thumbnail: 'thumb-kitchen-0' });
  });

  it('supports the legacy single fingerprint and skips untrained nodes', () => {
    const results = rankMatches([0.7, 0.7, 0], nodes);
    expect(results[0]).toMatchObject({ score: 100, thumbnail: null });
    expect(results.find((r) => r.node.id === 'untrained')).toBeUndefined();
  });

  it('applies minScore and limit', () => {
    const results = rankMatches([1, 0, 0], nodes, { minScore: 50, limit: 1 });
    expect(results).toHaveLength(1);
    expect(results[0]?.node.id).toBe('kitchen');
  });

  it('ranks by score plus boost but keeps the raw score', () => {
    const similar: Record<string, MapNode> = {
      roomA: trained('roomA', [[1, 0.2]]), // 98 %
      roomB: trained('roomB', [[1, 0.3]]), // 96 %
    };
    expect(rankMatches([1, 0], similar).map((r) => r.node.id)).toEqual(['roomA', 'roomB']);
    const boosted = rankMatches([1, 0], similar, { boosts: { roomB: 5 } });
    expect(boosted.map((r) => r.node.id)).toEqual(['roomB', 'roomA']);
    expect(boosted[0]).toMatchObject({ score: 96, boost: 5 });
  });
});

describe('pickAutoMatch', () => {
  const options = { minScore: 80, minMargin: 8 };
  const result = (id: string, score: number, boost = 0) => ({
    node: trained(id, []),
    score,
    thumbnail: null,
    boost,
  });

  it('accepts a strong match that clearly leads', () => {
    expect(pickAutoMatch([result('a', 92), result('b', 70)], options)?.node.id).toBe('a');
    expect(pickAutoMatch([result('a', 92)], options)?.node.id).toBe('a');
  });

  it('rejects a weak best match', () => {
    expect(pickAutoMatch([result('a', 75), result('b', 40)], options)).toBeNull();
    expect(pickAutoMatch([], options)).toBeNull();
  });

  it('rejects similar-looking places whose scores are close', () => {
    expect(pickAutoMatch([result('a', 92), result('b', 88)], options)).toBeNull();
  });

  it('counts the location boost in the lead', () => {
    expect(pickAutoMatch([result('a', 90), result('b', 80)], options)?.node.id).toBe('a');
    expect(pickAutoMatch([result('a', 90), result('b', 80, 5)], options)).toBeNull();
  });
});

describe('headingFactor', () => {
  it('counts views facing roughly the same way in full and unknown headings too', () => {
    expect(headingFactor(100, 100)).toBe(1);
    expect(headingFactor(350, 30)).toBe(1);
    expect(headingFactor(undefined, 30)).toBe(1);
    expect(headingFactor(30, null)).toBe(1);
  });

  it('weights views facing away down to the minimum', () => {
    expect(headingFactor(0, 180)).toBeCloseTo(HEADING_MIN_FACTOR);
    const side = headingFactor(0, 90);
    expect(side).toBeLessThan(1);
    expect(side).toBeGreaterThan(HEADING_MIN_FACTOR);
  });

  it('prefers the view recorded facing the same way when vectors tie', () => {
    const facing = (id: string, headingDeg: number): MapNode => {
      const node = trained(id, [[1, 0]]);
      return { ...node, embeddings: node.embeddings.map((s) => ({ ...s, headingDeg })) };
    };
    const tied = { a: facing('a', 180), b: facing('b', 0) };
    const ranked = rankMatches([1, 0], tied, { heading: 10 });
    expect(ranked.map((r) => r.node.id)).toEqual(['b', 'a']);
    expect(ranked.map((r) => r.score)).toEqual([100, Math.round(headingFactor(180, 10) * 100)]);
  });
});

describe('meanEmbedding and centred ranking', () => {
  const nodes = {
    a: trained('a', [[1, 0.2, 0]]),
    b: trained('b', [[1, 0, 0.2]]),
  };
  const live = [1, 0.15, 0.05];

  it('averages all vectors of the expected size', () => {
    expect(meanEmbedding(nodes, 3)).toEqual([1, 0.1, 0.1]);
    expect(meanEmbedding(nodes, 5)).toBeNull();
  });

  it('separates places that share a dominant common component', () => {
    const plain = rankMatches(live, nodes).map((r) => r.score);
    expect(Math.abs((plain[0] ?? 0) - (plain[1] ?? 0))).toBeLessThan(5);

    const centred = rankMatches(live, nodes, { center: meanEmbedding(nodes, 3) });
    expect(centred.map((r) => r.node.id)[0]).toBe('a');
    expect((centred[0]?.score ?? 0) - (centred[1]?.score ?? 100)).toBeGreaterThan(50);
  });

  it('falls back to plain cosine when the centre has another length', () => {
    expect(centeredCosineSimilarity([1, 0], [1, 0], [0, 0, 0])).toBe(1);
  });
});

describe('tile-aware ranking', () => {
  /** A view with a whole-frame vector and left/right tile vectors. */
  function tiled(id: string, vector: number[], tiles: number[][]): MapNode {
    const node = trained(id, [vector]);
    return { ...node, embeddings: node.embeddings.map((s) => ({ ...s, tiles })) };
  }

  // Two rooms mirrored left to right: the whole frame looks the same, the halves swap.
  const window = [1, 0, 0];
  const tv = [0, 1, 0];
  const whole = [0.7, 0.7, 0.1];
  const rooms = {
    windowRight: tiled('windowRight', whole, [tv, window]),
    windowLeft: tiled('windowLeft', whole, [window, tv]),
  };

  it('ties mirrored rooms on the whole frame alone', () => {
    const scores = rankMatches(whole, rooms).map((r) => r.score);
    expect(scores[0]).toBe(scores[1]);
  });

  it('tells mirrored rooms apart when tiles are given', () => {
    const ranked = rankMatches(whole, rooms, { tiles: [window, tv] });
    expect(ranked[0]?.node.id).toBe('windowLeft');
    expect((ranked[0]?.score ?? 0) - (ranked[1]?.score ?? 100)).toBeGreaterThan(15);
  });

  it('uses the whole frame only when the live or stored tiles are missing or do not fit', () => {
    const plain = rankMatches(whole, rooms).map((r) => r.score);
    expect(rankMatches(whole, rooms, { tiles: null }).map((r) => r.score)).toEqual(plain);
    expect(rankMatches(whole, rooms, { tiles: [[1, 0]] }).map((r) => r.score)).toEqual(plain);
    expect(
      rankMatches(whole, rooms, {
        tiles: [
          [1, 0],
          [0, 1],
        ],
      }).map((r) => r.score),
    ).toEqual(plain);
    const old = { a: trained('a', [whole]) };
    expect(rankMatches(whole, old, { tiles: [window, tv] })[0]?.score).toBe(100);
  });
});

describe('meanTileEmbeddings', () => {
  const nodes = {
    a: tiledNode('a', [
      [2, 0],
      [0, 2],
    ]),
    b: tiledNode('b', [
      [0, 2],
      [2, 0],
    ]),
    old: trained('old', [[1, 0]]),
  };

  function tiledNode(id: string, tiles: number[][]): MapNode {
    const node = trained(id, [[1, 0]]);
    return { ...node, embeddings: node.embeddings.map((s) => ({ ...s, tiles })) };
  }

  it('averages each tile position over the views that have tiles', () => {
    expect(meanTileEmbeddings(nodes, 2)).toEqual([
      [1, 1],
      [1, 1],
    ]);
  });

  it('is null when no view has tiles of that size', () => {
    expect(meanTileEmbeddings(nodes, 5)).toBeNull();
    expect(meanTileEmbeddings({ old: nodes.old }, 2)).toBeNull();
  });
});
