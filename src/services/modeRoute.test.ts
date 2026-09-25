import { describe, expect, it } from 'vitest';
import { hrefForMode, modeFromHash } from './modeRoute';

const base = 'https://example.com/indoor-navigation/';

describe('mode route', () => {
  it('maps the editor hash to the editor and anything else to navigation', () => {
    expect(modeFromHash('#editor')).toBe('editor');
    expect(modeFromHash('')).toBe('user');
    expect(modeFromHash('#something')).toBe('user');
  });

  it('adds the editor hash and keeps path and query', () => {
    expect(hrefForMode(`${base}?x=1`, 'editor')).toBe(`${base}?x=1#editor`);
  });

  it('removes the hash for navigation and AR without leaving a bare #', () => {
    expect(hrefForMode(`${base}#editor`, 'user')).toBe(base);
    expect(hrefForMode(`${base}?x=1#editor`, 'ar')).toBe(`${base}?x=1`);
  });
});
