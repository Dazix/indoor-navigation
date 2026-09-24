import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addToLibrary,
  clearLegacyMap,
  createBlankMap,
  createMapId,
  deleteMap as deleteStoredMap,
  EMPTY_LIBRARY,
  LIBRARY_STORAGE_KEY,
  parseLibrary,
  readLegacyMap,
  readMap,
  removeFromLibrary,
  uniqueName,
  updateSummary,
  withName,
  writeMap,
} from '../services/mapLibrary';
import { loadDefaultMap } from '../services/mapStorage';
import type { MapData, MapLibrary } from '../types/map';
import { useLocalStorage } from './useLocalStorage';

const SAVE_DEBOUNCE_MS = 400;

export type LibraryStatus = 'loading' | 'ready' | 'error';

interface ActiveMap {
  id: string;
  map: MapData;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Multi-map library. The index (names, active map) lives in localStorage; each map body,
 * including thumbnails and floor plan images, lives in IndexedDB, which has far more room.
 * Edits to the active map are saved automatically with a short debounce.
 */
export function useMapLibrary() {
  const [library, setLibrary, indexError] = useLocalStorage<MapLibrary>(
    LIBRARY_STORAGE_KEY,
    EMPTY_LIBRARY,
    parseLibrary,
  );
  const [active, setActive] = useState<ActiveMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The last map object known to be in IndexedDB; edits produce new objects and trigger a save.
  const savedRef = useRef<MapData | null>(null);
  const pendingRef = useRef<ActiveMap | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const bootstrapping = useRef(false);

  const flush = useCallback(async () => {
    clearTimeout(timerRef.current);
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    try {
      await writeMap(pending.id, pending.map);
      setSaveError(null);
      setLibrary((lib) =>
        updateSummary(lib, pending.id, { name: pending.map.metadata.name, updatedAt: Date.now() }),
      );
    } catch (err) {
      setSaveError(`Could not save the map: ${errorMessage(err)}`);
    }
  }, [setLibrary]);

  // First run: seed the library from the prototype's localStorage map or the bundled sample.
  useEffect(() => {
    if (library.maps.length > 0 || bootstrapping.current) return;
    bootstrapping.current = true;
    void (async () => {
      try {
        if ('storage' in navigator) void navigator.storage.persist();
        const legacy = readLegacyMap();
        const map = legacy ?? (await loadDefaultMap());
        const id = createMapId();
        await writeMap(id, map);
        if (legacy) clearLegacyMap();
        setLibrary((lib) => addToLibrary(lib, { id, name: map.metadata.name, updatedAt: Date.now() }));
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        bootstrapping.current = false;
      }
    })();
  }, [library.maps.length, setLibrary]);

  // Load the active map whenever the selection changes.
  const activeId = library.activeMapId ?? library.maps[0]?.id ?? null;
  const loadedId = active?.id ?? null;
  useEffect(() => {
    if (!activeId || activeId === loadedId) return;
    let cancelled = false;
    readMap(activeId)
      .then((map) => {
        if (cancelled) return;
        if (!map) {
          // Index points to a map that is gone from IndexedDB (e.g. site data partially cleared).
          setLibrary((lib) => removeFromLibrary(lib, activeId));
          return;
        }
        savedRef.current = map;
        setActive({ id: activeId, map });
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, loadedId, setLibrary]);

  // Debounced auto-save of edits to the active map.
  useEffect(() => {
    if (!active || active.map === savedRef.current) return;
    savedRef.current = active.map;
    pendingRef.current = active;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }, [active, flush]);

  // Save immediately when the page is hidden (tab switch, app backgrounded, closing).
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [flush]);

  const updateMap = useCallback((updater: (map: MapData) => MapData) => {
    setActive((prev) => (prev ? { id: prev.id, map: updater(prev.map) } : prev));
  }, []);

  const addMap = useCallback(
    async (map: MapData) => {
      await flush();
      const id = createMapId();
      const named = withName(map, uniqueName(library, map.metadata.name));
      await writeMap(id, named);
      setLibrary((lib) => addToLibrary(lib, { id, name: named.metadata.name, updatedAt: Date.now() }));
      return id;
    },
    [flush, library, setLibrary],
  );

  const switchMap = useCallback(
    async (id: string) => {
      await flush();
      setLibrary((lib) => ({ ...lib, activeMapId: id }));
    },
    [flush, setLibrary],
  );

  const createMap = useCallback(
    async (name: string, template: 'blank' | 'sample') => {
      const base = template === 'sample' ? withName(await loadDefaultMap(), name) : createBlankMap(name);
      return addMap(base);
    },
    [addMap],
  );

  const duplicateActive = useCallback(async () => {
    if (!active) return null;
    return addMap(withName(active.map, `${active.map.metadata.name} copy`));
  }, [active, addMap]);

  const renameMap = useCallback(
    async (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      if (id === active?.id) {
        updateMap((map) => withName(map, trimmed));
      } else {
        const map = await readMap(id);
        if (map) await writeMap(id, withName(map, trimmed));
      }
      setLibrary((lib) => updateSummary(lib, id, { name: trimmed, updatedAt: Date.now() }));
    },
    [active?.id, setLibrary, updateMap],
  );

  const deleteMap = useCallback(
    async (id: string) => {
      if (library.maps.length <= 1) return;
      if (pendingRef.current?.id === id) {
        clearTimeout(timerRef.current);
        pendingRef.current = null;
      } else {
        await flush();
      }
      await deleteStoredMap(id);
      setLibrary((lib) => removeFromLibrary(lib, id));
    },
    [flush, library.maps.length, setLibrary],
  );

  const status: LibraryStatus = error ? 'error' : active?.id === activeId ? 'ready' : 'loading';

  return {
    maps: library.maps,
    activeMapId: active?.id ?? null,
    map: active?.map ?? null,
    status,
    error,
    saveError: saveError ?? indexError,
    updateMap,
    switchMap,
    createMap,
    importMap: addMap,
    duplicateActive,
    renameMap,
    deleteMap,
  };
}
