import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { createFirebaseAdapter } from '../services/cloud/firebaseAdapter';
import { toCloudError } from '../services/cloud/errors';
import { nullAdapter } from '../services/cloud/nullAdapter';
import {
  decidePush,
  decideRemoteUpdate,
  deriveStatus,
  linkMap,
  markSynced,
  type MapSyncEntry,
  type SyncState,
  type SyncStatus,
} from '../services/cloud/syncState';
import type { CloudAdapter, CloudUser } from '../services/cloud/types';
import {
  activeCloudConfig,
  CLOUD_CONFIG_STORAGE_KEY,
  mergeStoredCloudConfig,
  parseStoredCloudConfig,
  type CloudConfig,
  type FirebaseConfig,
  type StoredCloudConfig,
} from '../services/cloudConfig';
import { readMap } from '../services/mapLibrary';
import type { MapData, MapSummary } from '../types/map';
import { useLocalStorage } from './useLocalStorage';

export interface SyncNotice {
  tone: 'error' | 'info';
  text: string;
}

export interface SyncConflict {
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
  importMap: (map: MapData) => Promise<string>;
  replaceMap: (id: string, map: MapData) => Promise<void>;
  switchMap: (id: string) => Promise<void>;
  /** A route is active; cloud updates then wait for the user instead of swapping the map mid-route. */
  navigating: boolean;
  notify: (notice: SyncNotice) => void;
  /** Configuration carried by the launch URL; saved once, then offered for removal from the address bar. */
  urlConfig: StoredCloudConfig | null;
}

type Busy = 'push' | 'pull' | null;

