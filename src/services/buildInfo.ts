import type { MapData } from '../types/map';

/** Raw values injected by Vite at build time (see `define` in vite.config.ts). */
export interface RawBuildInfo {
  /** Output of `git describe --tags --always`, or `dev` without git. */
  version: string;
  commit: string;
  /** ISO timestamp. */
  builtAt: string;
}

export interface BuildInfo {
  /** Release version without the `v` prefix, e.g. `1.2.3`; a bare SHA or `dev` stays as it is. */
  version: string;
  /** Commits made after the release tag; 0 for a clean tag build. */
  commitsAhead: number;
  commit: string;
  builtAt: string;
}

const DESCRIBE = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+?)?)(?:-(\d+)-g[0-9a-f]+)?$/;

/** Splits `v1.2.3-4-gabc1234` into the version and the number of commits since the tag. */
export function parseDescribe(describe: string): { version: string; commitsAhead: number } {
  const match = DESCRIBE.exec(describe.trim());
  if (!match?.[1]) return { version: describe.trim(), commitsAhead: 0 };
  return { version: match[1], commitsAhead: match[2] ? Number(match[2]) : 0 };
}

export function formatBuildInfo(raw: RawBuildInfo): BuildInfo {
  const { version, commitsAhead } = parseDescribe(raw.version);
  return { version, commitsAhead, commit: raw.commit.slice(0, 7), builtAt: raw.builtAt };
}

/** `1.2.3`, or `1.2.3 (+4)` for a build made 4 commits after the tag. */
export function formatVersionLabel(info: BuildInfo): string {
  return info.commitsAhead > 0 ? `${info.version} (+${info.commitsAhead})` : info.version;
}

/** Cache names created by Workbox start with the `cacheId` set in vite.config.ts: `indoor-nav-<version>-precache-…`. */
const CACHE_PREFIX = 'indoor-nav-';

/** Build version of the service worker that owns the precache, read from the cache names. */
export function workerVersionFromCaches(cacheNames: readonly string[]): string | null {
  for (const name of cacheNames) {
    if (!name.startsWith(CACHE_PREFIX)) continue;
    const end = name.indexOf('-precache-');
    if (end > CACHE_PREFIX.length) return parseDescribe(name.slice(CACHE_PREFIX.length, end)).version;
  }
  return null;
}

export interface ViewStats {
  nodes: number;
  views: number;
  /** Views with left/right tile vectors. */
  withTiles: number;
  /** Views per embedding engine, told apart by vector length (256 MobileNet, 192 fallback). */
  mobilenet: number;
  fallback: number;
}

const MOBILENET_DIMENSIONS = 256;

export function viewStats(map: MapData): ViewStats {
  const stats: ViewStats = { nodes: 0, views: 0, withTiles: 0, mobilenet: 0, fallback: 0 };
  for (const node of Object.values(map.nodes)) {
    stats.nodes += 1;
    for (const view of node.embeddings) {
      stats.views += 1;
      if (view.tiles && view.tiles.length > 0) stats.withTiles += 1;
      if (view.vector.length === MOBILENET_DIMENSIONS) stats.mobilenet += 1;
      else stats.fallback += 1;
    }
  }
  return stats;
}
