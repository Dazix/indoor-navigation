import { z } from 'zod';
import type { Edge, MapData, MapNode } from '../../types/map';
import { parseMapData, type ParseResult } from '../mapStorage';

/** Firestore collection holding maps and their chunk documents (matches the documented security rules). */
export const CLOUD_COLLECTION = 'indoorMaps';

/**
 * Firestore documents are limited to 1 MiB. Chunk payloads are ASCII (base64 image, JSON numbers), so
 * characters equal bytes; this leaves room for the other fields and Firestore's own overhead.
 */
export const CHUNK_CHARS = 700_000;
/** Upper bound for the main document: everything except floor plan data and learned views. */
export const MAX_HEAD_BYTES = 900_000;
/** Bounds how much a corrupt or hostile main document can make a client download. */
const MAX_CHUNKS_PER_GROUP = 40;

const FLOOR_PLAN_GROUP = 'fp';
const embeddingGroup = (nodeId: string) => `emb:${nodeId}`;

const ChunkRefSchema = z.object({
  n: z.number().int().min(1).max(MAX_CHUNKS_PER_GROUP),
  /** Content hash, so unchanged groups are neither re-uploaded nor re-downloaded. */
  hash: z.string().min(1),
});

export type ChunkRef = z.infer<typeof ChunkRefSchema>;

const CloudEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  bends: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
});

export type CloudEdge = z.infer<typeof CloudEdgeSchema>;

/** Main document of a cloud map. Detail is validated again by `parseMapData` after reassembly. */
const MapHeadSchema = z.object({
  kind: z.literal('map'),
  name: z.string(),
  metadata: z.unknown(),
  nodes: z.record(z.string(), z.unknown()),
  edges: z.array(CloudEdgeSchema),
  rooms: z.array(z.unknown()),
  /** Only set when the floor plan is a path or URL; uploaded images live in chunk documents. */
  floorPlanImage: z.string().nullable(),
  revision: z.number().int().min(0),
  updatedAt: z.number(),
  updatedBy: z.string().nullable(),
  chunks: z.object({
    floorPlan: ChunkRefSchema.optional(),
    embeddings: z.record(z.string(), ChunkRefSchema),
  }),
});

export type MapHead = z.infer<typeof MapHeadSchema>;

export interface ChunkDoc {
  kind: 'chunk';
  mapId: string;
  /** `fp` for the floor plan, `emb` for the learned views of one node. */
  part: 'fp' | 'emb';
  nodeId: string | null;
  index: number;
  data: string;
}

export interface ChunkEntry {
  id: string;
  /** Which group (floor plan or one node's views) the chunk belongs to. */
  group: string;
  doc: ChunkDoc;
}

export interface CloudMapDocs {
  head: MapHead;
  chunks: ChunkEntry[];
}

export interface CloudMeta {
  mapId: string;
  revision: number;
  updatedAt: number;
  updatedBy: string | null;
}

export class CloudMapTooLargeError extends Error {
  constructor(bytes: number) {
    super(
      `The map structure is too large to sync (${Math.round(bytes / 1024)} KiB before images and learned views)`,
    );
    this.name = 'CloudMapTooLargeError';
  }
}

/** Firestore rejects nested arrays, so edges become objects. */
export function edgesToCloud(edges: readonly Edge[]): CloudEdge[] {
  return edges.map(([from, to, bends]) => (bends?.length ? { from, to, bends } : { from, to }));
}

export function edgesFromCloud(edges: readonly CloudEdge[]): Edge[] {
  return edges.map(({ from, to, bends }): Edge => (bends?.length ? [from, to, bends] : [from, to]));
}

/** Small non-cryptographic content hash (FNV-1a) used only to detect changed chunk groups. */
export function contentHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

export function splitText(text: string, size = CHUNK_CHARS): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
}

/** Document ids may not contain `/`; `~` separates the id parts. Node ids are escaped to stay unambiguous. */
function escapeIdPart(value: string): string {
  return encodeURIComponent(value).replace(/~/g, '%7E').replace(/%/g, '=');
}

