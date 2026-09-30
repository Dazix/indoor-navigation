import { CloudDownload, ShieldCheck } from 'lucide-react';
import { Button } from '../ui/Button';

interface CloudBannerProps {
  /** Cloud settings arrived through the link and are still in the address bar. */
  urlConfigInAddressBar: boolean;
  onCleanUrl: () => void;
  onDismissUrl: () => void;
  /** A newer cloud version is waiting because a route is active. */
  updateAvailable: boolean;
  onApplyUpdate: () => void;
}

/** Slim notices under the header about things the user may want to act on. */
export function CloudBanner({
  urlConfigInAddressBar,
  onCleanUrl,
  onDismissUrl,
  updateAvailable,
  onApplyUpdate,
}: CloudBannerProps) {
  if (!urlConfigInAddressBar && !updateAvailable) return null;
  return (
    <div className="px-safe z-10 space-y-px border-b border-slate-800 bg-slate-900 text-xs text-slate-200">
      {urlConfigInAddressBar && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 sm:px-4">
          <ShieldCheck className="size-4 shrink-0 text-emerald-400" />
          <span className="min-w-0 flex-1">
            Cloud settings from the link are saved on this device. Remove them from the address bar so they
            are not shared by accident.
          </span>
          <Button size="sm" variant="dark" onClick={onCleanUrl}>
            Clean address bar
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismissUrl}>
            Keep
          </Button>
        </div>
      )}
      {updateAvailable && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 sm:px-4">
          <CloudDownload className="size-4 shrink-0 text-brand-300" />
          <span className="min-w-0 flex-1">
            A newer version of this map is available. It is not applied while a route is active.
          </span>
          <Button size="sm" onClick={onApplyUpdate}>
            Update now
          </Button>
        </div>
      )}
    </div>
  );
}
