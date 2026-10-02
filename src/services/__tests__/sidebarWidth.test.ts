import { describe, expect, it } from 'vitest';
import { clampSidebarWidth, parseSidebarWidth, SIDEBAR_MAX, SIDEBAR_MIN } from '../sidebarWidth';

describe('clampSidebarWidth', () => {
  it('keeps values inside the range', () => {
    expect(clampSidebarWidth(400, 1920)).toBe(400);
  });

  it('clamps to the minimum and maximum', () => {
    expect(clampSidebarWidth(10, 1920)).toBe(SIDEBAR_MIN);
    expect(clampSidebarWidth(5000, 1920)).toBe(SIDEBAR_MAX);
  });

  it('caps to a share of a narrow viewport but never below the minimum', () => {
    expect(clampSidebarWidth(600, 900)).toBe(540);
    expect(clampSidebarWidth(600, 400)).toBe(SIDEBAR_MIN);
  });
});

describe('parseSidebarWidth', () => {
  it('accepts and clamps numbers', () => {
    expect(parseSidebarWidth(350)).toBe(350);
    expect(parseSidebarWidth(1)).toBe(SIDEBAR_MIN);
    expect(parseSidebarWidth(9999)).toBe(SIDEBAR_MAX);
  });

  it('rejects non-numbers', () => {
    expect(parseSidebarWidth('320')).toBeNull();
    expect(parseSidebarWidth(NaN)).toBeNull();
    expect(parseSidebarWidth(null)).toBeNull();
  });
});
