import { Camera, Loader2, Pause, Trash2, Video } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CAMERA_STATUS_TEXT, useCamera } from '../../hooks/useCamera';
import { useTensorFlow } from '../../hooks/useTensorFlow';
import { captureThumbnail, isFrameReady } from '../../services/visionMatcher';
import type { MapNode } from '../../types/map';
import type { EmbeddingSample } from '../../types/vision';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

interface WalkthroughModalProps {
  node: MapNode;
  onClose: () => void;
  onSave: (nodeId: string, samples: EmbeddingSample[]) => void;
}

const SAMPLE_INTERVAL_MS = 1200;
/** Keeps a place's footprint in storage and exports reasonable (~3 kB per sample). */
export const MAX_SAMPLES = 60;

function sampleId(): string {
  return `emb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Walkthrough learning: while the user walks slowly through a place, a keyframe is sampled
 * every 1.2 s and stored as an embedding with a thumbnail. Mount with `key={node.id}`.
 */
export default function WalkthroughModal({ node, onClose, onSave }: WalkthroughModalProps) {
  const [samples, setSamples] = useState<EmbeddingSample[]>(node.embeddings);
  const [recording, setRecording] = useState(false);
  const { videoRef, status: cameraStatus, retry } = useCamera(true);
  const { status: modelStatus, engine, load, embed } = useTensorFlow();
  const busy = useRef(false);

  useEffect(() => {
    void load();
  }, [load]);

  const full = samples.length >= MAX_SAMPLES;
  const modelLoading = modelStatus === 'loading' || modelStatus === 'idle';

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (busy.current || !isFrameReady(video)) return;
    busy.current = true;
    try {
      const thumbnail = captureThumbnail(video);
      const { vector } = await embed(video);
      setSamples((prev) =>
        prev.length >= MAX_SAMPLES
          ? prev
          : [...prev, { id: sampleId(), thumbnail, vector, timestamp: Date.now() }],
      );
    } finally {
      busy.current = false;
    }
  }, [embed, videoRef]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => void capture(), SAMPLE_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [recording, capture]);

  // Stop automatically when the per-place limit is reached.
  if (recording && full) setRecording(false);

  const statusText = recording
    ? 'Recording… walk slowly and turn the phone to cover the whole place.'
    : full
      ? `Limit of ${MAX_SAMPLES} views reached. Remove some to add new ones.`
      : 'Hold the phone at eye level and start recording.';

  return (
    <Modal
      open
      onClose={onClose}
      tone="dark"
      size="lg"
      title={`Walkthrough learning: ${node.label}`}
      subtitle={
        modelLoading
          ? 'Loading AI model…'
          : engine === 'mobilenet'
            ? 'MobileNet v2 embeddings'
            : 'Colour descriptor (fallback)'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="success"
            onClick={() => {
              onSave(node.id, samples);
              onClose();
            }}
          >
            Save {samples.length} views
          </Button>
        </>
      }
    >
      <div className="relative flex aspect-[4/3] max-h-[40dvh] w-full items-center justify-center overflow-hidden bg-black">
        <video ref={videoRef} autoPlay playsInline muted className="size-full object-cover" />
        {cameraStatus !== 'ready' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-300">
            {cameraStatus === 'starting' && <Loader2 className="size-6 animate-spin" />}
            <p>{CAMERA_STATUS_TEXT[cameraStatus]}</p>
            {(cameraStatus === 'denied' || cameraStatus === 'unavailable') && (
              <Button variant="secondary" size="sm" onClick={retry}>
                Try again
              </Button>
            )}
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
            <div className="flex items-center justify-between">
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold backdrop-blur-md ${
                  recording ? 'animate-pulse bg-red-500/85 text-white' : 'bg-slate-800/80 text-slate-300'
                }`}
              >
                {recording ? '● REC' : 'READY'}
              </span>
              <span className="rounded-md bg-black/60 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                {samples.length}/{MAX_SAMPLES}
              </span>
            </div>
            <p className="mx-auto rounded-xl bg-black/70 px-3 py-1 text-center text-[11px] text-white/95 backdrop-blur-md">
              {statusText}
            </p>
          </div>
        )}
      </div>

      <div className="flex gap-2 border-b border-slate-800 bg-slate-950 p-3">
        <Button
          variant={recording ? 'dark' : 'primary'}
          className={`flex-1 ${recording ? 'bg-amber-600! hover:bg-amber-500!' : ''}`}
          disabled={cameraStatus !== 'ready' || modelLoading || (full && !recording)}
          onClick={() => {
            setRecording((r) => !r);
          }}
          icon={recording ? <Pause className="size-4" /> : <Video className="size-4" />}
        >
          {recording ? 'Pause' : 'Start walkthrough'}
        </Button>
        <Button
          variant="dark"
          disabled={recording || cameraStatus !== 'ready' || modelLoading || full}
          onClick={() => void capture()}
          icon={<Camera className="size-4" />}
          title="Add a single view"
        >
          Snapshot
        </Button>
      </div>

      <section className="p-3">
        <h3 className="mb-2 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
          Recorded views ({samples.length})
        </h3>
        {samples.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-800 p-4 text-center text-xs text-slate-500">
            No views yet. Start the walkthrough and cover the desk, doors and windows of this place.
          </p>
        ) : (
          <ul className="grid grid-cols-4 gap-2 sm:grid-cols-5">
            {samples.map((sample, i) => (
              <li
                key={sample.id}
                className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-slate-700 bg-slate-800"
              >
                <img src={sample.thumbnail} alt={`View ${i + 1}`} className="size-full object-cover" />
                <span className="absolute bottom-0.5 left-1 rounded bg-black/60 px-1 font-mono text-[9px] text-white/90">
                  #{i + 1}
                </span>
                <button
                  type="button"
                  aria-label={`Remove view ${i + 1}`}
                  onClick={() => {
                    setSamples((prev) => prev.filter((s) => s.id !== sample.id));
                  }}
                  className="absolute top-1 right-1 rounded-md bg-red-600/85 p-1 text-white opacity-100 transition-opacity hover:bg-red-600 sm:opacity-0 sm:group-hover:opacity-100"
                >
                  <Trash2 className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Modal>
  );
}
