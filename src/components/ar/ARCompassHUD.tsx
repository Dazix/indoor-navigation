import { ArrowLeft, Check, Compass, Footprints } from 'lucide-react';
import { formatDistance, type Route } from '../../services/navigation';
import type { SensorPermission } from '../../types/navigation';
import { Button } from '../ui/Button';

interface ARCompassHUDProps {
  route: Route | null;
  destinationLabel: string | null;
  heading: number | null;
  headingAbsolute: boolean;
  sensorPermission: SensorPermission;
  steps: number;
  onEnableSensors: () => void;
  onBack: () => void;
}

const pill =
  'rounded-full border border-white/15 bg-black/60 px-3 py-1.5 font-mono text-xs text-white/90 backdrop-blur-md';

/** Heads-up display over the camera: compass, next waypoint, remaining distance and sensor prompts. */
export function ARCompassHUD({
  route,
  destinationLabel,
  heading,
  headingAbsolute,
  sensorPermission,
  steps,
  onEnableSensors,
  onBack,
}: ARCompassHUDProps) {
  return (
    <>
      <div className="pt-safe absolute inset-x-0 top-0 z-10">
        <div className="flex items-center justify-between gap-2 p-3">
          <button
            type="button"
            onClick={onBack}
            className={`${pill} flex items-center gap-1.5`}
            aria-label="Back to map"
          >
            <ArrowLeft className="size-4" /> Map
          </button>
          <div className="flex items-center gap-2">
            <span className={`${pill} flex items-center gap-1.5`}>
              <Footprints className="size-3.5" /> {steps}
            </span>
            <span className={`${pill} flex items-center gap-1.5`}>
              <Compass className="size-3.5" />
              {heading === null ? '—' : `${Math.round(heading)}°`}
              {heading !== null && !headingAbsolute && <span className="text-amber-300">rel</span>}
            </span>
          </div>
        </div>
      </div>

      <div className="pb-safe absolute inset-x-0 bottom-0 z-10">
        <div className="mx-auto flex max-w-md flex-col gap-2 p-4">
          {sensorPermission === 'prompt' && (
            <Button
              variant="primary"
              onClick={onEnableSensors}
              icon={<Compass className="size-4" />}
              fullWidth
            >
              Enable compass & step tracking
            </Button>
          )}
          {sensorPermission === 'denied' && (
            <p className="rounded-xl bg-amber-500/90 px-3 py-2 text-center text-xs font-medium text-amber-950">
              Motion sensors are blocked. The arrow shows the map direction only.
            </p>
          )}
          {sensorPermission === 'granted' && heading === null && (
            <p className="rounded-xl bg-black/60 px-3 py-2 text-center text-xs text-white/80 backdrop-blur-md">
              Waiting for compass… move the phone in a figure 8 to calibrate.
            </p>
          )}

          {!route || !destinationLabel ? (
            <div className="rounded-2xl border border-white/20 bg-black/60 px-5 py-3 text-center text-sm font-medium text-white backdrop-blur-md">
              {destinationLabel
                ? 'No walkable route to the destination.'
                : 'Choose a destination on the map.'}
            </div>
          ) : route.arrived ? (
            <div className="rounded-3xl border border-emerald-400/60 bg-emerald-950/85 px-6 py-4 text-center text-emerald-50 shadow-2xl backdrop-blur-md">
              <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-full bg-emerald-500 text-white">
                <Check className="size-6" />
              </div>
              <p className="text-lg font-bold">You have arrived</p>
              <p className="text-xs text-emerald-300">{destinationLabel}</p>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-brand-400/50 bg-slate-900/90 px-4 py-3 text-white shadow-2xl backdrop-blur-md">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold tracking-wider text-brand-300 uppercase">
                  Head towards
                </p>
                <p className="truncate text-base font-bold">{route.next?.node.label}</p>
                <p className="truncate text-xs text-slate-400">Destination: {destinationLabel}</p>
              </div>
              <div className="text-right">
                <p className="text-xl font-bold">{formatDistance(route.next?.distanceM ?? 0)}</p>
                <p className="text-[11px] text-slate-400">
                  {formatDistance(route.progress.remainingM)} total
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
