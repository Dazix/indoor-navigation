import { describe, expect, it } from 'vitest';
import { createBlankMap } from './mapLibrary';
import { addNode, deleteNode, setEmbeddings, snapToMap, toggleEdge, updateNode } from './mapEditing';

function sampleMap() {
  let map = createBlankMap('Test');
  map = addNode(map, { id: 'a', x: 10, y: 10, label: 'A', markerCode: 'LOC-A' });
  map = addNode(map, { id: 'b', x: 20, y: 10, label: 'B', markerCode: 'LOC-B' });
  map = addNode(map, { id: 'c', x: 30, y: 10, label: 'C', markerCode: 'LOC-C' });
  return toggleEdge(toggleEdge(map, 'a', 'b'), 'b', 'c');
}

describe('map editing', () => {
  it('toggles corridors regardless of direction', () => {
    const map = sampleMap();
    expect(map.edges).toEqual([
      ['a', 'b'],
      ['b', 'c'],
    ]);
    expect(toggleEdge(map, 'b', 'a').edges).toEqual([['b', 'c']]);
  });

  it('ignores self-loops and unknown nodes', () => {
    const map = sampleMap();
    expect(toggleEdge(map, 'a', 'a')).toBe(map);
    expect(toggleEdge(map, 'a', 'ghost')).toBe(map);
  });

  it('deletes a node with its corridors', () => {
    const map = deleteNode(sampleMap(), 'b');
    expect(Object.keys(map.nodes)).toEqual(['a', 'c']);
    expect(map.edges).toEqual([]);
  });

  it('updates node fields without mutating the original', () => {
    const map = sampleMap();
    const next = updateNode(map, 'a', { label: 'Lobby' });
    expect(next.nodes.a?.label).toBe('Lobby');
    expect(map.nodes.a?.label).toBe('A');
  });

  it('replaces the legacy fingerprint when embeddings are saved', () => {
    const map = updateNode(sampleMap(), 'a', { fingerprint: [1, 0] });
    const sample = { id: 's', thumbnail: 'data:image/jpeg;base64,', vector: [1], timestamp: 0 };
    const next = setEmbeddings(map, 'a', [sample]);
    expect(next.nodes.a?.embeddings).toEqual([sample]);
    expect(next.nodes.a?.fingerprint).toBeUndefined();
  });

  it('snaps points into the map space', () => {
    expect(snapToMap({ x: -4, y: 42.26 })).toEqual({ x: 0, y: 42.5 });
    expect(snapToMap({ x: 130, y: 7.1 })).toEqual({ x: 100, y: 7 });
  });
});
