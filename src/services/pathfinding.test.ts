import { describe, expect, it } from 'vitest';
import type { Edge, MapNode } from '../types/map';
import { buildGraph, findShortestPath } from './pathfinding';

function node(id: string, x: number, y: number): MapNode {
  return { id, x, y, label: id, markerCode: '', embeddings: [] };
}

const nodes: Record<string, MapNode> = {
  a: node('a', 0, 0),
  b: node('b', 10, 0),
  c: node('c', 20, 0),
  d: node('d', 10, 50),
  island: node('island', 90, 90),
};

describe('buildGraph', () => {
  it('creates undirected weighted adjacency and skips edges to missing nodes', () => {
    const graph = buildGraph(nodes, [
      ['a', 'b'],
      ['b', 'ghost'],
    ]);
    expect(graph.get('a')).toEqual([{ id: 'b', cost: 10 }]);
    expect(graph.get('b')).toEqual([{ id: 'a', cost: 10 }]);
    expect(graph.has('ghost')).toBe(false);
  });
});

describe('findShortestPath', () => {
  const edges: Edge[] = [
    ['a', 'b'],
    ['b', 'c'],
    ['a', 'd'],
    ['d', 'c'],
  ];

  it('returns the single node when start equals target', () => {
    expect(findShortestPath('a', 'a', nodes, edges)).toEqual(['a']);
  });

  it('finds a straight route', () => {
    expect(findShortestPath('a', 'c', nodes, edges)).toEqual(['a', 'b', 'c']);
  });

  it('prefers the shorter distance over fewer hops', () => {
    // a-d-c is 2 hops but ~102 units long; a-x1-b-x2-c is 4 hops but only 20 units.
    const withStops = { ...nodes, x1: node('x1', 5, 0), x2: node('x2', 15, 0) };
    const routes: Edge[] = [
      ['a', 'd'],
      ['d', 'c'],
      ['a', 'x1'],
      ['x1', 'b'],
      ['b', 'x2'],
      ['x2', 'c'],
    ];
    expect(findShortestPath('a', 'c', withStops, routes)).toEqual(['a', 'x1', 'b', 'x2', 'c']);
  });

  it('returns an empty path when the target is unreachable', () => {
    expect(findShortestPath('a', 'island', nodes, edges)).toEqual([]);
  });

  it('returns an empty path for unknown or null ids', () => {
    expect(findShortestPath('a', 'nope', nodes, edges)).toEqual([]);
    expect(findShortestPath(null, 'a', nodes, edges)).toEqual([]);
  });

  it('ignores edges that reference deleted nodes', () => {
    const rest: Record<string, MapNode> = { a: nodes.a as MapNode, c: nodes.c as MapNode };
    expect(findShortestPath('a', 'c', rest, edges)).toEqual([]);
  });
});
