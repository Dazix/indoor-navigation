import { useCallback, useEffect, useRef, useState } from 'react';
import { createStepDetector } from '../services/pdr';
import { addStep, EMPTY_WALK, type WalkTrack } from '../services/walkTrack';
import type { SensorPermission } from '../types/navigation';
import { initialSensorPermission, requestSensorPermission } from './sensorPermission';

export interface PDRState {
  steps: number;
  /** Walked distance estimated from step count × step length. */
  distanceM: number;
  /** Steps and direction since the last `markFix`; unlike `steps` it is not cleared when a route starts. */
  sinceFix: WalkTrack;
  /** Step length used for `distanceM` and `sinceFix`. */
  stepLengthM: number;
  permission: SensorPermission;
  /** Must be called from a user gesture on iOS. */
  request: () => Promise<SensorPermission>;
  /** Restarts the step count, e.g. when a new route leg begins. */
  reset: () => void;
  /** Restarts `sinceFix`, called when the user's position was confirmed. */
  markFix: () => void;
}

/** Average adult step length; good enough for snapping the user dot along a known corridor. */
export const DEFAULT_STEP_LENGTH_M = 0.7;

/**
 * Pedestrian dead reckoning: counts steps from the accelerometer while `enabled` is true.
 * `headingDeg` is the absolute compass heading (null when unknown); each step is recorded with it.
 */
export function usePDR(
  enabled: boolean,
  headingDeg: number | null = null,
  stepLengthM = DEFAULT_STEP_LENGTH_M,
): PDRState {
  const [permission, setPermission] = useState<SensorPermission>(() =>
    initialSensorPermission('DeviceMotionEvent'),
  );
  const [steps, setSteps] = useState(0);
  const [sinceFix, setSinceFix] = useState<WalkTrack>(EMPTY_WALK);

  // Read inside the motion listener, which must not be re-registered whenever the compass moves.
  const headingRef = useRef(headingDeg);
  useEffect(() => {
    headingRef.current = headingDeg;
  }, [headingDeg]);

  useEffect(() => {
    if (!enabled || permission !== 'granted') return;
    const detect = createStepDetector();

    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (a?.x == null || a.y == null || a.z == null) return;
      if (detect({ x: a.x, y: a.y, z: a.z, t: e.timeStamp })) {
        setSteps((n) => n + 1);
        const heading = headingRef.current;
        setSinceFix((track) => addStep(track, stepLengthM, heading));
      }
    };

    window.addEventListener('devicemotion', onMotion);
    return () => {
      window.removeEventListener('devicemotion', onMotion);
    };
  }, [enabled, permission, stepLengthM]);

  const request = useCallback(async () => {
    const result = await requestSensorPermission('DeviceMotionEvent');
    setPermission(result);
    return result;
  }, []);

  const reset = useCallback(() => {
    setSteps(0);
  }, []);

  const markFix = useCallback(() => {
    setSinceFix(EMPTY_WALK);
  }, []);

  return {
    steps,
    distanceM: steps * stepLengthM,
    sinceFix,
    stepLengthM,
    permission,
    request,
    reset,
    markFix,
  };
}
