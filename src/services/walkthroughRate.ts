export type CaptureRateId = 'slow' | 'normal' | 'fast';

export interface CaptureRate {
  id: CaptureRateId;
  label: string;
  /** Time between two automatically captured views. */
  intervalMs: number;
}

const NORMAL_RATE: CaptureRate = { id: 'normal', label: 'Normal', intervalMs: 1200 };

/** Ordered from the longest to the shortest interval, so a slider index maps straight onto it. */
export const CAPTURE_RATES: readonly CaptureRate[] = [
  { id: 'slow', label: 'Slow', intervalMs: 2000 },
  NORMAL_RATE,
  { id: 'fast', label: 'Fast', intervalMs: 700 },
];

export const DEFAULT_CAPTURE_RATE: CaptureRateId = 'normal';

export function isCaptureRateId(value: unknown): value is CaptureRateId {
  return CAPTURE_RATES.some((rate) => rate.id === value);
}

export function parseCaptureRate(raw: unknown): CaptureRateId | null {
  return isCaptureRateId(raw) ? raw : null;
}

export function captureRate(id: CaptureRateId): CaptureRate {
  return CAPTURE_RATES.find((rate) => rate.id === id) ?? NORMAL_RATE;
}

/** "1.2 s", "2 s": seconds without a trailing zero. */
export function formatInterval(intervalMs: number): string {
  return `${Number((intervalMs / 1000).toFixed(1))} s`;
}
