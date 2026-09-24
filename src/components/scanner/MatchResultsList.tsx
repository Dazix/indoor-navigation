import { MapPin } from 'lucide-react';
import type { MatchResult } from '../../types/vision';

interface MatchResultsListProps {
  results: MatchResult[];
  onPick: (nodeId: string) => void;
}

function barColor(score: number): string {
  if (score >= 75) return 'bg-emerald-400';
  if (score >= 50) return 'bg-amber-400';
  return 'bg-slate-500';
}

/** Live ranking of places that look most like the current camera frame. */
export function MatchResultsList({ results, onPick }: MatchResultsListProps) {
  if (results.length === 0) {
    return <p className="py-3 text-center text-xs text-slate-400">Point the camera around the room…</p>;
  }

  return (
    <ul className="space-y-1.5" aria-live="polite">
      {results.map(({ node, score, thumbnail }) => (
        <li key={node.id}>
          <button
            type="button"
            onClick={() => {
              onPick(node.id);
            }}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-800/80 p-2 text-left transition-colors hover:border-brand-500/60 hover:bg-brand-900/40"
          >
            <span className="flex min-w-0 items-center gap-2">
              {thumbnail ? (
                <img src={thumbnail} alt="" className="size-9 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-700">
                  <MapPin className="size-4 text-slate-300" />
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold text-white">{node.label}</span>
                <span className="text-[10px] text-slate-400">{node.embeddings.length} learned views</span>
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2 w-16 overflow-hidden rounded-full bg-slate-700">
                <span
                  className={`block h-full rounded-full ${barColor(score)}`}
                  style={{ width: `${score}%` }}
                />
              </span>
              <span className="w-9 text-right font-mono text-xs font-bold text-brand-300">{score}%</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
