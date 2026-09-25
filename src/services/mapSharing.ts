import type { MapData } from '../types/map';
import { MAX_IMPORT_BYTES, parseMapData, resolveAssetUrl, type ParseResult } from './mapStorage';

/** Query parameter that makes the app load a map from a URL on startup. */
export const MAP_URL_PARAM = 'map';
/** Location link parameter: `?to=<node id>` starts navigation to that location. */
export const TO_URL_PARAM = 'to';

/** File picker filter for map imports; .txt covers maps shared from Android (see shareCandidates). */
export const MAP_FILE_ACCEPT = 'application/json,.json,text/plain,.txt';

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

export function mapFileName(map: MapData, date = new Date()): string {
  const slug = map.metadata.name
    .normalize('NFD')
    .replace(/[^\w]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `${slug || 'indoor-map'}-${date.toISOString().slice(0, 10)}.json`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
}

/**
 * Embeds a floor plan that is only referenced (bundled asset path or external URL) as a data URL,
 * so the shared map is complete on any device. When the image cannot be fetched (offline, CORS),
 * the reference is kept.
 */
export async function inlineFloorPlan(map: MapData): Promise<MapData> {
  const src = map.floorPlanImage;
  if (!src || src.startsWith('data:')) return map;
  try {
    const res = await fetch(resolveAssetUrl(src));
    if (!res.ok) return map;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return map;
    return { ...map, floorPlanImage: await blobToDataUrl(blob) };
  } catch {
    return map;
  }
}

/** Complete, self-contained JSON of a map: graph, rooms, learned views and the floor plan image. */
export async function serializeMap(map: MapData): Promise<{ json: string; fileName: string }> {
  const complete = await inlineFloorPlan(map);
  return { json: JSON.stringify(complete), fileName: mapFileName(map) };
}

// Mobile download managers read the blob URL asynchronously; revoking it right away makes Chrome on
// Android save a file named after the blob UUID, without an extension.
const REVOKE_DELAY_MS = 60_000;

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a); // Firefox ignores clicks on detached links
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, REVOKE_DELAY_MS);
}

export async function exportMapToFile(map: MapData): Promise<void> {
  const { json, fileName } = await serializeMap(map);
  download(new Blob([json], { type: 'application/json' }), fileName);
}

/**
 * Files offered to the share sheet, in order of preference. Chrome on Android only shares an allowlist
 * of types that excludes JSON, so the same content is also offered as a .txt file; import accepts both.
 */
export function shareCandidates(json: string, fileName: string): File[] {
  return [
    new File([json], fileName, { type: 'application/json' }),
    new File([json], fileName.replace(/\.json$/, '.txt'), { type: 'text/plain' }),
  ];
}

/** Opens the system share sheet with the map file; falls back to a download where files cannot be shared. */
export async function shareMap(map: MapData): Promise<ShareOutcome> {
  const { json, fileName } = await serializeMap(map);
  const candidates = shareCandidates(json, fileName);
  const file =
    typeof navigator.canShare === 'function'
      ? candidates.find((f) => navigator.canShare({ files: [f] }))
      : undefined;
  if (file) {
    try {
      await navigator.share({ files: [file], title: map.metadata.name });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      throw err;
    }
  }
  download(new Blob([json], { type: 'application/json' }), fileName);
  return 'downloaded';
}

/**
 * Resolves the `?map=` value to a fetchable URL: absolute http(s) URLs, or paths relative to the app
 * (e.g. `maps/office.json` for a file committed to public/maps). Returns null for anything else.
 */
export function resolveMapUrl(raw: string, appBase: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    if (/^https?:\/\//i.test(value)) return new URL(value).href;
    if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//')) return null;
    return new URL(value.replace(/^\/+/, ''), appBase).href;
  } catch {
    return null;
  }
}

/** App URL that opens the given map JSON URL; this is what goes into a printed QR code. */
export function buildShareLink(mapUrl: string, appUrl: string): string {
  const url = new URL(appUrl);
  url.search = '';
  url.hash = '';
  url.searchParams.set(MAP_URL_PARAM, mapUrl);
  return url.href;
}

/**
 * App URL that starts navigation to a location. With the map's share URL it also carries the
 * map, so it works on devices that do not have the map yet.
 */
export function buildNodeLink(appUrl: string, nodeId: string, mapUrl?: string): string {
  const url = new URL(appUrl);
  url.search = '';
  url.hash = '';
  if (mapUrl) url.searchParams.set(MAP_URL_PARAM, mapUrl);
  url.searchParams.set(TO_URL_PARAM, nodeId);
  return url.href;
}

/** Downloads and validates a map from a URL. */
export async function fetchSharedMap(url: string): Promise<ParseResult> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-cache' });
  } catch {
    return {
      ok: false,
      error: 'The map could not be downloaded. The server must allow cross-origin access (CORS).',
    };
  }
  if (!res.ok) return { ok: false, error: `The map could not be downloaded (HTTP ${res.status})` };
  if (Number(res.headers.get('content-length') ?? 0) > MAX_IMPORT_BYTES) {
    return { ok: false, error: 'The map file is too large' };
  }
  const text = await res.text();
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: 'The map file is too large' };
  try {
    return parseMapData(JSON.parse(text));
  } catch {
    return { ok: false, error: 'The link does not point to a map JSON file' };
  }
}
