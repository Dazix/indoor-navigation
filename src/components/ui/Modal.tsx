import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Extra header content, e.g. tabs. */
  headerExtra?: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
  /** Dark chrome for camera views. */
  tone?: 'default' | 'dark';
  children: ReactNode;
}

/**
 * Accessible dialog rendered into <body>: closes on Escape and backdrop click, moves focus in
 * and restores it on close. On phones it becomes a bottom sheet that respects the safe areas.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  headerExtra,
  footer,
  size = 'md',
  tone = 'default',
  children,
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;

  const dark = tone === 'dark';
  const panelTone = dark
    ? 'dark border-slate-700 bg-slate-900 text-white'
    : 'border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex max-h-[calc(100dvh-env(safe-area-inset-top)-0.5rem)] w-full flex-col overflow-hidden rounded-t-3xl border shadow-2xl outline-none sm:max-h-[92dvh] sm:rounded-3xl ${size === 'lg' ? 'sm:max-w-lg' : 'sm:max-w-md'} ${panelTone}`}
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-sm font-bold">
              {title}
            </h2>
            {subtitle && <p className="truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2">
            {headerExtra}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-500/10 hover:text-slate-900 dark:hover:text-white"
            >
              <X className="size-5" />
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && (
          <footer className="pb-safe border-t border-slate-200 dark:border-slate-800">
            <div className="flex justify-end gap-2 px-4 py-3">{footer}</div>
          </footer>
        )}
        {!footer && <div className="pb-safe" />}
      </div>
    </div>,
    document.body,
  );
}
