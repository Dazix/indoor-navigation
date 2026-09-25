import { describe, expect, it } from 'vitest';
import { pulseDurationMs, revealDurationMs, routeKey } from './routeAnimation';

describe('routeKey', () => {
  it('identifies a route by its node path', () => {
    expect(routeKey({ path: ['a', 'b', 'c'] })).toBe('a>b>c');
    expect(routeKey({ path: ['a', 'b'] })).not.toBe(routeKey({ path: ['a', 'c'] }));
  });
});

describe('revealDurationMs', () => {
  it('scales with the route length within bounds', () => {
    expect(revealDurationMs(0)).toBe(600);
    expect(revealDurationMs(40)).toBe(1000);
    expect(revealDurationMs(500)).toBe(1800);
  });
});

describe('pulseDurationMs', () => {
  it('scales with the route length within bounds', () => {
    expect(pulseDurationMs(1)).toBe(1600);
    expect(pulseDurationMs(40)).toBe(2400);
    expect(pulseDurationMs(200)).toBe(3500);
  });
});
