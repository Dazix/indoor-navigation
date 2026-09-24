import {
  Fragment,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { snapToMap } from '../../services/mapEditing';
import { resolveAssetUrl } from '../../services/mapStorage';
import type { Route } from '../../services/navigation';
import { isTrained } from '../../services/visionMatcher';
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

const GRID = [20, 40, 60, 80];
const DRAG_THRESHOLD = 1.2;

function toMapPoint(svg: SVGSVGElement, clientX: number, clientY: number): Point {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

/** Floor plan canvas in a 0–100 SVG coordinate space: rooms, corridors, waypoints and the route. */
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
  const drag = useRef<{ id: string; start: Point; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const { nodes, edges, rooms, floorPlanImage } = map;
  const canDrag = isEditor && tool === 'select';

  const userPoint: Point | null =
    route?.progress.position ?? (currentLocation && nodes[currentLocation] ? nodes[currentLocation] : null);

  const handleCanvasClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    // A drag with pointer capture ends in a click on the <svg>; it is not a canvas tap.
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (!svgRef.current) return;
    onCanvasTap(snapToMap(toMapPoint(svgRef.current, e.clientX, e.clientY)));
  };

  const startDrag = (id: string, e: ReactPointerEvent<SVGGElement>) => {
    if (!canDrag || !svgRef.current) return;
    e.stopPropagation();
    svgRef.current.setPointerCapture(e.pointerId);
    drag.current = { id, start: toMapPoint(svgRef.current, e.clientX, e.clientY), moved: false };
  };

  const moveDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || !svgRef.current) return;
    const p = toMapPoint(svgRef.current, e.clientX, e.clientY);
    if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < DRAG_THRESHOLD) return;
    if (!d.moved) setDraggingId(d.id);
    d.moved = true;
    onNodeDrag(d.id, snapToMap(p));
  };

  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
    drag.current = null;
    suppressClick.current = true;
    setDraggingId(null);
    if (!d.moved) onNodeTap(d.id);
  };

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden p-2 select-none sm:p-4">
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        role="img"
        aria-label={`Floor plan: ${map.metadata.name}`}
        className={`aspect-square max-h-full w-full max-w-full touch-none rounded-2xl border border-slate-300/80 bg-white shadow-inner dark:border-slate-700 dark:bg-slate-900 ${
          isEditor && tool === 'add_node' ? 'cursor-crosshair' : ''
        }`}
        onClick={handleCanvasClick}
        onPointerDownCapture={() => {
          suppressClick.current = false;
        }}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {floorPlanImage ? (
          <image
            href={resolveAssetUrl(floorPlanImage)}
            x={0}
            y={0}
            width={100}
            height={100}
            preserveAspectRatio="none"
            opacity={0.9}
          />
        ) : (
          <g className="stroke-slate-100 dark:stroke-slate-800" strokeWidth={0.4}>
            {GRID.map((c) => (
              <Fragment key={c}>
                <line x1={c} y1={0} x2={c} y2={100} />
                <line x1={0} y1={c} x2={100} y2={c} />
              </Fragment>
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
                strokeWidth={isTarget ? 1.2 : 0.5}
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
              strokeWidth={isEditor ? 1.3 : 1}
              strokeDasharray={isEditor ? '1.5 1.5' : undefined}
              strokeLinecap="round"
            />
          );
        })}

        {route && <PathOverlay route={route} />}

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
              onPointerDown={(e) => {
                startDrag(node.id, e);
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (!canDrag) onNodeTap(node.id);
              }}
              className={
                canDrag ? (draggingId === node.id ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-pointer'
              }
            >
              {/* Invisible larger hit area for fingers. */}
              <circle cx={node.x} cy={node.y} r={4} fill="transparent" />
              {isSelected && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={4.4}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth={0.8}
                  strokeDasharray="1.5 1"
                />
              )}
              <circle
                cx={node.x}
                cy={node.y}
                r={isEditor ? 2.4 : 1.7}
                fill={fill}
                stroke="#fff"
                strokeWidth={0.6}
              />
              {trained && isEditor && (
                <circle
                  cx={node.x + 1.8}
                  cy={node.y - 1.8}
                  r={0.9}
                  fill="#059669"
                  stroke="#fff"
                  strokeWidth={0.3}
                />
              )}
              {isEditor && (
                <text
                  x={node.x}
                  y={node.y - 3.4}
                  fontSize={2}
                  textAnchor="middle"
                  className="pointer-events-none fill-slate-900 font-semibold"
                  stroke="#ffffff"
                  strokeWidth={0.5}
                  paintOrder="stroke"
                >
                  {node.label}
                </text>
              )}
            </g>
          );
        })}

        {!isEditor && userPoint && (
          <g transform={`translate(${userPoint.x} ${userPoint.y})`} pointerEvents="none">
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
  );
}
