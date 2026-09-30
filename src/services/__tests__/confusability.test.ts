import { describe, expect, it } from 'vitest';
import type { MapNode } from '../../types/map';
import { analyzeConfusability } from '../confusability';

function trained(id: string, vectors: number[][]): MapNode {
  return {
    id,
    x: 0,
    y: 0,
    label: id,
    markerCode: '',
    embeddings: vectors.map((vector, i) => ({ id: `${id}-${i}`, thumbnail: '', vector, timestamp: i })),
  };
}

describe('analyzeConfusability', () => {
  it('recognises clearly different places', () => {
    const nodes = {
      a: trained('a', [
        [1, 0, 0],
        [0.9, 0.1, 0],
      ]),
      b: trained('b', [
        [0, 1, 0],
        [0.1, 0.9, 0],
      ]),
    };
    const report = analyzeConfusability(nodes, { centered: false });
    expect(report.total).toBe(4);
    expect(report.accuracy).toBe(1);
    expect(report.confused).toEqual([]);
  });

  it('reports which places get mixed up', () => {
    const nodes = {
      a: trained('a', [
        [1, 0, 0],
        [0, 1, 0],
      ]),
      b: trained('b', [[0.9, 0.1, 0]]),
    };
    const report = analyzeConfusability(nodes, { centered: false });
    // b has a single view and is never held out; both views of a look more like b than like each other.
    expect(report.total).toBe(2);
    expect(report.confused).toEqual([{ expectedId: 'a', predictedId: 'b', count: 2 }]);
    expect(report.accuracy).toBe(0);
  });

  it('returns an empty report when no node has two views', () => {
    const report = analyzeConfusability({ a: trained('a', [[1, 0]]) });
    expect(report).toEqual({ total: 0, accuracy: 0, meanMargin: 0, confused: [], skippedNodes: 1 });
  });

  it('reports the lead over the runner-up', () => {
    const nodes = {
      a: trained('a', [
        [1, 0, 0],
        [1, 0, 0],
      ]),
      b: trained('b', [[0, 1, 0]]),
    };
    const report = analyzeConfusability(nodes, { centered: false });
    // Each held-out view matches its twin at 100 % and the other place at 0 %.
    expect(report.meanMargin).toBe(100);
    expect(report.skippedNodes).toBe(1);
  });
});
