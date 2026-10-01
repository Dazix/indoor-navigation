import { useEffect, useState } from 'react';
import { analyzeConfusabilityAsync, type ConfusabilityReport } from '../../services/confusability';
import { AUTO_MATCH } from '../../services/visionMatcher';
import type { MapData } from '../../types/map';
import { Modal } from '../ui/Modal';

interface RecognitionQualityModalProps {
  map: MapData;
  onClose: () => void;
  /** Selects a place on the map and closes the dialog. */
  onPickNode: (nodeId: string) => void;
}

/**
 * Shows how well the learned views tell the places apart: every view is held out in turn and
 * matched against the rest of the map. Places that get mixed up need a QR marker.
 */
export default function RecognitionQualityModal({ map, onClose, onPickNode }: RecognitionQualityModalProps) {
  const [centered, setCentered] = useState(true);
  const [done, setDone] = useState<{
    nodes: MapData['nodes'];
    centered: boolean;
    report: ConfusabilityReport;
  } | null>(null);

  // Hundreds of views take seconds to compare, so the work runs in slices and the dialog opens at once.
  useEffect(() => {
    let cancelled = false;
    void analyzeConfusabilityAsync(map.nodes, { centered }, { isCancelled: () => cancelled }).then(
      (report) => {
        if (report) setDone({ nodes: map.nodes, centered, report });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [map.nodes, centered]);

  const report = done?.nodes === map.nodes && done.centered === centered ? done.report : null;

  const label = (id: string) => map.nodes[id]?.label ?? id;
  const percent = Math.round((report?.accuracy ?? 0) * 100);
  const tone = percent >= 90 ? 'text-emerald-600' : percent >= 70 ? 'text-amber-600' : 'text-red-600';

  return (
    <Modal open onClose={onClose} title="Recognition quality" subtitle={map.metadata.name}>
      <div className="space-y-4 p-4 text-sm">
        {report === null ? (
          <p role="status" className="p-3 text-center text-xs text-slate-500">
            Comparing the views…
          </p>
        ) : report.total === 0 ? (
          <p className="rounded-xl bg-slate-100 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            Nothing to test yet. Record a walkthrough with at least two views for some places.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-slate-100 p-2 dark:bg-slate-800">
                <p className={`text-xl font-bold ${tone}`}>{percent} %</p>
                <p className="text-[11px] text-slate-500">recognised</p>
              </div>
              <div className="rounded-xl bg-slate-100 p-2 dark:bg-slate-800">
                <p className="text-xl font-bold">{Math.round(report.meanMargin)}</p>
                <p className="text-[11px] text-slate-500">avg. lead (pts)</p>
              </div>
              <div className="rounded-xl bg-slate-100 p-2 dark:bg-slate-800">
                <p className="text-xl font-bold">{report.total}</p>
                <p className="text-[11px] text-slate-500">views tested</p>
              </div>
            </div>

            <div className="rounded-xl bg-slate-100 p-3 text-xs dark:bg-slate-800">
              <p className="font-semibold">
                Scanner would confirm on its own (score ≥ {AUTO_MATCH.minScore}, lead ≥ {AUTO_MATCH.minMargin}
                )
              </p>
              <p className="mt-1 text-slate-600 dark:text-slate-300">
                <span className="text-emerald-600">{report.auto.right} right</span> ·{' '}
                <span className={report.auto.wrong > 0 ? 'text-red-600' : ''}>{report.auto.wrong} wrong</span>{' '}
                · {report.auto.asked} would ask you
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Wrong ones are the costly kind: raise the score or lead until they vanish. Many asked means
                the thresholds are too strict or the views too similar.
              </p>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={centered}
                onChange={(e) => {
                  setCentered(e.target.checked);
                }}
              />
              Remove what all views share (as the scanner does). Switch off to compare.
            </label>

            <section>
              <h3 className="mb-2 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                Places that get mixed up
              </h3>
              {report.confused.length === 0 ? (
                <p className="text-xs text-emerald-600">No place was mistaken for another.</p>
              ) : (
                <ul className="space-y-1">
                  {report.confused.map((pair) => (
                    <li key={`${pair.expectedId}>${pair.predictedId}`}>
                      <button
                        type="button"
                        onClick={() => {
                          onPickNode(pair.expectedId);
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span className="min-w-0 truncate">
                          <b>{label(pair.expectedId)}</b> looks like <b>{label(pair.predictedId)}</b>
                        </span>
                        <span className="shrink-0 text-slate-500">{pair.count}×</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {report.confused.length > 0 && (
                <p className="mt-2 text-[11px] text-slate-500">
                  Put a QR marker at these places, or record more views with different headings.
                </p>
              )}
            </section>
          </>
        )}

        {report && report.skippedNodes > 0 && (
          <p className="text-[11px] text-slate-500">
            {report.skippedNodes} place{report.skippedNodes === 1 ? ' has' : 's have'} only one view and{' '}
            {report.skippedNodes === 1 ? 'was' : 'were'} not tested.
          </p>
        )}
        <p className="text-[11px] text-slate-500">
          Neighbouring frames of one walkthrough look alike, so this is optimistic. A second walkthrough on
          another day is the fair test.
        </p>
      </div>
    </Modal>
  );
}
