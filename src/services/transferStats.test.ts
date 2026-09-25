import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, formatRate, RateMeter, remainingSeconds } from './transferStats';

describe('transfer stats', () => {
  it('measures speed over a sliding window', () => {
    const meter = new RateMeter(1000);
    meter.add(0, 0);
    expect(meter.rate()).toBeNull();
    meter.add(100_000, 500);
    expect(meter.rate()).toBe(200_000);
    // Speed drops: only recent samples count.
    meter.add(200_000, 1000);
    meter.add(210_000, 2000);
    meter.add(220_000, 3000);
    expect(meter.rate()).toBe(10_000);
    expect(meter.average(3000)).toBeCloseTo(73_333, 0);
  });

  it('estimates the remaining time', () => {
    expect(remainingSeconds(1_000, 3_000, 1_000)).toBe(2);
    expect(remainingSeconds(1_000, 3_000, null)).toBeNull();
    expect(remainingSeconds(0, 0, 1_000)).toBeNull();
  });

  it('formats sizes, speeds and durations', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(5_120)).toBe('5.0 kB');
    expect(formatBytes(620_000)).toBe('605 kB');
    expect(formatBytes(3_500_000)).toBe('3.3 MB');
    expect(formatRate(2_097_152)).toBe('2.0 MB/s');
    expect(formatDuration(0.027)).toBe('27 ms');
    expect(formatDuration(4.25)).toBe('4.3 s');
    expect(formatDuration(75)).toBe('1 min 15 s');
  });
});
