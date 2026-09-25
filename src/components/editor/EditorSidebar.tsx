import {
  ClipboardPaste,
  Download,
  ImageUp,
  Link,
  Link2,
  MousePointer2,
  Plus,
  QrCode,
  RotateCcw,
  RotateCw,
  Ruler,
  Scan,
  Share2,
  Trash2,
  Upload,
} from 'lucide-react';
import { useState, useRef, type ChangeEvent, type ReactNode } from 'react';
import {
  floorPlanFineDeg,
  longSideMeters,
  MAX_FINE_ROTATION_DEG,
  metersPerUnitForLongSide,
} from '../../services/mapEditing';
import { buildNodeLink, MAP_FILE_ACCEPT } from '../../services/mapSharing';
import { distance } from '../../services/geometry';
import type { MapData, MapMetadata, MapNode, Point } from '../../types/map';
import type { EditorTool } from '../../types/navigation';
import { LocationSearch } from '../map/LocationSearch';
import { Button } from '../ui/Button';
import { NodeDetailsCard } from './NodeDetailsCard';

interface EditorSidebarProps {
  map: MapData;
  tool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  selectedNode: MapNode | null;
  linkFrom: MapNode | null;
  message: { tone: 'error' | 'info'; text: string } | null;
  onMetadataChange: (patch: Partial<MapMetadata>) => void;
  onFloorPlanUpload: (file: File) => void;
  onFloorPlanRemove: () => void;
  onFloorPlanPaste: () => void;
  /** New width / height ratio of the map. */
  onAspectChange: (ratio: number) => void;
  onFitToImage: () => void;
  onRotate90: (clockwise: boolean) => void;
  onFineRotation: (deg: number) => void;
  onExport: () => void;
  onShare: () => void;
  onSendNearby: () => void;
  onShareLink: () => void;
  onImport: (file: File) => void;
  onNodeChange: (patch: Partial<Pick<MapNode, 'label' | 'markerCode'>>) => void;
  onRecordWalkthrough: () => void;
  onClearViews: () => void;
  onDeleteNode: () => void;
  onDeselect: () => void;
  /** URL the active map was loaded from via a share link; location links then carry it. */
  mapSourceUrl?: string;
  /** A location picked in the search field. */
  onFindNode: (nodeId: string) => void;
  /** Ends of the line drawn with the measure tool (0–2 points). */
  measureLine: Point[];
  /** Sets the scale so the measured line is `meters` long. */
  onApplyMeasure: (meters: number) => void;
  onClearMeasure: () => void;
}

const TOOLS: { id: EditorTool; label: string; icon: ReactNode; hint: string }[] = [
  {
    id: 'select',
    label: 'Select',
    icon: <MousePointer2 className="size-4" />,
    hint: 'Tap a location to edit it, drag to move it. Click a corridor to add a bend point.',
  },
  {
    id: 'add_node',
    label: 'Add',
    icon: <Plus className="size-4" />,
    hint: 'Tap the floor plan to place a new location.',
  },
  {
    id: 'link_nodes',
    label: 'Connect',
    icon: <Link2 className="size-4" />,
    hint: 'Tap two locations to add or remove a walkable corridor.',
  },
  {
    id: 'delete',
    label: 'Delete',
    icon: <Trash2 className="size-4" />,
    hint: 'Tap a location, a corridor or a bend point to delete it.',
  },
  {
    id: 'measure',
    label: 'Measure',
    icon: <Ruler className="size-4" />,
    hint: 'Tap both ends of a wall or anything else you know the real length of. Zoom in for precision.',
  },
];

const heading = 'mb-2 text-[11px] font-bold tracking-wider text-slate-400 uppercase';
const input =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800';

