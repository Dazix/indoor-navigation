import { Camera, Map as MapIcon, ScanLine } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AppMode } from '../../types/navigation';

interface NavigationBarProps {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  onScan: () => void;
}

function Tab({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex min-w-20 flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[11px] font-bold transition-colors ${
        active
          ? 'text-brand-600 dark:text-brand-400'
          : 'text-slate-500 hover:text-brand-600 dark:text-slate-400'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/** Bottom tab bar for the navigation experience, padded above the iOS home indicator. */
export function NavigationBar({ mode, onModeChange, onScan }: NavigationBarProps) {
  return (
    <nav
      aria-label="Navigation"
      className="pb-safe relative z-20 border-t border-slate-200 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95"
    >
      <div className="mx-auto flex h-16 max-w-lg items-center justify-between px-6">
        <Tab
          active={mode === 'user'}
          label="2D Map"
          icon={<MapIcon className="size-5" />}
          onClick={() => {
            onModeChange('user');
          }}
        />
        <button
          type="button"
          onClick={onScan}
          aria-label="Locate me with the camera"
          className="relative -top-5 flex size-15 items-center justify-center rounded-full bg-gradient-to-tr from-brand-600 to-brand-400 text-white shadow-lg shadow-brand-500/40 transition active:scale-95"
        >
          <ScanLine className="size-7" />
        </button>
        <Tab
          active={mode === 'ar'}
          label="AR View"
          icon={<Camera className="size-5" />}
          onClick={() => {
            onModeChange('ar');
          }}
        />
      </div>
    </nav>
  );
}
