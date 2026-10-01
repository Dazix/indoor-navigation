import { describe, expect, it } from 'vitest';
import type { MapData } from '../../../types/map';
import type { EmbeddingSample } from '../../../types/vision';
import { parseMapData } from '../../mapStorage';
import {
  CHUNK_CHARS,
  CloudMapTooLargeError,
  chunkDocId,
  chunkIdsOf,
  chunksToFetch,
  cloudToMap,
  edgesFromCloud,
  edgesToCloud,
  mapContentHash,
  mapToCloud,
  parseMapHead,
  planPush,
  splitText,
  type CloudMapDocs,
  type CloudMeta,
} from '../mapDocs';

const MAP_ID = 'office_1';
const meta: CloudMeta = { mapId: MAP_ID, revision: 1, updatedAt: 1000, updatedBy: 'uid1' };

function sample(id: string, size = 10): EmbeddingSample {
  return {
    id,
    thumbnail: `data:image/jpeg;base64,${'A'.repeat(size)}`,
    vector: [0.1, 0.2, 0.3],
    timestamp: 1,
  };
}

function makeMap(overrides: Partial<MapData> = {}): MapData {
  const result = parseMapData({
    metadata: { name: 'Office' },
    floorPlanImage: null,
    nodes: {
      a: {
        id: 'a',
        x: 10,
        y: 10,
        label: 'Lobby',
        markerCode: 'QR-A',
        embeddings: [sample('s1'), sample('s2')],
      },
      b: { id: 'b', x: 50, y: 10, label: 'Kitchen', markerCode: '', embeddings: [] },
      c: { id: 'c', x: 50, y: 50, label: 'Meeting', markerCode: '', embeddings: [sample('s3')] },
    },
    edges: [
      ['a', 'b'],
      ['b', 'c', [{ x: 60, y: 20 }]],
    ],
    rooms: [{ id: 'r1', x: 0, y: 0, w: 20, h: 20, label: 'Lobby', nodeId: 'a', color: '#ffffff' }],
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

/** Replaces a node's learned views, failing loudly when the fixture has no such node. */
function withViews(map: MapData, nodeId: string, embeddings: EmbeddingSample[]): void {
  const node = map.nodes[nodeId];
  if (!node) throw new Error(`fixture has no node ${nodeId}`);
  map.nodes[nodeId] = { ...node, embeddings };
}

function dataUrl(chars: number): string {
  return `data:image/webp;base64,${'B'.repeat(chars)}`;
}

function pull(docs: CloudMapDocs, local: MapData | null = null) {
  const texts = new Map(docs.chunks.map((c) => [c.id, c.doc.data]));
  return cloudToMap(MAP_ID, docs.head, texts, local);
}

describe('edges', () => {
  it('converts nested tuples to objects and back', () => {
    const edges: MapData['edges'] = [
      ['a', 'b'],
      ['b', 'c', [{ x: 1, y: 2 }]],
    ];
    const cloud = edgesToCloud(edges);
    expect(cloud).toEqual([
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c', bends: [{ x: 1, y: 2 }] },
    ]);
    expect(edgesFromCloud(cloud)).toEqual(edges);
  });

  it('treats empty bend lists as no bends', () => {
    expect(edgesToCloud([['a', 'b', []]])).toEqual([{ from: 'a', to: 'b' }]);
  });
});

describe('splitText', () => {
  it('splits into pieces of at most the chunk size and reassembles', () => {
    const text = 'x'.repeat(CHUNK_CHARS * 2 + 5);
    const parts = splitText(text);
    expect(parts).toHaveLength(3);
    expect(parts.every((p) => p.length <= CHUNK_CHARS)).toBe(true);
    expect(parts.join('')).toBe(text);
  });

  it('returns no pieces for empty text', () => {
    expect(splitText('')).toEqual([]);
  });
});

describe('chunkDocId', () => {
  it('never contains a slash and keeps ids distinct', () => {
    const ids = ['a/b', 'a~b', 'a=b', 'a%2Fb', 'a b'].map((n) => chunkDocId(MAP_ID, 'emb', n, 'h1', 0));
    expect(ids.every((id) => !id.includes('/'))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('changes with the content hash, so new content never overwrites published chunks', () => {
    expect(chunkDocId(MAP_ID, 'fp', null, 'h1', 0)).not.toBe(chunkDocId(MAP_ID, 'fp', null, 'h2', 0));
  });
});

describe('mapContentHash', () => {
  it('ignores key order and empty bend lists', () => {
    const map = makeMap();
    const reordered: MapData = { ...map, nodes: Object.fromEntries(Object.entries(map.nodes).reverse()) };
    expect(mapContentHash(reordered)).toBe(mapContentHash(map));
  });

  it('changes when anything is lost, down to the tiles of one view', () => {
    const withTiles = makeMap();
    const node = withTiles.nodes.a;
    if (!node) throw new Error('fixture node missing');
    withTiles.nodes.a = { ...node, embeddings: [{ ...sample('t1'), tiles: [[0.5], [0.1]] }] };
    const stripped = makeMap();
    stripped.nodes.a = { ...node, embeddings: [sample('t1')] };
    expect(mapContentHash(withTiles)).not.toBe(mapContentHash(stripped));
  });
});

describe('mapToCloud', () => {
  it('keeps learned views out of the main document', () => {
    const { head, chunks } = mapToCloud(makeMap(), meta);
    expect(JSON.stringify(head)).not.toContain('thumbnail');
    expect(Object.keys(head.chunks.embeddings).sort()).toEqual(['a', 'c']);
    expect(chunks.map((c) => c.id).sort()).toEqual(chunkIdsOf(MAP_ID, head).sort());
    expect(chunks.map((c) => c.doc.nodeId).sort()).toEqual(['a', 'c']);
    expect(head.nodes.a).not.toHaveProperty('embeddings');
    expect(head).toMatchObject({ kind: 'map', name: 'Office', revision: 1, updatedBy: 'uid1' });
  });

  it('stores edges without nested arrays', () => {
    const { head } = mapToCloud(makeMap(), meta);
    expect(head.edges).toEqual([
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c', bends: [{ x: 60, y: 20 }] },
    ]);
  });

  it('keeps a path floor plan inline', () => {
    const { head, chunks } = mapToCloud(makeMap({ floorPlanImage: 'sample-floorplan.svg' }), meta);
    expect(head.floorPlanImage).toBe('sample-floorplan.svg');
    expect(head.chunks.floorPlan).toBeUndefined();
    expect(chunks.some((c) => c.doc.part === 'fp')).toBe(false);
  });

  it('moves an uploaded floor plan into chunks of bounded size', () => {
    const { head, chunks } = mapToCloud(makeMap({ floorPlanImage: dataUrl(CHUNK_CHARS * 2) }), meta);
    const fp = chunks.filter((c) => c.doc.part === 'fp');
    expect(head.floorPlanImage).toBeNull();
    expect(head.chunks.floorPlan?.n).toBe(3);
    expect(fp).toHaveLength(3);
    expect(fp.every((c) => c.doc.data.length <= CHUNK_CHARS)).toBe(true);
  });

  it('omits undefined values, which Firestore rejects', () => {
    const { head } = mapToCloud(makeMap(), meta);
    expect(JSON.stringify(head)).not.toContain('undefined');
    expect(head.nodes.a).not.toHaveProperty('fingerprint');
  });

  it('rejects a structure too large for one document', () => {
    const nodes: MapData['nodes'] = {};
    for (let i = 0; i < 3000; i++) {
      nodes[`n${i}`] = {
        id: `n${i}`,
        x: 1,
        y: 1,
        label: 'L'.repeat(120),
        markerCode: 'M'.repeat(120),
        embeddings: [],
      };
    }
    const big = { ...makeMap(), nodes, edges: [], rooms: [] };
    expect(() => mapToCloud(big, meta)).toThrow(CloudMapTooLargeError);
  });
});

describe('cloudToMap', () => {
  it('round-trips a map with views, bends and an uploaded floor plan', () => {
    const map = makeMap({ floorPlanImage: dataUrl(CHUNK_CHARS + 100) });
    const result = pull(mapToCloud(map, meta));
    expect(result).toEqual({ ok: true, data: map });
  });

  it('keeps the tiles of learned views', () => {
    const map = makeMap();
    const node = map.nodes.a;
    if (!node) throw new Error('fixture node missing');
    map.nodes.a = {
      ...node,
      embeddings: [
        {
          ...sample('t1'),
          tiles: [
            [0.5, 0.5],
            [0.1, 0.9],
          ],
        },
      ],
    };
    const result = pull(mapToCloud(map, meta));
    expect(result).toEqual({ ok: true, data: map });
  });

  it('refuses a copy whose content differs from the published checksum', () => {
    const docs = mapToCloud(makeMap(), meta);
    const tampered = { ...docs, head: { ...docs.head, contentHash: 'other' } };
    const result = pull(tampered);
    expect(result.ok).toBe(false);
  });

  it('accepts heads from before checksums existed', () => {
    const docs = mapToCloud(makeMap(), meta);
    const legacy = { ...docs.head, contentHash: undefined };
    expect(pull({ ...docs, head: legacy }).ok).toBe(true);
  });

  it('round-trips through the JSON a real Firestore read would return', () => {
    const docs = mapToCloud(makeMap(), meta);
    const head = parseMapHead(JSON.parse(JSON.stringify(docs.head)));
    expect(head.ok).toBe(true);
  });

  it('reports a missing chunk', () => {
    const docs = mapToCloud(makeMap(), meta);
    const result = cloudToMap(MAP_ID, docs.head, new Map(), null);
    expect(result).toEqual({ ok: false, error: 'A cloud map chunk is missing' });
  });

  it('reports a corrupt chunk', () => {
    const docs = mapToCloud(makeMap(), meta);
    const texts = new Map(docs.chunks.map((c) => [c.id, c.doc.data.replace('A', 'Z')]));
    const result = cloudToMap(MAP_ID, docs.head, texts, null);
    expect(result).toEqual({ ok: false, error: 'A cloud map chunk is corrupt' });
  });

  it('rejects data that fails map validation', () => {
    const docs = mapToCloud(makeMap(), meta);
    docs.head.edges.push({ from: 'a', to: 'missing' });
    const result = pull(docs);
    expect(result.ok).toBe(false);
  });

  it('reuses matching groups from the local map and needs no chunk for them', () => {
    const map = makeMap();
    const docs = mapToCloud(map, meta);
    expect(chunksToFetch(MAP_ID, docs.head, map)).toEqual([]);
    const result = cloudToMap(MAP_ID, docs.head, new Map(), map);
    expect(result).toEqual({ ok: true, data: map });
  });
});

describe('chunksToFetch', () => {
  it('asks for everything without a local map', () => {
    const docs = mapToCloud(makeMap({ floorPlanImage: dataUrl(10) }), meta);
    expect(chunksToFetch(MAP_ID, docs.head, null).sort()).toEqual(chunkIdsOf(MAP_ID, docs.head).sort());
  });

  it('asks only for groups that changed', () => {
    const local = makeMap();
    const remote = makeMap();
    withViews(remote, 'c', [sample('s3'), sample('s4')]);
    const docs = mapToCloud(remote, meta);
    const idsOfC = docs.chunks.filter((c) => c.doc.nodeId === 'c').map((c) => c.id);
    expect(idsOfC).toHaveLength(1);
    expect(chunksToFetch(MAP_ID, docs.head, local)).toEqual(idsOfC);
  });
});

describe('planPush', () => {
  it('writes every chunk on the first push', () => {
    const docs = mapToCloud(makeMap({ floorPlanImage: dataUrl(10) }), meta);
    const { write, deleteIds } = planPush(MAP_ID, docs, null);
    expect(write).toHaveLength(docs.chunks.length);
    expect(deleteIds).toEqual([]);
  });

  it('writes nothing for unchanged content', () => {
    const map = makeMap({ floorPlanImage: dataUrl(10) });
    const remote = mapToCloud(map, meta).head;
    const next = mapToCloud(map, { ...meta, revision: 2 });
    expect(planPush(MAP_ID, next, remote)).toEqual({ write: [], deleteIds: [] });
  });

  it('writes only the changed group', () => {
    const before = makeMap();
    const remote = mapToCloud(before, meta).head;
    const after = makeMap();
    withViews(after, 'a', [sample('s1')]);
    const next = mapToCloud(after, { ...meta, revision: 2 });
    const { write, deleteIds } = planPush(MAP_ID, next, remote);
    expect(write.map((c) => c.id)).toEqual(next.chunks.filter((c) => c.doc.nodeId === 'a').map((c) => c.id));
    expect(write.every((c) => c.doc.nodeId === 'a')).toBe(true);
    // The superseded chunk stays published until the head commit and is only then deleted.
    expect(deleteIds).toEqual(chunkIdsOf(MAP_ID, remote).filter((id) => id.includes('~emb~a~')));
  });

  it('never reuses the id of a published chunk for different content', () => {
    const remote = mapToCloud(makeMap({ floorPlanImage: dataUrl(50) }), meta);
    const next = mapToCloud(makeMap({ floorPlanImage: dataUrl(60) }), { ...meta, revision: 2 });
    const published = new Set(remote.chunks.map((c) => c.id));
    const { write } = planPush(MAP_ID, next, remote.head);
    expect(write.length).toBeGreaterThan(0);
    expect(write.every((c) => !published.has(c.id))).toBe(true);
  });

  it('deletes chunks of removed groups and of shrunk groups', () => {
    const before = makeMap({ floorPlanImage: dataUrl(CHUNK_CHARS * 2) });
    const remote = mapToCloud(before, meta).head;
    const after = makeMap({ floorPlanImage: dataUrl(CHUNK_CHARS / 2) });
    delete after.nodes.c;
    after.edges = [['a', 'b']];
    const { deleteIds } = planPush(MAP_ID, mapToCloud(after, { ...meta, revision: 2 }), remote);
    const gone = chunkIdsOf(MAP_ID, remote).filter((id) => id.includes('~fp~') || id.includes('~emb~c~'));
    expect(gone).toHaveLength(4);
    expect(deleteIds.sort()).toEqual(gone.sort());
  });
});

describe('parseMapHead', () => {
  it('rejects a head that claims an absurd number of chunks', () => {
    const { head } = mapToCloud(makeMap(), meta);
    const hostile = { ...head, chunks: { embeddings: { a: { n: 100000, hash: 'x' } } } };
    expect(parseMapHead(hostile).ok).toBe(false);
  });

  it('rejects documents that are not maps', () => {
    expect(parseMapHead({ kind: 'chunk' }).ok).toBe(false);
    expect(parseMapHead(null).ok).toBe(false);
  });
});