/** Map authoring panel: map settings, floor plan, import/export and graph tools. */
export function EditorSidebar(props: EditorSidebarProps) {
  const { map, tool, onToolChange, selectedNode, linkFrom, message } = props;
  const planInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const activeTool = TOOLS.find((t) => t.id === tool);
  const { width, height, metersPerUnit } = map.metadata;
  const fineDeg = floorPlanFineDeg(map.metadata.floorPlanRotationDeg);
  const appUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href;

  const pickFile = (e: ChangeEvent<HTMLInputElement>, handler: (file: File) => void) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) handler(file);
  };

  return (
    <aside className="z-10 flex max-h-[45dvh] w-full shrink-0 flex-col gap-4 overflow-x-hidden overflow-y-auto border-b border-slate-200 bg-white p-4 shadow-lg md:max-h-none md:w-80 md:border-r md:border-b-0 dark:border-slate-800 dark:bg-slate-900">
      {Object.keys(map.nodes).length > 0 && (
        <LocationSearch map={map} placeholder="Find a location" onPick={props.onFindNode} />
      )}

      <section>
        <h2 className={heading}>Tools</h2>
        <div className="grid grid-cols-5 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="toolbar">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tool === t.id}
              onClick={() => {
                onToolChange(t.id);
              }}
              className={`flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] font-semibold ${
                tool === t.id
                  ? `bg-white shadow-sm dark:bg-slate-700 ${t.id === 'delete' ? 'text-red-600' : 'text-brand-600 dark:text-brand-300'}`
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          {tool === 'link_nodes' && linkFrom
            ? `Connecting from “${linkFrom.label}” — tap the second location.`
            : activeTool?.hint}
        </p>
        {tool === 'measure' && (
          <MeasurePanel
            line={props.measureLine}
            metersPerUnit={metersPerUnit}
            onApply={props.onApplyMeasure}
            onClear={props.onClearMeasure}
          />
        )}
        <p className="mt-1 text-[10px] text-slate-500">
          Scroll or pinch to zoom, drag an empty spot to pan. Zoomed in, points snap more finely.
        </p>
      </section>

      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-xl px-3 py-2 text-xs ${
            message.tone === 'error'
              ? 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
              : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
          }`}
        >
          {message.text}
        </p>
      )}

      {selectedNode && (
        <NodeDetailsCard
          node={selectedNode}
          onChange={props.onNodeChange}
          onRecord={props.onRecordWalkthrough}
          onClearViews={props.onClearViews}
          onDelete={props.onDeleteNode}
          onClose={props.onDeselect}
          link={buildNodeLink(appUrl, selectedNode.id, props.mapSourceUrl)}
          linkHasMap={Boolean(props.mapSourceUrl)}
        />
      )}

      <section className="flex flex-col gap-2">
        <h2 className={heading}>Map settings</h2>
        <label className="flex min-w-0 flex-col gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
          Name
          <input
            className={input}
            value={map.metadata.name}
            maxLength={200}
            onChange={(e) => {
              props.onMetadataChange({ name: e.target.value });
            }}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex min-w-0 flex-col gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
            Scale (m / unit)
            <input
              className={input}
              type="number"
              inputMode="decimal"
              min={0.01}
              max={100}
              step={0.01}
              value={Math.round(map.metadata.metersPerUnit * 10000) / 10000}
              onChange={(e) => {
                const v = e.target.valueAsNumber;
                if (v > 0 && v <= 100) props.onMetadataChange({ metersPerUnit: v });
              }}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
            Plan faces (° from N)
            <input
              className={input}
              type="number"
              inputMode="numeric"
              min={0}
              max={359}
              step={1}
              value={map.metadata.northOffsetDeg}
              onChange={(e) => {
                const v = e.target.valueAsNumber;
                if (Number.isFinite(v)) props.onMetadataChange({ northOffsetDeg: ((v % 360) + 360) % 360 });
              }}
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex min-w-0 flex-col gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
            Longer side (m)
            <input
              className={input}
              type="number"
              inputMode="decimal"
              min={0.1}
              step={0.1}
              value={Math.round(longSideMeters(map.metadata) * 100) / 100}
              onChange={(e) => {
                const mpu = metersPerUnitForLongSide(map.metadata, e.target.valueAsNumber);
                if (mpu > 0 && mpu <= 100) props.onMetadataChange({ metersPerUnit: mpu });
              }}
            />
          </label>
          <AspectInput
            width={map.metadata.width}
            height={map.metadata.height}
            onChange={props.onAspectChange}
          />
        </div>
        <p className="text-[10px] leading-relaxed text-slate-500">
          The map is {formatNumber(width)} × {formatNumber(height)} units ={' '}
          {formatNumber(width * metersPerUnit)} × {formatNumber(height * metersPerUnit)} m. Enter the real
          length of the plan’s longer side and the scale follows. “Plan faces” is the compass heading you look
          at when facing the top of the floor plan; the AR arrow uses it.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={heading}>Floor plan & data</h2>
        <input
          ref={planInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            pickFile(e, props.onFloorPlanUpload);
          }}
        />
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            icon={<ImageUp className="size-4" />}
            onClick={() => planInput.current?.click()}
          >
            {map.floorPlanImage ? 'Replace floor plan' : 'Upload floor plan'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<ClipboardPaste className="size-4" />}
            onClick={props.onFloorPlanPaste}
            title="Paste an image from the clipboard (or press Ctrl+V / ⌘V)"
          >
            Paste
          </Button>
          {map.floorPlanImage && (
            <Button
              variant="ghost"
              size="sm"
              onClick={props.onFloorPlanRemove}
              aria-label="Remove floor plan"
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
        <p className="text-[10px] text-slate-500">Tip: copy a screenshot and press Ctrl+V / ⌘V here.</p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            icon={<RotateCcw className="size-4" />}
            onClick={() => {
              props.onRotate90(false);
            }}
            title="Turn the whole plan with its locations 90° counter-clockwise"
          >
            90°
          </Button>
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            icon={<RotateCw className="size-4" />}
            onClick={() => {
              props.onRotate90(true);
            }}
            title="Turn the whole plan with its locations 90° clockwise"
          >
            90°
          </Button>
          {map.floorPlanImage && (
            <Button
              variant="secondary"
              size="sm"
              fullWidth
              icon={<Scan className="size-4" />}
              onClick={props.onFitToImage}
              title="Set the map’s aspect ratio to the floor plan image so it is not stretched"
            >
              Fit
            </Button>
          )}
        </div>
        {map.floorPlanImage && (
          <label className="flex min-w-0 flex-col gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
            <span className="flex justify-between">
              Straighten image
              <span className="font-mono tabular-nums">{formatNumber(fineDeg)}°</span>
            </span>
            <input
              type="range"
              className="accent-brand-600"
              min={-MAX_FINE_ROTATION_DEG}
              max={MAX_FINE_ROTATION_DEG}
              step={0.5}
              value={fineDeg}
              onChange={(e) => {
                props.onFineRotation(e.target.valueAsNumber);
              }}
              onDoubleClick={() => {
                props.onFineRotation(0);
              }}
            />
          </label>
        )}
        <p className="text-[10px] leading-relaxed text-slate-500">
          90° turns the whole design. “Straighten” rotates only the image under the locations (double-click
          resets it).
        </p>
        <input
          ref={jsonInput}
          type="file"
          accept={MAP_FILE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            pickFile(e, props.onImport);
          }}
        />
        <div className="flex gap-2">
          <Button
            variant="dark"
            size="sm"
            fullWidth
            icon={<Download className="size-4" />}
            onClick={props.onExport}
          >
            Export JSON
          </Button>
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            icon={<Upload className="size-4" />}
            onClick={() => jsonInput.current?.click()}
          >
            Import as new
          </Button>
        </div>
        <Button
          variant="primary"
          size="sm"
          fullWidth
          icon={<Share2 className="size-4" />}
          onClick={props.onShare}
        >
          Share map
        </Button>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            icon={<QrCode className="size-4" />}
            onClick={props.onSendNearby}
          >
            Nearby phone
          </Button>
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            icon={<Link className="size-4" />}
            onClick={props.onShareLink}
          >
            Link & QR
          </Button>
        </div>
        <p className="text-[10px] leading-relaxed text-slate-500">
          Every option carries the floor plan and all learned views. <b>Share map</b> opens the share sheet
          (AirDrop, messaging, e-mail). <b>Nearby phone</b> sends the map straight to a phone on the same
          Wi-Fi by scanning QR codes. <b>Link & QR</b> makes a printable QR code for a map JSON you uploaded
          somewhere public.
        </p>
      </section>
    </aside>
  );
}

