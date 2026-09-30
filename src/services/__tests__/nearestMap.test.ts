import { describe, expect, it } from 'vitest';
import type { MapSummary } from '../../types/map';
import { haversineM, pickNearestMap } from '../nearestMap';

const map = (id: string, geo?: { lat: number; lng: number }): MapSummary => ({
  id,
  name: id,
  updatedAt: 0,
  geo,
});

describe('haversineM', () => {
  it('is zero for the same point', () => {
    expect(haversineM({ lat: 50, lng: 14 }, { lat: 50, lng: 14 })).toBe(0);
  });

  it('measures about 111 km per degree of latitude', () => {
    const d = haversineM({ lat: 50, lng: 14 }, { lat: 51, lng: 14 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });
});

describe('pickNearestMap', () => {
  const here = { lat: 50.08, lng: 14.42 };

  it('picks the closest map', () => {
    const near = map('near', { lat: 50.0801, lng: 14.42 });
    const far = map('far', { lat: 50.085, lng: 14.42 });
    expect(pickNearestMap([far, near], here)?.id).toBe('near');
  });

  it('ignores maps without geo', () => {
    const noGeo = map('none');
    const withGeo = map('geo', { lat: 50.0805, lng: 14.42 });
    expect(pickNearestMap([noGeo, withGeo], here)?.id).toBe('geo');
    expect(pickNearestMap([noGeo], here)).toBeNull();
  });

  it('returns null beyond the limit', () => {
    const far = map('far', { lat: 50.09, lng: 14.42 }); // ~1.1 km
    expect(pickNearestMap([far], here)).toBeNull();
    expect(pickNearestMap([far], here, 2000)?.id).toBe('far');
  });

  it('returns null for an empty library', () => {
    expect(pickNearestMap([], here)).toBeNull();
  });

  it('breaks ties by list order', () => {
    const a = map('a', { lat: 50.081, lng: 14.42 });
    const b = map('b', { lat: 50.081, lng: 14.42 });
    expect(pickNearestMap([a, b], here)?.id).toBe('a');
  });
});
