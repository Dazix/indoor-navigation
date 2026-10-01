import { describe, expect, it } from 'vitest';
import type { MapNode } from '../../types/map';
import type { MatchResult } from '../../types/vision';
import { pickAutoMatch } from '../visionMatcher';
import { pushFrame, smoothMatches } from '../scoreSmoothing';

function node(id: string): MapNode {
  return { id, x: 0, y: 0, label: id, markerCode: '', embeddings: [] };
}

function match(id: string, score: number, boost = 0, thumbnail: string | null = null): MatchResult {
  return { node: node(id), score, thumbnail, boost };
}

describe('pushFrame', () => {
  it('keeps only the newest frames', () => {
    const frames = [1, 2, 3, 4].reduce<number[][]>((acc, n) => pushFrame(acc, [n], 3), []);
    expect(frames).toEqual([[2], [3], [4]]);
  });

  it('does not change the history it is given', () => {
    const before = [[1]];
    pushFrame(before, [2], 3);
    expect(before).toEqual([[1]]);
  });
});

describe('smoothMatches', () => {
  it('returns nothing without frames', () => {
    expect(smoothMatches([])).toEqual([]);
  });

  it('is the frame itself for a single frame', () => {
    const frame = [match('a', 90), match('b', 70)];
    expect(smoothMatches([frame]).map((r) => [r.node.id, r.score])).toEqual([
      ['a', 90],
      ['b', 70],
    ]);
  });

  it('averages the score of a node over the frames', () => {
    const ranked = smoothMatches([[match('a', 90)], [match('a', 80)], [match('a', 70)]]);
    expect(ranked[0]?.score).toBe(80);
  });

  it('counts a frame where a node was missing as zero, so a flicker does not win', () => {
    const frames = [[match('a', 90)], [match('b', 92), match('a', 85)], [match('a', 88)]];
    const ranked = smoothMatches(frames);
    expect(ranked.map((r) => r.node.id)).toEqual(['a', 'b']);
    expect(ranked[0]?.score).toBe(88);
    expect(ranked[1]?.score).toBe(31);
  });

  it('turns a one-frame jump between two similar places into no automatic match', () => {
    const frames = [
      [match('a', 88), match('b', 60)],
      [match('b', 95), match('a', 80)],
      [match('a', 89), match('b', 62)],
    ];
    const raw = frames.map((f) => pickAutoMatch(f, { minScore: 80, minMargin: 8 })?.node.id ?? null);
    expect(raw).toEqual(['a', 'b', 'a']);
    expect(pickAutoMatch(smoothMatches(frames), { minScore: 80, minMargin: 8 })?.node.id).toBe('a');
  });

  it('takes the bonus from the newest frame and the thumbnail from the best-scoring one', () => {
    const ranked = smoothMatches([
      [match('a', 60, 5, 'old')],
      [match('a', 90, 0, 'best')],
      [match('a', 70, 12, 'new')],
    ]);
    expect(ranked[0]?.boost).toBe(12);
    expect(ranked[0]?.thumbnail).toBe('best');
  });

  it('orders by smoothed score plus bonus', () => {
    const ranked = smoothMatches([[match('a', 80, 0), match('b', 76, 10)]]);
    expect(ranked.map((r) => r.node.id)).toEqual(['b', 'a']);
  });

  it('honours the limit', () => {
    const ranked = smoothMatches([[match('a', 90), match('b', 80), match('c', 70)]], 2);
    expect(ranked.map((r) => r.node.id)).toEqual(['a', 'b']);
  });
});
