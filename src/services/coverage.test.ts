import { describe, expect, it } from 'vitest';
import type { EmbeddingSample } from '../types/vision';
import { coverageReport, GOOD_VIEWS, isRepeating, markNewViews, MIN_VIEWS } from './coverage';
import { EMBEDDING_SIZE } from './visionMatcher';

/** Unit vector pointing along axis `axis`; different axes are orthogonal, i.e. different views. */
function view(axis: number, size = EMBEDDING_SIZE): EmbeddingSample {
  const vector = Array.from({ length: size }, (_, i) => (i === axis ? 1 : 0));
  return { id: `s${axis}-${Math.random()}`, thumbnail: '', vector, timestamp: 0 };
}

const distinct = (n: number) => Array.from({ length: n }, (_, i) => view(i));

describe('markNewViews', () => {
  it('flags only the first sample of each group of similar frames', () => {
    expect(markNewViews([view(0), view(0), view(1), view(0), view(1), view(2)])).toEqual([
      true,
      false,
      true,
      false,
      false,
      true,
    ]);
  });

  it('returns an empty list for no samples', () => {
    expect(markNewViews([])).toEqual([]);
  });
});

describe('coverageReport', () => {
  it('is null without samples or with colour fallback vectors only', () => {
    expect(coverageReport([])).toBeNull();
    expect(coverageReport([view(0, 192), view(1, 192)])).toBeNull();
  });

  it('counts distinct views, not frames', () => {
    const report = coverageReport([view(0), view(0), view(0), view(0), view(1)]);
    expect(report?.views).toBe(2);
    expect(report?.level).toBe('low');
  });

  it('rates the level by the number of distinct views', () => {
    expect(coverageReport(distinct(MIN_VIEWS - 1))?.level).toBe('low');
    expect(coverageReport(distinct(MIN_VIEWS))?.level).toBe('ok');
    expect(coverageReport(distinct(GOOD_VIEWS))).toMatchObject({ level: 'good', progress: 1 });
  });

  it('reports progress towards a well covered place', () => {
    expect(coverageReport(distinct(GOOD_VIEWS / 2))?.progress).toBeCloseTo(0.5);
  });

  it('ignores fallback vectors mixed in with MobileNet ones', () => {
    expect(coverageReport([view(0), view(0, 192), view(1, 192)])?.views).toBe(1);
  });
});

describe('isRepeating', () => {
  it('is false until there are more frames than the window', () => {
    expect(isRepeating([view(0), view(0), view(0), view(0)])).toBe(false);
  });

  it('is true when the latest frames repeat known views', () => {
    expect(isRepeating([view(0), view(1), view(0), view(1), view(0), view(1)])).toBe(true);
  });

  it('is false while the latest frames still bring new views', () => {
    expect(isRepeating([view(0), view(0), view(0), view(0), view(1)])).toBe(false);
  });
});