/**
 * Chunk ids contain the content hash, so a push never overwrites chunks that the currently published
 * version (or a push that loses a conflict) still needs. Stale chunks are deleted after the head commit.
 */
export function chunkDocId(
  mapId: string,
  part: 'fp' | 'emb',
  nodeId: string | null,
  hash: string,
  index: number,
): string {
  return part === 'fp'
    ? `${mapId}~fp~${hash}~${index}`
    : `${mapId}~emb~${escapeIdPart(nodeId ?? '')}~${hash}~${index}`;
}

function groupChunks(mapId: string, group: string, part: 'fp' | 'emb', nodeId: string | null, text: string) {
  const pieces = splitText(text);
  const hash = contentHash(text);
  const entries: ChunkEntry[] = pieces.map((data, index) => ({
    id: chunkDocId(mapId, part, nodeId, hash, index),
    group,
    doc: { kind: 'chunk', mapId, part, nodeId, index, data },
  }));
  return { entries, ref: { n: pieces.length, hash } satisfies ChunkRef };
}

interface GroupText {
  part: 'fp' | 'emb';
  nodeId: string | null;
  text: string;
}

/** The heavy parts of a map as text, keyed by chunk group: uploaded floor plan and per-node learned views. */
function groupTexts(map: MapData): Map<string, GroupText> {
  const groups = new Map<string, GroupText>();
  for (const [id, node] of Object.entries(map.nodes)) {
    if (node.embeddings.length > 0) {
      groups.set(embeddingGroup(id), { part: 'emb', nodeId: id, text: JSON.stringify(node.embeddings) });
    }
  }
  if (map.floorPlanImage?.startsWith('data:')) {
    groups.set(FLOOR_PLAN_GROUP, { part: 'fp', nodeId: null, text: map.floorPlanImage });
  }
  return groups;
}

/** Splits a local map into the main document and the chunk documents that carry its heavy data. */
export function mapToCloud(map: MapData, meta: CloudMeta): CloudMapDocs {
  const chunks: ChunkEntry[] = [];
  const embeddings: Record<string, ChunkRef> = {};
  const nodes: Record<string, unknown> = {};
  for (const [id, node] of Object.entries(map.nodes)) {
    const withoutViews: Partial<MapNode> = { ...node };
    delete withoutViews.embeddings;
    nodes[id] = withoutViews;
  }

  let floorPlan: ChunkRef | undefined;
  for (const [key, { part, nodeId, text }] of groupTexts(map)) {
    const group = groupChunks(meta.mapId, key, part, nodeId, text);
    chunks.push(...group.entries);
    if (part === 'fp') floorPlan = group.ref;
    else if (nodeId !== null) embeddings[nodeId] = group.ref;
  }
  const floorPlanImage = floorPlan ? null : map.floorPlanImage;

  // The JSON round trip drops `undefined` values, which Firestore refuses to store.
  const head = JSON.parse(
    JSON.stringify({
      kind: 'map',
      name: map.metadata.name,
      metadata: map.metadata,
      nodes,
      edges: edgesToCloud(map.edges),
      rooms: map.rooms,
      floorPlanImage,
      revision: meta.revision,
      updatedAt: meta.updatedAt,
      updatedBy: meta.updatedBy,
      chunks: { ...(floorPlan ? { floorPlan } : {}), embeddings },
    } satisfies MapHead),
  ) as MapHead;

  const headBytes = new TextEncoder().encode(JSON.stringify(head)).length;
  if (headBytes > MAX_HEAD_BYTES) throw new CloudMapTooLargeError(headBytes);
  return { head, chunks };
}

export function parseMapHead(raw: unknown): { ok: true; head: MapHead } | { ok: false; error: string } {
  const result = MapHeadSchema.safeParse(raw);
  return result.success
    ? { ok: true, head: result.data }
    : {
        ok: false,
        error: `The cloud map is malformed (${result.error.issues[0]?.path.join('.') ?? 'unknown field'})`,
      };
}

