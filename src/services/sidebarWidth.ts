export const SIDEBAR_MIN = 280;
export const SIDEBAR_MAX = 640;
export const SIDEBAR_DEFAULT = 320;

/** Largest share of the viewport the editor sidebar may take, so the map keeps room. */
const MAX_VIEWPORT_SHARE = 0.6;

/** Clamps a sidebar width in px to [SIDEBAR_MIN, SIDEBAR_MAX], capped to a share of the viewport. */
export function clampSidebarWidth(px: number, viewportWidth: number): number {
  const max = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, viewportWidth * MAX_VIEWPORT_SHARE));
  return Math.round(Math.min(max, Math.max(SIDEBAR_MIN, px)));
}

/** Validates a persisted width; `null` for anything that is not a finite number. */
export function parseSidebarWidth(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, raw)));
}
