import { describe, expect, it } from 'vitest';
import type { EmbeddingSample } from '../../types/vision';
import type { MapData, MapNode } from '../../types/map';
import {
  formatBuildInfo,
  formatVersionLabel,
  parseDescribe,
  viewStats,
  workerVersionFromCaches,
} from '../buildInfo';

function view(dimensions: number, tiles?: number[][]): EmbeddingSample {
  return { id: 'v', thumbnail: '', vector: new Array<number>(dimensions).fill(0), timestamp: 0, tiles };
}

function mapWith(nodes: Record<string, EmbeddingSample[]>): MapData {
  const built: Record<string, MapNode> = {};
  for (const [id, embeddings] of Object.entries(nodes)) {
    built[id] = { id, label: id, markerCode: id, x: 0, y: 0, embeddings };
  }
  return { nodes: built } as unknown as MapData;
}

describe('parseDescribe', () => {
  it('reads a clean tag', () => {
    expect(parseDescribe('v1.2.3')).toEqual({ version: '1.2.3', commitsAhead: 0 });
  });

  it('reads commits after a tag', () => {
    expect(parseDescribe('v1.2.3-4-gabc1234')).toEqual({ version: '1.2.3', commitsAhead: 4 });
  });

  it('keeps a prerelease suffix', () => {
    expect(parseDescribe('v1.0.0-beta.1-2-gabc1234')).toEqual({ version: '1.0.0-beta.1', commitsAhead: 2 });
  });

  it('passes through a bare SHA and dev', () => {
    expect(parseDescribe('abc1234')).toEqual({ version: 'abc1234', commitsAhead: 0 });
    expect(parseDescribe('dev')).toEqual({ version: 'dev', commitsAhead: 0 });
  });
});

describe('formatBuildInfo', () => {
  it('shortens the SHA and splits the version', () => {
    const info = formatBuildInfo({
      version: 'v0.9.0-3-gabcdef0',
      commit: 'abcdef0123456789',
      builtAt: '2026-10-01T12:00:00.000Z',
    });
    expect(info).toEqual({
      version: '0.9.0',
      commitsAhead: 3,
      commit: 'abcdef0',
      builtAt: '2026-10-01T12:00:00.000Z',
    });
    expect(formatVersionLabel(info)).toBe('0.9.0 (+3)');
  });

  it('omits the counter on a tag build', () => {
    const info = formatBuildInfo({ version: 'v1.0.0', commit: 'abc', builtAt: '' });
    expect(formatVersionLabel(info)).toBe('1.0.0');
  });
});

describe('workerVersionFromCaches', () => {
  it('reads the version from the precache name', () => {
    expect(
      workerVersionFromCaches(['mobilenet-model', 'indoor-nav-v1.2.3-4-gabc1234-precache-v2-https://x/']),
    ).toBe('1.2.3');
  });

  it('returns null without a versioned precache', () => {
    expect(workerVersionFromCaches(['workbox-precache-v2-https://x/', 'mobilenet-model'])).toBeNull();
    expect(workerVersionFromCaches([])).toBeNull();
  });
});

describe('viewStats', () => {
  it('counts views, tiles and engines', () => {
    const stats = viewStats(
      mapWith({ a: [view(256, [[1], [2]]), view(256)], b: [view(192, [[1], [2]])], c: [] }),
    );
    expect(stats).toEqual({ nodes: 3, views: 3, withTiles: 2, mobilenet: 2, fallback: 1 });
  });
});
