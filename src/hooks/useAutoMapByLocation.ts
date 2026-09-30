import { useEffect, useRef } from 'react';
import { pickNearestMap } from '../services/nearestMap';
import type { MapSummary } from '../types/map';

interface Options {
  /** Turn on once the library is ready and no link decides which map to open. */
  enabled: boolean;
  maps: MapSummary[];
  activeMapId: string | null;
  switchMap: (id: string) => Promise<void>;
}

/**
 * Once per page load, opens the map closest to the device. Does nothing when the position is
 * unavailable or denied, when no map is close enough, or when the user picked a map meanwhile.
 */
export function useAutoMapByLocation({ enabled, maps, activeMapId, switchMap }: Options): void {
  const started = useRef(false);
  const latest = useRef({ maps, activeMapId, switchMap });
  useEffect(() => {
    latest.current = { maps, activeMapId, switchMap };
  });

  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    if (!('geolocation' in navigator)) return;
    if (!latest.current.maps.some((m) => m.geo)) return;
    const idAtStart = latest.current.activeMapId;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const { maps: current, activeMapId: currentId, switchMap: doSwitch } = latest.current;
        if (currentId !== idAtStart) return;
        const nearest = pickNearestMap(current, { lat: coords.latitude, lng: coords.longitude });
        if (nearest && nearest.id !== currentId) void doSwitch(nearest.id);
      },
      () => {
        // Denied or unavailable: keep the current map.
      },
      { timeout: 8000, maximumAge: 5 * 60_000 },
    );
  }, [enabled]);
}
