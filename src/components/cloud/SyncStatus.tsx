import { Check, Cloud, CloudOff, CloudUpload, Loader2 } from 'lucide-react';
import type { SyncStatus as Status } from '../../services/cloud/syncState';

interface SyncStatusProps {
  configured: boolean;
  status: Status | null;
  /** The active map has edits that are not in the cloud (or was never published). */
  dirty: boolean;
  busy: 'push' | 'pull' | null;
  onPublish: () => void;
  onOpenSettings: () => void;
}

const LOOK: Record<Status, { icon: typeof Check; label: string; shortLabel: string; tone: string }> = {
  synced: {
    icon: Check,
    label: 'Synced',
    shortLabel: 'Synced',
    tone: 'border-emerald-700/60 bg-emerald-900/40 text-emerald-300',
  },
  unsaved: {
    icon: CloudUpload,
    label: 'Unsaved local changes',
    shortLabel: 'Unsaved',
    tone: 'border-amber-700/60 bg-amber-900/40 text-amber-300',
  },
  offline: {
    icon: CloudOff,
    label: 'Offline',
    shortLabel: 'Offline',
    tone: 'border-slate-600 bg-slate-800 text-slate-300',
  },
};

/** Cloud sync state in the header, with the publish button while there is something to publish. */
export function SyncStatus({ configured, status, dirty, busy, onPublish, onOpenSettings }: SyncStatusProps) {
  if (!configured || !status) {
    return (
      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="Cloud sync settings"
        title="Cloud sync is off. Set it up to publish maps."
        className="flex items-center gap-1 rounded-md px-1 py-0.5 text-[10px] text-slate-400 hover:bg-white/10 hover:text-white"
      >
        <Cloud className="size-3" />
        <span className="hidden sm:inline">Cloud sync</span>
      </button>
    );
  }

  const look = LOOK[status];
  const Icon = busy ? Loader2 : look.icon;
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onOpenSettings}
        title={`${look.label}. Open cloud settings.`}
        className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${look.tone}`}
      >
        <Icon className={`size-3 ${busy ? 'animate-spin' : ''}`} />
        <span className="sm:hidden">{look.shortLabel}</span>
        <span className="hidden sm:inline">{look.label}</span>
      </button>
      {dirty && (
        <button
          type="button"
          onClick={onPublish}
          disabled={busy !== null || status === 'offline'}
          title={status === 'offline' ? 'You are offline. Publish when you are back online.' : undefined}
          className="flex items-center gap-1 rounded-md bg-brand-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-brand-500 disabled:pointer-events-none disabled:opacity-50"
        >
          <CloudUpload className="size-3" />
          <span>Sync to Cloud</span>
        </button>
      )}
    </div>
  );
}
