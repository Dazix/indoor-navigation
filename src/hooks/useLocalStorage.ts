import { useCallback, useRef, useState } from 'react';

type SetValue<T> = (value: T | ((prev: T) => T)) => void;

function read<T>(key: string, fallback: T, parse: (raw: unknown) => T | null): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return parse(JSON.parse(raw)) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Writes a value and returns a user-facing error message, or null on success. */
function write(key: string, value: unknown): string | null {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return null;
  } catch (err) {
    return err instanceof DOMException && err.name === 'QuotaExceededError'
      ? 'Browser storage is full. Export your data and remove unused items.'
      : 'Browser storage is not available.';
  }
}

/**
 * Typed, validated localStorage state. `parse` receives the decoded JSON and returns `null`
 * for invalid data, in which case `fallback` is used. Write failures (quota, private mode)
 * are reported through the third tuple element instead of being thrown.
 */
export function useLocalStorage<T>(
  key: string,
  fallback: T,
  parse: (raw: unknown) => T | null,
): [T, SetValue<T>, string | null] {
  const [value, setValue] = useState<T>(() => read(key, fallback, parse));
  const [saveError, setSaveError] = useState<string | null>(null);
  // Latest value, so several functional updates in one tick compose like with useState.
  const latest = useRef(value);

  const set = useCallback<SetValue<T>>(
    (next) => {
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(latest.current) : next;
      latest.current = resolved;
      setValue(resolved);
      setSaveError(write(key, resolved));
    },
    [key],
  );

  return [value, set, saveError];
}
