import { z } from 'zod';
import type { MapData } from '../types/map';

/** Single-map storage key used by the original prototype; migrated into the map library on first run. */
export const LEGACY_STORAGE_KEY = 'indoor_nav_map_data_v3';
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

const coordinate = z.number().min(0).max(100);

const EmbeddingSampleSchema = z.object({
  id: z.string().min(1),
  thumbnail: z.string().startsWith('data:image/'),
  vector: z.array(z.number()).min(1).max(4096),
  timestamp: z.number(),
});

const MapNodeSchema = z.object({
  id: z.string().min(1),
  x: coordinate,
  y: coordinate,
  label: z.string().max(120),
  markerCode: z.string().max(120).default(''),
  embeddings: z.array(EmbeddingSampleSchema).default([]),
  fingerprint: z.array(z.number()).optional(),
});

const RoomSchema = z.object({
  id: z.string().min(1),
  x: coordinate,
  y: coordinate,
  w: z.number().positive().max(100),
  h: z.number().positive().max(100),
  label: z.string().max(120),
  nodeId: z.string(),
  color: z
    .string()
    .regex(/^#[0-9a-f]{3,8}$/i)
    .default('#e2e8f0'),
});

const MapMetadataSchema = z.object({
  name: z.string().max(200).default('Office'),
  version: z.number().int().nonnegative().default(1),
  metersPerUnit: z.number().positive().max(100).default(0.3),
  northOffsetDeg: z.number().min(-360).max(360).default(0),
});

/** Uploaded image (data URL), absolute http(s) URL, or an asset path relative to the app base. */
const FloorPlanSchema = z
  .string()
  .refine(
    (src) =>
      src.startsWith('data:image/') ||
      /^https?:\/\//.test(src) ||
      /^[\w./-]+\.(svg|png|jpe?g|webp|gif)$/i.test(src),
    'Unsupported floor plan image format',
  )
  .nullable()
  .default(null);

export const MapDataSchema = z
  .object({
    metadata: MapMetadataSchema.prefault({}),
    floorPlanImage: FloorPlanSchema,
    nodes: z.record(z.string(), MapNodeSchema),
    edges: z.array(z.tuple([z.string(), z.string()])),
    rooms: z.array(RoomSchema).default([]),
  })
  .superRefine((map, ctx) => {
    for (const [key, node] of Object.entries(map.nodes)) {
      if (node.id !== key) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', key, 'id'],
          message: `Node id "${node.id}" does not match its key`,
        });
      }
    }
    map.edges.forEach(([u, v], i) => {
      if (!(u in map.nodes) || !(v in map.nodes)) {
        ctx.addIssue({
          code: 'custom',
          path: ['edges', i],
          message: `Edge references a missing node (${u} – ${v})`,
        });
      }
    });
  });

export type ParseResult = { ok: true; data: MapData } | { ok: false; error: string };

/** Validates untrusted map data (imported file, localStorage) and fills defaults for older formats. */
export function parseMapData(input: unknown): ParseResult {
  const result = MapDataSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };

  const issue = result.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
  const more = result.error.issues.length > 1 ? ` (+${result.error.issues.length - 1} more)` : '';
  return { ok: false, error: `${where}${issue?.message ?? 'Invalid data'}${more}` };
}

export async function importMapFromFile(file: File): Promise<ParseResult> {
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, error: 'File is too large' };
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    return { ok: false, error: 'File is not valid JSON' };
  }
  return parseMapData(json);
}

export function exportMapToFile(map: MapData): void {
  const blob = new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = map.metadata.name
    .normalize('NFD')
    .replace(/[^\w]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  a.href = url;
  a.download = `${slug || 'indoor-map'}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/** Resolves a floor plan reference so relative asset paths work under the GitHub Pages sub-path. */
export function resolveAssetUrl(src: string): string {
  if (/^(data:|https?:|blob:|\/)/.test(src)) return src;
  return `${import.meta.env.BASE_URL}${src}`;
}

export async function loadDefaultMap(): Promise<MapData> {
  const res = await fetch(`${import.meta.env.BASE_URL}default-map.json`);
  if (!res.ok) throw new Error(`Cannot load the default map (${res.status})`);
  const parsed = parseMapData(await res.json());
  if (!parsed.ok) throw new Error(`Default map is invalid: ${parsed.error}`);
  return parsed.data;
}
