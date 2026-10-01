import { describe, expect, it } from 'vitest';
import defaultMap from '../../../public/default-map.json';
import { parseMapData } from '../mapStorage';

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

  it('keeps the optional heading of a learned view and rejects a bad one', () => {
    const view = { id: 'v1', thumbnail: 'data:image/jpeg;base64,AA', vector: [1], timestamp: 1 };
    const withViews = (views: unknown[]) => {
      const map = clone();
      const nodes = map.nodes as Record<string, Record<string, unknown>>;
      (nodes.hub as Record<string, unknown>).embeddings = views;
      return map;
    };

    const ok = parseMapData(withViews([{ ...view, headingDeg: 270 }, view]));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.data.nodes.hub?.embeddings.map((s) => s.headingDeg)).toEqual([270, undefined]);
    }
    expect(parseMapData(withViews([{ ...view, headingDeg: 720 }])).ok).toBe(false);
  });

  it('keeps the optional tiles of a learned view and rejects malformed ones', () => {
    const view = { id: 'v1', thumbnail: 'data:image/jpeg;base64,AA', vector: [1], timestamp: 1 };
    const withViews = (views: unknown[]) => {
      const map = clone();
      const nodes = map.nodes as Record<string, Record<string, unknown>>;
      (nodes.hub as Record<string, unknown>).embeddings = views;
      return map;
    };

    const ok = parseMapData(
      withViews([
        {
          ...view,
          tiles: [
            [1, 0],
            [0, 1],
          ],
        },
        view,
      ]),
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.data.nodes.hub?.embeddings.map((s) => s.tiles)).toEqual([
        [
          [1, 0],
          [0, 1],
        ],
        undefined,
      ]);
    }
    expect(parseMapData(withViews([{ ...view, tiles: [] }])).ok).toBe(false);
    expect(parseMapData(withViews([{ ...view, tiles: [['x']] }])).ok).toBe(false);
  });

  it('keeps the optional stored frame of a learned view and rejects a non-image one', () => {
    const view = { id: 'v1', thumbnail: 'data:image/jpeg;base64,AA', vector: [1], timestamp: 1 };
    const withViews = (views: unknown[]) => {
      const map = clone();
      const nodes = map.nodes as Record<string, Record<string, unknown>>;
      (nodes.hub as Record<string, unknown>).embeddings = views;
      return map;
    };

    const ok = parseMapData(withViews([{ ...view, frame: 'data:image/jpeg;base64,BB' }, view]));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.data.nodes.hub?.embeddings.map((s) => s.frame)).toEqual([
        'data:image/jpeg;base64,BB',
        undefined,
      ]);
    }
    expect(parseMapData(withViews([{ ...view, frame: 'https://example.com/a.jpg' }])).ok).toBe(false);
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

  it('accepts corridor bends and rejects bends outside the map', () => {
    const map = clone();
    const edges = map.edges as unknown[][];
    const [u, v] = edges[0] as string[];
    edges[0] = [u, v, [{ x: 20, y: 5 }]];
    const result = parseMapData(map);
    expect(result.ok && result.data.edges[0]).toEqual([u, v, [{ x: 20, y: 5 }]]);

    map.metadata = { ...(map.metadata as object), width: 100, height: 100 };
    edges[0] = [u, v, [{ x: 20, y: 120 }]];
    expect(errorOf(map)).toContain('edges.0');
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

  it('keeps a valid map position and rejects an out-of-range one', () => {
    const withGeo = clone();
    (withGeo.metadata as Record<string, unknown>).geo = { lat: 50.0755, lng: 14.4378 };
    const ok = parseMapData(withGeo);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.data.metadata.geo).toEqual({ lat: 50.0755, lng: 14.4378 });

    (withGeo.metadata as Record<string, unknown>).geo = { lat: 91, lng: 0 };
    expect(parseMapData(withGeo).ok).toBe(false);
  });

  it('leaves geo unset on maps that have none', () => {
    const result = parseMapData(defaultMap);
    expect(result.ok && result.data.metadata.geo).toBeFalsy();
  });
});
