import type { SensorPermission } from '../types/navigation';

export type SensorEventName = 'DeviceOrientationEvent' | 'DeviceMotionEvent';

function api(name: SensorEventName): SensorPermissionApi | undefined {
  return name in window ? (window[name] as unknown as SensorPermissionApi) : undefined;
}

/** Initial permission state: iOS 13+ needs an explicit prompt, other browsers grant sensors silently. */
export function initialSensorPermission(name: SensorEventName): SensorPermission {
  const ctor = api(name);
  if (!ctor) return 'unsupported';
  if (!window.isSecureContext) return 'denied';
  return typeof ctor.requestPermission === 'function' ? 'prompt' : 'granted';
}

/**
 * Asks for motion/orientation access on iOS. Call synchronously from a click/tap handler:
 * Safari rejects the request once the user-gesture activation has been consumed.
 */
export async function requestSensorPermission(name: SensorEventName): Promise<SensorPermission> {
  const ctor = api(name);
  if (!ctor) return 'unsupported';
  if (typeof ctor.requestPermission !== 'function') return 'granted';
  try {
    return (await ctor.requestPermission()) === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}
