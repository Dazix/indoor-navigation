import { describe, expect, it } from 'vitest';
import {
  CAPTURE_RATES,
  DEFAULT_CAPTURE_RATE,
  captureRate,
  formatInterval,
  parseCaptureRate,
} from '../walkthroughRate';

describe('walkthroughRate', () => {
  it('orders presets from the slowest to the fastest', () => {
    const intervals = CAPTURE_RATES.map((r) => r.intervalMs);
    expect(intervals).toEqual([...intervals].sort((a, b) => b - a));
  });

  it('keeps the default at the previous fixed 1.2 s', () => {
    expect(captureRate(DEFAULT_CAPTURE_RATE).intervalMs).toBe(1200);
  });

  it('accepts only known ids when loading a stored preference', () => {
    expect(parseCaptureRate('fast')).toBe('fast');
    expect(parseCaptureRate('turbo')).toBeNull();
    expect(parseCaptureRate(3)).toBeNull();
  });

  it('formats intervals in seconds', () => {
    expect(formatInterval(2000)).toBe('2 s');
    expect(formatInterval(1200)).toBe('1.2 s');
    expect(formatInterval(700)).toBe('0.7 s');
  });
});
