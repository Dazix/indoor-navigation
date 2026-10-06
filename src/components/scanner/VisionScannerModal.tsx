import { Loader2, QrCode, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CAMERA_STATUS_TEXT, WIDE_CONSTRAINTS, useCamera } from '../../hooks/useCamera';
import { CameraControls } from './CameraControls';
import { useTensorFlow } from '../../hooks/useTensorFlow';
import {
  AUTO_MATCH,
  EMBEDDING_SIZE,
  findNodeByCode,
  isFrameReady,
  isTrained,
  meanEmbedding,
  meanTileEmbeddings,
  rankMatches,
} from '../../services/visionMatcher';
import { resolveEmbeddingModel } from '../../services/embeddingModels';
import { rankProjected, trainLda } from '../../services/ldaProjection';
import {
  AUTO_CONFIDENT,
  buildFilterModel,
  initialBelief,
  pickConfidentMatch,
  predictBelief,
  rankBelief,
  updateBelief,
} from '../../services/positionFilter';
import { proximityBoosts, type LocationFix, type WalkEstimate } from '../../services/locationPrior';
import type { MapData } from '../../types/map';
import type { MatchResult } from '../../types/vision';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { MatchResultsList } from './MatchResultsList';

interface VisionScannerModalProps {
  onClose: () => void;
  map: MapData;
  onDetected: (nodeId: string) => void;
  /** Last confirmed location; nearby places get a ranking bonus while it is fresh. */
  lastFix: LocationFix | null;
  /** Walk since the last fix from the step counter, or null when it is unavailable. */
  walk: WalkEstimate | null;
  /** Compass heading of the camera, or null without an absolute compass; used to weight views by direction. */
  heading: number | null;
}

type Tab = 'visual' | 'code';

const SCAN_INTERVAL_MS = 700;
/** Frames the position filter has seen before it may warn that several places look alike. */
const MIN_FRAMES = 3;
const RESULT_COUNT = 4;
/** On how many consecutive frames the same place must pass `AUTO_CONFIDENT` for automatic relocalization. */
const AUTO_FRAMES = 2;

