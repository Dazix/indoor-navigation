/** Throughput over a sliding time window, fed with cumulative byte counts. Times are in ms. */
export class RateMeter {
  private samples: { t: number; bytes: number }[] = [];
  private firstAt: number | null = null;
  private firstBytes = 0;

  private readonly windowMs: number;

  constructor(windowMs = 2000) {
    this.windowMs = windowMs;
  }

  add(bytes: number, t: number): void {
    if (this.firstAt === null) {
      this.firstAt = t;
      this.firstBytes = bytes;
    }
    this.samples.push({ t, bytes });
    while (this.samples.length > 2 && t - (this.samples[1]?.t ?? t) > this.windowMs) this.samples.shift();
  }

  /** Current speed in bytes per second, or null until two samples are far enough apart. */
  rate(): number | null {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last || last.t - first.t < 150) return null;
    return ((last.bytes - first.bytes) * 1000) / (last.t - first.t);
  }

  /** Average speed since the first sample, in bytes per second. */
  average(now: number): number | null {
    const last = this.samples[this.samples.length - 1];
    if (this.firstAt === null || !last || now - this.firstAt < 1) return null;
    return ((last.bytes - this.firstBytes) * 1000) / (now - this.firstAt);
  }
}

/** Seconds left at the given speed, or null when unknown. */
export function remainingSeconds(done: number, total: number, bytesPerSecond: number | null): number | null {
  if (!bytesPerSecond || bytesPerSecond <= 0 || total <= 0) return null;
  return Math.max(0, (total - done) / bytesPerSecond);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 1) return `${Math.max(0, Math.round(seconds * 1000))} ms`;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const m = Math.floor(seconds / 60);
  return `${m} min ${Math.round(seconds - m * 60)} s`;
}
