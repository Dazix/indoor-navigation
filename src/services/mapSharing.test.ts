import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBlankMap } from './mapLibrary';
import {
  buildShareLink,
  fetchSharedMap,
  inlineFloorPlan,
  mapFileName,
  resolveMapUrl,
  shareCandidates,
} from './mapSharing';

const BASE = 'https://vibecoding.sanda.dev/indoor-navigation/';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('map sharing', () => {
  it('names export files after the map', () => {
    const map = createBlankMap('Praha – 3. patro');
    expect(mapFileName(map, new Date('2026-09-25T10:00:00Z'))).toBe('praha-3-patro-2026-09-25.json');
  });

  it('offers a .txt copy for share sheets that refuse JSON (Chrome on Android)', () => {
    const [json, txt] = shareCandidates('{}', 'office-2026-09-25.json');
    expect([json?.name, json?.type]).toEqual(['office-2026-09-25.json', 'application/json']);
    expect([txt?.name, txt?.type]).toEqual(['office-2026-09-25.txt', 'text/plain']);
  });

  it('resolves ?map= values to fetchable URLs', () => {
    expect(resolveMapUrl('maps/office.json', BASE)).toBe(`${BASE}maps/office.json`);
    expect(resolveMapUrl('/maps/office.json', BASE)).toBe(`${BASE}maps/office.json`);
    expect(resolveMapUrl('https://gist.githubusercontent.com/u/1/raw/map.json', BASE)).toBe(
      'https://gist.githubusercontent.com/u/1/raw/map.json',
    );
    expect(resolveMapUrl('javascript:alert(1)', BASE)).toBeNull();
    expect(resolveMapUrl('data:application/json,{}', BASE)).toBeNull();
    expect(resolveMapUrl('//evil.example/map.json', BASE)).toBeNull();
    expect(resolveMapUrl('  ', BASE)).toBeNull();
  });

  it('builds an app link carrying the map URL', () => {
    const link = buildShareLink('https://example.com/a map.json', `${BASE}?map=old#x`);
    expect(link).toBe(`${BASE}?map=https%3A%2F%2Fexample.com%2Fa+map.json`);
    expect(new URL(link).searchParams.get('map')).toBe('https://example.com/a map.json');
  });

  it('embeds a referenced floor plan as a data URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(new Blob(['<svg/>'], { type: 'image/svg+xml' })))),
    );
    const map = { ...createBlankMap('A'), floorPlanImage: 'https://example.com/plan.svg' };
    const inlined = await inlineFloorPlan(map);
    expect(inlined.floorPlanImage).toBe(`data:image/svg+xml;base64,${btoa('<svg/>')}`);
  });

  it('keeps the reference when the floor plan cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('CORS'))),
    );
    const map = { ...createBlankMap('A'), floorPlanImage: 'https://example.com/plan.svg' };
    expect(await inlineFloorPlan(map)).toBe(map);
  });

  it('downloads and validates a shared map', async () => {
    const map = createBlankMap('Shared');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(map)))),
    );
    await expect(fetchSharedMap('https://example.com/map.json')).resolves.toEqual({ ok: true, data: map });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('<html>', { status: 200 }))),
    );
    expect(await fetchSharedMap('https://example.com/map.json')).toMatchObject({ ok: false });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 404 }))),
    );
    expect(await fetchSharedMap('https://example.com/map.json')).toEqual({
      ok: false,
      error: 'The map could not be downloaded (HTTP 404)',
    });
  });
});
