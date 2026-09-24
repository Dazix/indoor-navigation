import { Download, ImageUp, Link2, MousePointer2, Plus, Trash2, Upload } from 'lucide-react';
import { useRef, type ChangeEvent, type ReactNode } from 'react';
import type { MapData, MapMetadata, MapNode } from '../../types/map';
import type { EditorTool } from '../../types/navigation';
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
  onExport: () => void;
  onImport: (file: File) => void;
  onNodeChange: (patch: Partial<Pick<MapNode, 'label' | 'markerCode'>>) => void;
  onRecordWalkthrough: () => void;
  onClearViews: () => void;
  onDeleteNode: () => void;
  onDeselect: () => void;
}

const TOOLS: { id: EditorTool; label: string; icon: ReactNode; hint: string }[] = [
  {
    id: 'select',
    label: 'Select',
    icon: <MousePointer2 className="size-4" />,
    hint: 'Tap a location to edit it, drag to move it.',
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
    hint: 'Tap a location to delete it with its corridors.',
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

  const pickFile = (e: ChangeEvent<HTMLInputElement>, handler: (file: File) => void) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) handler(file);
  };

  return (
    <aside className="z-10 flex max-h-[45dvh] w-full shrink-0 flex-col gap-4 overflow-x-hidden overflow-y-auto border-b border-slate-200 bg-white p-4 shadow-lg md:max-h-none md:w-80 md:border-r md:border-b-0 dark:border-slate-800 dark:bg-slate-900">
      <section>
        <h2 className={heading}>Tools</h2>
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="toolbar">
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
              value={map.metadata.metersPerUnit}
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
        <p className="text-[10px] leading-relaxed text-slate-500">
          The map is 100 × 100 units. “Plan faces” is the compass heading you look at when facing the top of
          the floor plan; the AR arrow uses it.
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
        <input
          ref={jsonInput}
          type="file"
          accept="application/json,.json"
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
      </section>
    </aside>
  );
}
