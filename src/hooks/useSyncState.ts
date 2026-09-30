import { useCallback, useEffect, useRef } from 'react';
import {
  markDirty,
  parseSyncState,
  SYNC_STATE_STORAGE_KEY,
  type SyncState,
} from '../services/cloud/syncState';
import { useLocalStorage } from './useLocalStorage';

/**
 * Per-map cloud sync bookkeeping in localStorage. It is separate from `useCloudSync` because the map
 * library needs `markEdited` while `useCloudSync` needs the library, and one of them has to come first.
 */
export function useSyncState() {
  const [sync, setSync] = useLocalStorage<SyncState>(SYNC_STATE_STORAGE_KEY, {}, parseSyncState);

  const syncRef = useRef(sync);
  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);

  /** Marks a linked map as having local edits. Edits fire in bursts, so skip when nothing would change. */
  const markEdited = useCallback(
    (mapId: string) => {
      const entry = syncRef.current[mapId];
      if (!entry || entry.dirty) return;
      setSync((state) => markDirty(state, mapId));
    },
    [setSync],
  );

  return { sync, setSync, markEdited };
}
