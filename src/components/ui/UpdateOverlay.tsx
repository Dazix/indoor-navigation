import { Loader2 } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { getAppUpdating, subscribeAppUpdate } from '../../services/appUpdate';

/** Covers the stale version while a new one installs and the page reloads. */
export function UpdateOverlay() {
  const updating = useSyncExternalStore(subscribeAppUpdate, getAppUpdating);
  if (!updating) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-slate-950/85 p-6 text-center text-sm text-slate-300 backdrop-blur-sm"
    >
      <Loader2 className="size-6 animate-spin" />
      Updating to the latest version…
    </div>
  );
}
