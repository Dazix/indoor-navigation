import { ChevronDown, Layers, MapPinned, PencilRuler } from 'lucide-react';
import type { MapSummary } from '../../types/map';
import type { AppMode } from '../../types/navigation';
import type { EmbeddingEngine, ModelStatus } from '../../types/vision';

interface HeaderProps {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  maps: MapSummary[];
  activeMapId: string | null;
  onSwitchMap: (id: string) => void;
  onManageMaps: () => void;
  engine: EmbeddingEngine;
  modelStatus: ModelStatus;
}

export function Header({
  mode,
  onModeChange,
  maps,
  activeMapId,
  onSwitchMap,
  onManageMaps,
  engine,
  modelStatus,
}: HeaderProps) {
  const sorted = [...maps].sort((a, b) => a.name.localeCompare(b.name));
  const badge =
    modelStatus === 'loading' ? 'Loading AI…' : engine === 'mobilenet' ? 'AI MobileNet' : 'Offline';

  return (
    <header className="pt-safe px-safe z-20 border-b border-slate-800 bg-slate-900 text-white">
      <div className="flex h-14 items-center justify-between gap-2 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-brand-600 to-brand-400 shadow-md">
            <MapPinned className="size-4.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="hidden text-sm leading-tight font-bold sm:block">Indoor Navigation</h1>
              <span className="hidden rounded border border-brand-700/50 bg-brand-900/80 px-1.5 font-mono text-[9px] text-brand-300 md:inline">
                {badge}
              </span>
            </div>
            <div className="flex items-center">
              <label className="relative flex min-w-0 items-center">
                <span className="sr-only">Active map</span>
                <select
                  value={activeMapId ?? ''}
                  onChange={(e) => {
                    onSwitchMap(e.target.value);
                  }}
                  className="max-w-40 appearance-none truncate bg-transparent pr-5 text-xs font-semibold text-slate-200 outline-none sm:max-w-56 sm:text-[11px] sm:font-normal sm:text-slate-400"
                >
                  {sorted.map((m) => (
                    <option key={m.id} value={m.id} className="bg-slate-900 text-white">
                      {m.name || 'Untitled map'}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-0 size-3.5 text-slate-400" />
              </label>
              <button
                type="button"
                onClick={onManageMaps}
                aria-label="Manage maps"
                title="Manage maps"
                className="ml-1 rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <Layers className="size-3.5" />
              </button>
            </div>
          </div>
        </div>

        <div
          className="flex shrink-0 items-center gap-1 rounded-xl border border-slate-700/60 bg-slate-800/80 p-1"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode !== 'editor'}
            onClick={() => {
              onModeChange('user');
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              mode !== 'editor' ? 'bg-brand-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            Navigate
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'editor'}
            onClick={() => {
              onModeChange('editor');
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              mode === 'editor' ? 'bg-amber-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            <PencilRuler className="size-3.5" />
            <span>Editor</span>
          </button>
        </div>
      </div>
    </header>
  );
}
