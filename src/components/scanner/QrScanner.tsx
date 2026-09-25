import { Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { CAMERA_STATUS_TEXT, useCamera } from '../../hooks/useCamera';
import { isFrameReady } from '../../services/visionMatcher';
import { Button } from '../ui/Button';

interface QrScannerProps {
  /** Called with every decoded QR text until `accept` returns true. */
  accept: (text: string) => boolean;
}

const SCAN_INTERVAL_MS = 250;
// Handshake codes are dense; a higher resolution than the vision scanner keeps them readable.
const CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 1280 },
  height: { ideal: 960 },
};

type Decoder = (video: HTMLVideoElement) => Promise<string[]>;

/** BarcodeDetector where available; jsQR (loaded on demand) elsewhere, e.g. iOS Safari. */
async function createDecoder(): Promise<Decoder> {
  if (window.BarcodeDetector) {
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    return async (video) => (await detector.detect(video)).map((c) => c.rawValue);
  }
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return (video) => {
    if (!ctx) return Promise.resolve([]);
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
    return Promise.resolve(code ? [code.data] : []);
  };
}

/** Live camera view that reads QR codes. */
export function QrScanner({ accept }: QrScannerProps) {
  const { videoRef, status, retry } = useCamera(true, CONSTRAINTS);
  const acceptRef = useRef(accept);
  useEffect(() => {
    acceptRef.current = accept;
  });

  useEffect(() => {
    if (status !== 'ready') return;
    let cancelled = false;
    let busy = false;
    let done = false;
    let decode: Decoder | null = null;
    void createDecoder().then((d) => {
      decode = d;
    });

    const timer = setInterval(() => {
      const video = videoRef.current;
      if (cancelled || busy || done || !decode || !isFrameReady(video)) return;
      busy = true;
      decode(video)
        .then((texts) => {
          if (cancelled) return;
          done = texts.some((t) => acceptRef.current(t));
        })
        .catch((err: unknown) => {
          console.warn('QR scan failed', err);
        })
        .finally(() => {
          busy = false;
        });
    }, SCAN_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [status, videoRef]);

  return (
    <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl bg-black">
      <video ref={videoRef} autoPlay playsInline muted className="size-full object-cover" />
      {status === 'ready' ? (
        <div className="pointer-events-none absolute inset-[12%] rounded-2xl border-2 border-white/70" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-300">
          {status === 'starting' ? <Loader2 className="size-6 animate-spin" /> : null}
          <p>{CAMERA_STATUS_TEXT[status]}</p>
          {(status === 'denied' || status === 'unavailable') && (
            <Button variant="secondary" size="sm" onClick={retry}>
              Try again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
