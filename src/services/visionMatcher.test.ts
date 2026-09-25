import { describe, expect, it } from 'vitest';
import type { MapNode } from '../types/map';
import {
  compactEmbedding,
  cosineSimilarity,
  EMBEDDING_SIZE,
  findNodeByCode,
  rankMatches,
} from './visionMatcher';

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
});
