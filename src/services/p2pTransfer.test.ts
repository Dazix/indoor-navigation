import { describe, expect, it } from 'vitest';
import { gunzipText, gzipText, joinChunks, splitChunks } from './p2pTransfer';

describe('p2p transfer payload', () => {
  it('splits into fixed-size chunks and joins them back', () => {
    const bytes = Uint8Array.from({ length: 200_001 }, (_, i) => i % 251);
    const chunks = splitChunks(bytes, 65_536);
    expect(chunks.map((c) => c.length)).toEqual([65_536, 65_536, 65_536, 3_393]);
    expect(joinChunks(chunks)).toEqual(bytes);
  });

  it('handles an empty payload', () => {
    expect(splitChunks(new Uint8Array(0))).toEqual([]);
    expect(joinChunks([])).toEqual(new Uint8Array(0));
  });

  it('gzips map JSON losslessly', async () => {
    const json = JSON.stringify({ name: 'Kancelář', vector: Array.from({ length: 256 }, (_, i) => i / 7) });
    const packed = await gzipText(json);
    expect(packed.length).toBeLessThan(json.length);
    await expect(gunzipText(packed)).resolves.toBe(json);
  });
});