/** Camera-based relocalization: markerless (MobileNet embeddings) or QR / barcode markers. */
export default function VisionScannerModal({
  onClose,
  map,
  onDetected,
  lastFix,
  walk,
  heading,
}: VisionScannerModalProps) {
  const [tab, setTab] = useState<Tab>('visual');
  const [results, setResults] = useState<MatchResult[]>([]);
  const [ambiguous, setAmbiguous] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const {
    videoRef,
    status: cameraStatus,
    retry,
    devices,
    currentDeviceId,
    selectDevice,
    zoom,
    setZoom,
  } = useCamera(true, WIDE_CONSTRAINTS);
  const modelId = resolveEmbeddingModel(map.metadata.embeddingModel).id;
  const { status: modelStatus, engine, load, embed } = useTensorFlow(modelId);

  const trainedNodes = useMemo(() => Object.values(map.nodes).filter(isTrained), [map.nodes]);
  const hasMobileNetSamples = useMemo(
    () => trainedNodes.some((n) => n.embeddings.some((s) => s.vector.length === EMBEDDING_SIZE)),
    [trainedNodes],
  );
  const barcodeSupported = typeof window !== 'undefined' && 'BarcodeDetector' in window;
  // Removing what all views of the map share lets places in a uniform room be told apart.
  const center = useMemo(() => meanEmbedding(map.nodes), [map.nodes]);
  const tileCenters = useMemo(() => meanTileEmbeddings(map.nodes), [map.nodes]);
  // Projection that keeps what tells the places apart; null when the views do not allow training one.
  const lda = useMemo(() => trainLda(map.nodes), [map.nodes]);
  const filterModel = useMemo(
    () =>
      buildFilterModel(
        map,
        trainedNodes.map((n) => n.id),
      ),
    [map, trainedNodes],
  );

  // Latest values for the scan loop, which must not restart on every render.
  const latest = useRef({
    map,
    onDetected,
    onClose,
    tab,
    embed,
    lastFix,
    center,
    tileCenters,
    lda,
    filterModel,
    heading,
    walk,
  });
  useEffect(() => {
    latest.current = {
      map,
      onDetected,
      onClose,
      tab,
      embed,
      lastFix,
      center,
      tileCenters,
      lda,
      filterModel,
      heading,
      walk,
    };
  });

  const detectedRef = useRef(false);

  useEffect(() => {
    void load();
  }, [load]);

  const confirm = (nodeId: string, text: string) => {
    if (detectedRef.current) return;
    detectedRef.current = true;
    setMessage(text);
    setTimeout(() => {
      latest.current.onDetected(nodeId);
      latest.current.onClose();
    }, 600);
  };
  const confirmRef = useRef(confirm);
  useEffect(() => {
    confirmRef.current = confirm;
  });

  useEffect(() => {
    if (cameraStatus !== 'ready') return;
    const detector = window.BarcodeDetector
      ? new window.BarcodeDetector({ formats: ['qr_code', 'code_128', 'data_matrix', 'ean_13'] })
      : null;
    let busy = false;
    let streak: { id: string; frames: number } | null = null;
    // Position filter state: the belief per trained place, rebuilt when the places change.
    let filter: { model: ReturnType<typeof buildFilterModel>; belief: number[]; frames: number } | null =
      null;
    // Walked distance since the fix at the previous frame; null without a step counter.
    let lastWalkedM: number | null = null;

    const timer = setInterval(() => {
      const video = videoRef.current;
      if (busy || detectedRef.current || !isFrameReady(video)) return;
      busy = true;
      const {
        map: currentMap,
        tab: currentTab,
        embed,
        lastFix: fix,
        center: mean,
        tileCenters: tileMeans,
        lda: projection,
        filterModel: model,
        heading: liveHeading,
        walk: liveWalk,
      } = latest.current;

      const scan = async () => {
        if (currentTab === 'visual') {
          const { vector, tiles } = await embed(video);
          const frame =
            (projection && rankProjected(projection, vector, tiles, currentMap.nodes, liveHeading)) ||
            rankMatches(vector, currentMap.nodes, {
              center: mean,
              tiles,
              tileCenters: tileMeans,
              heading: liveHeading,
            });
          // One frame of a uniform room can jump to a look-alike place, so the frames are not judged
          // one by one: the filter accumulates their evidence and moves it along with the walk.
          const walkedM = liveWalk?.distanceM ?? null;
          const similarities = model.ids.map(
            (id) => (frame.find((result) => result.node.id === id)?.score ?? 0) / 100,
          );
          if (filter?.model !== model) {
            filter = {
              model,
              belief: initialBelief(model, proximityBoosts(currentMap, fix, Date.now(), liveWalk)),
              frames: 0,
            };
          } else {
            // The step count restarts at every fix, so a drop means a new leg, not walking backwards.
            const stepM =
              walkedM !== null && lastWalkedM !== null ? Math.max(0, walkedM - lastWalkedM) : null;
            filter.belief = predictBelief(model, filter.belief, stepM);
          }
          lastWalkedM = walkedM;
          filter.belief = updateBelief(filter.belief, similarities);
          filter.frames++;
          const ranked = rankBelief(model, filter.belief, currentMap.nodes, frame, RESULT_COUNT);
          setResults(ranked);
          const top = filter.frames < MIN_FRAMES ? null : pickConfidentMatch(ranked, AUTO_CONFIDENT);
          // Strong match that similar-looking places compete with: let the user choose.
          setAmbiguous(!top && filter.frames >= MIN_FRAMES && (ranked[0]?.score ?? 0) >= AUTO_MATCH.minScore);
          if (top) {
            streak =
              streak?.id === top.node.id
                ? { id: top.node.id, frames: streak.frames + 1 }
                : { id: top.node.id, frames: 1 };
            if (streak.frames >= AUTO_FRAMES)
              confirmRef.current(top.node.id, `Recognized: ${top.node.label} (${top.score}%)`);
          } else {
            streak = null;
          }
        } else if (detector) {
          const codes = await detector.detect(video);
          for (const code of codes) {
            const node = findNodeByCode(currentMap.nodes, code.rawValue);
            if (node) {
              confirmRef.current(node.id, `Marker found: ${node.label}`);
              break;
            }
            setMessage(`Code "${code.rawValue}" is not on this map.`);
          }
        }
      };

      scan()
        .catch((err: unknown) => {
          console.warn('Scan failed', err);
        })
        .finally(() => {
          busy = false;
        });
    }, SCAN_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [cameraStatus, videoRef]);

  const submitCode = () => {
    const node = findNodeByCode(map.nodes, manualCode);
    if (node) confirm(node.id, `Location set: ${node.label}`);
    else setMessage(`Code "${manualCode}" is not on this map.`);
  };

  const pickManually = (nodeId: string) => {
    onDetected(nodeId);
    onClose();
  };

  const tabs = (
    <div className="flex gap-1 rounded-xl bg-slate-800 p-0.5 text-xs font-semibold" role="tablist">
      {(
        [
          ['visual', 'Visual AI', <Sparkles key="i" className="size-3.5" />],
          ['code', 'QR / Code', <QrCode key="i" className="size-3.5" />],
        ] as const
      ).map(([id, label, icon]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          onClick={() => {
            setTab(id);
            setMessage(null);
          }}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-colors ${
            tab === id ? 'bg-brand-600 text-white shadow' : 'text-slate-400 hover:text-white'
          }`}
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  );

  const manualPicker = (
    <label className="flex w-full items-center justify-between gap-3 text-xs text-slate-400">
      <span className="shrink-0">Or pick your location</span>
      <select
        value=""
        onChange={(e) => {
          if (e.target.value) pickManually(e.target.value);
        }}
        className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white"
      >
        <option value="">Choose…</option>
        {Object.values(map.nodes)
          .sort((a, b) => a.label.localeCompare(b.label))
          .map((n) => (
            <option key={n.id} value={n.id}>
              {n.label}
            </option>
          ))}
      </select>
    </label>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title="Where am I?"
      tone="dark"
      headerExtra={tabs}
      fullHeight
      footer={manualPicker}
    >
      <div className="sticky top-0 z-10 flex h-[clamp(11rem,32dvh,20rem)] w-full items-center justify-center overflow-hidden bg-black">
        <video ref={videoRef} autoPlay playsInline muted className="size-full object-contain" />
        <CameraControls
          devices={devices}
          currentDeviceId={currentDeviceId}
          onSelectDevice={selectDevice}
          zoom={zoom}
          onZoom={setZoom}
        />

        {cameraStatus !== 'ready' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-300">
            {cameraStatus === 'starting' ? <Loader2 className="size-6 animate-spin" /> : null}
            <p>{CAMERA_STATUS_TEXT[cameraStatus]}</p>
            {(cameraStatus === 'denied' || cameraStatus === 'unavailable') && (
              <Button variant="secondary" size="sm" onClick={retry}>
                Try again
              </Button>
            )}
          </div>
        )}

        {cameraStatus === 'ready' && tab === 'visual' && (
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
            <span className="flex items-center gap-1.5 self-start rounded-full bg-black/60 px-2.5 py-1 font-mono text-[10px] text-brand-300 backdrop-blur-sm">
              {modelStatus === 'loading' ? (
                <>
                  <Loader2 className="size-3 animate-spin" /> Loading AI model…
                </>
              ) : (
                <>
                  <span className="size-2 animate-pulse rounded-full bg-cyan-400" />
                  {engine === 'mobilenet'
                    ? resolveEmbeddingModel(modelId).label
                    : 'Colour descriptor (fallback)'}
                </>
              )}
            </span>
            <div className="grid aspect-[224/298] h-3/4 grid-cols-3 grid-rows-3 self-center rounded-2xl border border-cyan-400/50 bg-cyan-500/5">
              {Array.from({ length: 9 }, (_, i) => (
                <div key={i} className="border border-cyan-400/15" />
              ))}
            </div>
            <span className="h-4" />
          </div>
        )}

        {cameraStatus === 'ready' && tab === 'code' && (
          <div className="pointer-events-none absolute inset-8 flex flex-col rounded-2xl border-2 border-brand-400/70 p-2">
            <div className="h-0.5 w-full animate-pulse bg-brand-500 shadow-[0_0_10px_#6366f1]" />
          </div>
        )}

        {message && (
          <p className="absolute inset-x-3 bottom-3 rounded-xl bg-black/70 px-3 py-1.5 text-center text-xs text-white backdrop-blur-md">
            {message}
          </p>
        )}
      </div>

      <div className="space-y-3 p-4 text-white">
        {tab === 'visual' ? (
          <section>
            <h3 className="mb-2 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
              Best matches · {trainedNodes.length} trained places
            </h3>
            {trainedNodes.length === 0 ? (
              <p className="rounded-xl border border-slate-700 bg-slate-800/80 p-3 text-center text-xs text-slate-400">
                No place has been trained yet. In the Editor, select a location and record a walkthrough.
              </p>
            ) : (
              <>
                {engine === 'mobilenet' && !hasMobileNetSamples && (
                  <p className="mb-2 rounded-xl bg-amber-500/15 p-2 text-xs text-amber-300">
                    Views on this map were recorded without the AI model. Record the walkthroughs again for
                    accurate matching.
                  </p>
                )}
                {ambiguous && (
                  <p className="mb-2 rounded-xl bg-amber-500/15 p-2 text-xs text-amber-300">
                    Several places look alike. Pick yours below, or scan its QR code.
                  </p>
                )}
                <MatchResultsList results={results} onPick={pickManually} />
              </>
            )}
          </section>
        ) : (
          <section className="space-y-2">
            {!barcodeSupported && (
              <p className="text-xs text-slate-400">
                This browser cannot read QR codes from the camera. Type the code printed on the marker
                instead.
              </p>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                submitCode();
              }}
            >
              <input
                type="text"
                value={manualCode}
                onChange={(e) => {
                  setManualCode(e.target.value);
                }}
                placeholder="e.g. LOC-KITCHEN"
                aria-label="Marker code"
                autoCapitalize="characters"
                className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
              />
              <Button type="submit" size="md" disabled={!manualCode.trim()}>
                Confirm
              </Button>
            </form>
          </section>
        )}
      </div>
    </Modal>
  );
}
