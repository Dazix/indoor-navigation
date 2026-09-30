import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, COALESCE_MS, commit, createHistory, HISTORY_LIMIT, redo, undo } from '../history';

describe('history', () => {
  it('undoes and redoes in order', () => {
    let h = createHistory(0);
    h = commit(h, 1, { now: 0 });
    h = commit(h, 2, { now: 1 });
    expect(canUndo(h)).toBe(true);
    h = undo(h);
    expect(h.present).toBe(1);
    h = undo(h);
    expect(h.present).toBe(0);
    expect(canUndo(h)).toBe(false);
    expect(undo(h)).toBe(h);
    h = redo(h);
    h = redo(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(false);
    expect(redo(h)).toBe(h);
  });

  it('drops the redo stack on a new commit', () => {
    let h = commit(createHistory(0), 1, { now: 0 });
    h = undo(h);
    h = commit(h, 5, { now: 1 });
    expect(canRedo(h)).toBe(false);
    expect(undo(h).present).toBe(0);
  });

  it('ignores a commit that changes nothing', () => {
    const h = createHistory('a');
    expect(commit(h, 'a', { now: 0 })).toBe(h);
  });

  it('merges same-key commits inside the window into one step', () => {
    let h = createHistory(0);
    h = commit(h, 1, { key: 'drag', now: 0 });
    h = commit(h, 2, { key: 'drag', now: 100 });
    h = commit(h, 3, { key: 'drag', now: 100 + COALESCE_MS });
    expect(h.present).toBe(3);
    expect(h.past).toEqual([0]);
    expect(undo(h).present).toBe(0);
  });

  it('starts a new step after the window, for another key, or without a key', () => {
    let h = commit(createHistory(0), 1, { key: 'drag', now: 0 });
    h = commit(h, 2, { key: 'drag', now: COALESCE_MS + 1 });
    expect(h.past).toEqual([0, 1]);
    h = commit(h, 3, { key: 'other', now: COALESCE_MS + 2 });
    expect(h.past).toEqual([0, 1, 2]);
    h = commit(h, 4, { now: COALESCE_MS + 3 });
    h = commit(h, 5, { now: COALESCE_MS + 4 });
    expect(h.past).toEqual([0, 1, 2, 3, 4]);
  });

  it('does not merge into the state that undo just restored', () => {
    let h = commit(createHistory(0), 1, { key: 'drag', now: 0 });
    h = undo(h);
    h = commit(h, 2, { key: 'drag', now: 10 });
    expect(h.past).toEqual([0]);
    expect(h.present).toBe(2);
    h = commit(h, 3, { key: 'drag', now: 20 });
    expect(h.past).toEqual([0]);
  });

  it('keeps at most HISTORY_LIMIT snapshots', () => {
    let h = createHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = commit(h, i, { now: i });
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]).toBe(20);
  });
});
