import type { GeoPoint, MapSummary } from '../types/map';

/** Maps further away than this (metres) are not opened automatically. */
export const MAX_AUTO_SWITCH_M = 500;

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
export function haversineM(a: GeoPoint, b: GeoPoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Closest map with a known position within `maxM` of `pos`; null when none qualifies. */
export function pickNearestMap(
  maps: MapSummary[],
  pos: GeoPoint,
  maxM: number = MAX_AUTO_SWITCH_M,
): MapSummary | null {
  let best: MapSummary | null = null;
  let bestD = Infinity;
  for (const m of maps) {
    if (!m.geo) continue;
    const d = haversineM(pos, m.geo);
    if (d <= maxM && d < bestD) {
      best = m;
      bestD = d;
    }
  }
  return best;
}