export type CloudSync = ReturnType<typeof useCloudSync>;

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
    {},
    parseStoredCloudConfig,
  );
  const config: CloudConfig | null = useMemo(() => activeCloudConfig(stored), [stored]);

  // A new adapter only when the credentials change, not when just the map id does.
  const firebaseKey = config ? JSON.stringify(config.firebase) : null;
  const adapter: CloudAdapter = useMemo(
    () => (firebaseKey ? createFirebaseAdapter(JSON.parse(firebaseKey) as FirebaseConfig) : nullAdapter),
    [firebaseKey],
  );

  const [user, setUser] = useState<CloudUser | null>(null);
  const uid = user?.uid ?? null;
  const [online, setOnline] = useState(() => navigator.onLine);
  const [networkError, setNetworkError] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [conflict, setConflict] = useState<SyncConflict | null>(null);
  /** Local map with a cloud update that waits for the user (set during navigation). */
  const [pendingUpdateFor, setPendingUpdateFor] = useState<string | null>(null);
  const [configFromUrl, setConfigFromUrl] = useState(urlConfig !== null);

  // Latest values for callbacks that outlive a render (listeners, in-flight requests).
  const latest = useRef({ map, activeMapId, sync, navigating, maps });
  useEffect(() => {
    latest.current = { map, activeMapId, sync, navigating, maps };
  });
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
    setStored((current) => mergeStoredCloudConfig(current, urlConfig));
  }, [urlConfig, setStored]);

  useEffect(() => adapter.onAuthChange(setUser), [adapter]);

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
    async (localMapId: string, cloudMapId: string) => {
      try {
        const head = await adapter.getHead(cloudMapId);
        setConflict({
          localMapId,
          cloudMapId,
          remoteRevision: head?.revision ?? null,
          remoteUpdatedAt: head?.updatedAt ?? null,
        });
      } catch (err) {
        fail(err);
      }
    },
    [adapter, fail],
  );

  /**
   * Downloads the cloud version into a local map. Unless `force`, it refuses to overwrite edits made on
   * this device, including ones made while the download was running.
   */
  const pullInto = useCallback(
    async (localMapId: string, cloudMapId: string, force: boolean): Promise<boolean> => {
      if (busyRef.current) return false;
      setBusyBoth('pull');
      try {
        const startedOn = latest.current.activeMapId === localMapId ? latest.current.map : null;
        const local = startedOn ?? (await readMap(localMapId));
        const pulled = await adapter.pull(cloudMapId, local);
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
          await openConflict(localMapId, cloudMapId);
          return false;
        }
        await replaceMap(localMapId, pulled.map);
        setSync((state) => markSynced(state, localMapId, pulled.head.revision, Date.now()));
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
    [adapter, fail, notify, openConflict, replaceMap, setBusyBoth, setSync],
  );

  /** Publishes the active map. `expected` is the cloud revision the push is based on (null: new map). */
  const pushActive = useCallback(
    async (localMapId: string, cloudMapId: string, expected: number | null) => {
      const pushed = latest.current.map;
      if (busyRef.current || !pushed || latest.current.activeMapId !== localMapId) return;
      setBusyBoth('push');
      try {
        const revision = await adapter.push(cloudMapId, pushed, expected);
        const editedMeanwhile = latest.current.map !== pushed;
        setSync((state) => markSynced(state, localMapId, revision, Date.now(), editedMeanwhile));
        setNetworkError(false);
        notify({ tone: 'info', text: 'Published to the cloud.' });
      } catch (err) {
        const cloudError = toCloudError(err);
        if (cloudError.code === 'conflict') {
          setBusyBoth(null);
          await openConflict(localMapId, cloudMapId);
        } else {
          fail(cloudError);
        }
      } finally {
        setBusyBoth(null);
      }
    },
    [adapter, fail, notify, openConflict, setBusyBoth, setSync],
  );

  const publish = useCallback(async () => {
    const { activeMapId: localId } = latest.current;
    if (!adapter.configured || !localId || busyRef.current) return;

    // Sign-in comes first and must be the first await, so the popup opens inside the click.
    if (!adapter.currentUser()) {
      try {
        await adapter.signIn();
      } catch (err) {
        fail(err);
        return;
      }
    }

    let entry: MapSyncEntry | undefined = latest.current.sync[localId];
    if (!entry) {
      const cloudMapId = config?.mapId ?? localId;
      setSync((state) => linkMap(state, localId, cloudMapId));
      entry = { cloudMapId, baseRevision: 0, dirty: true, lastSyncedAt: null };
    }
    try {
      const head = await adapter.getHead(entry.cloudMapId);
      if (decidePush(entry, head?.revision ?? null) === 'conflict') {
        await openConflict(localId, entry.cloudMapId);
        return;
      }
      await pushActive(localId, entry.cloudMapId, head?.revision ?? null);
    } catch (err) {
      fail(err);
    }
  }, [adapter, config?.mapId, fail, openConflict, pushActive, setSync]);

  /** Manual "pull latest" for the active map. */
  const pullLatest = useCallback(async () => {
    const { activeMapId: localId, sync: state } = latest.current;
    const entry = localId ? state[localId] : undefined;
    if (!localId || !entry) return;
    try {
      const head = await adapter.getHead(entry.cloudMapId);
      if (!head) {
        notify({ tone: 'error', text: 'This map does not exist in the cloud yet.' });
        return;
      }
      const decision = decideRemoteUpdate(entry, head.revision, false);
      if (decision === 'ignore') {
        notify({ tone: 'info', text: 'Already up to date.' });
      } else if (decision === 'conflict') {
        await openConflict(localId, entry.cloudMapId);
      } else if (await pullInto(localId, entry.cloudMapId, false)) {
        notify({ tone: 'info', text: 'Map updated from the cloud.' });
      }
    } catch (err) {
      fail(err);
    }
  }, [adapter, fail, notify, openConflict, pullInto]);

  const resolveConflict = useCallback(
    async (choice: 'mine' | 'cloud') => {
      if (!conflict) return;
      const { localMapId, cloudMapId } = conflict;
      setConflict(null);
      if (choice === 'cloud') {
        if (await pullInto(localMapId, cloudMapId, true)) {
          notify({ tone: 'info', text: 'Replaced your local copy with the cloud version.' });
        }
        return;
      }
      if (!adapter.currentUser()) {
        try {
          await adapter.signIn();
        } catch (err) {
          fail(err);
          return;
        }
      }
      try {
        const head = await adapter.getHead(cloudMapId);
        await pushActive(localMapId, cloudMapId, head?.revision ?? null);
      } catch (err) {
        fail(err);
      }
    },
    [adapter, conflict, fail, notify, pullInto, pushActive],
  );

  const applyPendingUpdate = useCallback(async () => {
    const { activeMapId: localId, sync: state } = latest.current;
    const entry = localId ? state[localId] : undefined;
    if (!localId || !entry) return;
    if (await pullInto(localId, entry.cloudMapId, false)) {
      notify({ tone: 'info', text: 'Map updated from the cloud.' });
    }
  }, [notify, pullInto]);

  // Live updates: watch the open map's main document. Reading needs no sign-in.
  const activeCloudId = activeMapId ? sync[activeMapId]?.cloudMapId : undefined;
  const onRemoteHead = useRef<(localId: string, cloudId: string, revision: number) => void>(() => undefined);
  useEffect(() => {
    onRemoteHead.current = (localId, cloudId, revision) => {
      const entry = latest.current.sync[localId];
      // An in-flight push or pull of ours also changes the document; the request itself settles state.
      if (!entry || busyRef.current) return;
      switch (decideRemoteUpdate(entry, revision, latest.current.navigating)) {
        case 'ignore':
          setPendingUpdateFor(null);
          break;
        case 'apply':
          void pullInto(localId, cloudId, false).then((applied) => {
            if (applied) notify({ tone: 'info', text: 'Map updated from the cloud.' });
          });
          break;
        case 'defer':
          setPendingUpdateFor(localId);
          break;
        case 'conflict':
          void openConflict(localId, cloudId);
          break;
      }
    };
  }, [notify, openConflict, pullInto]);

  useEffect(() => {
    if (!adapter.configured || !activeMapId || !activeCloudId) return;
    const localId = activeMapId;
    const cloudId = activeCloudId;
    return adapter.watch(
      cloudId,
      (head) => {
        setNetworkError(false);
        if (head) onRemoteHead.current(localId, cloudId, head.revision);
      },
      (err) => {
        if (err.code === 'network') setNetworkError(true);
        else notify({ tone: 'error', text: err.message });
      },
    );
    // `uid`: a listener that rules rejected ends for good, so it is restarted after a sign-in or sign-out.
  }, [adapter, activeMapId, activeCloudId, notify, uid]);

  // A link (or saved setting) that names a cloud map opens it, downloading it on first use.
  const handledCloudMap = useRef<string | null>(null);
  const targetCloudMapId = config?.mapId;
  useEffect(() => {
    if (!adapter.configured || !targetCloudMapId || !libraryReady) return;
    if (handledCloudMap.current === targetCloudMapId) return;
    handledCloudMap.current = targetCloudMapId;

    const linked = Object.entries(latest.current.sync).find(
      ([, entry]) => entry.cloudMapId === targetCloudMapId,
    );
    if (linked) {
      if (linked[0] !== latest.current.activeMapId) void switchMap(linked[0]);
      return;
    }
    void (async () => {
      try {
        const pulled = await adapter.pull(targetCloudMapId, null);
        if (!pulled) {
          notify({ tone: 'error', text: `The cloud map “${targetCloudMapId}” was not found.` });
          return;
        }
        const localId = await importMap(pulled.map);
        setSync((state) =>
          markSynced(linkMap(state, localId, targetCloudMapId), localId, pulled.head.revision, Date.now()),
        );
        notify({ tone: 'info', text: `Opened “${pulled.map.metadata.name}” from the cloud.` });
      } catch (err) {
        // Rules that require sign-in for reading: try again once the user has signed in.
        const { code } = toCloudError(err);
        if (code === 'permission' || code === 'auth-required') handledCloudMap.current = null;
        fail(err);
      }
    })();
    // `uid` only re-runs the effect after a sign-in or sign-out; the body does not read it.
  }, [adapter, fail, importMap, libraryReady, notify, setSync, switchMap, targetCloudMapId, uid]);

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

  const entry = activeMapId ? sync[activeMapId] : undefined;
  const status: SyncStatus | null = adapter.configured ? deriveStatus({ entry, online, networkError }) : null;

  return {
    configured: adapter.configured,
    config,
    storedConfig: stored,
    saveConfig: setStored,
    clearConfig: useCallback(() => {
      setStored({});
    }, [setStored]),
    user,
    status,
    entry,
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
    signIn: useCallback(async () => {
      try {
        await adapter.signIn();
      } catch (err) {
        fail(err);
      }
    }, [adapter, fail]),
    signOut: useCallback(async () => {
      try {
        await adapter.signOut();
      } catch (err) {
        fail(err);
      }
    }, [adapter, fail]),
    /** The launch link carried cloud settings that are still in the address bar. */
    configFromUrl,
    acknowledgeUrlConfig: useCallback(() => {
      setConfigFromUrl(false);
    }, []),
  };
}
