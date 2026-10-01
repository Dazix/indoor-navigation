import { useEffect, useMemo, useState } from 'react';
import {
  formatBuildInfo,
  formatVersionLabel,
  viewStats,
  workerVersionFromCaches,
} from '../../services/buildInfo';
import type { MapData } from '../../types/map';
import { Button } from './Button';
import { Modal } from './Modal';

interface VersionModalProps {
  map: MapData;
  onClose: () => void;
}

interface WorkerState {
  /** `unsupported`, `none` (not registered), or the state of the active worker. */
  active: string;
  /** A newer worker is installed and waiting to take over. */
  updateWaiting: boolean;
  controlling: boolean;
  /** Build version the service worker precached; null if it cannot be read. */
  version: string | null;
}

async function readWorkerState(): Promise<WorkerState> {
  if (!('serviceWorker' in navigator)) {
    return { active: 'unsupported', updateWaiting: false, controlling: false, version: null };
  }
  const registration = await navigator.serviceWorker.getRegistration();
  const cacheNames = 'caches' in window ? await caches.keys() : [];
  return {
    active: registration?.active?.state ?? 'none',
    updateWaiting: Boolean(registration?.waiting),
    controlling: Boolean(navigator.serviceWorker.controller),
    version: workerVersionFromCaches(cacheNames),
  };
}

/** Which build runs on this device; the long press on the logo opens it. */
export default function VersionModal({ map, onClose }: VersionModalProps) {
  const info = formatBuildInfo({
    version: __APP_VERSION__,
    commit: __APP_COMMIT__,
    builtAt: __APP_BUILD_TIME__,
  });
  const stats = useMemo(() => viewStats(map), [map]);
  const [worker, setWorker] = useState<WorkerState | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readWorkerState().then((state) => {
      if (!cancelled) setWorker(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const builtAt = new Date(info.builtAt);
  const builtLabel = Number.isNaN(builtAt.getTime()) ? info.builtAt : builtAt.toLocaleString();
  const workerLabel = worker
    ? `${worker.version ?? 'unknown'} (${worker.active}${worker.controlling ? ', controlling' : ''})`
    : 'checking…';
  const engines = [
    stats.mobilenet > 0 && `mobilenet ${stats.mobilenet}`,
    stats.fallback > 0 && `fallback ${stats.fallback}`,
  ].filter(Boolean);

  const rows: [string, string][] = [
    ['Version', formatVersionLabel(info)],
    ['Commit', info.commit],
    ['Built', builtLabel],
    ['Service worker', workerLabel],
    ...(worker?.updateWaiting ? ([['Update', 'waiting to activate']] as [string, string][]) : []),
    ['Embedding engine', engines.length > 0 ? engines.join(', ') : 'no views'],
    ['Views with tiles', `${stats.withTiles} of ${stats.views} (${stats.nodes} places)`],
  ];

  const copy = () => {
    const text = rows.map(([label, value]) => `${label}: ${value}`).join('\n');
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
      },
      () => {
        setCopied(false);
      },
    );
  };

  return (
    <Modal open onClose={onClose} title="About this build" subtitle="Attach it to a bug report">
      <div className="space-y-4 p-4 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
              <dd className="font-mono text-xs break-all text-slate-900 dark:text-slate-100">{value}</dd>
            </div>
          ))}
        </dl>
        <Button variant="secondary" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </Modal>
  );
}
