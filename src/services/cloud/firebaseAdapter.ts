import type { FirebaseConfig } from '../cloudConfig';
import { createCloudAdapter } from './cloudAdapter';
import { toCloudError, withTimeout } from './errors';
import { CLOUD_COLLECTION } from './mapDocs';
import { CloudError, type AuthFacade, type CloudAdapter, type CloudUser, type DocStore } from './types';

const REQUEST_TIMEOUT_MS = 30_000;
/** Firestore allows 500 writes and 10 MiB per batch; stay well below both. */
const BATCH_MAX_DOCS = 400;
const BATCH_MAX_CHARS = 6_000_000;

/** Splits items into batches limited by count and by approximate payload size. */
export function splitBatches<T>(
  items: readonly T[],
  sizeOf: (item: T) => number,
  maxItems = BATCH_MAX_DOCS,
  maxSize = BATCH_MAX_CHARS,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const item of items) {
    const itemSize = sizeOf(item);
    if (current.length > 0 && (current.length >= maxItems || size + itemSize > maxSize)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += itemSize;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

let appCounter = 0;

/** The Firebase SDK is a separate chunk that is only downloaded once cloud sync is configured. */
async function loadSdk(config: FirebaseConfig) {
  const [{ initializeApp }, firestore, auth] = await Promise.all([
    import('firebase/app'),
    import('firebase/firestore'),
    import('firebase/auth'),
  ]);
  const app = initializeApp(config, `cloud-${appCounter++}`);
  // Auto-detection falls back to long polling behind proxies that break WebChannel streaming.
  const db = firestore.initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  return { firestore, auth, db, authInstance: auth.getAuth(app) };
}

type Sdk = Awaited<ReturnType<typeof loadSdk>>;

function toUser(
  user: { uid: string; email: string | null; displayName: string | null } | null,
): CloudUser | null {
  return user ? { uid: user.uid, email: user.email, displayName: user.displayName } : null;
}

/** Cloud adapter backed by Firestore (documents) and Firebase Auth (Google sign-in). */
export function createFirebaseAdapter(config: FirebaseConfig): CloudAdapter {
  let sdkPromise: Promise<Sdk> | null = null;
  let ready: Sdk | null = null;
  let currentUser: CloudUser | null = null;
  const authCallbacks = new Set<(user: CloudUser | null) => void>();

  /** Loads the SDK on first use, so creating an adapter costs nothing until it is needed. */
  const load = (): Promise<Sdk> => {
    sdkPromise ??= loadSdk(config).then((loaded) => {
      ready = loaded;
      loaded.auth.onAuthStateChanged(loaded.authInstance, (user) => {
        currentUser = toUser(user);
        for (const callback of authCallbacks) callback(currentUser);
      });
      return loaded;
    });
    return sdkPromise;
  };

  const sdk = (): Promise<Sdk> =>
    load().catch(() => {
      sdkPromise = null; // allow a retry, e.g. after the connection is back
      throw new CloudError('network', 'Cloud sync could not be loaded. Check your connection and reload.');
    });

  const docRef = (s: Sdk, id: string) => s.firestore.doc(s.db, CLOUD_COLLECTION, id);

  const store: DocStore = {
    get: async (id) => {
      const s = await sdk();
      const snap = await withTimeout(s.firestore.getDoc(docRef(s, id)), REQUEST_TIMEOUT_MS);
      return snap.exists() ? snap.data() : null;
    },

    writeDocs: async (docs) => {
      const s = await sdk();
      const sizeOf = ({ data }: { data: unknown }) => {
        const payload = (data as { data?: unknown }).data;
        return typeof payload === 'string' ? payload.length : 1_000;
      };
      for (const group of splitBatches(docs, sizeOf)) {
        const batch = s.firestore.writeBatch(s.db);
        for (const { id, data } of group) batch.set(docRef(s, id), data as Record<string, unknown>);
        await withTimeout(batch.commit(), REQUEST_TIMEOUT_MS);
      }
    },

    listMeta: async () => {
      const s = await sdk();
      const snap = await withTimeout(
        s.firestore.getDocs(
          s.firestore.query(
            s.firestore.collection(s.db, CLOUD_COLLECTION),
            s.firestore.where('kind', '==', 'meta'),
          ),
        ),
        REQUEST_TIMEOUT_MS,
      );
      return snap.docs.map((d) => d.data());
    },

    commitHead: async (id, head, expectedRevision, meta) => {
      const s = await sdk();
      await withTimeout(
        s.firestore.runTransaction(s.db, async (tx) => {
          const snap = await tx.get(docRef(s, id));
          const stored = snap.exists() ? (snap.data() as { revision?: unknown }).revision : null;
          if ((typeof stored === 'number' ? stored : null) !== expectedRevision) {
            throw new CloudError('conflict', 'The map was changed in the cloud in the meantime');
          }
          tx.set(docRef(s, id), head as unknown as Record<string, unknown>);
          tx.set(docRef(s, meta.id), meta.data as unknown as Record<string, unknown>);
        }),
        REQUEST_TIMEOUT_MS,
      );
    },

    deleteDocs: async (ids) => {
      const s = await sdk();
      for (const group of splitBatches(ids, () => 1)) {
        const batch = s.firestore.writeBatch(s.db);
        for (const id of group) batch.delete(docRef(s, id));
        await withTimeout(batch.commit(), REQUEST_TIMEOUT_MS);
      }
    },

    watch: (id, onData, onError) => {
      let cancelled = false;
      let unsubscribe: () => void = () => undefined;
      sdk().then(
        (s) => {
          if (cancelled) return;
          unsubscribe = s.firestore.onSnapshot(
            docRef(s, id),
            (snap) => {
              onData(snap.exists() ? snap.data() : null);
            },
            (err) => {
              onError(toCloudError(err));
            },
          );
        },
        (err: unknown) => {
          onError(toCloudError(err));
        },
      );
      return () => {
        cancelled = true;
        unsubscribe();
      };
    },
  };

  const auth: AuthFacade = {
    signIn: async () => {
      try {
        // Already-loaded SDK: call straight through, so the popup opens inside the click's user gesture.
        const s = ready ?? (await load());
        const provider = new s.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        const result = await s.auth.signInWithPopup(s.authInstance, provider);
        const user = toUser(result.user);
        if (!user) throw new CloudError('auth-required', 'Sign-in did not return a user');
        // Set here as well: the auth listener may fire after this promise resolves, and a push right
        // after signing in must already see the user.
        currentUser = user;
        return user;
      } catch (err) {
        throw toCloudError(err);
      }
    },
    signOut: async () => {
      const s = await sdk();
      await s.auth.signOut(s.authInstance);
    },
    onChange: (callback) => {
      authCallbacks.add(callback);
      callback(currentUser);
      // Start loading, so a session from an earlier visit is restored without waiting for a click.
      load().catch(() => undefined);
      return () => authCallbacks.delete(callback);
    },
    current: () => currentUser,
  };

  return createCloudAdapter(store, auth);
}
