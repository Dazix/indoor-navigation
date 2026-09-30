import { z } from 'zod';

/** localStorage key for the cloud sources entered in the UI or received through a link (see `parseStoredCloudConfig` for the shape change). */
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

/** What a link carries (and what the first cloud version stored): credentials and/or one map id. */
const UrlConfigSchema = z.object({
  firebase: FirebaseConfigSchema.optional(),
  mapId: CloudMapIdSchema.optional(),
});

export type UrlConfig = z.infer<typeof UrlConfigSchema>;

/** A Firebase project plus the maps of it this device uses. Maps that are not listed are never downloaded. */
const CloudSourceSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1),
  firebase: FirebaseConfigSchema,
  enabledMapIds: z.array(CloudMapIdSchema),
});

export type CloudSource = z.infer<typeof CloudSourceSchema>;

/** What is persisted: every configured source. No sources keeps the app purely local. */
const StoredCloudConfigSchema = z.object({ sources: z.array(CloudSourceSchema) });

export type StoredCloudConfig = z.infer<typeof StoredCloudConfigSchema>;

export const EMPTY_CLOUD_CONFIG: StoredCloudConfig = { sources: [] };

/** Stable id of a source, derived from the Firebase project so the same project is never added twice. */
export function sourceIdFor(firebase: FirebaseConfig): string {
  return firebase.projectId.replace(/[^A-Za-z0-9_-]/g, '_');
}

function sourceFromUrlConfig(legacy: UrlConfig): CloudSource[] {
  if (!legacy.firebase) return [];
  return [
    {
      id: sourceIdFor(legacy.firebase),
      label: legacy.firebase.projectId,
      firebase: legacy.firebase,
      enabledMapIds: legacy.mapId ? [legacy.mapId] : [],
    },
  ];
}

/**
 * Validates persisted data. The first cloud version stored a single `{ firebase, mapId }` under the same
 * key; it is converted to one source here and written in the new shape on the next save.
 */
export function parseStoredCloudConfig(raw: unknown): StoredCloudConfig | null {
  const current = StoredCloudConfigSchema.safeParse(raw);
  if (current.success) return current.data;
  if (typeof raw === 'object' && raw !== null && 'sources' in raw) return null;
  const legacy = UrlConfigSchema.safeParse(raw);
  return legacy.success ? { sources: sourceFromUrlConfig(legacy.data) } : null;
}

export function findSource(config: StoredCloudConfig, sourceId: string | undefined): CloudSource | undefined {
  return sourceId === undefined ? undefined : config.sources.find((s) => s.id === sourceId);
}

/** Adds a source, or replaces the credentials (and label, if given) of the one for the same project. */
export function upsertSource(
  config: StoredCloudConfig,
  firebase: FirebaseConfig,
  label?: string,
): StoredCloudConfig {
  const id = sourceIdFor(firebase);
  const existing = findSource(config, id);
  if (!existing) {
    const source: CloudSource = {
      id,
      label: label?.trim() || firebase.projectId,
      firebase,
      enabledMapIds: [],
    };
    return { sources: [...config.sources, source] };
  }
  return {
    sources: config.sources.map((s) =>
      s.id === id ? { ...s, firebase, ...(label?.trim() ? { label: label.trim() } : {}) } : s,
    ),
  };
}

export function removeSource(config: StoredCloudConfig, sourceId: string): StoredCloudConfig {
  return { sources: config.sources.filter((s) => s.id !== sourceId) };
}

/** Replaces the enabled maps of a source (duplicates dropped, order kept). */
export function setEnabledMaps(
  config: StoredCloudConfig,
  sourceId: string,
  mapIds: readonly string[],
): StoredCloudConfig {
  const unique = [...new Set(mapIds)];
  return { sources: config.sources.map((s) => (s.id === sourceId ? { ...s, enabledMapIds: unique } : s)) };
}

export function enableMap(config: StoredCloudConfig, sourceId: string, mapId: string): StoredCloudConfig {
  const source = findSource(config, sourceId);
  return source ? setEnabledMaps(config, sourceId, [...source.enabledMapIds, mapId]) : config;
}

/**
 * Applies what a launch link carries: credentials add or update a source, and a map id is enabled on that
 * source (or on the only source when the link has no credentials).
 */
export function applyUrlConfig(current: StoredCloudConfig, incoming: UrlConfig): StoredCloudConfig {
  let config = current;
  let targetId: string | undefined;
  if (incoming.firebase) {
    config = upsertSource(config, incoming.firebase);
    targetId = sourceIdFor(incoming.firebase);
  } else if (config.sources.length === 1) {
    targetId = config.sources[0]?.id;
  }
  return incoming.mapId && targetId ? enableMap(config, targetId, incoming.mapId) : config;
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
export function parseUrlConfig(search: string): UrlConfig | null {
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
export function buildConfigLink(appUrl: string, config: UrlConfig): string {
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
