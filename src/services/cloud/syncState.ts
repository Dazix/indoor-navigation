import { z } from 'zod';

/** localStorage key for the per-map cloud sync bookkeeping. Kept apart from the map data and its schemas. */
export const SYNC_STATE_STORAGE_KEY = 'indoor_nav_sync_v1';

const MapSyncEntrySchema = z.object({
  /** Document id of the map in Firestore. */
  cloudMapId: z.string().min(1),
  /** Cloud revision this device last pulled or pushed; 0 when the map was never in the cloud. */
  baseRevision: z.number().int().min(0),
  /** True while the local copy has edits that are not in the cloud. */
  dirty: z.boolean(),
  lastSyncedAt: z.number().nullable(),
});

export type MapSyncEntry = z.infer<typeof MapSyncEntrySchema>;

/** Sync entries by local map id. A map without an entry is not linked to the cloud. */
const SyncStateSchema = z.record(z.string(), MapSyncEntrySchema);

export type SyncState = z.infer<typeof SyncStateSchema>;

export type SyncStatus = 'synced' | 'unsaved' | 'offline';

export function parseSyncState(raw: unknown): SyncState | null {
  const result = SyncStateSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** Links a local map to a cloud map id. Until the first push it counts as unsaved. */
export function linkMap(state: SyncState, localMapId: string, cloudMapId: string): SyncState {
  return { ...state, [localMapId]: { cloudMapId, baseRevision: 0, dirty: true, lastSyncedAt: null } };
}

export function unlinkMap(state: SyncState, localMapId: string): SyncState {
  return Object.fromEntries(Object.entries(state).filter(([id]) => id !== localMapId));
}

/** Records a local edit. Maps that are not linked stay untouched. */
export function markDirty(state: SyncState, localMapId: string): SyncState {
  const entry = state[localMapId];
  if (!entry || entry.dirty) return state;
  return { ...state, [localMapId]: { ...entry, dirty: true } };
}

/**
 * Records that the cloud is at `revision` and this device has taken part in it (after a push, or after
 * applying a pull). `stillDirty` keeps the dirty flag for edits made while the request was in flight.
 */
export function markSynced(
  state: SyncState,
  localMapId: string,
  revision: number,
  now: number,
  stillDirty = false,
): SyncState {
  const entry = state[localMapId];
  if (!entry) return state;
  return {
    ...state,
    [localMapId]: { ...entry, baseRevision: revision, dirty: stillDirty, lastSyncedAt: now },
  };
}

export function nextRevision(remoteRevision: number | null): number {
  return (remoteRevision ?? 0) + 1;
}

export interface StatusInput {
  /** Sync entry of the active map, if it is linked to the cloud. */
  entry: MapSyncEntry | undefined;
  online: boolean;
  /** The last cloud request failed because the network or Firestore could not be reached. */
  networkError: boolean;
}

export function deriveStatus({ entry, online, networkError }: StatusInput): SyncStatus {
  if (!online || networkError) return 'offline';
  return entry && !entry.dirty ? 'synced' : 'unsaved';
}

export type PushDecision = 'push' | 'conflict';

/**
 * Whether a push may go ahead. The cloud must still be at the revision this device based its edits on;
 * a map that vanished from the cloud is recreated, since the user explicitly asked to publish.
 */
export function decidePush(entry: MapSyncEntry, remoteRevision: number | null): PushDecision {
  if (remoteRevision === null) return 'push';
  return remoteRevision === entry.baseRevision ? 'push' : 'conflict';
}

export type RemoteUpdateDecision = 'ignore' | 'apply' | 'defer' | 'conflict';

/**
 * What to do when the cloud map changes while it is open: apply silently when nothing local is at stake,
 * hold the update during active navigation, and never overwrite unsynced local edits.
 */
export function decideRemoteUpdate(
  entry: MapSyncEntry,
  remoteRevision: number,
  navigating: boolean,
): RemoteUpdateDecision {
  if (remoteRevision <= entry.baseRevision) return 'ignore';
  if (entry.dirty) return 'conflict';
  return navigating ? 'defer' : 'apply';
}
