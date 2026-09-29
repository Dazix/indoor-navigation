/** Snapshot history for undo / redo. Pure and immutable; snapshots are expected to share structure. */

export const HISTORY_LIMIT = 100;
/** Commits with the same key closer together than this count as one step (a drag, a slider move). */
export const COALESCE_MS = 800;

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  lastKey: string | null;
  lastAt: number;
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null, lastAt: 0 };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

/** Makes `next` the present. A commit that changes nothing is ignored. */
export function commit<T>(h: History<T>, next: T, opts: { key?: string; now: number }): History<T> {
  if (next === h.present) return h;
  const { key = null, now } = opts;
  if (key !== null && key === h.lastKey && now - h.lastAt <= COALESCE_MS && h.past.length > 0) {
    return { ...h, present: next, future: [], lastAt: now };
  }
  return {
    past: [...h.past, h.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
    lastKey: key,
    lastAt: now,
  };
}

export function undo<T>(h: History<T>): History<T> {
  const previous = h.past[h.past.length - 1];
  if (previous === undefined) return h;
  return {
    past: h.past.slice(0, -1),
    present: previous,
    future: [h.present, ...h.future],
    lastKey: null,
    lastAt: 0,
  };
}

export function redo<T>(h: History<T>): History<T> {
  const [next, ...rest] = h.future;
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future: rest, lastKey: null, lastAt: 0 };
}
