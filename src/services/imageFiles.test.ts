import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickImageFile, readClipboardImage } from './imageFiles';

afterEach(() => {
  vi.unstubAllGlobals();
});

function clipboardItem(types: Record<string, Blob>) {
  return {
    types: Object.keys(types),
    getType: (type: string) => Promise.resolve(types[type]),
  };
}

describe('floor plan from the clipboard', () => {
  it('picks the first pasted image', () => {
    const text = new File(['hi'], 'a.txt', { type: 'text/plain' });
    const png = new File(['x'], 'b.png', { type: 'image/png' });
    expect(pickImageFile([text, png])).toBe(png);
    expect(pickImageFile([text])).toBeNull();
    expect(pickImageFile(null)).toBeNull();
  });

  it('reads an image from the clipboard as a named file', async () => {
    const read = vi.fn(() =>
      Promise.resolve([
        clipboardItem({ 'text/plain': new Blob(['x']) }),
        clipboardItem({ 'image/png': new Blob(['png'], { type: 'image/png' }) }),
      ]),
    );
    vi.stubGlobal('navigator', { clipboard: { read } });
    const file = await readClipboardImage();
    expect([file.name, file.type]).toEqual(['pasted-floor-plan.png', 'image/png']);
  });

  it('explains why nothing could be pasted', async () => {
    vi.stubGlobal('navigator', {});
    await expect(readClipboardImage()).rejects.toThrow('cannot read images');

    vi.stubGlobal('navigator', { clipboard: { read: () => Promise.reject(new Error('NotAllowed')) } });
    await expect(readClipboardImage()).rejects.toThrow('denied');

    vi.stubGlobal('navigator', {
      clipboard: { read: () => Promise.resolve([clipboardItem({ 'text/plain': new Blob(['x']) })]) },
    });
    await expect(readClipboardImage()).rejects.toThrow('no image');
  });
});
