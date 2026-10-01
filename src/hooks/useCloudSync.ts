import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { createFirebaseAdapter } from '../services/cloud/firebaseAdapter';
import { toCloudError } from '../services/cloud/errors';
import { mapContentHash, type MapMeta } from '../services/cloud/mapDocs';
import { nullAdapter } from '../services/cloud/nullAdapter';
import {
  decidePush,
  decideRemoteUpdate,
  deriveStatus,
  entrySourceId,
  hasUnflaggedChanges,
  linkedLocalIds,
  linkMap,
  markDirty,
  markSynced,
  unlinkMap,
  type MapSyncEntry,
  type SyncState,
  type SyncStatus,
} from '../services/cloud/syncState';
import type { CloudAdapter, CloudUser } from '../services/cloud/types';
import {
  applyUrlConfig,
  EMPTY_CLOUD_CONFIG,
  findSource,
  parseStoredCloudConfig,
  removeSource as removeSourceFromConfig,
  setEnabledMaps,
  sourceIdFor,
  upsertSource,
  CLOUD_CONFIG_STORAGE_KEY,
  type FirebaseConfig,
  type StoredCloudConfig,
  type UrlConfig,
} from '../services/cloudConfig';
import { readMap } from '../services/mapLibrary';
import type { MapData, MapSummary } from '../types/map';
import { useLocalStorage } from './useLocalStorage';

export interface SyncNotice {
  tone: 'error' | 'info';
  text: string;
}

export interface SyncConflict {
  sourceId: string;
  localMapId: string;
  cloudMapId: string;
  remoteRevision: number | null;
  remoteUpdatedAt: number | null;
}

interface Options {
  sync: SyncState;
  setSync: Dispatch<SetStateAction<SyncState>>;
  map: MapData | null;
  activeMapId: string | null;
  maps: readonly MapSummary[];
  libraryReady: boolean;
  /** Adds a downloaded map to the library; `activate` opens it, otherwise the open map stays. */
  importMap: (map: MapData, activate: boolean) => Promise<string>;
  replaceMap: (id: string, map: MapData) => Promise<void>;
  switchMap: (id: string) => Promise<void>;
  /** A route is active; cloud updates then wait for the user instead of swapping the map mid-route. */
  navigating: boolean;
  notify: (notice: SyncNotice) => void;
  /** Configuration carried by the launch URL; saved once, then offered for removal from the address bar. */
  urlConfig: UrlConfig | null;
}

type Busy = 'push' | 'pull' | null;

export type CloudSync = ReturnType<typeof useCloudSync>;

/** One adapter per Firebase project for the whole session, so editing the map selection never reconnects. */
const adapterCache = new Map<string, CloudAdapter>();

function adapterForFirebase(firebase: FirebaseConfig): CloudAdapter {
  const key = JSON.stringify(firebase);
  let adapter = adapterCache.get(key);
  if (!adapter) {
    adapter = createFirebaseAdapter(firebase);
    adapterCache.set(key, adapter);
  }
  return adapter;
}

const handledKey = (sourceId: string, cloudMapId: string) => `${sourceId}/${cloudMapId}`;

