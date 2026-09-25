import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

interface QrCodeProps {
  value: string;
  /** Accessible description of what the code contains. */
  label: string;
  className?: string;
}

const QUIET_ZONE = 4;

/** Renders text as a QR code: dark modules on white with a quiet zone, so it scans in dark mode too. */
export function QrCode({ value, label, className = '' }: QrCodeProps) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'L');
    qr.addData(value, 'Byte');
    qr.make();
    const count = qr.getModuleCount();
    let d = '';
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) d += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
      }
    }
    return { size: count + QUIET_ZONE * 2, path: d };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={`aspect-square rounded-xl bg-white ${className}`}
    >
      <path d={path} fill="#000" />
    </svg>
  );
}
