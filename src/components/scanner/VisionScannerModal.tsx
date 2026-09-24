import { Loader2, QrCode, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CAMERA_STATUS_TEXT, useCamera } from '../../hooks/useCamera';
import { useTensorFlow } from '../../hooks/useTensorFlow';
import {
  EMBEDDING_SIZE,
  findNodeByCode,
  isFrameReady,
  isTrained,
  rankMatches,
} from '../../services/visionMatcher';
import type { MapData } from '../../types/map';
import type { MatchResult } from '../../types/vision';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { MatchResultsList } from './MatchResultsList';

interface VisionScannerModalProps {
  onClose: () => void;
  map: MapData;
  onDetected: (nodeId: string) => void;
}

type Tab = 'visual' | 'code';

const SCAN_INTERVAL_MS = 700;
const MIN_SCORE = 30;
/** Score needed for automatic relocalization, and on how many consecutive frames. */
const AUTO_SCORE = 80;
const AUTO_FRAMES = 2;

/** Camera-based relocalization: markerless (MobileNet embeddings) or QR / barcode markers. */
export default function VisionScannerModal({ onClose, map, onDetected }: VisionScannerModalProps) {
  const [tab, setTab] = useState<Tab>('visual');
  const [results, setResults] = useState<MatchResult[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const { videoRef, status: cameraStatus, retry } = useCamera(true);
  const { status: modelStatus, engine, load, embed } = useTensorFlow();

  const trainedNodes = useMemo(() => Object.values(map.nodes).filter(isTrained), [map.nodes]);
  const hasMobileNetSamples = useMemo(
    () => trainedNodes.some((n) => n.embeddings.some((s) => s.vector.length === EMBEDDING_SIZE)),
    [trainedNodes],
  );
  const barcodeSupported = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  // Latest values for the scan loop, which must not restart on every render.
  const latest = useRef({ map, onDetected, onClose, tab, embed });
  useEffect(() => {
    latest.current = { map, onDetected, onClose, tab, embed };
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

    const timer = setInterval(() => {
      const video = videoRef.current;
      if (busy || detectedRef.current || !isFrameReady(video)) return;
      busy = true;
      const { map: currentMap, tab: currentTab, embed } = latest.current;

      const scan = async () => {
        if (currentTab === 'visual') {
          const { vector } = await embed(video);
          const ranked = rankMatches(vector, currentMap.nodes, { minScore: MIN_SCORE, limit: 4 });
          setResults(ranked);
          const top = ranked[0];
          if (top && top.score >= AUTO_SCORE) {
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

  return (
    <Modal open onClose={onClose} title="Where am I?" tone="dark" headerExtra={tabs}>
      <div className="relative flex aspect-[4/3] max-h-[45dvh] w-full items-center justify-center overflow-hidden bg-black">
        <video ref={videoRef} autoPlay playsInline muted className="size-full object-cover" />

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
                  {engine === 'mobilenet' ? 'MobileNet v2 embeddings' : 'Colour descriptor (fallback)'}
                </>
              )}
            </span>
            <div className="grid h-2/3 w-2/3 grid-cols-3 grid-rows-3 self-center rounded-2xl border border-cyan-400/50 bg-cyan-500/5">
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

        <label className="flex items-center justify-between gap-3 border-t border-slate-800 pt-3 text-xs text-slate-400">
          <span>Or pick your location</span>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) pickManually(e.target.value);
            }}
            className="max-w-48 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white"
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
      </div>
    </Modal>
  );
}
