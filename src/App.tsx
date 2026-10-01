import { Loader2, MapPin, Target, X } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EditorSidebar } from './components/editor/EditorSidebar';
import { Header } from './components/layout/Header';
import { InteractiveMap } from './components/map/InteractiveMap';
import { LocationSearch } from './components/map/LocationSearch';
import { MapManagerModal, ShareLinkSection } from './components/maps/MapManagerModal';
import { Modal } from './components/ui/Modal';
import { NavigationBar } from './components/ui/NavigationBar';
import { CloudBanner } from './components/cloud/CloudBanner';
import { CloudSettingsModal } from './components/cloud/CloudSettingsModal';
import { Toast } from './components/ui/Toast';
import { ConflictModal } from './components/cloud/ConflictModal';
import { SyncStatus } from './components/cloud/SyncStatus';
import { useAutoMapByLocation } from './hooks/useAutoMapByLocation';
import { useCloudSync } from './hooks/useCloudSync';
import { useMapLibrary } from './hooks/useMapLibrary';
import { useSyncState } from './hooks/useSyncState';
import { hasUrlConfig, parseUrlConfig, stripConfigParams } from './services/cloudConfig';
import { readMap } from './services/mapLibrary';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useOrientation } from './hooks/useOrientation';
import { usePDR } from './hooks/usePDR';
import { normalizeDeg } from './services/geometry';
import type { LocationFix, WalkEstimate } from './services/locationPrior';
import { planDisplacement } from './services/walkTrack';
import { isTypingTarget, toolForShortcut } from './services/editorShortcuts';
import { corridorNear, deleteBend, deleteEdge, insertBend, moveBend } from './services/corridors';
import { imageRatio, pickImageFile, readClipboardImage, readFloorPlanFile } from './services/imageFiles';
import {
  addNode,
  canvasRatioForImage,
  createNodeId,
  deleteNode,
  metersPerUnitForSegment,
  moveNode,
  rotateMap90,
  setEmbeddings,
  setFloorPlan,
  setFloorPlanFineRotation,
  setMapAspect,
  addEdge,
  updateMetadata,
  updateNode,
} from './services/mapEditing';
import { resolveEmbeddingModel } from './services/embeddingModels';
import { withEmbeddingModel } from './services/modelSwitch';
import {
  exportMapToFile,
  fetchSharedMap,
  MAP_URL_PARAM,
  resolveMapUrl,
  shareMap,
  TO_URL_PARAM,
} from './services/mapSharing';
import { detectHandheldDevice } from './services/deviceCapabilities';
import { importMapFromFile, resolveAssetUrl } from './services/mapStorage';
import { computeRoute, formatDistance } from './services/navigation';
import { hrefForMode, modeFromHash } from './services/modeRoute';
import { parseMapRotationPref, type MapRotationPref } from './services/viewport';
import type { MapData, Point } from './types/map';
import type { AppMode, EditorTool } from './types/navigation';
import type { P2PRole } from './components/maps/P2PTransferModal';

const ARCanvas = lazy(() => import('./components/ar/ARCanvas'));
const VisionScannerModal = lazy(() => import('./components/scanner/VisionScannerModal'));
const WalkthroughModal = lazy(() => import('./components/editor/WalkthroughModal'));
const RecognitionQualityModal = lazy(() => import('./components/editor/RecognitionQualityModal'));
const RecognitionModelModal = lazy(() => import('./components/editor/RecognitionModelModal'));
const VersionModal = lazy(() => import('./components/ui/VersionModal'));
const P2PTransferModal = lazy(() => import('./components/maps/P2PTransferModal'));

type Notice = { tone: 'error' | 'info'; text: string };

function defaultStart(map: MapData): string | null {
  return 'entrance' in map.nodes ? 'entrance' : (Object.keys(map.nodes)[0] ?? null);
}

/** Reads a link parameter once and removes it, so a reload does not act on it again. */
function takeUrlParam(name: string): string | null {
  const url = new URL(window.location.href);
  const value = url.searchParams.get(name);
  if (value === null) return null;
  url.searchParams.delete(name);
  window.history.replaceState(window.history.state, '', url.href);
  return value;
}

