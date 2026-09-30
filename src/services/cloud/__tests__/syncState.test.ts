import { describe, expect, it } from 'vitest';
import {
  decidePush,
  decideRemoteUpdate,
  deriveStatus,
  entrySourceId,
  linkedLocalIds,
  linkMap,
  markDirty,
  markSynced,
  nextRevision,
  parseSyncState,
  unlinkMap,
  type MapSyncEntry,
  type SyncState,
} from '../syncState';

const entry = (over: Partial<MapSyncEntry> = {}): MapSyncEntry => ({
  cloudMapId: 'office',
  baseRevision: 3,
  dirty: false,
  lastSyncedAt: 100,
  ...over,
});

describe('state transitions', () => {
  it('links a map as unsaved at revision 0', () => {
    const state = linkMap({}, 'local1', 'office', 'praha');
    expect(state.local1).toEqual({
      sourceId: 'praha',
      cloudMapId: 'office',
      baseRevision: 0,
      dirty: true,
      lastSyncedAt: null,
    });
  });

  it('falls back to the first source for entries from before sources existed', () => {
    const sources = [{ id: 'praha' }, { id: 'liberec' }];
    expect(entrySourceId(entry(), sources)).toBe('praha');
    expect(entrySourceId(entry({ sourceId: 'liberec' }), sources)).toBe('liberec');
    expect(entrySourceId(entry(), [])).toBeUndefined();
  });

  it('finds the local maps linked to one source by cloud map id', () => {
    const sources = [{ id: 'praha' }, { id: 'liberec' }];
    const state: SyncState = {
      a: entry({ cloudMapId: 'm1', sourceId: 'praha' }),
      b: entry({ cloudMapId: 'm2', sourceId: 'liberec' }),
      c: entry({ cloudMapId: 'm3' }),
    };
    expect([...linkedLocalIds(state, 'praha', sources)]).toEqual([
      ['m1', 'a'],
      ['m3', 'c'],
    ]);
    expect([...linkedLocalIds(state, 'liberec', sources)]).toEqual([['m2', 'b']]);
  });

  it('marks only linked maps dirty and is a no-op when already dirty', () => {
    const state: SyncState = { local1: entry() };
    expect(markDirty(state, 'local1').local1?.dirty).toBe(true);
    expect(markDirty(state, 'other')).toBe(state);
    const dirty = markDirty(state, 'local1');
    expect(markDirty(dirty, 'local1')).toBe(dirty);
  });

  it('marks a map synced at a revision', () => {
    const state: SyncState = { local1: entry({ dirty: true }) };
    expect(markSynced(state, 'local1', 7, 555).local1).toEqual({
      cloudMapId: 'office',
      baseRevision: 7,
      dirty: false,
      lastSyncedAt: 555,
    });
    expect(markSynced(state, 'missing', 7, 555)).toBe(state);
  });

  it('keeps the dirty flag for edits made while a push was in flight', () => {
    const state: SyncState = { local1: entry({ dirty: true }) };
    expect(markSynced(state, 'local1', 8, 600, true).local1).toMatchObject({ baseRevision: 8, dirty: true });
  });

  it('unlinks without mutating the input', () => {
    const state: SyncState = { a: entry(), b: entry() };
    expect(Object.keys(unlinkMap(state, 'a'))).toEqual(['b']);
    expect(Object.keys(state)).toEqual(['a', 'b']);
  });

  it('computes the next revision', () => {
    expect(nextRevision(null)).toBe(1);
    expect(nextRevision(4)).toBe(5);
  });
});

describe('deriveStatus', () => {
  it('is synced only for a clean linked map while online', () => {
    expect(deriveStatus({ entry: entry(), online: true, networkError: false })).toBe('synced');
  });

  it('is unsaved for dirty and unlinked maps', () => {
    expect(deriveStatus({ entry: entry({ dirty: true }), online: true, networkError: false })).toBe(
      'unsaved',
    );
    expect(deriveStatus({ entry: undefined, online: true, networkError: false })).toBe('unsaved');
  });

  it('is offline without connectivity or after a network failure, whatever the dirty state', () => {
    expect(deriveStatus({ entry: entry(), online: false, networkError: false })).toBe('offline');
    expect(deriveStatus({ entry: entry({ dirty: true }), online: true, networkError: true })).toBe('offline');
  });
});

describe('decidePush', () => {
  it('pushes when the cloud is still at the base revision', () => {
    expect(decidePush(entry({ baseRevision: 3 }), 3)).toBe('push');
    expect(decidePush(entry({ baseRevision: 0 }), null)).toBe('push');
  });

  it('reports a conflict when someone else pushed in between', () => {
    expect(decidePush(entry({ baseRevision: 3 }), 4)).toBe('conflict');
  });

  it('conflicts when a never-synced map collides with an existing cloud map', () => {
    expect(decidePush(entry({ baseRevision: 0 }), 2)).toBe('conflict');
  });

  it('recreates a map that vanished from the cloud', () => {
    expect(decidePush(entry({ baseRevision: 3 }), null)).toBe('push');
  });
});

describe('decideRemoteUpdate', () => {
  it('ignores revisions that are not newer', () => {
    expect(decideRemoteUpdate(entry({ baseRevision: 3 }), 3, false)).toBe('ignore');
    expect(decideRemoteUpdate(entry({ baseRevision: 3 }), 2, false)).toBe('ignore');
  });

  it('applies a newer revision when local is clean', () => {
    expect(decideRemoteUpdate(entry({ baseRevision: 3 }), 4, false)).toBe('apply');
  });

  it('defers while navigating', () => {
    expect(decideRemoteUpdate(entry({ baseRevision: 3 }), 4, true)).toBe('defer');
  });

  it('never overwrites unsynced local edits, even during navigation', () => {
    expect(decideRemoteUpdate(entry({ baseRevision: 3, dirty: true }), 4, false)).toBe('conflict');
    expect(decideRemoteUpdate(entry({ baseRevision: 3, dirty: true }), 4, true)).toBe('conflict');
  });
});

describe('parseSyncState', () => {
  it('accepts valid state and rejects malformed data', () => {
    expect(parseSyncState({ local1: entry() })).toEqual({ local1: entry() });
    expect(parseSyncState({ local1: { cloudMapId: '' } })).toBeNull();
    expect(parseSyncState([])).toBeNull();
  });
});
