import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'idle' | 'starting' | 'ready' | 'denied' | 'unavailable' | 'insecure';

const DEFAULT_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 640 },
  height: { ideal: 480 },
};

export const CAMERA_STATUS_TEXT: Record<CameraStatus, string> = {
  idle: 'Camera is off',
  starting: 'Starting camera…',
  ready: 'Camera ready',
  denied: 'Camera access was denied. Allow it in your browser settings.',
  unavailable: 'No camera found on this device.',
  insecure: 'Camera requires HTTPS. Open the app over a secure connection.',
};

function precheck(active: boolean): CameraStatus | null {
  if (!active) return 'idle';
  if (!window.isSecureContext) return 'insecure';
  if (typeof (navigator.mediaDevices as MediaDevices | undefined)?.getUserMedia !== 'function')
    return 'unavailable';
  return null;
}

/**
 * Manages the rear camera stream for a <video> element while `active` is true.
 * Tracks are stopped when the hook deactivates or unmounts.
 */
export function useCamera(active: boolean, constraints: MediaTrackConstraints = DEFAULT_CONSTRAINTS) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<{ attempt: number; status: CameraStatus } | null>(null);
  const constraintsRef = useRef(constraints);
  const blocked = precheck(active);

  useEffect(() => {
    if (blocked) return;
    const video = videoRef.current;
    let stream: MediaStream | null = null;
    let cancelled = false;
    const isCancelled = () => cancelled;

    const start = async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: constraintsRef.current, audio: false });
        if (isCancelled()) {
          s.getTracks().forEach((t) => {
            t.stop();
          });
          return;
        }
        stream = s;
        if (video) {
          video.srcObject = s;
          // Autoplay can be blocked until the element is visible; a later play() retry is harmless.
          await video.play().catch(() => undefined);
        }
        if (!isCancelled()) setOutcome({ attempt, status: 'ready' });
      } catch (err) {
        if (isCancelled()) return;
        const name = err instanceof DOMException ? err.name : '';
        setOutcome({
          attempt,
          status: name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable',
        });
      }
    };
    void start();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => {
        t.stop();
      });
      if (video) video.srcObject = null;
      setOutcome(null);
    };
  }, [blocked, attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  const status: CameraStatus = blocked ?? (outcome?.attempt === attempt ? outcome.status : 'starting');
  return { videoRef, status, retry };
}