function formatNumber(v: number): string {
  return String(Math.round(v * 10) / 10);
}

/** Measure tool: the drawn line's length at the current scale and the real length to set. */
function MeasurePanel({
  line,
  metersPerUnit,
  onApply,
  onClear,
}: {
  line: Point[];
  metersPerUnit: number;
  onApply: (meters: number) => void;
  onClear: () => void;
}) {
  const [a, b] = line;
  const [meters, setMeters] = useState('');
  if (!a || !b) {
    return (
      <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
        {a ? 'Now tap the other end.' : 'Tap the first end of the line.'}
      </p>
    );
  }
  const current = distance(a, b) * metersPerUnit;
  return (
    <form
      className="mt-2 flex flex-col gap-2 rounded-xl bg-amber-50 p-3 dark:bg-amber-950/50"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(Number(meters.replace(',', '.')));
      }}
    >
      <p className="text-xs text-amber-900 dark:text-amber-100">
        The line is <strong>{current.toFixed(2)} m</strong> at the current scale.
      </p>
      <label className="flex min-w-0 flex-col gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
        Real length (m)
        <input
          className={input}
          type="text"
          inputMode="decimal"
          autoFocus
          placeholder={current.toFixed(2)}
          value={meters}
          onChange={(e) => {
            setMeters(e.target.value);
          }}
        />
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={!(Number(meters.replace(',', '.')) > 0)}>
          Apply scale
        </Button>
        <button
          type="button"
          className="text-xs font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          onClick={onClear}
        >
          Clear
        </button>
      </div>
      <p className="text-[10px] leading-relaxed text-slate-500">
        The scale is the same in both directions, so check the map aspect first (Fit to image).
      </p>
    </form>
  );
}

