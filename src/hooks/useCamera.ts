import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalStorage } from './useLocalStorage';

export type CameraStatus = 'idle' | 'starting' | 'ready' | 'denied' | 'unavailable' | 'insecure';

export interface CameraDevice {
  deviceId: string;
  label: string;
}

const DEFAULT_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 640 },
  height: { ideal: 480 },
};

/**
 * Full-sensor frames (most sensors are natively 4:3) with no forced aspect ratio, so the camera's
 * widest field of view is kept. Used by the visual-memory scanner and walkthrough recording.
 */
export const WIDE_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 1280 },
  height: { ideal: 960 },
};

export interface CameraZoom {
  min: number;
  max: number;
  value: number;
}

/** `zoom` is not part of the standard DOM typings yet. */
interface ZoomCapabilities {
  zoom?: { min: number; max: number };
}
interface ZoomSettings {
  zoom?: number;
}

const DEVICE_STORAGE_KEY = 'indoor-nav:camera-device';

const parseDeviceId = (raw: unknown): string | null => (typeof raw === 'string' && raw ? raw : null);

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

async function listCameras(): Promise<CameraDevice[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === 'videoinput' && d.deviceId)
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  } catch {
    return [];
  }
}

/** Zoom range of the track (null when unsupported); starts at the widest setting when it is below 1×. */
async function initialZoom(track: MediaStreamTrack | null): Promise<CameraZoom | null> {
  const range = (track?.getCapabilities() as ZoomCapabilities | undefined)?.zoom;
  if (!track || !range) return null;
  let value = (track.getSettings() as ZoomSettings).zoom ?? 1;
  if (range.min < 1) {
    try {
      await track.applyConstraints({ advanced: [{ zoom: range.min } as MediaTrackConstraintSet] });
      value = range.min;
    } catch {
      // Keep the current zoom.
    }
  }
  return { min: range.min, max: range.max, value };
}

/**
 * Manages the camera stream for a <video> element while `active` is true (rear camera by default).
 * The user's lens choice is remembered across sessions. Tracks are stopped when the hook
 * deactivates or unmounts.
 */
export function useCamera(active: boolean, constraints: MediaTrackConstraints = DEFAULT_CONSTRAINTS) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<{ attempt: number; status: CameraStatus } | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [preferredId, setPreferredId] = useLocalStorage<string | null>(
    DEVICE_STORAGE_KEY,
    null,
    parseDeviceId,
  );
  const [zoom, setZoomState] = useState<CameraZoom | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const constraintsRef = useRef(constraints);
  const blocked = precheck(active);

  useEffect(() => {
    if (blocked) return;
    const video = videoRef.current;
    let stream: MediaStream | null = null;
    let cancelled = false;
    const isCancelled = () => cancelled;

    const open = (deviceId: string | null) => {
      // An explicit lens replaces the facing-mode hint, otherwise the two constraints can conflict.
      const videoConstraints: MediaTrackConstraints = deviceId
        ? { ...constraintsRef.current, facingMode: undefined, deviceId: { exact: deviceId } }
        : constraintsRef.current;
      return navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
    };

    const start = async () => {
      try {
        let s: MediaStream;
        try {
          s = await open(preferredId);
        } catch (err) {
          // The remembered lens is gone (unplugged, permissions reset): forget it, use the default.
          const name = err instanceof DOMException ? err.name : '';
          if (!preferredId || (name !== 'OverconstrainedError' && name !== 'NotFoundError')) throw err;
          if (!isCancelled()) setPreferredId(null);
          s = await open(null);
        }
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
        // Labels and the full device list are only exposed once permission has been granted.
        const cameras = await listCameras();
        if (isCancelled()) return;
        setDevices(cameras);
        const track = s.getVideoTracks()[0] ?? null;
        trackRef.current = track;
        setCurrentId(track?.getSettings().deviceId ?? null);
        setZoomState(await initialZoom(track));
        setOutcome({ attempt, status: 'ready' });
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
      trackRef.current = null;
      setZoomState(null);
      setOutcome(null);
    };
  }, [blocked, attempt, preferredId, setPreferredId]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  const selectDevice = useCallback(
    (deviceId: string) => {
      setPreferredId(deviceId);
    },
    [setPreferredId],
  );

  const setZoom = useCallback((value: number) => {
    const track = trackRef.current;
    if (!track) return;
    void track
      .applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] })
      .then(() => {
        setZoomState((z) => (z ? { ...z, value } : z));
      })
      .catch(() => undefined);
  }, []);

  const status: CameraStatus = blocked ?? (outcome?.attempt === attempt ? outcome.status : 'starting');
  return {
    videoRef,
    status,
    retry,
    devices,
    currentDeviceId: currentId,
    selectDevice,
    zoom,
    setZoom,
  };
}
