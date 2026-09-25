import type { Route } from './navigation';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Identity of a route: changes with a new start or destination, not with the user's progress. */
export function routeKey(route: Pick<Route, 'path'>): string {
  return route.path.join('>');
}

/** How long drawing the route on takes: longer routes draw slower, within sensible bounds. */
export function revealDurationMs(totalM: number): number {
  return Math.round(clamp(totalM * 25, 600, 1800));
}

/** One run of the travelling pulse (including the pause after it) along the route. */
export function pulseDurationMs(totalM: number): number {
  return Math.round(clamp(totalM * 60, 1600, 3500));
}
