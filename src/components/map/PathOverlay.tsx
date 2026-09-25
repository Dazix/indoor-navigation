import { useEffect, useId, useState, type CSSProperties } from 'react';
import type { Point } from '../../types/map';
import type { Route } from '../../services/navigation';
import { pulseDurationMs, revealDurationMs, routeKey } from '../../services/routeAnimation';

interface PathOverlayProps {
  route: Route;
  /** Multiplier for stroke widths and the pin so they keep their on-screen size when zoomed. */
  scale?: number;
}

function toPoints(points: readonly Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Draws the walked part of the route faded and the remaining part as an animated dashed line.
 * A new route is drawn on from the user's position to the destination; afterwards a soft pulse
 * periodically travels along the remaining part.
 */
export function PathOverlay({ route, scale = 1 }: PathOverlayProps) {
  const { points, progress } = route;
  const key = routeKey(route);
  const maskId = `route-reveal-${useId()}`;
  // Timings are fixed per route: walking shortens it, and a changed duration would make a running
  // animation jump.
  const timings = (k: string) => ({
    key: k,
    ms: revealDurationMs(route.totalM),
    pulseMs: pulseDurationMs(route.totalM),
  });
  const [reveal, setReveal] = useState(() => timings(key));
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  if (reveal.key !== key) setReveal(timings(key));
  const revealing = revealedKey !== key;
  const pulseStyle = { animationDuration: `${reveal.pulseMs}ms` };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRevealedKey(key);
    }, reveal.ms);
    return () => {
      window.clearTimeout(timer);
    };
  }, [key, reveal.ms]);

  if (points.length < 2) return null;

  const reducedMotion = prefersReducedMotion();

  const walked = [...points.slice(0, progress.nextIndex), progress.position];
  const remaining = [progress.position, ...points.slice(progress.nextIndex)];
  const end = points[points.length - 1] as Point;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const pad = 10 * scale;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;

  return (
    <g pointerEvents="none">
      {revealing && (
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x={minX}
          y={minY}
          width={Math.max(...xs) + pad - minX}
          height={Math.max(...ys) + pad - minY}
        >
          <polyline
            key={key}
            points={toPoints(points)}
            pathLength={1}
            fill="none"
            stroke="#fff"
            strokeWidth={8 * scale}
            strokeDasharray="1 1"
            strokeDashoffset={1}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="animate-route-reveal"
            style={{ animationDuration: `${reveal.ms}ms` }}
          />
        </mask>
      )}
      {walked.length > 1 && (
        <polyline
          points={toPoints(walked)}
          fill="none"
          className="stroke-brand-300 dark:stroke-brand-900"
          strokeWidth={2 * scale}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {remaining.length > 1 && (
        <g mask={revealing ? `url(#${maskId})` : undefined}>
          <polyline
            points={toPoints(remaining)}
            fill="none"
            className="stroke-brand-600/15 dark:stroke-brand-400/15"
            strokeWidth={3.6 * scale}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points={toPoints(remaining)}
            fill="none"
            className="animate-dash stroke-brand-600 dark:stroke-brand-400"
            strokeWidth={2.2 * scale}
            // Round caps add half the width to each end: 1.2 + 2.2 visible dash, 4.3 - 2.2 gap.
            strokeDasharray={`${1.2 * scale} ${4.3 * scale}`}
            style={{ '--dash-scale': scale } as CSSProperties}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
      {!revealing && remaining.length > 1 && !reducedMotion && (
        <g>
          <polyline
            points={toPoints(remaining)}
            pathLength={1}
            fill="none"
            className="animate-route-pulse stroke-brand-400/30 dark:stroke-brand-300/25"
            style={pulseStyle}
            strokeWidth={5 * scale}
            strokeDasharray="0.1 1.3"
            strokeDashoffset={0.1}
            opacity={0}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points={toPoints(remaining)}
            pathLength={1}
            fill="none"
            className="animate-route-pulse stroke-white/90 dark:stroke-brand-100/80"
            style={pulseStyle}
            strokeWidth={1.6 * scale}
            strokeDasharray="0.1 1.3"
            strokeDashoffset={0.1}
            opacity={0}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
      <g transform={`translate(${end.x} ${end.y}) scale(${scale})`}>
        <g
          key={key}
          className="animate-pin-pop"
          style={{ transformOrigin: '0 0', animationDelay: reducedMotion ? '0ms' : `${reveal.ms}ms` }}
        >
          <path
            d="M0 0 C -2.6 -3.2 -3 -4.4 -3 -5.6 A 3 3 0 1 1 3 -5.6 C 3 -4.4 2.6 -3.2 0 0 Z"
            className="fill-red-500"
            stroke="#fff"
            strokeWidth={0.5}
          />
          <circle cy={-5.6} r={1.1} fill="#fff" />
        </g>
      </g>
    </g>
  );
}
