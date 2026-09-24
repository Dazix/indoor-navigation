import { useCallback, useEffect, useState } from 'react';
import { createStepDetector } from '../services/pdr';
import type { SensorPermission } from '../types/navigation';
import { initialSensorPermission, requestSensorPermission } from './sensorPermission';

export interface PDRState {
  steps: number;
  /** Walked distance estimated from step count × step length. */
  distanceM: number;
  permission: SensorPermission;
  /** Must be called from a user gesture on iOS. */
  request: () => Promise<SensorPermission>;
  reset: () => void;
}

/** Average adult step length; good enough for snapping the user dot along a known corridor. */
export const DEFAULT_STEP_LENGTH_M = 0.7;

/** Pedestrian dead reckoning: counts steps from the accelerometer while `enabled` is true. */
export function usePDR(enabled: boolean, stepLengthM = DEFAULT_STEP_LENGTH_M): PDRState {
  const [permission, setPermission] = useState<SensorPermission>(() =>
    initialSensorPermission('DeviceMotionEvent'),
  );
  const [steps, setSteps] = useState(0);

  useEffect(() => {
    if (!enabled || permission !== 'granted') return;
    const detect = createStepDetector();

    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (a?.x == null || a.y == null || a.z == null) return;
      if (detect({ x: a.x, y: a.y, z: a.z, t: e.timeStamp })) setSteps((n) => n + 1);
    };

    window.addEventListener('devicemotion', onMotion);
    return () => {
      window.removeEventListener('devicemotion', onMotion);
    };
  }, [enabled, permission]);

  const request = useCallback(async () => {
    const result = await requestSensorPermission('DeviceMotionEvent');
    setPermission(result);
    return result;
  }, []);

  const reset = useCallback(() => {
    setSteps(0);
  }, []);

  return { steps, distanceM: steps * stepLengthM, permission, request, reset };
}
