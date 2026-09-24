import { createStore, del, get, set } from 'idb-keyval';
import { z } from 'zod';
import type { MapData, MapLibrary, MapSummary } from '../types/map';
import { LEGACY_STORAGE_KEY, parseMapData } from './mapStorage';

/** localStorage key of the library index (map names + active map). Map bodies are in IndexedDB. */
export const LIBRARY_STORAGE_KEY = 'indoor_nav_library_v1';

export const EMPTY_LIBRARY: MapLibrary = { activeMapId: null, maps: [] };

const MapLibrarySchema = z.object({
  activeMapId: z.string().nullable(),
  maps: z.array(z.object({ id: z.string().min(1), name: z.string(), updatedAt: z.number() })),
});

export function parseLibrary(raw: unknown): MapLibrary | null {
  const result = MapLibrarySchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function createMapId(): string {
  return `map_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createBlankMap(name: string): MapData {
  return {
    metadata: { name, version: 1, metersPerUnit: 0.3, northOffsetDeg: 0 },
    floorPlanImage: null,
    nodes: {},
    edges: [],
    rooms: [],
  };
}

export function withName(map: MapData, name: string): MapData {
  return { ...map, metadata: { ...map.metadata, name } };
}

/** Picks a name that does not collide with existing maps: "Office", "Office (2)", ... */
export function uniqueName(library: MapLibrary, base: string): string {
  const taken = new Set(library.maps.map((m) => m.name));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base} (${i})`)) i++;
  return `${base} (${i})`;
}

export function addToLibrary(library: MapLibrary, summary: MapSummary, activate = true): MapLibrary {
  return {
    activeMapId: activate ? summary.id : library.activeMapId,
    maps: [...library.maps.filter((m) => m.id !== summary.id), summary],
  };
}

export function updateSummary(
  library: MapLibrary,
  id: string,
  patch: Partial<Omit<MapSummary, 'id'>>,
): MapLibrary {
  return { ...library, maps: library.maps.map((m) => (m.id === id ? { ...m, ...patch } : m)) };
}

/** Removes a map; when it was active, the most recently updated remaining map becomes active. */
export function removeFromLibrary(library: MapLibrary, id: string): MapLibrary {
  const maps = library.maps.filter((m) => m.id !== id);
  if (library.activeMapId !== id) return { ...library, maps };
  const next = [...maps].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return { activeMapId: next?.id ?? null, maps };
}

// ---- IndexedDB persistence -------------------------------------------------------------------

const store = typeof indexedDB === 'undefined' ? undefined : createStore('indoor-navigation', 'maps');

export async function readMap(id: string): Promise<MapData | null> {
  const raw: unknown = await get(id, store);
  if (raw === undefined) return null;
  const parsed = parseMapData(raw);
  if (!parsed.ok) throw new Error(`Stored map "${id}" is corrupted: ${parsed.error}`);
  return parsed.data;
}

export async function writeMap(id: string, map: MapData): Promise<void> {
  await set(id, map, store);
}

export async function deleteMap(id: string): Promise<void> {
  await del(id, store);
}

/** Returns the map saved by the single-map prototype in localStorage, if there is a valid one. */
export function readLegacyMap(): MapData | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = parseMapData(JSON.parse(raw));
    return parsed.ok ? parsed.data : null;
  } catch {
    return null;
  }
}

export function clearLegacyMap(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage unavailable (private mode); nothing to clean up.
  }
}
