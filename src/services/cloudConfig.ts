import { z } from 'zod';

/** localStorage key for the cloud configuration entered in the UI or received through a link. */
export const CLOUD_CONFIG_STORAGE_KEY = 'indoor_nav_cloud_config_v1';
/** Query parameter carrying a base64url-encoded Firebase web config. */
export const CFG_URL_PARAM = 'cfg';
/** Query parameter carrying only the cloud map id. */
export const CLOUD_MAP_URL_PARAM = 'cloudMap';

/** Ids end up in Firestore document paths, where `/` is a separator and `~` splits chunk ids. */
const CLOUD_MAP_ID = /^[A-Za-z0-9_-]{1,100}$/;

export function isValidCloudMapId(value: string): boolean {
  return CLOUD_MAP_ID.test(value);
}

const requiredString = z.string().trim().min(1);

export const FirebaseConfigSchema = z.object({
  apiKey: requiredString,
  authDomain: requiredString,
  projectId: requiredString,
  appId: requiredString,
  storageBucket: requiredString.optional(),
  messagingSenderId: requiredString.optional(),
});

export type FirebaseConfig = z.infer<typeof FirebaseConfigSchema>;

const CloudMapIdSchema = z.string().trim().regex(CLOUD_MAP_ID);

/** What is persisted or received. A link may carry only the map id, for a device that is already set up. */
export const StoredCloudConfigSchema = z.object({
  firebase: FirebaseConfigSchema.optional(),
  mapId: CloudMapIdSchema.optional(),
});

export type StoredCloudConfig = z.infer<typeof StoredCloudConfigSchema>;

export interface CloudConfig {
  firebase: FirebaseConfig;
  mapId?: string;
}

export function parseStoredCloudConfig(raw: unknown): StoredCloudConfig | null {
  const result = StoredCloudConfigSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * The active cloud configuration, or null when no Firebase credentials were entered or received, which
 * keeps the app purely local. Credentials only ever come from the settings dialog or a link.
 */
export function activeCloudConfig(stored: StoredCloudConfig): CloudConfig | null {
  if (!stored.firebase) return null;
  return { firebase: stored.firebase, ...(stored.mapId ? { mapId: stored.mapId } : {}) };
}

/** Incoming values replace the current ones; parts the incoming config does not carry are kept. */
export function mergeStoredCloudConfig(
  current: StoredCloudConfig,
  incoming: StoredCloudConfig,
): StoredCloudConfig {
  const firebase = incoming.firebase ?? current.firebase;
  const mapId = incoming.mapId ?? current.mapId;
  return { ...(firebase ? { firebase } : {}), ...(mapId ? { mapId } : {}) };
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

export function encodeFirebaseConfig(config: FirebaseConfig): string {
  return toBase64Url(JSON.stringify(config));
}

export function decodeFirebaseConfig(value: string): FirebaseConfig | null {
  try {
    const result = FirebaseConfigSchema.safeParse(JSON.parse(fromBase64Url(value)));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Configuration carried by a URL query string, or null when it has none (or only invalid values). */
export function parseUrlConfig(search: string): StoredCloudConfig | null {
  const params = new URLSearchParams(search);
  const rawCfg = params.get(CFG_URL_PARAM);
  const rawMapId = params.get(CLOUD_MAP_URL_PARAM);
  const firebase = rawCfg ? decodeFirebaseConfig(rawCfg) : null;
  const mapId = rawMapId ? CloudMapIdSchema.safeParse(rawMapId) : null;
  if (!firebase && !mapId?.success) return null;
  return { ...(firebase ? { firebase } : {}), ...(mapId?.success ? { mapId: mapId.data } : {}) };
}

export function hasUrlConfig(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has(CFG_URL_PARAM) || params.has(CLOUD_MAP_URL_PARAM);
}

/** Same URL without the config parameters, so credentials do not stay in the address bar or history. */
export function stripConfigParams(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(CFG_URL_PARAM);
  url.searchParams.delete(CLOUD_MAP_URL_PARAM);
  return url.href;
}

/** Pre-configured app link an administrator can hand out. Keeps the hash out, it carries the editor mode. */
export function buildConfigLink(appUrl: string, config: StoredCloudConfig): string {
  const url = new URL(appUrl);
  url.search = '';
  url.hash = '';
  if (config.firebase) url.searchParams.set(CFG_URL_PARAM, encodeFirebaseConfig(config.firebase));
  if (config.mapId) url.searchParams.set(CLOUD_MAP_URL_PARAM, config.mapId);
  return url.href;
}

const SNIPPET_KEYS = [
  'apiKey',
  'authDomain',
  'projectId',
  'appId',
  'storageBucket',
  'messagingSenderId',
] as const;

/**
 * Reads the config out of the `const firebaseConfig = { ... }` snippet the Firebase console shows after
 * registering a web app (JSON works as well), so non-technical users can paste it as it is.
 */
export function parseFirebaseSnippet(text: string): FirebaseConfig | null {
  const found: Record<string, string> = {};
  for (const key of SNIPPET_KEYS) {
    const match = new RegExp(`["']?${key}["']?\\s*:\\s*["'\`]([^"'\`]+)["'\`]`).exec(text);
    if (match?.[1]) found[key] = match[1];
  }
  const result = FirebaseConfigSchema.safeParse(found);
  return result.success ? result.data : null;
}
