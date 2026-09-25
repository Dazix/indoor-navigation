import { Maximize, Minus, Plus } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { floorPlanQuarterTurns, snapToMap } from '../../services/mapEditing';
import { resolveAssetUrl } from '../../services/mapStorage';
import type { Route } from '../../services/navigation';
import { isTrained } from '../../services/visionMatcher';
import {
  clampView,
  fitView,
  MAX_ZOOM,
  MIN_ZOOM,
  snapStep,
  viewBoxOf,
  zoomAround,
  type MapView,
} from '../../services/viewport';
import type { MapData, Point } from '../../types/map';
import type { EditorTool } from '../../types/navigation';
import { PathOverlay } from './PathOverlay';

interface InteractiveMapProps {
  map: MapData;
  route: Route | null;
  currentLocation: string | null;
  destination: string | null;
  /** Map-relative heading of the user (degrees clockwise from the top of the plan). */
  userHeadingDeg?: number | null;
  isEditor: boolean;
  tool: EditorTool;
  selectedNodeId: string | null;
  onNodeTap: (id: string) => void;
  onRoomTap: (nodeId: string) => void;
  onCanvasTap: (point: Point) => void;
  onNodeDrag: (id: string, point: Point) => void;
}

const GRID_STEP = 20;
/** Node drag threshold in map units at 1× zoom. */
const DRAG_THRESHOLD = 1.2;
/** Screen distance a pan has to travel before it stops being a tap. */
const PAN_THRESHOLD_PX = 5;
const BUTTON_ZOOM_STEP = 1.5;

type Gesture =
  | { kind: 'node'; id: string; start: Point; moved: boolean }
  | { kind: 'pan'; pointerId: number; startX: number; startY: number; startView: MapView; moved: boolean }
  | { kind: 'pinch'; startDist: number; startMid: Point; startView: MapView }
  /** A pinch lost a finger: ignore the rest until every pointer is up. */
  | { kind: 'done' };

