/** One accelerometer reading (m/s², including gravity) with its timestamp in milliseconds. */
export interface MotionSample {
  x: number;
  y: number;
  z: number;
  t: number;
}

export interface StepDetectorOptions {
  /** Magnitude above the running baseline (m/s²) that counts as a step peak. */
  threshold?: number;
  /** Minimum time between two steps; human cadence tops out around 3 steps/s. */
  minIntervalMs?: number;
  /** Low-pass smoothing factor for the signal, 0–1 (higher = less smoothing). */
  smoothing?: number;
  /** Adaptation rate of the gravity baseline, 0–1. */
  baselineRate?: number;
}

/**
 * Peak detector for walking steps from `DeviceMotionEvent.accelerationIncludingGravity`.
 *
 * The acceleration magnitude is low-pass filtered, compared against a slowly adapting baseline
 * (≈ gravity), and a step is emitted when the signal rises above `baseline + threshold` and then
 * falls back below `baseline + threshold / 2` (hysteresis), no sooner than `minIntervalMs` after
 * the previous step.
 *
 * Returns a function that consumes one sample and reports whether it completed a step.
 */
export function createStepDetector(options: StepDetectorOptions = {}): (sample: MotionSample) => boolean {
  const { threshold = 1.2, minIntervalMs = 300, smoothing = 0.35, baselineRate = 0.02 } = options;

  let filtered: number | null = null;
  let baseline: number | null = null;
  let aboveThreshold = false;
  let lastStepAt = -Infinity;

  return ({ x, y, z, t }) => {
    const magnitude = Math.hypot(x, y, z);
    filtered = filtered === null ? magnitude : filtered + smoothing * (magnitude - filtered);
    baseline = baseline === null ? magnitude : baseline + baselineRate * (filtered - baseline);

    const excess = filtered - baseline;
    if (!aboveThreshold && excess > threshold) {
      aboveThreshold = true;
      return false;
    }
    if (aboveThreshold && excess < threshold / 2) {
      aboveThreshold = false;
      if (t - lastStepAt >= minIntervalMs) {
        lastStepAt = t;
        return true;
      }
    }
    return false;
  };
}
