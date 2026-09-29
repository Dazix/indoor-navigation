import { Camera } from 'lucide-react';
import type { CameraDevice, CameraZoom } from '../../hooks/useCamera';

interface CameraControlsProps {
  devices: CameraDevice[];
  currentDeviceId: string | null;
  onSelectDevice: (deviceId: string) => void;
  zoom: CameraZoom | null;
  onZoom: (value: number) => void;
}

const formatZoom = (value: number) => `${String(Math.round(value * 10) / 10)}×`;

/** Lens switcher and wide / normal zoom toggle overlaid on the camera preview. */
export function CameraControls({
  devices,
  currentDeviceId,
  onSelectDevice,
  zoom,
  onZoom,
}: CameraControlsProps) {
  // Only worth a button when the camera can zoom out below 1×; otherwise a lens switch is the way to go wide.
  const canGoWide = zoom !== null && zoom.min < 1;
  return (
    <div className="absolute top-3 right-3 z-10 flex max-w-[60%] flex-col items-end gap-1.5">
      {devices.length > 1 && (
        <label className="flex max-w-full items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-slate-200 backdrop-blur-sm">
          <Camera className="size-3.5 shrink-0" aria-hidden />
          <span className="sr-only">Camera lens</span>
          <select
            value={currentDeviceId ?? ''}
            onChange={(e) => {
              onSelectDevice(e.target.value);
            }}
            className="min-w-0 truncate bg-transparent outline-none"
          >
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId} className="text-black">
                {d.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {canGoWide && (
        <button
          type="button"
          onClick={() => {
            onZoom(zoom.value <= zoom.min ? 1 : zoom.min);
          }}
          className="rounded-full bg-black/60 px-2.5 py-1 font-mono text-[11px] text-slate-200 backdrop-blur-sm"
        >
          {zoom.value <= zoom.min
            ? `Wide ${formatZoom(zoom.min)} · tap for 1×`
            : `${formatZoom(zoom.value)} · tap for wide`}
        </button>
      )}
    </div>
  );
}
