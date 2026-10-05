import { useEffect, useRef, useState } from 'react';
import { embedStoredFrame, loadMobileNet } from '../../hooks/useTensorFlow';
import {
  EMBEDDING_MODEL_IDS,
  EMBEDDING_MODELS,
  resolveEmbeddingModel,
  type EmbeddingModelId,
} from '../../services/embeddingModels';
import { planModelSwitch, recomputeViews } from '../../services/modelSwitch';
import type { MapData } from '../../types/map';
import type { EmbeddingSample } from '../../types/vision';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

interface RecognitionModelModalProps {
  map: MapData;
  onClose: () => void;
  /** Receives the chosen model and the views recomputed by it, per node id. */
  onApply: (model: EmbeddingModelId, views: Record<string, EmbeddingSample[]>) => void;
}

/**
 * Chooses the model that turns camera frames into vectors for this map. A learned view keeps the frame
 * it was computed from, so switching recomputes the vectors on this device without scanning again. The
 * vectors of the model left behind stay saved with the view, so switching back costs nothing.
 */
export default function RecognitionModelModal({ map, onClose, onApply }: RecognitionModelModalProps) {
  const current = resolveEmbeddingModel(map.metadata.embeddingModel).id;
  const [chosen, setChosen] = useState<EmbeddingModelId>(current);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const plan = planModelSwitch(map.nodes, chosen);
  const toCompute = plan.recomputable - plan.cached;
  const working = progress !== null;
  const changed = chosen !== current;

  const apply = async () => {
    setError(null);
    setProgress(0);
    try {
      // With every view cached the model is not needed at all, so skip its download.
      if (toCompute > 0 && !(await loadMobileNet(chosen)))
        throw new Error('The model could not be loaded. Check the connection.');
      const views = await recomputeViews(map.nodes, embedStoredFrame, {
        from: current,
        to: chosen,
        onProgress: setProgress,
        isCancelled: () => cancelled.current,
      });
      if (!views) return;
      onApply(chosen, views);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress(null);
    }
  };

  return (
    <Modal
      open
      onClose={working ? () => undefined : onClose}
      title="Recognition model"
      subtitle={map.metadata.name}
    >
      <div className="space-y-4 p-4 text-sm">
        <fieldset className="space-y-2" disabled={working}>
          {EMBEDDING_MODEL_IDS.map((id) => {
            const model = EMBEDDING_MODELS[id];
            return (
              <label
                key={id}
                className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700"
              >
                <input
                  type="radio"
                  name="embedding-model"
                  className="mt-0.5"
                  checked={chosen === id}
                  onChange={() => {
                    setChosen(id);
                  }}
                />
                <span className="text-xs">
                  <b>{model.label}</b>
                  {id === current && <span className="text-slate-500"> (in use)</span>}
                  <span className="block text-slate-500">
                    {model.description} Download about {model.sizeMb} MB on first use.
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        {changed && plan.recomputable + plan.removed > 0 && (
          <p className="rounded-xl bg-slate-100 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {toCompute} view{toCompute === 1 ? '' : 's'} will be recomputed from the stored frames on this
            device
            {plan.cached > 0 && `; ${plan.cached} already have vectors of this model saved and are reused`}.
            {plan.removed > 0 && (
              <b className="text-red-600">
                {' '}
                {plan.removed} older view{plan.removed === 1 ? ' has' : 's have'} no stored frame and will be
                removed. Record {plan.removed === 1 ? 'it' : 'them'} again.
              </b>
            )}
          </p>
        )}

        {working && (
          <div role="status" className="space-y-1">
            <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-full bg-brand-500" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="text-center text-[11px] text-slate-500">
              {progress === 0 ? 'Loading the model…' : `Recomputing views… ${Math.round(progress * 100)} %`}
            </p>
          </div>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}

        <p className="text-[11px] text-slate-500">
          Other devices pick up the change when the map is published and pulled. Check the result with
          Recognition quality.
        </p>

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" disabled={working} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!changed || working} onClick={() => void apply()}>
            Switch model
          </Button>
        </div>
      </div>
    </Modal>
  );
}
