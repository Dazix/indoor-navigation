import type { MapData } from '../../types/map';
import type { MapHead, MapMeta } from './mapDocs';

export interface CloudUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export type CloudErrorCode =
  /** Network or Firestore unreachable. Local work is unaffected. */
  | 'network'
  /** Security rules denied the request. */
  | 'permission'
  /** The action needs a signed-in user. */
  | 'auth-required'
  /** The cloud revision moved on since this device last synced. */
  | 'conflict'
  /** The map exceeds what can be stored, or the cloud data is malformed. */
  | 'invalid'
  | 'unknown';

export class CloudError extends Error {
  readonly code: CloudErrorCode;

  constructor(code: CloudErrorCode, message: string) {
    super(message);
    this.name = 'CloudError';
    this.code = code;
  }
}

/** Raw document I/O. The Firebase SDK sits behind this, so the sync logic can run against a fake. */
export interface DocStore {
  /** Returns the stored document, or null when it does not exist. */
  get: (id: string) => Promise<unknown>;
  /** Writes documents; ids are content-addressed, so concurrent writers never clobber each other. */
  writeDocs: (docs: readonly { id: string; data: unknown }[]) => Promise<void>;
  /**
   * Publishes the main document atomically: only when the stored revision equals `expectedRevision`
   * (null: the document must not exist yet). Rejects with a `conflict` CloudError otherwise.
   */
  commitHead: (
    id: string,
    head: MapHead,
    expectedRevision: number | null,
    /** Catalog document, stored in the same transaction under its own id. */
    meta: { id: string; data: MapMeta },
  ) => Promise<void>;
  /** All catalog documents of the collection. */
  listMeta: () => Promise<unknown[]>;
  deleteDocs: (ids: readonly string[]) => Promise<void>;
  /** Live updates of one document; the callback receives null when it does not exist. */
  watch: (id: string, onData: (data: unknown) => void, onError: (err: CloudError) => void) => () => void;
}

export interface AuthFacade {
  signIn: () => Promise<CloudUser>;
  signOut: () => Promise<void>;
  /** Calls back with the current user right away and on every change. Returns an unsubscribe function. */
  onChange: (callback: (user: CloudUser | null) => void) => () => void;
  current: () => CloudUser | null;
}

export interface PulledMap {
  head: MapHead;
  map: MapData;
}

export interface CloudAdapter {
  /** False for the local-only fallback. */
  readonly configured: boolean;
  /** Maps of this cloud project, by name. Maps published before the catalog existed appear after their next publish. */
  listMaps(): Promise<MapMeta[]>;
  /** Main document of a cloud map, or null when it does not exist. */
  getHead(mapId: string): Promise<MapHead | null>;
  /** Downloads a cloud map, reusing matching parts of `local`. Null when the map does not exist. */
  pull(mapId: string, local: MapData | null): Promise<PulledMap | null>;
  /**
   * Publishes `map` as revision `expectedRevision + 1` (first push: 1). Requires sign-in.
   * Rejects with a `conflict` CloudError when the cloud moved on. Resolves to the new revision.
   */
  push(mapId: string, map: MapData, expectedRevision: number | null): Promise<number>;
  /** Live updates of the main document; `null` means the map does not exist (yet). */
  watch(
    mapId: string,
    onHead: (head: MapHead | null) => void,
    onError: (err: CloudError) => void,
  ): () => void;
  signIn(): Promise<CloudUser>;
  signOut(): Promise<void>;
  onAuthChange(callback: (user: CloudUser | null) => void): () => void;
  currentUser(): CloudUser | null;
}
