import { Check, CircleHelp, Copy, QrCode as QrCodeIcon, Share2, Trash2, Video, X } from 'lucide-react';
import { useId, useState } from 'react';
import type { MapNode } from '../../types/map';
import { Button } from '../ui/Button';
import { QrCode } from '../ui/QrCode';

interface NodeDetailsCardProps {
  node: MapNode;
  onChange: (patch: Partial<Pick<MapNode, 'label' | 'markerCode'>>) => void;
  onRecord: () => void;
  onClearViews: () => void;
  onDelete: () => void;
  onClose: () => void;
  /** App URL that starts navigation to this location. */
  link: string;
  /** Whether the link also carries the map, so it works on any device. */
  linkHasMap: boolean;
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
  link,
  linkHasMap,
}: NodeDetailsCardProps) {
  const views = node.embeddings.length;
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [showMarkerHelp, setShowMarkerHelp] = useState(false);
  const markerHelpId = useId();
  // Another location selected: back to the plain link section.
  const [shownFor, setShownFor] = useState(node.id);
  if (shownFor !== node.id) {
    setShownFor(node.id);
    setCopied(false);
    setShowQr(false);
  }

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
        <span className="relative">
          <input
            className={`${input} pr-8 font-mono uppercase`}
            value={node.markerCode}
            maxLength={120}
            onChange={(e) => {
              onChange({ markerCode: e.target.value.toUpperCase() });
            }}
          />
          <button
            type="button"
            aria-label="What is the marker code?"
            aria-expanded={showMarkerHelp}
            aria-controls={markerHelpId}
            title="What is the marker code?"
            onClick={(e) => {
              e.preventDefault(); // do not focus the input through the label
              setShowMarkerHelp((v) => !v);
            }}
            className={`absolute top-1/2 right-1.5 -translate-y-1/2 rounded-full p-0.5 ${
              showMarkerHelp
                ? 'text-brand-600'
                : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            <CircleHelp className="size-4" />
          </button>
        </span>
      </label>
      {showMarkerHelp && (
        <p
          id={markerHelpId}
          className="-mt-1.5 rounded-lg bg-white p-2.5 text-[11px] leading-relaxed text-slate-600 dark:bg-slate-900 dark:text-slate-400"
        >
          Text printed as a QR or barcode and stuck up at this spot. Scanning it with the app’s scanner sets
          this location as where the user is standing, so the route starts from here. Any short code works,
          e.g. <span className="font-mono">KITCHEN</span>. The QR of the navigation link below works for this
          too.
        </p>
      )}
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

      <div className="rounded-xl border border-brand-100 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
        <span className="mb-1 block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
          Navigation link
        </span>
        <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
          Opening this link starts navigation to this location.
          {!linkHasMap &&
            ' It works on devices that already have this map; load the map from a share link to make it work everywhere.'}
        </p>
        <p className="mb-2 truncate rounded-md bg-slate-100 px-2 py-1 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
          {link}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            onClick={() => {
              void navigator.clipboard.writeText(link).then(() => {
                setCopied(true);
              });
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
          {'share' in navigator && (
            <Button
              size="sm"
              variant="secondary"
              icon={<Share2 className="size-3.5" />}
              onClick={() => {
                navigator.share({ title: node.label, url: link }).catch(() => undefined);
              }}
            >
              Share
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            aria-pressed={showQr}
            icon={<QrCodeIcon className="size-3.5" />}
            onClick={() => {
              setShowQr((v) => !v);
            }}
          >
            QR
          </Button>
        </div>
        {showQr && (
          <QrCode value={link} label={`QR code: navigate to ${node.label}`} className="mx-auto mt-2 w-40" />
        )}
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
