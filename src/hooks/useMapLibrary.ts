import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addToLibrary,
  clearLegacyMap,
  createBlankMap,
  createMapId,
  deleteMap as deleteStoredMap,
  EMPTY_LIBRARY,
  findBySource,
  LIBRARY_STORAGE_KEY,
  parseLibrary,
  readLegacyMap,
  readMap,
  removeFromLibrary,
  uniqueName,
  summaryFields,
  updateSummary,
  withName,
  writeMap,
} from '../services/mapLibrary';
import {
  canRedo,
  canUndo,
  commit,
  createHistory,
  redo as redoHistory,
  undo as undoHistory,
  type History,
} from '../services/history';
import { loadDefaultMap } from '../services/mapStorage';
import type { MapData, MapLibrary } from '../types/map';
import { useLocalStorage } from './useLocalStorage';

const SAVE_DEBOUNCE_MS = 400;

export type LibraryStatus = 'loading' | 'ready' | 'error';

interface ActiveMap {
  id: string;
  /** Undo / redo snapshots of the map; `present` is the map being shown and edited. */
  history: History<MapData>;
}

interface PendingSave {
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
export function useMapLibrary({ onEdited }: { onEdited?: (mapId: string) => void } = {}) {
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
  const pendingRef = useRef<PendingSave | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const bootstrapping = useRef(false);
  // Reported as soon as an edit lands, before the debounced save, so sync status reacts instantly.
  const onEditedRef = useRef(onEdited);
  useEffect(() => {
    onEditedRef.current = onEdited;
  }, [onEdited]);

  const flush = useCallback(async () => {
    clearTimeout(timerRef.current);
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    try {
      await writeMap(pending.id, pending.map);
      setSaveError(null);
      setLibrary((lib) =>
        updateSummary(lib, pending.id, { ...summaryFields(pending.map), updatedAt: Date.now() }),
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
        setLibrary((lib) => addToLibrary(lib, { id, ...summaryFields(map), updatedAt: Date.now() }));
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
        setActive({ id: activeId, history: createHistory(map) });
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
    if (!active || active.history.present === savedRef.current) return;
    savedRef.current = active.history.present;
    onEditedRef.current?.(active.id);
    pendingRef.current = { id: active.id, map: active.history.present };
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

  /** Edits the active map. Calls with the same `key` in quick succession form one undo step. */
  const updateMap = useCallback((updater: (map: MapData) => MapData, key?: string) => {
    const now = Date.now();
    setActive((prev) =>
      prev
        ? {
            id: prev.id,
            history: commit(prev.history, updater(prev.history.present), { ...(key ? { key } : {}), now }),
          }
        : prev,
    );
  }, []);

  const undo = useCallback(() => {
    setActive((prev) =>
      prev && canUndo(prev.history) ? { id: prev.id, history: undoHistory(prev.history) } : prev,
    );
  }, []);

  const redo = useCallback(() => {
    setActive((prev) =>
      prev && canRedo(prev.history) ? { id: prev.id, history: redoHistory(prev.history) } : prev,
    );
  }, []);

  const addMap = useCallback(
    async (map: MapData, sourceUrl?: string) => {
      await flush();
      const id = createMapId();
      const named = withName(map, uniqueName(library, map.metadata.name));
      await writeMap(id, named);
      setLibrary((lib) =>
        addToLibrary(lib, {
          id,
          ...summaryFields(named),
          updatedAt: Date.now(),
          ...(sourceUrl ? { sourceUrl } : {}),
        }),
      );
      return id;
    },
    [flush, library, setLibrary],
  );

  /** Adds a map loaded from a share link, or overwrites the map previously loaded from the same link. */
  const importFromUrl = useCallback(
    async (map: MapData, sourceUrl: string) => {
      const existing = findBySource(library, sourceUrl);
      if (!existing) return addMap(map, sourceUrl);
      if (pendingRef.current?.id === existing.id) {
        clearTimeout(timerRef.current);
        pendingRef.current = null;
      } else {
        await flush();
      }
      const others = { ...library, maps: library.maps.filter((m) => m.id !== existing.id) };
      const named = withName(map, uniqueName(others, map.metadata.name));
      await writeMap(existing.id, named);
      if (active?.id === existing.id) {
        savedRef.current = named;
        setActive({ id: existing.id, history: createHistory(named) });
      }
      onEditedRef.current?.(existing.id);
      setLibrary((lib) => ({
        ...updateSummary(lib, existing.id, { ...summaryFields(named), updatedAt: Date.now() }),
        activeMapId: existing.id,
      }));
      return existing.id;
    },
    [active?.id, addMap, flush, library, setLibrary],
  );

  /**
   * Replaces a map with a version received from the cloud. Unlike an edit this is not reported through
   * `onEdited`: local and cloud are equal afterwards, and undo history starts fresh.
   */
  const replaceMap = useCallback(
    async (id: string, map: MapData) => {
      if (pendingRef.current?.id === id) {
        clearTimeout(timerRef.current);
        pendingRef.current = null;
      }
      await writeMap(id, map);
      if (active?.id === id) {
        savedRef.current = map;
        setActive({ id, history: createHistory(map) });
      }
      setLibrary((lib) => updateSummary(lib, id, { ...summaryFields(map), updatedAt: Date.now() }));
    },
    [active?.id, setLibrary],
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
    const current = active.history.present;
    return addMap(withName(current, `${current.metadata.name} copy`));
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
        onEditedRef.current?.(id);
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

  const findSource = useCallback((url: string) => findBySource(library, url), [library]);

  const status: LibraryStatus = error ? 'error' : active?.id === activeId ? 'ready' : 'loading';

  return {
    maps: library.maps,
    activeMapId: active?.id ?? null,
    map: active?.history.present ?? null,
    canUndo: active ? canUndo(active.history) : false,
    canRedo: active ? canRedo(active.history) : false,
    undo,
    redo,
    status,
    error,
    saveError: saveError ?? indexError,
    updateMap,
    switchMap,
    createMap,
    importMap: addMap,
    importFromUrl,
    replaceMap,
    findBySource: findSource,
    duplicateActive,
    renameMap,
    deleteMap,
  };
}
