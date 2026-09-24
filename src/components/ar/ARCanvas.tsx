import { CameraOff } from 'lucide-react';
import { useState } from 'react';
import { CAMERA_STATUS_TEXT, useCamera } from '../../hooks/useCamera';
import type { OrientationState } from '../../hooks/useOrientation';
import { normalizeDeg } from '../../services/geometry';
import type { Route } from '../../services/navigation';
import type { MapData } from '../../types/map';
import { Button } from '../ui/Button';
import { ARCompassHUD } from './ARCompassHUD';

interface ARCanvasProps {
  map: MapData;
  route: Route | null;
  destinationLabel: string | null;
  orientation: OrientationState;
  steps: number;
  onEnableSensors: () => void;
  onBack: () => void;
}

/**
 * Accumulates an angle without wrapping so CSS transitions always take the short way round
 * (359° → 1° animates +2°, not −358°).
 */
function useContinuousAngle(target: number): number {
  const [state, setState] = useState({ target, value: target });
  if (state.target !== target) {
    const delta = ((target - state.value + 540) % 360) - 180;
    const next = { target, value: state.value + delta };
    setState(next);
    return next.value;
  }
  return state.value;
}

function DirectionArrow({ rotation, faded }: { rotation: number; faded: boolean }) {
  return (
    <div className="[perspective:700px]">
      <div
        className="size-40 transition-transform duration-300 ease-out [transform-style:preserve-3d]"
        style={{ transform: `rotateX(58deg) rotateZ(${rotation}deg)` }}
      >
        <svg
          viewBox="0 0 100 100"
          className={`size-full drop-shadow-[0_18px_22px_rgba(79,70,229,0.75)] ${faded ? 'opacity-60' : ''}`}
        >
          <defs>
            <linearGradient id="ar-arrow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#a5b4fc" />
              <stop offset="1" stopColor="#4f46e5" />
            </linearGradient>
          </defs>
          <polygon
            points="50,6 88,58 64,58 64,94 36,94 36,58 12,58"
            fill="url(#ar-arrow)"
            stroke="#fff"
            strokeWidth={3}
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

/** Camera passthrough with a floor-projected arrow pointing to the next waypoint. */
export default function ARCanvas({
  map,
  route,
  destinationLabel,
  orientation,
  steps,
  onEnableSensors,
  onBack,
}: ARCanvasProps) {
  const { videoRef, status, retry } = useCamera(true);
  const { heading, absolute, permission } = orientation;

  // World bearing of the next waypoint = map bearing rotated by how the plan is oriented to north.
  const worldBearing = route?.next ? normalizeDeg(route.next.bearingDeg + map.metadata.northOffsetDeg) : 0;
  const relative = heading === null ? (route?.next?.bearingDeg ?? 0) : worldBearing - heading;
  const rotation = useContinuousAngle(relative);
  const cameraFailed = status === 'denied' || status === 'unavailable' || status === 'insecure';

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950 select-none">
      <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 size-full object-cover" />

      {cameraFailed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
          <div className="flex size-16 items-center justify-center rounded-full bg-slate-800 text-brand-400">
            <CameraOff className="size-8" />
          </div>
          <p className="max-w-xs text-sm text-slate-300">{CAMERA_STATUS_TEXT[status]}</p>
          <Button variant="secondary" size="sm" onClick={retry}>
            Try again
          </Button>
        </div>
      )}

      {route?.next && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-24">
          <DirectionArrow rotation={rotation} faded={heading === null} />
        </div>
      )}

      <ARCompassHUD
        route={route}
        destinationLabel={destinationLabel}
        heading={heading}
        headingAbsolute={absolute}
        sensorPermission={permission}
        steps={steps}
        onEnableSensors={onEnableSensors}
        onBack={onBack}
      />
    </div>
  );
}
