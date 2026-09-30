import { describe, expect, it, vi } from 'vitest';
import type { MapData } from '../../../types/map';
import type { EmbeddingSample } from '../../../types/vision';
import { parseMapData } from '../../mapStorage';
import { createCloudAdapter } from '../cloudAdapter';
import { CHUNK_CHARS, type MapHead } from '../mapDocs';
import { CloudError, type AuthFacade, type CloudUser, type DocStore } from '../types';

const MAP_ID = 'office';
const user: CloudUser = { uid: 'u1', email: 'a@corp.com', displayName: 'A' };

function sample(id: string): EmbeddingSample {
  return { id, thumbnail: 'data:image/jpeg;base64,AAAA', vector: [0.1, 0.2], timestamp: 1 };
}

function makeMap(floorPlanChars = 0, views = 1): MapData {
  const result = parseMapData({
    metadata: { name: 'Office' },
    floorPlanImage: floorPlanChars ? `data:image/webp;base64,${'B'.repeat(floorPlanChars)}` : null,
    nodes: {
      a: {
        id: 'a',
        x: 10,
        y: 10,
        label: 'A',
        markerCode: '',
        embeddings: Array.from({ length: views }, (_, i) => sample(`s${i}`)),
      },
      b: { id: 'b', x: 50, y: 10, label: 'B', markerCode: '', embeddings: [sample('t1')] },
    },
    edges: [['a', 'b', [{ x: 30, y: 20 }]]],
    rooms: [],
  });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

/** In-memory Firestore stand-in. Values are cloned on the way in and out, like real storage. */
function fakeStore() {
  const docs = new Map<string, unknown>();
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const emit = (id: string) => {
    for (const cb of listeners.get(id) ?? []) cb(docs.get(id) ?? null);
  };
  const store: DocStore = {
    get: vi.fn((id: string) => Promise.resolve(docs.has(id) ? structuredClone(docs.get(id)) : null)),
    writeDocs: vi.fn((entries: readonly { id: string; data: unknown }[]) => {
      for (const { id, data } of entries) docs.set(id, structuredClone(data));
      return Promise.resolve();
    }),
    commitHead: vi.fn((id: string, head: MapHead, expected: number | null) => {
      const current = docs.get(id) as MapHead | undefined;
      if ((current?.revision ?? null) !== expected) {
        return Promise.reject(new CloudError('conflict', 'revision moved'));
      }
      docs.set(id, structuredClone(head));
      emit(id);
      return Promise.resolve();
    }),
    deleteDocs: vi.fn((ids: readonly string[]) => {
      for (const id of ids) docs.delete(id);
      return Promise.resolve();
    }),
    watch: (id, onData) => {
      const set = listeners.get(id) ?? new Set();
      set.add(onData);
      listeners.set(id, set);
      onData(docs.get(id) ?? null);
      return () => set.delete(onData);
    },
  };
  return { store, docs };
}

function fakeAuth(initial: CloudUser | null = user): AuthFacade {
  let current = initial;
  const callbacks = new Set<(u: CloudUser | null) => void>();
  return {
    signIn: () => {
      current = user;
      for (const cb of callbacks) cb(current);
      return Promise.resolve(user);
    },
    signOut: () => {
      current = null;
      for (const cb of callbacks) cb(null);
      return Promise.resolve();
    },
    onChange: (cb) => {
      callbacks.add(cb);
      cb(current);
      return () => callbacks.delete(cb);
    },
    current: () => current,
  };
}

const writtenIds = (store: DocStore) =>
  vi.mocked(store.writeDocs).mock.calls.flatMap(([entries]) => entries.map((e) => e.id));

describe('push and pull', () => {
  it('round-trips a map with learned views and a multi-chunk floor plan', async () => {
    const { store } = fakeStore();
    const adapter = createCloudAdapter(store, fakeAuth());
    const map = makeMap(CHUNK_CHARS * 2 + 10);

    expect(await adapter.push(MAP_ID, map, null)).toBe(1);
    const pulled = await adapter.pull(MAP_ID, null);

    expect(pulled?.map).toEqual(map);
    expect(pulled?.head.revision).toBe(1);
    expect(pulled?.head.updatedBy).toBe('u1');
  });

  it('returns null when the cloud map does not exist', async () => {
    const adapter = createCloudAdapter(fakeStore().store, fakeAuth());
    expect(await adapter.getHead(MAP_ID)).toBeNull();
    expect(await adapter.pull(MAP_ID, null)).toBeNull();
  });

  it('requires a signed-in user to push and writes nothing without one', async () => {
    const { store } = fakeStore();
    const adapter = createCloudAdapter(store, fakeAuth(null));
    await expect(adapter.push(MAP_ID, makeMap(), null)).rejects.toMatchObject({ code: 'auth-required' });
    expect(store.writeDocs).not.toHaveBeenCalled();
    expect(store.commitHead).not.toHaveBeenCalled();
  });

  it('lets visitors pull without signing in', async () => {
    const { store } = fakeStore();
    await createCloudAdapter(store, fakeAuth()).push(MAP_ID, makeMap(), null);
    const visitor = createCloudAdapter(store, fakeAuth(null));
    expect((await visitor.pull(MAP_ID, null))?.map).toEqual(makeMap());
  });

  it('increments the revision on every push', async () => {
    const adapter = createCloudAdapter(fakeStore().store, fakeAuth());
    expect(await adapter.push(MAP_ID, makeMap(), null)).toBe(1);
    expect(await adapter.push(MAP_ID, makeMap(0, 2), 1)).toBe(2);
    expect(await adapter.push(MAP_ID, makeMap(0, 3), 2)).toBe(3);
  });
});

describe('conflicts', () => {
  it('rejects a push based on an outdated revision without touching the cloud', async () => {
    const { store } = fakeStore();
    const adapter = createCloudAdapter(store, fakeAuth());
    await adapter.push(MAP_ID, makeMap(), null);
    await adapter.push(MAP_ID, makeMap(0, 2), 1);
    vi.mocked(store.writeDocs).mockClear();

    await expect(adapter.push(MAP_ID, makeMap(0, 3), 1)).rejects.toMatchObject({ code: 'conflict' });
    expect(store.writeDocs).not.toHaveBeenCalled();
    expect((await adapter.getHead(MAP_ID))?.revision).toBe(2);
  });

  it('rejects creating a map that already exists', async () => {
    const adapter = createCloudAdapter(fakeStore().store, fakeAuth());
    await adapter.push(MAP_ID, makeMap(), null);
    await expect(adapter.push(MAP_ID, makeMap(), null)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('keeps the published version intact when another push wins the race', async () => {
    const { store } = fakeStore();
    const adapter = createCloudAdapter(store, fakeAuth());
    await adapter.push(MAP_ID, makeMap(), null);
    const realCommit = vi.mocked(store.commitHead).getMockImplementation();
    // Another client commits between this push's check and its commit.
    vi.mocked(store.commitHead).mockImplementationOnce(async (id, head, expected) => {
      await realCommit?.(id, { ...head, revision: 2 }, expected);
      return realCommit?.(id, head, expected);
    });

    await expect(adapter.push(MAP_ID, makeMap(0, 3), 1)).rejects.toMatchObject({ code: 'conflict' });
    expect((await adapter.getHead(MAP_ID))?.revision).toBe(2);
  });
});

describe('incremental sync', () => {
  it('writes only changed chunks and deletes superseded ones', async () => {
    const { store, docs } = fakeStore();
    const adapter = createCloudAdapter(store, fakeAuth());
    await adapter.push(MAP_ID, makeMap(100, 1), null);
    const before = new Set(docs.keys());
    vi.mocked(store.writeDocs).mockClear();

    await adapter.push(MAP_ID, makeMap(100, 2), 1);

    const written = writtenIds(store);
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('~emb~a~');
    expect(docs.has(written[0] as string)).toBe(true);
    const deleted = [...before].filter((id) => !docs.has(id));
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toContain('~emb~a~');
  });

  it('does not download chunks the local map already has', async () => {
    const { store } = fakeStore();
    const adapter = createCloudAdapter(store, fakeAuth());
    const map = makeMap(CHUNK_CHARS + 10);
    await adapter.push(MAP_ID, map, null);
    vi.mocked(store.get).mockClear();

    const pulled = await adapter.pull(MAP_ID, map);

    expect(pulled?.map).toEqual(map);
    expect(vi.mocked(store.get).mock.calls.map(([id]) => id)).toEqual([MAP_ID]);
  });

  it('downloads only the group that changed', async () => {
    const { store } = fakeStore();
    const adapter = createCloudAdapter(store, fakeAuth());
    const local = makeMap(50, 1);
    await adapter.push(MAP_ID, makeMap(50, 2), null);
    vi.mocked(store.get).mockClear();

    const pulled = await adapter.pull(MAP_ID, local);

    expect(pulled?.map).toEqual(makeMap(50, 2));
    const fetched = vi.mocked(store.get).mock.calls.map(([id]) => id);
    expect(fetched).toHaveLength(2);
    expect(fetched.filter((id) => id.includes('~emb~a~'))).toHaveLength(1);
  });

  it('retries a pull when chunks were replaced between reading the head and the chunks', async () => {
    const { store, docs } = fakeStore();
    const adapter = createCloudAdapter(store, fakeAuth());
    await adapter.push(MAP_ID, makeMap(0, 1), null);
    const realGet = vi.mocked(store.get).getMockImplementation();
    let sabotaged = false;
    vi.mocked(store.get).mockImplementation(async (id) => {
      if (!sabotaged && id.includes('~emb~a~')) {
        sabotaged = true;
        // A concurrent push publishes new views and removes the old chunk.
        await adapter.push(MAP_ID, makeMap(0, 2), 1);
        return null;
      }
      return realGet?.(id) ?? null;
    });

    const pulled = await adapter.pull(MAP_ID, null);

    expect(pulled?.head.revision).toBe(2);
    expect(pulled?.map).toEqual(makeMap(0, 2));
    expect(docs.size).toBeGreaterThan(0);
  });
});

describe('invalid data', () => {
  it('rejects a cloud map that fails validation', async () => {
    const { store, docs } = fakeStore();
    const adapter = createCloudAdapter(store, fakeAuth());
    await adapter.push(MAP_ID, makeMap(), null);
    const head = structuredClone(docs.get(MAP_ID)) as MapHead;
    head.edges.push({ from: 'a', to: 'ghost' });
    docs.set(MAP_ID, head);

    await expect(adapter.pull(MAP_ID, null)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('rejects a malformed main document', async () => {
    const { store, docs } = fakeStore();
    docs.set(MAP_ID, { kind: 'map', nonsense: true });
    await expect(createCloudAdapter(store, fakeAuth()).getHead(MAP_ID)).rejects.toMatchObject({
      code: 'invalid',
    });
  });

  it('reports a map too large to sync as invalid', async () => {
    const adapter = createCloudAdapter(fakeStore().store, fakeAuth());
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
    await expect(adapter.push(MAP_ID, { ...makeMap(), nodes, edges: [] }, null)).rejects.toMatchObject({
      code: 'invalid',
    });
  });
});

describe('watch', () => {
  it('reports the head, null for a missing map, and later pushes', async () => {
    const { store } = fakeStore();
    const adapter = createCloudAdapter(store, fakeAuth());
    const seen: (number | null)[] = [];
    const stop = adapter.watch(
      MAP_ID,
      (head) => seen.push(head?.revision ?? null),
      () => undefined,
    );

    await adapter.push(MAP_ID, makeMap(), null);
    await adapter.push(MAP_ID, makeMap(0, 2), 1);
    stop();
    await adapter.push(MAP_ID, makeMap(0, 3), 2);

    expect(seen).toEqual([null, 1, 2]);
  });

  it('reports a malformed document through the error callback', () => {
    const { store, docs } = fakeStore();
    docs.set(MAP_ID, { kind: 'map' });
    const errors: CloudError[] = [];
    createCloudAdapter(store, fakeAuth()).watch(
      MAP_ID,
      () => undefined,
      (err) => errors.push(err),
    );
    expect(errors[0]?.code).toBe('invalid');
  });
});