/** Ids of every chunk document the head refers to. */
export function chunkIdsOf(mapId: string, head: MapHead): string[] {
  return [...headGroups(head)].flatMap(([group, ref]) => groupChunkIds(mapId, group, ref));
}

/** Chunk documents to write and stale ones to delete when replacing `remote` (null: first push) with `next`. */
export function planPush(
  mapId: string,
  next: CloudMapDocs,
  remote: MapHead | null,
): { write: ChunkEntry[]; deleteIds: string[] } {
  const published = new Set(remote ? chunkIdsOf(mapId, remote) : []);
  const keep = new Set(chunkIdsOf(mapId, next.head));
  return {
    write: next.chunks.filter((entry) => !published.has(entry.id)),
    deleteIds: [...published].filter((id) => !keep.has(id)),
  };
}

function headGroups(head: MapHead): Map<string, ChunkRef> {
  const groups = new Map<string, ChunkRef>();
  if (head.chunks.floorPlan) groups.set(FLOOR_PLAN_GROUP, head.chunks.floorPlan);
  for (const [nodeId, ref] of Object.entries(head.chunks.embeddings)) groups.set(embeddingGroup(nodeId), ref);
  return groups;
}

function groupChunkIds(mapId: string, group: string, ref: ChunkRef): string[] {
  const [part, nodeId] =
    group === FLOOR_PLAN_GROUP ? (['fp', null] as const) : (['emb', group.slice(4)] as const);
  return Array.from({ length: ref.n }, (_, index) => chunkDocId(mapId, part, nodeId, ref.hash, index));
}

/** Chunk documents to download: groups whose content differs from what the local map already holds. */
export function chunksToFetch(mapId: string, head: MapHead, local: MapData | null): string[] {
  const localTexts = local ? groupTexts(local) : new Map<string, GroupText>();
  const ids: string[] = [];
  for (const [group, ref] of headGroups(head)) {
    const held = localTexts.get(group);
    if (held && contentHash(held.text) === ref.hash) continue;
    ids.push(...groupChunkIds(mapId, group, ref));
  }
  return ids;
}

/**
 * Reassembles and validates a cloud map. Groups not present in `texts` are taken from `local` when
 * their content hash matches the head, which is how partial pulls work.
 */
export function cloudToMap(
  mapId: string,
  head: MapHead,
  texts: ReadonlyMap<string, string>,
  local: MapData | null,
): ParseResult {
  try {
    const localTexts = local ? groupTexts(local) : new Map<string, GroupText>();
    const groups = headGroups(head);
    const textOf = (group: string): string | null => {
      const ref = groups.get(group);
      if (!ref) return null;
      const pieces = groupChunkIds(mapId, group, ref).map((id) => texts.get(id));
      if (pieces.every((piece) => piece !== undefined)) {
        const joined = pieces.join('');
        if (contentHash(joined) !== ref.hash) throw new Error('A cloud map chunk is corrupt');
        return joined;
      }
      const held = localTexts.get(group);
      if (held && contentHash(held.text) === ref.hash) return held.text;
      throw new Error('A cloud map chunk is missing');
    };

    const nodes: Record<string, unknown> = {};
    for (const [id, node] of Object.entries(head.nodes)) {
      if (typeof node !== 'object' || node === null) throw new Error('A cloud map node is malformed');
      const text = textOf(embeddingGroup(id));
      nodes[id] = { ...node, embeddings: text ? (JSON.parse(text) as unknown) : [] };
    }
    return parseMapData({
      metadata: head.metadata,
      floorPlanImage: textOf(FLOOR_PLAN_GROUP) ?? head.floorPlanImage,
      nodes,
      edges: edgesFromCloud(head.edges),
      rooms: head.rooms,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'The cloud map could not be read' };
  }
}
