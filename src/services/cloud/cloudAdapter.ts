import type { MapData } from '../../types/map';
import {
  CloudMapTooLargeError,
  chunksToFetch,
  cloudToMap,
  mapToCloud,
  parseMapHead,
  planPush,
  type MapHead,
} from './mapDocs';
import { CloudError, type AuthFacade, type CloudAdapter, type DocStore, type PulledMap } from './types';

/** Chunk downloads in flight at once; keeps a large map from opening dozens of requests. */
const FETCH_CONCURRENCY = 6;
/** A pull can race a push that deletes the chunks the pull's head referred to; re-reading the head fixes it. */
const PULL_ATTEMPTS = 3;

class StaleHeadError extends Error {}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function readHead(raw: unknown): MapHead | null {
  if (raw === null || raw === undefined) return null;
  const parsed = parseMapHead(raw);
  if (!parsed.ok) throw new CloudError('invalid', parsed.error);
  return parsed.head;
}

function readChunkData(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = (raw as { data?: unknown }).data;
  return typeof data === 'string' ? data : null;
}

/** Sync logic on top of raw document storage and sign-in; contains no Firebase-specific code. */
export function createCloudAdapter(
  store: DocStore,
  auth: AuthFacade,
  now: () => number = Date.now,
): CloudAdapter {
  const getHead = async (mapId: string): Promise<MapHead | null> => readHead(await store.get(mapId));

  const pullOnce = async (mapId: string, local: MapData | null): Promise<PulledMap | null> => {
    const head = await getHead(mapId);
    if (!head) return null;
    const ids = chunksToFetch(mapId, head, local);
    const docs = await mapLimit(
      ids,
      FETCH_CONCURRENCY,
      async (id) => [id, readChunkData(await store.get(id))] as const,
    );
    const texts = new Map<string, string>();
    for (const [id, data] of docs) {
      if (data === null) throw new StaleHeadError();
      texts.set(id, data);
    }
    const parsed = cloudToMap(mapId, head, texts, local);
    if (!parsed.ok) throw new CloudError('invalid', parsed.error);
    return { head, map: parsed.data };
  };

  return {
    configured: true,
    getHead,

    async pull(mapId, local) {
      for (let attempt = 1; ; attempt++) {
        try {
          return await pullOnce(mapId, local);
        } catch (err) {
          if (!(err instanceof StaleHeadError)) throw err;
          if (attempt >= PULL_ATTEMPTS)
            throw new CloudError('unknown', 'The cloud map kept changing while downloading');
        }
      }
    },

    async push(mapId, map, expectedRevision) {
      const user = auth.current();
      if (!user) throw new CloudError('auth-required', 'Sign in with Google to publish changes');

      const remote = await getHead(mapId);
      if ((remote?.revision ?? null) !== expectedRevision) {
        throw new CloudError('conflict', 'The map was changed in the cloud in the meantime');
      }

      const revision = (expectedRevision ?? 0) + 1;
      let next;
      try {
        next = mapToCloud(map, { mapId, revision, updatedAt: now(), updatedBy: user.uid });
      } catch (err) {
        if (err instanceof CloudMapTooLargeError) throw new CloudError('invalid', err.message);
        throw err;
      }

      const { write, deleteIds } = planPush(mapId, next, remote);
      await store.writeDocs(write.map((entry) => ({ id: entry.id, data: entry.doc })));
      await store.commitHead(mapId, next.head, expectedRevision);
      // Superseded chunks are garbage only now that the new head is published. Failing to delete them
      // wastes space but never breaks a reader, so it does not fail the push.
      if (deleteIds.length > 0) await store.deleteDocs(deleteIds).catch(() => undefined);
      return revision;
    },

    watch(mapId, onHead, onError) {
      return store.watch(
        mapId,
        (raw) => {
          try {
            onHead(readHead(raw));
          } catch (err) {
            onError(
              err instanceof CloudError ? err : new CloudError('unknown', 'The cloud map could not be read'),
            );
          }
        },
        onError,
      );
    },

    signIn: () => auth.signIn(),
    signOut: () => auth.signOut(),
    onAuthChange: (callback) => auth.onChange(callback),
    currentUser: () => auth.current(),
  };
}