function toMapPoint(svg: SVGSVGElement, clientX: number, clientY: number): Point {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

function gridLines(max: number): number[] {
  const lines: number[] = [];
  for (let c = GRID_STEP; c < max; c += GRID_STEP) lines.push(c);
  return lines;
}

/**
 * Floor plan canvas in map units (width × height from the map metadata): rooms, corridors,
 * waypoints and the route. Supports wheel / pinch zoom and drag-to-pan.
 */
export function InteractiveMap({
  map,
  route,
  currentLocation,
  destination,
  userHeadingDeg,
  isEditor,
  tool,
  selectedNodeId,
  onNodeTap,
  onRoomTap,
  onCanvasTap,
  onNodeDrag,
}: InteractiveMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const suppressClick = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const { nodes, edges, rooms, floorPlanImage, metadata } = map;
  const { width, height, floorPlanRotationDeg } = metadata;
  const size = { width, height };
  const canDrag = isEditor && tool === 'select';

  const [view, setView] = useState<MapView>(() => fitView(size));
  // A new canvas size (aspect change, rotation) starts from the whole map again.
  const [viewSize, setViewSize] = useState(`${width}×${height}`);
  if (viewSize !== `${width}×${height}`) {
    setViewSize(`${width}×${height}`);
    setView(fitView(size));
  }
  const viewRef = useRef(view);
  useLayoutEffect(() => {
    viewRef.current = view;
  }, [view]);

  const vb = viewBoxOf(view, size);
  /** Marker scale: nodes, labels and the route keep their on-screen size while zooming. */
  const s = 1 / view.zoom;

  const userPoint: Point | null =
    route?.progress.position ?? (currentLocation && nodes[currentLocation] ? nodes[currentLocation] : null);

  const snap = (p: Point) => snapToMap(p, size, snapStep(view.zoom));

  // Wheel / trackpad zoom around the cursor. React registers wheel listeners as passive, so the
  // listener is attached by hand to be able to stop the page from scrolling.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const current = viewRef.current;
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      setView(
        zoomAround(current, current.zoom * factor, toMapPoint(svg, e.clientX, e.clientY), { width, height }),
      );
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      svg.removeEventListener('wheel', onWheel);
    };
  }, [width, height]);

  const zoomBy = (factor: number) => {
    setView((v) => zoomAround(v, v.zoom * factor, { x: v.cx, y: v.cy }, size));
  };

  const handleCanvasClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    // A drag or pan with pointer capture ends in a click on the <svg>; it is not a canvas tap.
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (!svgRef.current) return;
    onCanvasTap(snap(toMapPoint(svgRef.current, e.clientX, e.clientY)));
  };

  const pinchState = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return null;
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    suppressClick.current = false;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      const pinch = pinchState();
      if (!pinch) return;
      if (gesture.current?.kind === 'node') setDraggingId(null);
      for (const id of pointers.current.keys()) {
        if (!svg.hasPointerCapture(id)) svg.setPointerCapture(id);
      }
      gesture.current = {
        kind: 'pinch',
        startDist: Math.max(1, pinch.dist),
        startMid: toMapPoint(svg, pinch.mid.x, pinch.mid.y),
        startView: viewRef.current,
      };
      return;
    }
    if (pointers.current.size > 2) return;

    const nodeId = (e.target as Element).closest('[data-node-id]')?.getAttribute('data-node-id');
    if (e.button === 1) e.preventDefault(); // no auto-scroll on middle click
    if (canDrag && nodeId && e.button === 0) {
      svg.setPointerCapture(e.pointerId);
      gesture.current = {
        kind: 'node',
        id: nodeId,
        start: toMapPoint(svg, e.clientX, e.clientY),
        moved: false,
      };
    } else if (e.button === 0 || e.button === 1) {
      gesture.current = {
        kind: 'pan',
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startView: viewRef.current,
        moved: false,
      };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const g = gesture.current;
    if (!svg || !g || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = svg.getBoundingClientRect();

    if (g.kind === 'pinch') {
      const pinch = pinchState();
      if (!pinch || rect.width === 0) return;
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (g.startView.zoom * pinch.dist) / g.startDist));
      // Keep the map point that started under the fingers under their current midpoint.
      const w = width / zoom;
      const h = height / zoom;
      const x = g.startMid.x - ((pinch.mid.x - rect.left) / rect.width) * w;
      const y = g.startMid.y - ((pinch.mid.y - rect.top) / rect.height) * h;
      setView(clampView({ zoom, cx: x + w / 2, cy: y + h / 2 }, size));
    } else if (g.kind === 'pan') {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (!g.moved) {
        if (Math.hypot(dx, dy) < PAN_THRESHOLD_PX) return;
        g.moved = true;
        svg.setPointerCapture(e.pointerId);
      }
      if (rect.width === 0) return;
      const { w, h } = viewBoxOf(g.startView, size);
      setView(
        clampView(
          {
            zoom: g.startView.zoom,
            cx: g.startView.cx - (dx / rect.width) * w,
            cy: g.startView.cy - (dy / rect.height) * h,
          },
          size,
        ),
      );
    } else if (g.kind === 'node') {
      const p = toMapPoint(svg, e.clientX, e.clientY);
      if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) < DRAG_THRESHOLD * s) return;
      if (!g.moved) setDraggingId(g.id);
      g.moved = true;
      onNodeDrag(g.id, snap(p));
    }
  };

  const onPointerEnd = (e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!pointers.current.delete(e.pointerId)) return;
    if (svg?.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    const g = gesture.current;
    if (!g) return;

    if (g.kind === 'node') {
      gesture.current = null;
      suppressClick.current = true;
      setDraggingId(null);
      if (!g.moved) onNodeTap(g.id);
    } else if (g.kind === 'pan') {
      gesture.current = null;
      if (g.moved) suppressClick.current = true;
    } else {
      suppressClick.current = true;
      gesture.current = pointers.current.size === 0 ? null : { kind: 'done' };
    }
  };

  // Floor plan image box: for odd quarter turns it is laid out with swapped sides and rotated into place.
  const quarterTurns = floorPlanQuarterTurns(floorPlanRotationDeg);
  const [imgW, imgH] = quarterTurns % 2 ? [height, width] : [width, height];

  return (
    <div className="relative h-full w-full overflow-hidden p-2 select-none sm:p-4">
      <div className="flex h-full w-full items-center justify-center @container-[size]">
        <svg
          ref={svgRef}
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          role="img"
          aria-label={`Floor plan: ${map.metadata.name}`}
          style={{
            aspectRatio: `${width} / ${height}`,
            width: `min(100cqw, calc(100cqh * ${width / height}))`,
          }}
          className={`touch-none rounded-2xl border border-slate-300/80 bg-white shadow-inner dark:border-slate-700 dark:bg-slate-900 ${
            isEditor && tool === 'add_node' ? 'cursor-crosshair' : ''
          }`}
          onClick={handleCanvasClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onAuxClick={(e) => {
            e.preventDefault();
          }}
        >
          {floorPlanImage ? (
            <image
              href={resolveAssetUrl(floorPlanImage)}
              x={(width - imgW) / 2}
              y={(height - imgH) / 2}
              width={imgW}
              height={imgH}
              preserveAspectRatio="none"
              transform={
                floorPlanRotationDeg
                  ? `rotate(${floorPlanRotationDeg} ${width / 2} ${height / 2})`
                  : undefined
              }
              opacity={0.9}
            />
          ) : (
            <g className="stroke-slate-100 dark:stroke-slate-800" strokeWidth={0.4 * s}>
              {gridLines(width).map((c) => (
                <line key={`x${c}`} x1={c} y1={0} x2={c} y2={height} />
              ))}
              {gridLines(height).map((c) => (
                <line key={`y${c}`} x1={0} y1={c} x2={width} y2={c} />
              ))}
            </g>
          )}

          {rooms.map((room) => {
            const linked = room.nodeId in nodes;
            const isTarget = destination === room.nodeId;
            return (
              <g
                key={room.id}
                onClick={(e) => {
                  if (isEditor || !linked) return;
                  e.stopPropagation();
                  onRoomTap(room.nodeId);
                }}
                className={!isEditor && linked ? 'cursor-pointer transition-opacity hover:opacity-80' : ''}
              >
                <rect
                  x={room.x}
                  y={room.y}
                  width={room.w}
                  height={room.h}
                  rx={2}
                  fill={isTarget ? '#ede9fe' : room.color}
                  opacity={floorPlanImage ? 0.55 : 0.85}
                  stroke={isTarget ? '#6366f1' : '#94a3b8'}
                  strokeWidth={(isTarget ? 1.2 : 0.5) * s}
                />
                <text
                  x={room.x + room.w / 2}
                  y={room.y + 3.6}
                  fontSize={2.6}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className={`pointer-events-none font-bold ${isTarget ? 'fill-brand-700' : 'fill-slate-800'}`}
                >
                  {room.label}
                </text>
              </g>
            );
          })}

          {edges.map(([u, v]) => {
            const a = nodes[u];
            const b = nodes[v];
            if (!a || !b) return null;
            return (
              <line
                key={`${u}-${v}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className={isEditor ? 'stroke-slate-400' : 'stroke-slate-300 dark:stroke-slate-600'}
                strokeWidth={(isEditor ? 1.3 : 1) * s}
                strokeDasharray={isEditor ? `${1.5 * s} ${1.5 * s}` : undefined}
                strokeLinecap="round"
              />
            );
          })}

          {route && <PathOverlay route={route} scale={s} />}

          {Object.values(nodes).map((node) => {
            const isSelected = selectedNodeId === node.id;
            const isUser = currentLocation === node.id;
            const isTarget = destination === node.id;
            const trained = isTrained(node);
            const fill = isTarget
              ? '#ef4444'
              : isSelected
                ? '#f59e0b'
                : isUser
                  ? '#2563eb'
                  : trained
                    ? '#10b981'
                    : '#64748b';

            return (
              <g
                key={node.id}
                role="button"
                aria-label={node.label}
                data-node-id={node.id}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!canDrag) onNodeTap(node.id);
                }}
                className={
                  canDrag ? (draggingId === node.id ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-pointer'
                }
              >
                {/* Invisible larger hit area for fingers. */}
                <circle cx={node.x} cy={node.y} r={4 * s} fill="transparent" />
                {isSelected && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={4.4 * s}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth={0.8 * s}
                    strokeDasharray={`${1.5 * s} ${s}`}
                  />
                )}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={(isEditor ? 2.4 : 1.7) * s}
                  fill={fill}
                  stroke="#fff"
                  strokeWidth={0.6 * s}
                />
                {trained && isEditor && (
                  <circle
                    cx={node.x + 1.8 * s}
                    cy={node.y - 1.8 * s}
                    r={0.9 * s}
                    fill="#059669"
                    stroke="#fff"
                    strokeWidth={0.3 * s}
                  />
                )}
                {isEditor && (
                  <text
                    x={node.x}
                    y={node.y - 3.4 * s}
                    fontSize={2 * s}
                    textAnchor="middle"
                    className="pointer-events-none fill-slate-900 font-semibold"
                    stroke="#ffffff"
                    strokeWidth={0.5 * s}
                    paintOrder="stroke"
                  >
                    {node.label}
                  </text>
                )}
              </g>
            );
          })}

          {!isEditor && userPoint && (
            <g transform={`translate(${userPoint.x} ${userPoint.y}) scale(${s})`} pointerEvents="none">
              {userHeadingDeg != null && (
                <path
                  d="M0 0 L-3.4 -8 A 8.7 8.7 0 0 1 3.4 -8 Z"
                  transform={`rotate(${userHeadingDeg})`}
                  className="fill-blue-500/25"
                />
              )}
              <circle r={4.5} className="animate-ping fill-blue-500/30" />
              <circle r={2.2} fill="#2563eb" stroke="#fff" strokeWidth={0.6} />
              <circle r={0.8} fill="#fff" />
            </g>
          )}
        </svg>
      </div>

      <div
        className="absolute top-1/2 right-3 z-10 flex -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-lg backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/95"
        role="toolbar"
        aria-label="Map zoom"
      >
        <ZoomButton
          label="Zoom in"
          onClick={() => {
            zoomBy(BUTTON_ZOOM_STEP);
          }}
          disabled={view.zoom >= MAX_ZOOM}
        >
          <Plus className="size-4" />
        </ZoomButton>
        <span className="py-0.5 text-center text-[10px] font-semibold text-slate-500 tabular-nums">
          {Math.round(view.zoom * 100)}%
        </span>
        <ZoomButton
          label="Zoom out"
          onClick={() => {
            zoomBy(1 / BUTTON_ZOOM_STEP);
          }}
          disabled={view.zoom <= MIN_ZOOM}
        >
          <Minus className="size-4" />
        </ZoomButton>
        <ZoomButton
          label="Fit map"
          onClick={() => {
            setView(fitView(size));
          }}
          disabled={view.zoom <= MIN_ZOOM}
        >
          <Maximize className="size-4" />
        </ZoomButton>
      </div>
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-9 items-center justify-center text-slate-700 hover:bg-slate-100 disabled:opacity-35 dark:text-slate-200 dark:hover:bg-slate-800"
    >
      {children}
    </button>
  );
}
