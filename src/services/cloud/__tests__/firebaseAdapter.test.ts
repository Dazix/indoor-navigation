import { describe, expect, it } from 'vitest';
import { splitBatches } from '../firebaseAdapter';

describe('splitBatches', () => {
  it('keeps small input in one batch and preserves order', () => {
    expect(splitBatches([1, 2, 3], () => 1)).toEqual([[1, 2, 3]]);
  });

  it('splits by item count', () => {
    expect(splitBatches([1, 2, 3, 4, 5], () => 1, 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('splits by payload size', () => {
    expect(splitBatches([5, 5, 5, 5], (n) => n, 100, 10)).toEqual([
      [5, 5],
      [5, 5],
    ]);
  });

  it('puts an oversized item in a batch of its own instead of dropping it', () => {
    expect(splitBatches([1, 50, 1], (n) => n, 100, 10)).toEqual([[1], [50], [1]]);
  });

  it('returns no batches for no input', () => {
    expect(splitBatches([], () => 1)).toEqual([]);
  });
});
