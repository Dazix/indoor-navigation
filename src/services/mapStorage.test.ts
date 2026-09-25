import { describe, expect, it } from 'vitest';
import defaultMap from '../../public/default-map.json';
import { parseMapData } from './mapStorage';

function clone(): Record<string, unknown> {
  const copy: Record<string, unknown> = structuredClone(defaultMap);
  return copy;
}

function errorOf(input: unknown): string | null {
  const result = parseMapData(input);
  return result.ok ? null : result.error;
}

describe('parseMapData', () => {
  it('accepts the bundled default map', () => {
    const result = parseMapData(defaultMap);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.data.nodes)).toHaveLength(8);
  });

  it('migrates v3 prototype data without metadata or embeddings', () => {
    const legacy = clone();
    delete legacy.metadata;
    const nodes = legacy.nodes as Record<string, Record<string, unknown>>;
    delete nodes.hub?.embeddings;
    legacy.floorPlanImage = null;

    const result = parseMapData(legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.metadata).toEqual({
      name: 'Office',
      version: 1,
      metersPerUnit: 0.3,
      northOffsetDeg: 0,
      width: 100,
      height: 100,
      floorPlanRotationDeg: 0,
    });
    expect(result.data.nodes.hub?.embeddings).toEqual([]);
  });

  it('rejects nodes outside the map size', () => {
    const map = clone();
    map.metadata = { ...(map.metadata as object), width: 100, height: 10 };
    expect(errorOf(map)).toContain('outside the 100 × 10 map');
  });

  it('rejects missing required fields', () => {
    const broken = clone();
    delete broken.nodes;
    expect(errorOf(broken)).toContain('nodes');
    expect(parseMapData('not a map').ok).toBe(false);
  });

  it('rejects edges pointing to missing nodes', () => {
    const broken = clone();
    (broken.edges as string[][]).push(['hub', 'ghost']);
    expect(errorOf(broken)).toContain('ghost');
  });

  it('rejects coordinates outside the 0–100 map space', () => {
    const broken = clone();
    const nodes = broken.nodes as Record<string, Record<string, unknown>>;
    if (nodes.hub) nodes.hub.x = 150;
    expect(errorOf(broken)).toContain('nodes.hub.x');
  });

  it('rejects script URLs as floor plan images', () => {
    const broken = clone();
    broken.floorPlanImage = 'javascript:alert(1)';
    expect(parseMapData(broken).ok).toBe(false);
  });
});