/**
 * Width : height of the map. Edits are kept locally and applied on Enter / blur, because the map
 * normalises the ratio (longer side 100) and would rewrite the fields while typing.
 */
function AspectInput({
  width,
  height,
  onChange,
}: {
  width: number;
  height: number;
  onChange: (ratio: number) => void;
}) {
  const [draft, setDraft] = useState<{ w: string; h: string } | null>(null);
  const w = draft?.w ?? formatNumber(width);
  const h = draft?.h ?? formatNumber(height);

  const commit = () => {
    if (!draft) return;
    const ratio = parseFloat(draft.w) / parseFloat(draft.h);
    setDraft(null);
    if (Number.isFinite(ratio) && ratio > 0 && ratio !== width / height) onChange(ratio);
  };
  const field = (value: string, key: 'w' | 'h', label: string) => (
    <input
      className={`${input.replace('px-2.5', 'px-1')} min-w-0 text-center tabular-nums`}
      type="number"
      inputMode="decimal"
      min={0.1}
      step="any"
      aria-label={label}
      value={value}
      onChange={(e) => {
        setDraft({ w, h, [key]: e.target.value });
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );

  return (
    <div className="flex min-w-0 flex-col gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
      Aspect (W : H)
      <div className="flex items-center gap-1">
        {field(w, 'w', 'Aspect width')}
        <span>:</span>
        {field(h, 'h', 'Aspect height')}
      </div>
    </div>
  );
}
