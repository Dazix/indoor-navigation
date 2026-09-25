import { Check, Copy, Download, Link, Pencil, Plus, Send, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { buildShareLink, MAP_FILE_ACCEPT, resolveMapUrl } from '../../services/mapSharing';
import type { MapSummary } from '../../types/map';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { QrCode } from '../ui/QrCode';

interface MapManagerModalProps {
  open: boolean;
  onClose: () => void;
  maps: MapSummary[];
  activeMapId: string | null;
  onSwitch: (id: string) => void;
  onCreate: (name: string, template: 'blank' | 'sample') => Promise<unknown>;
  onDuplicateActive: () => Promise<unknown>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onImport: (file: File) => void;
  onSendNearby: () => void;
  onReceiveNearby: () => void;
}

const input =
  'min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Lists all offices/floors stored in this browser and lets the user switch, add, rename or remove them. */
export function MapManagerModal({
  open,
  onClose,
  maps,
  activeMapId,
  onSwitch,
  onCreate,
  onDuplicateActive,
  onRename,
  onDelete,
  onImport,
  onSendNearby,
  onReceiveNearby,
}: MapManagerModalProps) {
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [template, setTemplate] = useState<'blank' | 'sample'>('blank');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sorted = [...maps].sort((a, b) => b.updatedAt - a.updatedAt);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const saveRename = () => {
    if (!editing) return;
    const { id, name } = editing;
    setEditing(null);
    void run(() => onRename(id, name));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Maps"
      subtitle="Offices and floors stored in this browser"
      size="lg"
    >
      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {sorted.map((m) => {
          const active = m.id === activeMapId;
          const isEditing = editing?.id === m.id;
          return (
            <li
              key={m.id}
              className={`flex items-center gap-2 px-4 py-2.5 ${active ? 'bg-brand-50 dark:bg-brand-900/20' : ''}`}
            >
              {isEditing ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveRename();
                  }}
                >
                  <input
                    autoFocus
                    className={input}
                    value={editing.name}
                    maxLength={200}
                    aria-label="Map name"
                    onChange={(e) => {
                      setEditing({ id: m.id, name: e.target.value });
                    }}
                  />
                  <Button type="submit" size="sm" disabled={!editing.name.trim()} aria-label="Save name">
                    <Check className="size-4" />
                  </Button>
                </form>
              ) : (
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    onSwitch(m.id);
                    onClose();
                  }}
                >
                  <span className="flex items-center gap-2 truncate text-sm font-semibold">
                    {m.name || 'Untitled map'}
                    {active && (
                      <span className="rounded bg-brand-600 px-1.5 py-0.5 text-[9px] font-bold text-white uppercase">
                        Active
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] text-slate-500">Updated {dateFormat.format(m.updatedAt)}</span>
                </button>
              )}
              {!isEditing && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Rename ${m.name}`}
                    onClick={() => {
                      setEditing({ id: m.id, name: m.name });
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  {active && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Duplicate ${m.name}`}
                      disabled={busy}
                      onClick={() => void run(onDuplicateActive)}
                    >
                      <Copy className="size-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${m.name}`}
                    disabled={busy || maps.length <= 1}
                    title={maps.length <= 1 ? 'At least one map is required' : undefined}
                    className="hover:text-red-600!"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete “${m.name}”? This removes its locations and learned views from this browser.`,
                        )
                      ) {
                        void run(() => onDelete(m.id));
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <section className="space-y-2 border-t border-slate-200 p-4 dark:border-slate-800">
        <h3 className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">New map</h3>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newName.trim();
            if (!name) return;
            void run(async () => {
              await onCreate(name, template);
              setNewName('');
              onClose();
            });
          }}
        >
          <input
            className={input}
            placeholder="e.g. Prague HQ – 3rd floor"
            value={newName}
            maxLength={200}
            aria-label="New map name"
            onChange={(e) => {
              setNewName(e.target.value);
            }}
          />
          <select
            value={template}
            aria-label="Template"
            onChange={(e) => {
              setTemplate(e.target.value as 'blank' | 'sample');
            }}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          >
            <option value="blank">Blank</option>
            <option value="sample">Sample office</option>
          </select>
          <Button
            type="submit"
            size="sm"
            disabled={busy || !newName.trim()}
            icon={<Plus className="size-4" />}
          >
            Create
          </Button>
        </form>
        <input
          ref={fileInput}
          type="file"
          accept={MAP_FILE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) {
              onImport(file);
              onClose();
            }
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          icon={<Upload className="size-4" />}
          onClick={() => fileInput.current?.click()}
        >
          Import map from JSON
        </Button>
      </section>

      <section className="space-y-2 border-t border-slate-200 p-4 dark:border-slate-800">
        <h3 className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">Nearby phone</h3>
        <p className="text-[11px] text-slate-500">
          Transfer a complete map directly between two phones on the same Wi-Fi by scanning QR codes.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            icon={<Send className="size-4" />}
            onClick={() => {
              onClose();
              onSendNearby();
            }}
          >
            Send active map
          </Button>
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            icon={<Download className="size-4" />}
            onClick={() => {
              onClose();
              onReceiveNearby();
            }}
          >
            Receive a map
          </Button>
        </div>
      </section>

      <ShareLinkSection />
    </Modal>
  );
}

/** Turns a public map JSON URL into an app link and a printable QR code. */
export function ShareLinkSection({ initialUrl = '' }: { initialUrl?: string }) {
  const [source, setSource] = useState(initialUrl);
  const [copied, setCopied] = useState(false);
  const appUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href;
  const mapUrl = source.trim() ? resolveMapUrl(source, appUrl) : null;
  const link = mapUrl ? buildShareLink(source.trim(), appUrl) : null;

  return (
    <section className="space-y-2 border-t border-slate-200 p-4 dark:border-slate-800">
      <h3 className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">Share via link</h3>
      <ol className="list-decimal space-y-0.5 pl-4 text-[11px] text-slate-500">
        <li>Save the map with Export JSON.</li>
        <li>
          Upload the file somewhere public: this app’s <code>public/maps/</code> folder, a GitHub gist (raw
          link) or S3. Google Drive and Dropbox links do not work.
        </li>
        <li>Paste its URL below. You get a link and a QR code to print.</li>
      </ol>
      <p className="text-[11px] text-slate-500">
        Opening the link adds the map, and opening it again later updates it. The map is public, camera
        thumbnails included. To send a map to one phone without uploading anything, use Nearby phone.
      </p>
      <input
        className={`${input} w-full`}
        placeholder="maps/office.json or https://…/map.json"
        value={source}
        aria-label="Map JSON URL"
        onChange={(e) => {
          setSource(e.target.value);
          setCopied(false);
        }}
      />
      {source.trim() && !link && <p className="text-[11px] text-red-600">Enter an https:// URL or a path.</p>}
      {link && (
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-start">
          <QrCode
            value={link}
            label="QR code of the map link"
            className="w-40 shrink-0 border border-slate-200"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-[11px] break-all text-slate-600 dark:text-slate-300">{link}</p>
            <Button
              variant="secondary"
              size="sm"
              icon={copied ? <Check className="size-4" /> : <Link className="size-4" />}
              onClick={() => {
                void navigator.clipboard.writeText(link).then(() => {
                  setCopied(true);
                });
              }}
            >
              {copied ? 'Link copied' : 'Copy link'}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
