import { Camera } from 'lucide-react';
import type { CameraDevice } from '../../hooks/useCamera';

interface CameraLensPickerProps {
  devices: CameraDevice[];
  currentDeviceId: string | null;
  onSelect: (deviceId: string) => void;
}

/** Lens switcher overlaid on the camera preview; hidden when the device has a single camera. */
export function CameraLensPicker({ devices, currentDeviceId, onSelect }: CameraLensPickerProps) {
  if (devices.length < 2) return null;
  return (
    <label className="absolute top-3 right-3 z-10 flex max-w-[55%] items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-slate-200 backdrop-blur-sm">
      <Camera className="size-3.5 shrink-0" aria-hidden />
      <span className="sr-only">Camera lens</span>
      <select
        value={currentDeviceId ?? ''}
        onChange={(e) => {
          onSelect(e.target.value);
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
  );
}
