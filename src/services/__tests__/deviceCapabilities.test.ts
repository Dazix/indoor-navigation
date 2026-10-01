import { describe, expect, it } from 'vitest';
import { isHandheldDevice } from '../deviceCapabilities';

describe('handheld device detection', () => {
  it('is a phone or tablet: finger as pointer and a compass API', () => {
    expect(isHandheldDevice({ coarsePointer: true, hasOrientationEvent: true })).toBe(true);
  });

  it('is not a desktop with a mouse, even when the browser exposes the orientation API', () => {
    expect(isHandheldDevice({ coarsePointer: false, hasOrientationEvent: true })).toBe(false);
  });

  it('is not a touch device without the orientation API', () => {
    expect(isHandheldDevice({ coarsePointer: true, hasOrientationEvent: false })).toBe(false);
  });
});
