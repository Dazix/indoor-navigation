import { useEffect, useState } from 'react';

type ToastMessage = { tone: 'error' | 'info'; text: string };

interface ToastProps {
  message: ToastMessage | null;
}

const FADE_MS = 200;

/**
 * App-wide message that floats above everything, modals included (z-index above `Modal`). It is out of
 * the layout flow, so showing or hiding it never moves other content. The owner decides when it goes away;
 * the toast then fades out and unmounts.
 */
export function Toast({ message }: ToastProps) {
  // Kept after `message` clears, so the text stays readable while it fades out.
  const [shown, setShown] = useState<ToastMessage | null>(message);
  /** Set one frame after mounting, so the fade-in transition starts from opacity 0. */
  const [entered, setEntered] = useState(false);
  const visible = message !== null && entered;

  if (message && message !== shown) setShown(message);

  useEffect(() => {
    if (message) {
      const frame = requestAnimationFrame(() => {
        setEntered(true);
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }
    const timer = setTimeout(() => {
      setShown(null);
      setEntered(false);
    }, FADE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [message]);

  if (!shown) return null;
  const error = shown.tone === 'error';
  return (
    <div className="pointer-events-none fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[60] flex justify-center">
      <p
        role={error ? 'alert' : 'status'}
        className={`max-w-md rounded-xl px-3 py-2 text-center text-xs font-medium text-white shadow-lg transition-opacity duration-200 ease-out motion-reduce:transition-none ${
          error ? 'bg-red-600' : 'bg-emerald-600'
        } ${visible ? 'opacity-100' : 'opacity-0'}`}
      >
        {shown.text}
      </p>
    </div>
  );
}
