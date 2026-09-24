import { useCallback, useEffect, useState } from 'react';
import { normalizeDeg } from '../services/geometry';
import type { SensorPermission } from '../types/navigation';
import { initialSensorPermission, requestSensorPermission } from './sensorPermission';

export interface OrientationState {
  /** Compass heading in degrees clockwise from north, or null until a reading arrives. */
  heading: number | null;
  /** False when the browser only reports orientation relative to the start pose (not to north). */
  absolute: boolean;
  permission: SensorPermission;
  /** Must be called from a user gesture on iOS. */
  request: () => Promise<SensorPermission>;
}

/** Shortest-arc exponential smoothing so the needle does not jump between 359° and 0°. */
function smoothAngle(prev: number | null, next: number, factor = 0.25): number {
  if (prev === null) return next;
  const delta = ((next - prev + 540) % 360) - 180;
  return normalizeDeg(prev + delta * factor);
}

function screenAngle(): number {
  return (screen.orientation as ScreenOrientation | undefined)?.angle ?? 0;
}

export function useOrientation(enabled = true): OrientationState {
  const [permission, setPermission] = useState<SensorPermission>(() =>
    initialSensorPermission('DeviceOrientationEvent'),
  );
  const [heading, setHeading] = useState<number | null>(null);
  const [absolute, setAbsolute] = useState(true);

  useEffect(() => {
    if (!enabled || permission !== 'granted') return;

    // Chromium exposes true compass readings only through the "absolute" event.
    const eventName =
      'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';

    const onOrientation = (e: DeviceOrientationEvent) => {
      let raw: number | null = null;
      let isAbsolute = true;
      if (typeof e.webkitCompassHeading === 'number') {
        raw = e.webkitCompassHeading;
      } else if (e.alpha !== null) {
        raw = 360 - e.alpha;
        isAbsolute = e.absolute || eventName === 'deviceorientationabsolute';
      }
      if (raw === null) return;
      const value = normalizeDeg(raw + screenAngle());
      setHeading((prev) => smoothAngle(prev, value));
      setAbsolute(isAbsolute);
    };

    window.addEventListener(eventName, onOrientation);
    return () => {
      window.removeEventListener(eventName, onOrientation);
    };
  }, [enabled, permission]);

  const request = useCallback(async () => {
    const result = await requestSensorPermission('DeviceOrientationEvent');
    setPermission(result);
    return result;
  }, []);

  return { heading, absolute, permission, request };
}
