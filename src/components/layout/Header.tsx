import { ChevronDown, Layers, MapPinned, Navigation, PencilRuler } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLongPress } from '../../hooks/useLongPress';
import type { MapSummary } from '../../types/map';
import type { AppMode } from '../../types/navigation';

interface HeaderProps {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  maps: MapSummary[];
  activeMapId: string | null;
  onSwitchMap: (id: string) => void;
  onManageMaps: () => void;
  /** Cloud sync status and actions, shown next to the manage maps button. */
  cloudSlot?: ReactNode;
  /** Local edits not yet in the cloud; shown as a dot on the Editor tab. */
  unsavedChanges?: boolean;
  /** Long press on the logo, opens the build info. */
  onLogoLongPress?: () => void;
}

export function Header({
  mode,
  onModeChange,
  maps,
  activeMapId,
  onSwitchMap,
  onManageMaps,
  cloudSlot,
  unsavedChanges = false,
  onLogoLongPress,
}: HeaderProps) {
  const sorted = [...maps].sort((a, b) => a.name.localeCompare(b.name));
  const { handlers: logoPress } = useLongPress(() => {
    onLogoLongPress?.();
  });

  return (
    <header className="pt-safe px-safe z-20 border-b border-slate-800 bg-slate-900 text-white">
      <div className="flex h-14 items-center justify-between gap-2 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            {...logoPress}
            title="Hold for build info"
            className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-brand-600 to-brand-400 shadow-md select-none [-webkit-touch-callout:none]"
          >
            <MapPinned className="size-4.5" />
          </div>
          <div className="min-w-0">
            <h1 className="hidden text-sm leading-tight font-bold sm:block">Indoor Navigation</h1>
            <div className="flex items-center">
              <label className="relative flex min-w-0 items-center">
                <span className="sr-only">Active map</span>
                <select
                  value={activeMapId ?? ''}
                  onChange={(e) => {
                    onSwitchMap(e.target.value);
                  }}
                  className="w-full min-w-0 max-w-24 appearance-none truncate bg-transparent pr-5 text-xs font-semibold text-slate-200 outline-none sm:max-w-44 sm:text-[11px] sm:font-normal sm:text-slate-400"
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
                className="ml-1 shrink-0 rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <Layers className="size-3.5" />
              </button>
              {cloudSlot && <div className="ml-1 shrink-0">{cloudSlot}</div>}
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
            aria-label="Navigate"
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors sm:px-3 ${
              mode !== 'editor' ? 'bg-brand-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Navigation className="size-3.5 sm:hidden" />
            <span className="hidden sm:inline">Navigate</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'editor'}
            onClick={() => {
              onModeChange('editor');
            }}
            aria-label={unsavedChanges ? 'Editor (unsaved changes)' : 'Editor'}
            className={`relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors sm:px-3 ${
              mode === 'editor' ? 'bg-amber-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            <PencilRuler className="size-3.5" />
            <span className="hidden sm:inline">Editor</span>
            {unsavedChanges && (
              <span
                aria-hidden="true"
                className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-red-500 ring-2 ring-slate-800"
              />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