export function useCloudSync(options: Options) {
  const {
    sync,
    setSync,
    map,
    activeMapId,
    maps,
    libraryReady,
    importMap,
    replaceMap,
    switchMap,
    navigating,
    notify,
    urlConfig,
  } = options;

  const [stored, setStored] = useLocalStorage<StoredCloudConfig>(
    CLOUD_CONFIG_STORAGE_KEY,
    EMPTY_CLOUD_CONFIG,
    parseStoredCloudConfig,
  );
  const sources = stored.sources;

  const adapters = useMemo(
    () => Object.fromEntries(sources.map((s) => [s.id, adapterForFirebase(s.firebase)])),
    [sources],
  );
  const adapterOf = useCallback(
    (sourceId: string | undefined): CloudAdapter =>
      (sourceId ? adapters[sourceId] : undefined) ?? nullAdapter,
    [adapters],
  );

  const [users, setUsers] = useState<Record<string, CloudUser | null>>({});
  const [online, setOnline] = useState(() => navigator.onLine);
  const [networkError, setNetworkError] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [conflict, setConflict] = useState<SyncConflict | null>(null);
  /** Local map with a cloud update that waits for the user (set during navigation). */
  const [pendingUpdateFor, setPendingUpdateFor] = useState<string | null>(null);
  const [configFromUrl, setConfigFromUrl] = useState(urlConfig !== null);
  /** Source an unlinked map is published to when there are several; the first one until chosen. */
  const [publishChoice, setPublishChoice] = useState<string | null>(null);

  // Source of the open map: its link, or where it would be published.
  const entry = activeMapId ? sync[activeMapId] : undefined;
  const linkedSourceId = entry ? entrySourceId(entry, sources) : undefined;
  const publishSourceId =
    linkedSourceId ?? (findSource(stored, publishChoice ?? undefined) ?? sources[0])?.id;
  const adapter = adapterOf(publishSourceId);
  const user = publishSourceId ? (users[publishSourceId] ?? null) : null;

  // Latest values for callbacks that outlive a render (listeners, in-flight requests).
  const latest = useRef({ map, activeMapId, sync, navigating, maps, sources });
  useEffect(() => {
    latest.current = { map, activeMapId, sync, navigating, maps, sources };
  });
  /** Revision this device last pushed or pulled per local map; its listener echo is not a foreign change. */
  const ownRevisions = useRef(new Map<string, number>());
  const busyRef = useRef<Busy>(null);
  const setBusyBoth = useCallback((next: Busy) => {
    busyRef.current = next;
    setBusy(next);
  }, []);

  const fail = useCallback(
    (err: unknown) => {
      const cloudError = toCloudError(err);
      if (cloudError.code === 'network') setNetworkError(true);
      notify({ tone: 'error', text: cloudError.message });
    },
    [notify],
  );

  // Configuration from the launch link is saved on arrival, so later visits work without it.
  useEffect(() => {
    if (!urlConfig) return;
    setStored((current) => applyUrlConfig(current, urlConfig));
  }, [urlConfig, setStored]);

  useEffect(() => {
    const unsubscribe = Object.entries(adapters).map(([sourceId, source]) =>
      source.onAuthChange((next) => {
        setUsers((current) =>
          current[sourceId]?.uid === next?.uid ? current : { ...current, [sourceId]: next },
        );
      }),
    );
    return () => {
      for (const stop of unsubscribe) stop();
    };
  }, [adapters]);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      setNetworkError(false);
    };
    const goOffline = () => {
      setOnline(false);
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const openConflict = useCallback(
    async (sourceId: string, localMapId: string, cloudMapId: string) => {
      try {
        const head = await adapterOf(sourceId).getHead(cloudMapId);
        setConflict({
          sourceId,
          localMapId,
          cloudMapId,
          remoteRevision: head?.revision ?? null,
          remoteUpdatedAt: head?.updatedAt ?? null,
        });
      } catch (err) {
        fail(err);
      }
    },
    [adapterOf, fail],
  );

  /**
   * Downloads the cloud version into a local map. Unless `force`, it refuses to overwrite edits made on
   * this device, including ones made while the download was running.
   */
  const pullInto = useCallback(
    async (sourceId: string, localMapId: string, cloudMapId: string, force: boolean): Promise<boolean> => {
      if (busyRef.current) return false;
      setBusyBoth('pull');
      try {
        const startedOn = latest.current.activeMapId === localMapId ? latest.current.map : null;
        const local = startedOn ?? (await readMap(localMapId));
        const pulled = await adapterOf(sourceId).pull(cloudMapId, local);
        if (!pulled) {
          notify({ tone: 'error', text: 'This map no longer exists in the cloud.' });
          return false;
        }
        const now = latest.current;
        const editedMeanwhile =
          now.sync[localMapId]?.dirty === true ||
          (now.activeMapId === localMapId && now.map !== startedOn && startedOn !== null);
        if (!force && editedMeanwhile) {
          setBusyBoth(null);
          await openConflict(sourceId, localMapId, cloudMapId);
          return false;
        }
        ownRevisions.current.set(localMapId, pulled.head.revision);
        await replaceMap(localMapId, pulled.map);
        const hash = mapContentHash(pulled.map);
        setSync((state) => markSynced(state, localMapId, pulled.head.revision, Date.now(), false, hash));
        setPendingUpdateFor(null);
        setNetworkError(false);
        return true;
      } catch (err) {
        fail(err);
        return false;
      } finally {
        setBusyBoth(null);
      }
    },
    [adapterOf, fail, notify, openConflict, replaceMap, setBusyBoth, setSync],
  );

  /** Publishes the active map. `expected` is the cloud revision the push is based on (null: new map). */
  const pushActive = useCallback(
    async (sourceId: string, localMapId: string, cloudMapId: string, expected: number | null) => {
      const pushed = latest.current.map;
      if (busyRef.current || !pushed || latest.current.activeMapId !== localMapId) return;
      setBusyBoth('push');
      try {
        const revision = await adapterOf(sourceId).push(cloudMapId, pushed, expected);
        ownRevisions.current.set(localMapId, revision);
        const editedMeanwhile = latest.current.map !== pushed;
        const hash = mapContentHash(pushed);
        setSync((state) => markSynced(state, localMapId, revision, Date.now(), editedMeanwhile, hash));
        setNetworkError(false);
        notify({ tone: 'info', text: 'Published to the cloud.' });
      } catch (err) {
        const cloudError = toCloudError(err);
        if (cloudError.code === 'conflict') {
          setBusyBoth(null);
          await openConflict(sourceId, localMapId, cloudMapId);
        } else {
          fail(cloudError);
        }
      } finally {
        setBusyBoth(null);
      }
    },
    [adapterOf, fail, notify, openConflict, setBusyBoth, setSync],
  );

  const publish = useCallback(async () => {
    const { activeMapId: localId } = latest.current;
    if (!adapter.configured || !publishSourceId || !localId || busyRef.current) return;

    // Sign-in comes first and must be the first await, so the popup opens inside the click.
    if (!adapter.currentUser()) {
      try {
        await adapter.signIn();
      } catch (err) {
        fail(err);
        return;
      }
    }

    let current: MapSyncEntry | undefined = latest.current.sync[localId];
    if (!current) {
      setSync((state) => linkMap(state, localId, localId, publishSourceId));
      current = {
        sourceId: publishSourceId,
        cloudMapId: localId,
        baseRevision: 0,
        dirty: true,
        lastSyncedAt: null,
      };
    }
    try {
      const head = await adapter.getHead(current.cloudMapId);
      if (decidePush(current, head?.revision ?? null) === 'conflict') {
        await openConflict(publishSourceId, localId, current.cloudMapId);
        return;
      }
      await pushActive(publishSourceId, localId, current.cloudMapId, head?.revision ?? null);
    } catch (err) {
      fail(err);
    }
  }, [adapter, fail, openConflict, publishSourceId, pushActive, setSync]);

  /** Manual "pull latest" for the active map. */
  const pullLatest = useCallback(async () => {
    const { activeMapId: localId, sync: state, sources: known } = latest.current;
    const linked = localId ? state[localId] : undefined;
    const sourceId = linked ? entrySourceId(linked, known) : undefined;
    if (!localId || !linked || !sourceId) return;
    try {
      const head = await adapterOf(sourceId).getHead(linked.cloudMapId);
      if (!head) {
        notify({ tone: 'error', text: 'This map does not exist in the cloud yet.' });
        return;
      }
      const decision = decideRemoteUpdate(linked, head.revision, false);
      if (decision === 'ignore') {
        notify({ tone: 'info', text: 'Already up to date.' });
      } else if (decision === 'conflict') {
        await openConflict(sourceId, localId, linked.cloudMapId);
      } else if (await pullInto(sourceId, localId, linked.cloudMapId, false)) {
        notify({ tone: 'info', text: 'Map updated from the cloud.' });
      }
    } catch (err) {
      fail(err);
    }
  }, [adapterOf, fail, notify, openConflict, pullInto]);

  const resolveConflict = useCallback(
    async (choice: 'mine' | 'cloud') => {
      if (!conflict) return;
      const { sourceId, localMapId, cloudMapId } = conflict;
      setConflict(null);
      if (choice === 'cloud') {
        if (await pullInto(sourceId, localMapId, cloudMapId, true)) {
          notify({ tone: 'info', text: 'Replaced your local copy with the cloud version.' });
        }
        return;
      }
      const target = adapterOf(sourceId);
      if (!target.currentUser()) {
        try {
          await target.signIn();
        } catch (err) {
          fail(err);
          return;
        }
      }
      try {
        const head = await target.getHead(cloudMapId);
        await pushActive(sourceId, localMapId, cloudMapId, head?.revision ?? null);
      } catch (err) {
        fail(err);
      }
    },
    [adapterOf, conflict, fail, notify, pullInto, pushActive],
  );

  const applyPendingUpdate = useCallback(async () => {
    const { activeMapId: localId, sync: state, sources: known } = latest.current;
    const linked = localId ? state[localId] : undefined;
    const sourceId = linked ? entrySourceId(linked, known) : undefined;
    if (!localId || !linked || !sourceId) return;
    if (await pullInto(sourceId, localId, linked.cloudMapId, false)) {
      notify({ tone: 'info', text: 'Map updated from the cloud.' });
    }
  }, [notify, pullInto]);

  // Live updates: watch the open map's main document. Reading needs no sign-in.
  const activeCloudId = entry?.cloudMapId;
  const onRemoteHead = useRef<(sourceId: string, localId: string, cloudId: string, revision: number) => void>(
    () => undefined,
  );
  useEffect(() => {
    onRemoteHead.current = (sourceId, localId, cloudId, revision) => {
      const linked = latest.current.sync[localId];
      // An in-flight push or pull of ours also changes the document; the request itself settles state.
      if (!linked || busyRef.current) return;
      const own = ownRevisions.current.get(localId) ?? null;
      switch (decideRemoteUpdate(linked, revision, latest.current.navigating, own)) {
        case 'ignore':
          setPendingUpdateFor(null);
          break;
        case 'apply':
          void pullInto(sourceId, localId, cloudId, false).then((applied) => {
            if (applied) notify({ tone: 'info', text: 'Map updated from the cloud.' });
          });
          break;
        case 'defer':
          setPendingUpdateFor(localId);
          break;
        case 'conflict':
          void openConflict(sourceId, localId, cloudId);
          break;
      }
    };
  }, [notify, openConflict, pullInto]);

  const watchedSourceId = linkedSourceId;
  const watchedUid = watchedSourceId ? (users[watchedSourceId]?.uid ?? null) : null;
  useEffect(() => {
    if (!watchedSourceId || !activeMapId || !activeCloudId) return;
    const source = adapterOf(watchedSourceId);
    if (!source.configured) return;
    const localId = activeMapId;
    const cloudId = activeCloudId;
    return source.watch(
      cloudId,
      (head) => {
        setNetworkError(false);
        if (head) onRemoteHead.current(watchedSourceId, localId, cloudId, head.revision);
      },
      (err) => {
        if (err.code === 'network') setNetworkError(true);
        else notify({ tone: 'error', text: err.message });
      },
    );
    // `watchedUid`: a listener that rules rejected ends for good, so it is restarted after a sign-in or sign-out.
  }, [adapterOf, watchedSourceId, activeMapId, activeCloudId, notify, watchedUid]);

  // Maps enabled on a source are downloaded once, the first time they are needed. Only the map a launch
  // link names is opened; the others are added in the background.
  const handled = useRef(new Set<string>());
  const signedInKey = sources.map((s) => users[s.id]?.uid ?? '').join(',');
  useEffect(() => {
    if (!libraryReady) return;
    for (const source of sources) {
      const target = adapterOf(source.id);
      if (!target.configured) continue;
      const linkedIds = linkedLocalIds(latest.current.sync, source.id, sources);
      for (const cloudMapId of source.enabledMapIds) {
        const key = handledKey(source.id, cloudMapId);
        if (handled.current.has(key)) continue;
        handled.current.add(key);

        const opensNow =
          urlConfig?.mapId === cloudMapId &&
          (!urlConfig.firebase || sourceIdFor(urlConfig.firebase) === source.id);
        const linkedLocalId = linkedIds.get(cloudMapId);
        if (linkedLocalId) {
          if (opensNow && linkedLocalId !== latest.current.activeMapId) void switchMap(linkedLocalId);
          continue;
        }
        void (async () => {
          try {
            const pulled = await target.pull(cloudMapId, null);
            if (!pulled) {
              notify({
                tone: 'error',
                text: `The cloud map “${cloudMapId}” was not found in ${source.label}.`,
              });
              return;
            }
            const localId = await importMap(pulled.map, opensNow);
            const hash = mapContentHash(pulled.map);
            setSync((state) =>
              markSynced(
                linkMap(state, localId, cloudMapId, source.id),
                localId,
                pulled.head.revision,
                Date.now(),
                false,
                hash,
              ),
            );
            notify({ tone: 'info', text: `Opened “${pulled.map.metadata.name}” from the cloud.` });
          } catch (err) {
            // Rules that require sign-in for reading: try again once the user has signed in.
            const { code } = toCloudError(err);
            if (code === 'permission' || code === 'auth-required') handled.current.delete(key);
            fail(err);
          }
        })();
      }
    }
    // `signedInKey` only re-runs the effect after a sign-in or sign-out; the body does not read it.
  }, [adapterOf, fail, importMap, libraryReady, notify, setSync, signedInKey, sources, switchMap, urlConfig]);

  // Safety net for edits that were not flagged: a map that differs from what was last synced is unsaved.
  useEffect(() => {
    if (!map || !activeMapId || busy) return;
    const linked = sync[activeMapId];
    if (!linked || linked.dirty || linked.syncedHash === undefined) return;
    if (hasUnflaggedChanges(linked, mapContentHash(map))) {
      setSync((state) => markDirty(state, activeMapId));
    }
  }, [map, activeMapId, sync, busy, setSync]);

  // Forget sync entries of maps that were deleted locally.
  useEffect(() => {
    if (!libraryReady) return;
    const ids = new Set(maps.map((m) => m.id));
    setSync((state) => {
      const stale = Object.keys(state).filter((id) => !ids.has(id));
      return stale.length === 0
        ? state
        : Object.fromEntries(Object.entries(state).filter(([id]) => ids.has(id)));
    });
  }, [libraryReady, maps, setSync]);

  const configured = sources.length > 0;
  const status: SyncStatus | null = configured ? deriveStatus({ entry, online, networkError }) : null;

  /** Stops syncing maps of a source (or some of them); the local copies stay as plain local maps. */
  const unlinkCloudMaps = useCallback(
    (sourceId: string, cloudMapIds: readonly string[] | null) => {
      const linked = linkedLocalIds(latest.current.sync, sourceId, latest.current.sources);
      const ids = cloudMapIds ?? [...linked.keys()];
      for (const cloudMapId of ids) handled.current.delete(handledKey(sourceId, cloudMapId));
      setSync((state) =>
        ids.reduce((next, cloudMapId) => {
          const localId = linked.get(cloudMapId);
          return localId ? unlinkMap(next, localId) : next;
        }, state),
      );
    },
    [setSync],
  );

  return {
    configured,
    sources,
    /** Source the open map syncs with, or would be published to. */
    publishSourceId,
    /** The open map is not linked yet and there is more than one place to publish it to. */
    needsPublishChoice: !entry && sources.length > 1,
    setPublishSource: setPublishChoice,
    entry,
    user,
    users,
    status,
    busy,
    conflict,
    dismissConflict: useCallback(() => {
      setConflict(null);
    }, []),
    resolveConflict,
    pendingUpdate: pendingUpdateFor !== null && pendingUpdateFor === activeMapId,
    applyPendingUpdate,
    publish,
    pullLatest,
    /** Adds a source, or updates the credentials of the one for the same project. Returns its id. */
    saveSource: useCallback(
      (firebase: FirebaseConfig, label?: string) => {
        setStored((current) => upsertSource(current, firebase, label));
        return sourceIdFor(firebase);
      },
      [setStored],
    ),
    removeSource: useCallback(
      (sourceId: string) => {
        unlinkCloudMaps(sourceId, null);
        setStored((current) => removeSourceFromConfig(current, sourceId));
      },
      [setStored, unlinkCloudMaps],
    ),
    /** Lists the maps of a source, or null when that failed (the reason is shown as a notice). */
    listMaps: useCallback(
      async (sourceId: string): Promise<MapMeta[] | null> => {
        try {
          return await adapterOf(sourceId).listMaps();
        } catch (err) {
          fail(err);
          return null;
        }
      },
      [adapterOf, fail],
    ),
    /** Uses exactly these maps of a source: new ones are downloaded, dropped ones are unlinked. */
    selectMaps: useCallback(
      (sourceId: string, cloudMapIds: readonly string[]) => {
        const source = latest.current.sources.find((s) => s.id === sourceId);
        if (!source) return;
        unlinkCloudMaps(
          sourceId,
          source.enabledMapIds.filter((id) => !cloudMapIds.includes(id)),
        );
        setStored((current) => setEnabledMaps(current, sourceId, cloudMapIds));
      },
      [setStored, unlinkCloudMaps],
    ),
    signIn: useCallback(
      async (sourceId: string) => {
        try {
          await adapterOf(sourceId).signIn();
        } catch (err) {
          fail(err);
        }
      },
      [adapterOf, fail],
    ),
    signOut: useCallback(
      async (sourceId: string) => {
        try {
          await adapterOf(sourceId).signOut();
        } catch (err) {
          fail(err);
        }
      },
      [adapterOf, fail],
    ),
    /** The launch link carried cloud settings that are still in the address bar. */
    configFromUrl,
    acknowledgeUrlConfig: useCallback(() => {
      setConfigFromUrl(false);
    }, []),
  };
}
