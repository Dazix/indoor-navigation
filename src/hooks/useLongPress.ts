import { useCallback, useEffect, useRef, type PointerEvent } from 'react';

const LONG_PRESS_MS = 600;
/** A finger that drifts further than this is scrolling, not pressing. */
const MOVE_TOLERANCE_PX = 10;

/**
 * Pointer handlers that fire `onLongPress` after a held press (touch and mouse). A short click is
 * left alone, so the element's own `onClick` still works.
 */
export function useLongPress(onLongPress: () => void, delayMs = LONG_PRESS_MS) {
  const callback = useRef(onLongPress);
  useEffect(() => {
    callback.current = onLongPress;
  }, [onLongPress]);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    origin.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      origin.current = { x: e.clientX, y: e.clientY };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        origin.current = null;
        callback.current();
      }, delayMs);
    },
    [delayMs],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const start = origin.current;
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOLERANCE_PX) cancel();
    },
    [cancel],
  );

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      // Mobile browsers open a context menu / selection on a long press.
      onContextMenu: (e: { preventDefault: () => void }) => {
        e.preventDefault();
      },
    },
  };
}