// Read at module load, before the first render, so StrictMode double renders cannot lose them.
/** `?map=` share link: map JSON to import. */
const INITIAL_MAP_LINK = takeUrlParam(MAP_URL_PARAM);
/** `?to=` location link: node to navigate to once the map is loaded. */
const INITIAL_TARGET = takeUrlParam(TO_URL_PARAM);
/**
 * `?cfg=` / `?cloudMap=` cloud setup link. Unlike the params above it stays in the address bar until the
 * user chooses to clean it (see CloudBanner), so they can see what the link carried.
 */
const INITIAL_CLOUD_CONFIG = parseUrlConfig(window.location.search);
const INITIAL_CLOUD_LINK_INVALID = INITIAL_CLOUD_CONFIG === null && hasUrlConfig(window.location.search);

function FullScreenMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-slate-950 p-6 text-center text-sm text-slate-300">
      {children}
    </div>
  );
}

export default function App() {
  const syncState = useSyncState();
  const library = useMapLibrary({ onEdited: syncState.markEdited });
  const { map, activeMapId, updateMap } = library;

  const [mapRotation, setMapRotation] = useLocalStorage<MapRotationPref>(
    'indoor-nav:map-rotation',
    'auto',
    parseMapRotationPref,
  );
  const [mode, setMode] = useState<AppMode>(() => modeFromHash(window.location.hash));
  const [tool, setTool] = useState<EditorTool>('select');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [linkFromId, setLinkFromId] = useState<string | null>(null);
  /** Ends of the reference line of the measure tool (0–2 points). */
  const [measure, setMeasure] = useState<Point[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [handheld] = useState(detectHandheldDevice);
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [shareLinkOpen, setShareLinkOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(() =>
    INITIAL_CLOUD_LINK_INVALID
      ? { tone: 'error', text: 'The cloud settings in this link are not valid.' }
      : null,
  );
  const [cloudOpen, setCloudOpen] = useState(false);
  const [p2pRole, setP2PRole] = useState<P2PRole | null>(null);
  /** Map spot to zoom to (editor search); `seq` makes a repeated pick of the same spot count. */
  const [mapFocus, setMapFocus] = useState<{ point: Point; seq: number } | null>(null);
  const mapLinkHandled = useRef(false);
  // A location link (?to=) waits until a ?map= link has been imported, so it can target that map.
  const [mapLinkDone, setMapLinkDone] = useState(INITIAL_MAP_LINK === null);
  const pendingTarget = useRef(INITIAL_TARGET);
  const targetSearched = useRef(false);

  // Location and destination belong to one map; reset them when another map becomes active.
  const [nav, setNav] = useState<{ mapId: string | null; from: string | null; to: string | null }>({
    mapId: null,
    from: null,
    to: null,
  });
  // Last location the user confirmed, in memory only: it gives the scanner a fading hint which
  // places are likely, and is gone after a restart, when the user may be anywhere.
  const [lastFix, setLastFix] = useState<LocationFix | null>(null);
  // The user is choosing where they are, by search or by tapping the map.
  const [pickingLocation, setPickingLocation] = useState(false);
  if (map && nav.mapId !== activeMapId) {
    setLastFix(null);
    setPickingLocation(false);
    setNav({ mapId: activeMapId, from: defaultStart(map), to: null });
    setSelectedNodeId(null);
    setLinkFromId(null);
    setMeasure([]);
  }
  // Undo / redo can remove the selected location.
  if (map && selectedNodeId && !map.nodes[selectedNodeId]) setSelectedNodeId(null);
  if (map && linkFromId && !map.nodes[linkFromId]) setLinkFromId(null);
  const currentLocation = nav.from && map?.nodes[nav.from] ? nav.from : null;
  const destination = nav.to && map?.nodes[nav.to] ? nav.to : null;

  const cloud = useCloudSync({
    sync: syncState.sync,
    setSync: syncState.setSync,
    map,
    activeMapId,
    maps: library.maps,
    libraryReady: library.status === 'ready',
    importMap: library.importCloudMap,
    replaceMap: library.replaceMap,
    switchMap: library.switchMap,
    navigating: destination !== null,
    notify: setNotice,
    urlConfig: INITIAL_CLOUD_CONFIG,
  });
  const cleanCloudUrl = () => {
    window.history.replaceState(window.history.state, '', stripConfigParams(window.location.href));
    cloud.acknowledgeUrlConfig();
  };

  // Only the editor is in the URL: entering or leaving it adds a history entry, so Back works.
  const changeMode = (next: AppMode) => {
    if ((mode === 'editor') !== (next === 'editor')) {
      window.history.pushState(null, '', hrefForMode(window.location.href, next));
    }
    setMode(next);
  };

  useEffect(() => {
    const syncFromUrl = () => {
      const fromUrl = modeFromHash(window.location.hash);
      // AR has no address of its own, so a URL without the editor hash keeps it open.
      setMode((prev) => (fromUrl === 'user' && prev === 'ar' ? prev : fromUrl));
    };
    window.addEventListener('popstate', syncFromUrl);
    window.addEventListener('hashchange', syncFromUrl);
    return () => {
      window.removeEventListener('popstate', syncFromUrl);
      window.removeEventListener('hashchange', syncFromUrl);
    };
  }, []);

  const picking = pickingLocation && mode === 'user';
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickingLocation(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [picking]);

  const sensorsEnabled = mode !== 'editor';
  const orientation = useOrientation(sensorsEnabled);
  const pdr = usePDR(sensorsEnabled, orientation.absolute ? orientation.heading : null);

  const route = useMemo(
    () => (map ? computeRoute(map, currentLocation, destination, pdr.distanceM) : null),
    [map, currentLocation, destination, pdr.distanceM],
  );

  const changeTool = useCallback((next: EditorTool) => {
    setTool(next);
    setLinkFromId(null);
    setMeasure([]);
    if (next !== 'select') setSelectedNodeId(null);
  }, []);

  // Editor keys: Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z or Ctrl+Y redoes, S/A/C/D/M pick a tool.
  // Text fields keep their own undo and receive all letters.
  const { undo, redo } = library;
  useEffect(() => {
    if (mode !== 'editor') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || isTypingTarget(e.target as HTMLElement | null)) return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
        } else if (key === 'y' && !e.shiftKey) {
          e.preventDefault();
          redo();
        }
        return;
      }
      const next = toolForShortcut(e);
      if (next) {
        e.preventDefault();
        changeTool(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [mode, undo, redo, changeTool]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      setNotice(null);
    }, 4000);
    return () => {
      clearTimeout(timer);
    };
  }, [notice]);

  // Share link (?map=<url>): once the library is ready, add the linked map or update the earlier copy.
  const { status: libraryStatus, findBySource, importFromUrl } = library;
  useEffect(() => {
    if (INITIAL_MAP_LINK === null || mapLinkHandled.current || libraryStatus !== 'ready') return;
    mapLinkHandled.current = true;
    const link = INITIAL_MAP_LINK;
    void (async () => {
      const url = resolveMapUrl(link, new URL(import.meta.env.BASE_URL, window.location.origin).href);
      if (!url) {
        setNotice({ tone: 'error', text: 'The map link is not a valid http(s) URL or path.' });
        return;
      }
      const result = await fetchSharedMap(url);
      if (!result.ok) {
        setNotice({ tone: 'error', text: `Map link failed: ${result.error}` });
        return;
      }
      const existing = findBySource(url);
      if (
        existing &&
        !window.confirm(
          `Update “${existing.name}” from the link? Local changes to this map will be replaced.`,
        )
      ) {
        return;
      }
      try {
        await importFromUrl(result.data, url);
        setNotice({
          tone: 'info',
          text: `${existing ? 'Updated' : 'Added'} “${result.data.metadata.name}” from the link.`,
        });
      } catch (err) {
        setNotice({
          tone: 'error',
          text: `Map link failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    })().finally(() => {
      setMapLinkDone(true);
    });
  }, [libraryStatus, findBySource, importFromUrl]);

  // Without a link that names a map or a spot, open the map nearest to the device.
  useAutoMapByLocation({
    enabled:
      libraryStatus === 'ready' &&
      mapLinkDone &&
      INITIAL_MAP_LINK === null &&
      INITIAL_TARGET === null &&
      INITIAL_CLOUD_CONFIG === null,
    maps: library.maps,
    activeMapId,
    switchMap: library.switchMap,
  });

  const { reset: resetSteps, markFix } = pdr;

  // How far and which way the user walked since the last confirmed location; null without a step
  // counter, when the scanner falls back to a plain disc around the fix.
  const { permission: motionPermission, sinceFix, stepLengthM } = pdr;
  const northOffsetDeg = map?.metadata.northOffsetDeg ?? 0;
  const walkEstimate = useMemo<WalkEstimate | null>(
    () =>
      motionPermission === 'granted'
        ? {
            distanceM: sinceFix.steps * stepLengthM,
            displacementM: planDisplacement(sinceFix, northOffsetDeg),
          }
        : null,
    [motionPermission, sinceFix, stepLengthM, northOffsetDeg],
  );

  /** Starts a new leg from the last waypoint the user walked past. */
  const navigateTo = useCallback(
    (to: string | null) => {
      const passed = route ? route.path[Math.max(0, route.nextNodeIndex - 1)] : undefined;
      setNav((n) => ({ ...n, from: passed ?? n.from, to }));
      resetSteps();
    },
    [route, resetSteps],
  );

  const relocate = useCallback(
    (from: string) => {
      setNav((n) => ({ ...n, from }));
      setLastFix({ nodeId: from, at: Date.now() });
      resetSteps();
      markFix();
    },
    [resetSteps, markFix],
  );

  // Location link (?to=<node id>): navigate there on the active map, or on the library map that has it.
  const { maps: libraryMaps, switchMap } = library;
  useEffect(() => {
    const target = pendingTarget.current;
    if (!target || !mapLinkDone || libraryStatus !== 'ready' || !map) return;
    const notFound = () => {
      pendingTarget.current = null;
      setNotice({ tone: 'error', text: 'The location from the link was not found in your maps.' });
    };
    if (target in map.nodes) {
      pendingTarget.current = null;
      navigateTo(target);
      return;
    }
    if (targetSearched.current) {
      notFound();
      return;
    }
    targetSearched.current = true;
    void (async () => {
      for (const summary of libraryMaps) {
        if (summary.id === activeMapId) continue;
        const data = await readMap(summary.id);
        if (data && target in data.nodes) {
          await switchMap(summary.id); // this effect runs again with that map and navigates
          return;
        }
      }
      notFound();
    })();
  }, [map, activeMapId, libraryMaps, libraryStatus, mapLinkDone, navigateTo, switchMap]);

  const enableSensors = () => {
    // Both prompts must start synchronously inside the tap handler for iOS to show them.
    void Promise.all([orientation.request(), pdr.request()]);
  };

  // ---- Editor ---------------------------------------------------------------------------------

  /** Adds an end of the measured line; a third tap starts a new line. */
  const addMeasurePoint = (point: Point) => {
    setMeasure((m) => (m.length >= 2 ? [point] : [...m, point]));
  };

  const applyMeasuredScale = (meters: number) => {
    const [a, b] = measure;
    const mpu = a && b ? metersPerUnitForSegment(a, b, meters) : null;
    if (!map || mpu === null) {
      setNotice({ tone: 'error', text: 'Enter the real length of the measured line in metres.' });
      return;
    }
    updateMap((m) => updateMetadata(m, { metersPerUnit: mpu }));
    const { width, height } = map.metadata;
    const size = (v: number) => String(Math.round(v * mpu * 10) / 10);
    setNotice({ tone: 'info', text: `Scale set: the map is ${size(width)} × ${size(height)} m.` });
  };

  const handleCanvasTap = (point: Point, near: { raw: Point; tolerance: number }) => {
    if (mode !== 'editor' || !map) return;
    if (tool === 'measure') {
      addMeasurePoint(point);
    } else if (tool === 'add_node' || tool === 'link_nodes') {
      // A tap on a corridor adds an unnamed bend point instead of a named location.
      const corridor = corridorNear(map.nodes, map.edges, near.raw, near.tolerance);
      if (corridor) {
        updateMap((m) => insertBend(m, corridor.edgeIndex, corridor.segmentIndex, corridor.point));
        return;
      }
      if (tool === 'link_nodes') return;
      const n = Object.keys(map.nodes).length + 1;
      const id = createNodeId();
      updateMap((m) => addNode(m, { id, ...point, label: `Location ${n}`, markerCode: `LOC-${n}` }));
      setSelectedNodeId(id);
    } else if (tool === 'select') {
      setSelectedNodeId(null);
    }
  };

  /** A place picked in the user view: where the user is while choosing a location, else the destination. */
  const handleUserPick = (id: string) => {
    if (picking) {
      relocate(id);
      setPickingLocation(false);
      const label = map?.nodes[id]?.label;
      if (label) setNotice({ tone: 'info', text: `You are at ${label}` });
    } else {
      navigateTo(id);
    }
  };

  const handleNodeTap = (id: string) => {
    if (mode !== 'editor') {
      handleUserPick(id);
      return;
    }
    if (tool === 'measure') {
      const node = map?.nodes[id];
      if (node) addMeasurePoint({ x: node.x, y: node.y });
    } else if (tool === 'link_nodes') {
      if (!linkFromId || linkFromId === id) {
        setLinkFromId(linkFromId === id ? null : id);
      } else {
        updateMap((m) => addEdge(m, linkFromId, id));
        setLinkFromId(id); // keep chaining corridors from the last tapped location
      }
    } else if (tool === 'delete') {
      updateMap((m) => deleteNode(m, id));
      if (selectedNodeId === id) setSelectedNodeId(null);
    } else {
      setSelectedNodeId(id);
    }
  };

  const handleImport = (file: File) => {
    void importMapFromFile(file).then(async (result) => {
      if (!result.ok) {
        setNotice({ tone: 'error', text: `Import failed: ${result.error}` });
        return;
      }
      await library.importMap(result.data);
      setNotice({ tone: 'info', text: `Imported “${result.data.metadata.name}” as a new map.` });
    });
  };

  const handleFloorPlan = useCallback(
    (file: File, successText?: string) => {
      readFloorPlanFile(file)
        .then(({ src, ratio }) => {
          updateMap((m) => setFloorPlan(m, src, ratio));
          if (successText) setNotice({ tone: 'info', text: successText });
        })
        .catch((err: unknown) => {
          setNotice({
            tone: 'error',
            text: err instanceof Error ? err.message : 'Floor plan could not be loaded',
          });
        });
    },
    [updateMap],
  );

  const pasteFloorPlan = () => {
    readClipboardImage()
      .then((file) => {
        handleFloorPlan(file, 'Floor plan pasted from the clipboard.');
      })
      .catch((err: unknown) => {
        setNotice({ tone: 'error', text: err instanceof Error ? err.message : String(err) });
      });
  };

  // Ctrl+V / ⌘V in the editor pastes a copied image as the floor plan. Text fields and open
  // dialogs keep the normal paste behaviour.
  useEffect(() => {
    if (mode !== 'editor') return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable], [role="dialog"]')) return;
      const file = pickImageFile(e.clipboardData?.files);
      if (!file) return;
      e.preventDefault();
      handleFloorPlan(file, 'Floor plan pasted from the clipboard.');
    };
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('paste', onPaste);
    };
  }, [mode, handleFloorPlan]);

  // ---- Render ---------------------------------------------------------------------------------

  if (library.status === 'error' && !map) {
    return (
      <FullScreenMessage>
        <p className="font-semibold text-white">The map library could not be opened.</p>
        <p>{library.error}</p>
      </FullScreenMessage>
    );
  }
  if (!map) {
    return (
      <FullScreenMessage>
        <Loader2 className="size-6 animate-spin" />
        Loading map…
      </FullScreenMessage>
    );
  }

  const selectedNode = selectedNodeId ? (map.nodes[selectedNodeId] ?? null) : null;
  const destinationNode = destination ? (map.nodes[destination] ?? null) : null;
  const userHeading =
    orientation.heading !== null ? normalizeDeg(orientation.heading - map.metadata.northOffsetDeg) : null;
  const errorText = library.saveError ?? (notice?.tone === 'error' ? notice.text : null);

  return (
    <div className="flex h-full flex-col bg-slate-950">
      {mode !== 'ar' && (
        <Header
          mode={mode}
          onModeChange={changeMode}
          maps={library.maps}
          activeMapId={activeMapId}
          onSwitchMap={(id) => void library.switchMap(id)}
          onManageMaps={() => {
            setManagerOpen(true);
          }}
          unsavedChanges={cloud.configured && cloud.status === 'unsaved'}
          onLogoLongPress={() => {
            setVersionOpen(true);
          }}
          cloudSlot={
            <SyncStatus
              configured={cloud.configured}
              status={cloud.status}
              dirty={mode === 'editor' && (!cloud.entry || cloud.entry.dirty)}
              busy={cloud.busy}
              onPublish={() => {
                // Several projects and no link yet: the person picks where this map goes first.
                if (cloud.needsPublishChoice) setCloudOpen(true);
                else void cloud.publish();
              }}
              onOpenSettings={() => {
                setCloudOpen(true);
              }}
            />
          }
        />
      )}
      {mode !== 'ar' && (
        <CloudBanner
          urlConfigInAddressBar={cloud.configFromUrl}
          onCleanUrl={cleanCloudUrl}
          onDismissUrl={cloud.acknowledgeUrlConfig}
          updateAvailable={cloud.pendingUpdate}
          onApplyUpdate={() => void cloud.applyPendingUpdate()}
        />
      )}

      <div className="relative flex flex-1 flex-col overflow-hidden bg-slate-100 md:flex-row dark:bg-slate-950">
        {mode === 'editor' && (
          <EditorSidebar
            map={map}
            tool={tool}
            onToolChange={changeTool}
            canUndo={library.canUndo}
            canRedo={library.canRedo}
            onUndo={library.undo}
            onRedo={library.redo}
            selectedNode={selectedNode}
            linkFrom={linkFromId ? (map.nodes[linkFromId] ?? null) : null}
            onMetadataChange={(patch) => {
              updateMap((m) => updateMetadata(m, patch), `meta:${Object.keys(patch).join(',')}`);
            }}
            onFloorPlanUpload={handleFloorPlan}
            onFloorPlanPaste={pasteFloorPlan}
            onFloorPlanRemove={() => {
              updateMap((m) => setFloorPlan(m, null));
            }}
            onAspectChange={(ratio) => {
              updateMap((m) => setMapAspect(m, ratio));
            }}
            onFitToImage={() => {
              if (!map.floorPlanImage) return;
              void imageRatio(resolveAssetUrl(map.floorPlanImage)).then((ratio) => {
                updateMap((m) => setMapAspect(m, canvasRatioForImage(m, ratio)));
              });
            }}
            onRotate90={(clockwise) => {
              updateMap((m) => rotateMap90(m, clockwise));
            }}
            onFineRotation={(deg) => {
              updateMap((m) => setFloorPlanFineRotation(m, deg), 'fine-rotation');
            }}
            onExport={() => {
              exportMapToFile(map).catch((err: unknown) => {
                setNotice({
                  tone: 'error',
                  text: err instanceof Error ? err.message : `Export failed: ${String(err)}`,
                });
              });
            }}
            onSendNearby={() => {
              setP2PRole('send');
            }}
            onShareLink={() => {
              setShareLinkOpen(true);
            }}
            onShare={() => {
              shareMap(map)
                .then((outcome) => {
                  if (outcome === 'downloaded') {
                    setNotice({
                      tone: 'info',
                      text: 'This browser cannot share files, so the map was downloaded instead.',
                    });
                  }
                })
                .catch((err: unknown) => {
                  setNotice({
                    tone: 'error',
                    text: `Sharing failed: ${err instanceof Error ? err.message : String(err)}`,
                  });
                });
            }}
            onImport={handleImport}
            onNodeChange={(patch) => {
              if (selectedNodeId) {
                updateMap(
                  (m) => updateNode(m, selectedNodeId, patch),
                  `node:${selectedNodeId}:${Object.keys(patch).join(',')}`,
                );
              }
            }}
            onRecordWalkthrough={() => {
              setWalkthroughOpen(true);
            }}
            onOpenRecognitionModel={() => {
              setModelOpen(true);
            }}
            onOpenRecognitionQuality={() => {
              setQualityOpen(true);
            }}
            onClearViews={() => {
              if (selectedNodeId && window.confirm('Remove all learned views of this location?')) {
                updateMap((m) => setEmbeddings(m, selectedNodeId, []));
              }
            }}
            onDeleteNode={() => {
              if (selectedNodeId) updateMap((m) => deleteNode(m, selectedNodeId));
              setSelectedNodeId(null);
            }}
            onDeselect={() => {
              setSelectedNodeId(null);
            }}
            measureLine={measure}
            onApplyMeasure={applyMeasuredScale}
            onClearMeasure={() => {
              setMeasure([]);
            }}
            mapSourceUrl={library.maps.find((m) => m.id === activeMapId)?.sourceUrl}
            mapId={activeMapId}
            onFindNode={(id) => {
              const node = map.nodes[id];
              if (!node) return;
              changeTool('select');
              setSelectedNodeId(id);
              setMapFocus((f) => ({ point: { x: node.x, y: node.y }, seq: (f?.seq ?? 0) + 1 }));
            }}
          />
        )}

        <main className="relative flex flex-1 flex-col overflow-hidden">
          {mode === 'ar' ? (
            <Suspense fallback={<FullScreenMessage>Starting AR…</FullScreenMessage>}>
              <ARCanvas
                map={map}
                route={route}
                destinationLabel={destinationNode?.label ?? null}
                orientation={orientation}
                steps={pdr.steps}
                onEnableSensors={enableSensors}
              />
            </Suspense>
          ) : (
            <InteractiveMap
              key={activeMapId}
              map={map}
              route={mode === 'user' ? route : null}
              currentLocation={currentLocation}
              destination={mode === 'user' ? destination : null}
              userHeadingDeg={orientation.absolute ? userHeading : null}
              isEditor={mode === 'editor'}
              tool={tool}
              selectedNodeId={mode === 'editor' ? (linkFromId ?? selectedNodeId) : null}
              onNodeTap={handleNodeTap}
              onRoomTap={handleUserPick}
              onCanvasTap={handleCanvasTap}
              onNodeDrag={(id, point) => {
                updateMap((m) => moveNode(m, id, point), `move:${id}`);
              }}
              focus={mode === 'editor' ? mapFocus : null}
              pickingLocation={picking}
              mapRotation={mapRotation}
              onMapRotationChange={setMapRotation}
              measureLine={mode === 'editor' && tool === 'measure' ? measure : undefined}
              onBendInsert={(edgeIndex, segmentIndex, point) => {
                updateMap((m) => insertBend(m, edgeIndex, segmentIndex, point));
              }}
              onBendDrag={(edgeIndex, bendIndex, point) => {
                updateMap((m) => moveBend(m, edgeIndex, bendIndex, point), `bend:${edgeIndex}:${bendIndex}`);
              }}
              onEdgeTap={(edgeIndex) => {
                updateMap((m) => deleteEdge(m, edgeIndex));
              }}
              onBendTap={(edgeIndex, bendIndex) => {
                updateMap((m) => deleteBend(m, edgeIndex, bendIndex));
              }}
            />
          )}

          {picking && (
            <div className="absolute inset-x-3 top-3 z-10 mx-auto max-w-md rounded-2xl border-2 border-brand-500 bg-white/95 p-3 shadow-xl ring-4 ring-brand-500/20 backdrop-blur-md motion-safe:animate-panel-in dark:bg-slate-900/95">
              <div className="mb-2 flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">
                  <MapPin className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900 dark:text-white">Where are you?</p>
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Search below or tap a place on the map.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Cancel choosing location"
                  onClick={() => {
                    setPickingLocation(false);
                  }}
                  className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white"
                >
                  <X className="size-4.5" />
                </button>
              </div>
              <LocationSearch
                map={map}
                mapId={activeMapId}
                placeholder="Where are you now?"
                onPick={handleUserPick}
              />
            </div>
          )}

          {mode === 'user' && !picking && destinationNode && (
            <div className="absolute inset-x-3 top-3 z-10 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/95">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                  <Target className="size-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Navigate to</p>
                  <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
                    {destinationNode.label}
                  </p>
                  {!currentLocation && (
                    <p className="text-[11px] text-amber-600">
                      {handheld ? 'Scan to set your location' : 'Tap “I’m here” to set your location'}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <span className="rounded-full border border-brand-100 bg-brand-50 px-2.5 py-1 text-xs font-bold whitespace-nowrap text-brand-700 dark:border-brand-900 dark:bg-brand-900/40 dark:text-brand-300">
                  {route ? formatDistance(route.progress.remainingM) : currentLocation ? 'No route' : '—'}
                </span>
                <button
                  type="button"
                  aria-label="Clear destination"
                  onClick={() => {
                    navigateTo(null);
                  }}
                  className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white"
                >
                  <X className="size-4.5" />
                </button>
              </div>
            </div>
          )}

          {mode === 'user' && !picking && !destinationNode && Object.keys(map.nodes).length > 0 && (
            <div className="absolute inset-x-3 top-3 z-10 mx-auto max-w-md rounded-2xl bg-white/90 p-2 shadow-lg backdrop-blur-md dark:bg-slate-900/90">
              <LocationSearch
                map={map}
                mapId={activeMapId}
                placeholder="Where do you want to go?"
                onPick={navigateTo}
              />
              <p className="mt-1.5 text-center text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Or tap a room or location on the map.
              </p>
            </div>
          )}

          {mode === 'user' && Object.keys(map.nodes).length === 0 && (
            <p className="absolute inset-x-3 top-3 z-10 mx-auto max-w-md rounded-2xl bg-amber-50 p-3 text-center text-xs font-medium text-amber-800 shadow-lg dark:bg-amber-950 dark:text-amber-200">
              This map is empty. Open the Editor to add locations and corridors.
            </p>
          )}
        </main>
      </div>

      {mode !== 'editor' && (
        <NavigationBar
          mode={mode}
          onModeChange={changeMode}
          onScan={() => {
            setScannerOpen(true);
          }}
          locating={picking}
          canSetLocation={Object.keys(map.nodes).length > 0}
          showCameraTools={handheld}
          onSetLocation={() => {
            setPickingLocation((p) => !p);
          }}
        />
      )}

      <Suspense fallback={null}>
        {scannerOpen && (
          <VisionScannerModal
            onClose={() => {
              setScannerOpen(false);
            }}
            map={map}
            onDetected={relocate}
            lastFix={lastFix}
            walk={walkEstimate}
            heading={orientation.absolute ? orientation.heading : null}
          />
        )}
        {walkthroughOpen && selectedNode && (
          <WalkthroughModal
            key={selectedNode.id}
            node={selectedNode}
            modelId={resolveEmbeddingModel(map.metadata.embeddingModel).id}
            onClose={() => {
              setWalkthroughOpen(false);
            }}
            onSave={(id, samples) => {
              updateMap((m) => setEmbeddings(m, id, samples));
            }}
          />
        )}
        {versionOpen && (
          <VersionModal
            map={map}
            onClose={() => {
              setVersionOpen(false);
            }}
          />
        )}
        {modelOpen && (
          <RecognitionModelModal
            map={map}
            onClose={() => {
              setModelOpen(false);
            }}
            onApply={(model, views) => {
              updateMap((m) => withEmbeddingModel(m, model, views));
              setNotice({
                tone: 'info',
                text: `Recognition model switched to ${resolveEmbeddingModel(model).label}.`,
              });
            }}
          />
        )}
        {qualityOpen && (
          <RecognitionQualityModal
            map={map}
            onClose={() => {
              setQualityOpen(false);
            }}
            onPickNode={(id) => {
              const node = map.nodes[id];
              if (!node) return;
              setQualityOpen(false);
              changeTool('select');
              setSelectedNodeId(id);
              setMapFocus((f) => ({ point: { x: node.x, y: node.y }, seq: (f?.seq ?? 0) + 1 }));
            }}
          />
        )}
        {p2pRole && (
          <P2PTransferModal
            role={p2pRole}
            map={map}
            onReceived={library.importMap}
            onClose={() => {
              setP2PRole(null);
            }}
          />
        )}
      </Suspense>

      <Modal
        open={shareLinkOpen}
        onClose={() => {
          setShareLinkOpen(false);
        }}
        title="Link & QR code"
        subtitle="Anyone who opens the link or scans the code gets this map"
      >
        <ShareLinkSection initialUrl={library.maps.find((m) => m.id === activeMapId)?.sourceUrl ?? ''} />
      </Modal>

      <MapManagerModal
        open={managerOpen}
        onClose={() => {
          setManagerOpen(false);
        }}
        maps={library.maps}
        activeMapId={activeMapId}
        onSwitch={(id) => void library.switchMap(id)}
        onCreate={library.createMap}
        onDuplicateActive={library.duplicateActive}
        onRename={library.renameMap}
        onDelete={library.deleteMap}
        onImport={handleImport}
        onSendNearby={() => {
          setP2PRole('send');
        }}
        onReceiveNearby={() => {
          setP2PRole('receive');
        }}
      />

      <CloudSettingsModal
        open={cloudOpen}
        onClose={() => {
          setCloudOpen(false);
        }}
        cloud={cloud}
      />
      <Toast message={errorText ? { tone: 'error', text: errorText } : notice} />
      <ConflictModal
        conflict={cloud.conflict}
        onResolve={(choice) => void cloud.resolveConflict(choice)}
        onClose={cloud.dismissConflict}
      />
    </div>
  );
}
