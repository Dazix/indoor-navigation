/** What the browser reports about the device, so the check can be tested without a window. */
export interface DeviceHints {
  /** The primary pointer is a finger (`(pointer: coarse)`). */
  coarsePointer: boolean;
  /** The browser has the compass / motion API (`DeviceOrientationEvent`). */
  hasOrientationEvent: boolean;
}

/**
 * Whether the device is held and walked around with: the camera locate button and AR view only make
 * sense there. A desktop has a mouse and no compass, so they are hidden.
 */
export function isHandheldDevice({ coarsePointer, hasOrientationEvent }: DeviceHints): boolean {
  return coarsePointer && hasOrientationEvent;
}

export function detectHandheldDevice(): boolean {
  return isHandheldDevice({
    coarsePointer: typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches,
    hasOrientationEvent: 'DeviceOrientationEvent' in window,
  });
}
