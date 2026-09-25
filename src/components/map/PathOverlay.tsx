import type { CSSProperties } from 'react';
import type { Point } from '../../types/map';
import type { Route } from '../../services/navigation';

interface PathOverlayProps {
  route: Route;
  /** Multiplier for stroke widths and the pin so they keep their on-screen size when zoomed. */
  scale?: number;
}

function toPoints(points: readonly Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

/** Draws the walked part of the route faded and the remaining part as an animated dashed line. */
export function PathOverlay({ route, scale = 1 }: PathOverlayProps) {
  const { points, progress } = route;
  if (points.length < 2) return null;

  const walked = [...points.slice(0, progress.nextIndex), progress.position];
  const remaining = [progress.position, ...points.slice(progress.nextIndex)];
  const end = points[points.length - 1] as Point;

  return (
    <g pointerEvents="none">
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
        <>
          <polyline
            points={toPoints(remaining)}
            fill="none"
            className="stroke-brand-600/25"
            strokeWidth={4.2 * scale}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points={toPoints(remaining)}
            fill="none"
            className="animate-dash stroke-brand-600 dark:stroke-brand-400"
            strokeWidth={2.2 * scale}
            strokeDasharray={`${3 * scale} ${1.5 * scale}`}
            style={{ '--dash-scale': scale } as CSSProperties}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      <g transform={`translate(${end.x} ${end.y}) scale(${scale})`}>
        <path
          d="M0 0 C -2.6 -3.2 -3 -4.4 -3 -5.6 A 3 3 0 1 1 3 -5.6 C 3 -4.4 2.6 -3.2 0 0 Z"
          className="fill-red-500"
          stroke="#fff"
          strokeWidth={0.5}
        />
        <circle cy={-5.6} r={1.1} fill="#fff" />
      </g>
    </g>
  );
}
