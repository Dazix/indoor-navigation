import { Trash2, Video, X } from 'lucide-react';
import type { MapNode } from '../../types/map';
import { Button } from '../ui/Button';

interface NodeDetailsCardProps {
  node: MapNode;
  onChange: (patch: Partial<Pick<MapNode, 'label' | 'markerCode'>>) => void;
  onRecord: () => void;
  onClearViews: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const input =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800';

/** Editable details of the selected waypoint and its learned visual memory. */
export function NodeDetailsCard({
  node,
  onChange,
  onRecord,
  onClearViews,
  onDelete,
  onClose,
}: NodeDetailsCardProps) {
  const views = node.embeddings.length;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-brand-200 bg-brand-50/80 p-3.5 dark:border-brand-900 dark:bg-brand-900/20">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold tracking-wider text-brand-900 uppercase dark:text-brand-300">
          Selected location
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Deselect"
          className="rounded p-1 text-slate-400 hover:text-slate-700"
        >
          <X className="size-4" />
        </button>
      </div>

      <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
        Name
        <input
          className={input}
          value={node.label}
          maxLength={120}
          onChange={(e) => {
            onChange({ label: e.target.value });
          }}
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
        Marker code (QR)
        <input
          className={`${input} font-mono uppercase`}
          value={node.markerCode}
          maxLength={120}
          onChange={(e) => {
            onChange({ markerCode: e.target.value.toUpperCase() });
          }}
        />
      </label>
      <p className="font-mono text-[10px] text-slate-500">
        x {node.x} · y {node.y} · id {node.id}
      </p>

      <div className="rounded-xl border border-brand-100 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">Visual memory</span>
          <span className="text-[11px] font-bold text-emerald-600">{views} views</span>
        </div>
        <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
          Walk through this place with the phone. The app remembers what it looks like so people can be
          located without QR codes.
        </p>
        {views > 0 && (
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
            {node.embeddings.slice(0, 8).map((s) => (
              <img
                key={s.id}
                src={s.thumbnail}
                alt=""
                className="h-8 w-10 shrink-0 rounded-md border border-brand-200 object-cover"
              />
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Button size="sm" fullWidth onClick={onRecord} icon={<Video className="size-3.5" />}>
            {views > 0 ? 'Record more' : 'Record walkthrough'}
          </Button>
          {views > 0 && (
            <Button size="sm" variant="secondary" onClick={onClearViews}>
              Clear
            </Button>
          )}
        </div>
      </div>

      <Button
        size="sm"
        variant="ghost"
        className="self-start text-red-600! hover:bg-red-500/10!"
        onClick={onDelete}
        icon={<Trash2 className="size-3.5" />}
      >
        Delete location
      </Button>
    </section>
  );
}
