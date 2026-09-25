import { Check, Copy, Loader2, RotateCcw, ScanLine } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { serializeMap } from '../../services/mapSharing';
import { isSignalText } from '../../services/p2pSignal';
import {
  createReceiver,
  createSender,
  type MapSender,
  type TransferPhase,
  type TransferProgress,
} from '../../services/p2pTransfer';
import {
  formatBytes,
  formatDuration,
  formatRate,
  RateMeter,
  remainingSeconds,
} from '../../services/transferStats';
import type { MapData } from '../../types/map';
import { QrScanner } from '../scanner/QrScanner';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { QrCode } from '../ui/QrCode';

export type P2PRole = 'send' | 'receive';

interface P2PTransferModalProps {
  role: P2PRole;
  /** Active map; required when sending. */
  map: MapData | null;
  onReceived: (map: MapData) => Promise<unknown>;
  onClose: () => void;
}

type Step =
  | { id: 'preparing' }
  | { id: 'show'; code: string }
  | { id: 'scan' }
  | { id: 'transfer' }
  | { id: 'done'; name: string }
  | { id: 'error'; message: string };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface LiveStats {
  progress: TransferProgress;
  /** performance.now() when the connection attempt started. */
  connectAt: number;
  /** performance.now() when the first payload byte was confirmed; null while connecting. */
  startedAt: number | null;
  now: number;
  /** Current speed (sliding window), bytes/s. */
  rate: number | null;
  /** Average speed since the payload started, bytes/s. */
  average: number | null;
}

const PHASE_LABEL: Record<P2PRole, Record<TransferPhase, string>> = {
  send: {
    connecting: 'Connecting to the other phone…',
    transferring: 'Sending map…',
    finishing: 'Waiting for the other phone to check the map…',
    done: 'Sent',
  },
  receive: {
    connecting: 'Connected, waiting for data…',
    transferring: 'Receiving map…',
    finishing: 'Unpacking and checking the map…',
    done: 'Saving the map…',
  },
};

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-100 px-2.5 py-1.5 dark:bg-slate-800">
      <dt className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="font-mono text-sm font-semibold text-slate-800 tabular-nums dark:text-slate-100">
        {value}
      </dd>
    </div>
  );
}

/** Live progress: bar, transferred / total, speed, time elapsed and remaining. */
function TransferStats({ role, stats }: { role: P2PRole; stats: LiveStats | null }) {
  const p = stats?.progress;
  const phase = p?.phase ?? 'connecting';
  const percent = p && p.total > 0 ? Math.min(100, (p.done / p.total) * 100) : 0;
  const elapsed = stats?.startedAt != null ? (stats.now - stats.startedAt) / 1000 : null;
  const eta = p ? remainingSeconds(p.done, p.total, stats.rate) : null;
  const indeterminate = phase === 'connecting' || phase === 'finishing';

  return (
    <div className="flex flex-col gap-3 py-2" aria-live="polite">
      <div className="flex items-baseline justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Loader2 className="size-4 animate-spin text-brand-600" />
          {PHASE_LABEL[role][phase]}
        </p>
        {p && p.total > 0 && (
          <span className="font-mono text-sm font-bold text-brand-600 tabular-nums">
            {Math.floor(percent)} %
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.floor(percent)}
        className="h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
      >
        <div
          className={`h-full rounded-full bg-brand-600 transition-[width] duration-200 ${indeterminate && percent === 0 ? 'w-1/3 animate-pulse' : ''}`}
          style={indeterminate && percent === 0 ? undefined : { width: `${percent}%` }}
        />
      </div>
      {p && p.total > 0 && (
        <dl className="grid grid-cols-2 gap-2">
          <StatCell label="Transferred" value={`${formatBytes(p.done)} / ${formatBytes(p.total)}`} />
          <StatCell label="Speed" value={stats.rate != null ? formatRate(stats.rate) : '—'} />
          <StatCell label="Elapsed" value={elapsed != null ? formatDuration(elapsed) : '—'} />
          <StatCell
            label="Remaining"
            value={phase === 'finishing' ? 'almost done' : eta != null ? `~${formatDuration(eta)}` : '—'}
          />
        </dl>
      )}
      {p && p.rawBytes > 0 && p.total > 0 && (
        <p className="text-[11px] text-slate-500">
          Map {formatBytes(p.rawBytes)}, compressed to {formatBytes(p.total)} for the transfer.
        </p>
      )}
    </div>
  );
}

/** Totals shown after a finished transfer. */
function TransferSummary({ stats }: { stats: LiveStats }) {
  const p = stats.progress;
  const transferSeconds = stats.startedAt != null ? (stats.now - stats.startedAt) / 1000 : 0;
  const totalSeconds = (stats.now - stats.connectAt) / 1000;
  const saved = p.rawBytes > 0 ? Math.round((1 - p.total / p.rawBytes) * 100) : 0;
  return (
    <dl className="grid grid-cols-2 gap-2">
      <StatCell label="Transferred" value={formatBytes(p.total)} />
      <StatCell label="Map size" value={formatBytes(p.rawBytes)} />
      <StatCell label="Transfer time" value={formatDuration(transferSeconds)} />
      <StatCell label="Avg speed" value={stats.average != null ? formatRate(stats.average) : '—'} />
      <StatCell label="Compression" value={`−${saved} %`} />
      <StatCell label="Incl. connecting" value={formatDuration(totalSeconds)} />
    </dl>
  );
}

/** Text fallback for devices without a usable camera (and for testing on a desktop). */
function CodeFallback({ code, onSubmit }: { code: string | null; onSubmit?: (text: string) => void }) {
  const [pasted, setPasted] = useState('');
  const [copied, setCopied] = useState(false);
  return (
    <details className="text-xs text-slate-500">
      <summary className="cursor-pointer select-none">Can’t scan? Use a text code instead</summary>
      <div className="mt-2 flex flex-col gap-2">
        {code && (
          <Button
            variant="secondary"
            size="sm"
            icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            onClick={() => {
              void navigator.clipboard.writeText(code).then(() => {
                setCopied(true);
              });
            }}
          >
            {copied ? 'Code copied' : 'Copy this phone’s code'}
          </Button>
        )}
        {onSubmit && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit(pasted.trim());
            }}
          >
            <input
              value={pasted}
              onChange={(e) => {
                setPasted(e.target.value);
              }}
              placeholder="Paste the other phone’s code (IN1:…)"
              aria-label="Code from the other phone"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800"
            />
            <Button type="submit" size="sm" disabled={!isSignalText(pasted.trim())}>
              Use
            </Button>
          </form>
        )}
      </div>
    </details>
  );
}

function Transfer({ role, map, onReceived }: Omit<P2PTransferModalProps, 'onClose'>) {
  const [step, setStep] = useState<Step>(role === 'send' ? { id: 'preparing' } : { id: 'scan' });
  const [ownCode, setOwnCode] = useState<string | null>(null);
  const senderRef = useRef<MapSender | null>(null);
  const closeRef = useRef<(() => void) | null>(null);
  const usedRef = useRef(false);
  const onReceivedRef = useRef(onReceived);
  useEffect(() => {
    onReceivedRef.current = onReceived;
  });

  const [stats, setStats] = useState<LiveStats | null>(null);
  const meterRef = useRef<{ meter: RateMeter; connectAt: number; startedAt: number | null } | null>(null);

  const progress = useCallback((p: TransferProgress) => {
    const now = performance.now();
    meterRef.current ??= { meter: new RateMeter(), connectAt: now, startedAt: null };
    const m = meterRef.current;
    if (p.phase !== 'connecting' && p.total > 0) {
      m.startedAt ??= now;
      m.meter.add(p.done, now);
    }
    setStats({
      progress: p,
      connectAt: m.connectAt,
      startedAt: m.startedAt,
      now,
      rate: m.meter.rate(),
      average: m.meter.average(now),
    });
    if (p.phase !== 'done') {
      setStep((s) => (s.id === 'show' || s.id === 'scan' || s.id === 'preparing' ? { id: 'transfer' } : s));
    }
  }, []);

  useEffect(() => () => closeRef.current?.(), []);

  // Sender: prepare the offer as soon as the dialog opens.
  useEffect(() => {
    if (role !== 'send') return;
    let cancelled = false;
    createSender()
      .then((sender) => {
        if (cancelled) {
          sender.close();
          return;
        }
        senderRef.current = sender;
        closeRef.current = sender.close;
        setOwnCode(sender.offerCode);
        setStep({ id: 'show', code: sender.offerCode });
      })
      .catch((err: unknown) => {
        if (!cancelled) setStep({ id: 'error', message: errorText(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [role]);

  /** Handles the code scanned or pasted from the other phone. Returns true when it was taken. */
  const handleCode = (text: string): boolean => {
    if (!isSignalText(text) || usedRef.current) return false;
    usedRef.current = true;

    if (role === 'send') {
      const sender = senderRef.current;
      if (!sender || !map) return false;
      setStep({ id: 'transfer' });
      void serializeMap(map)
        .then(({ json }) => sender.send(text, json, map.metadata.name, progress))
        .then(() => {
          setStep({ id: 'done', name: map.metadata.name });
        })
        .catch((err: unknown) => {
          setStep({ id: 'error', message: errorText(err) });
        });
      return true;
    }

    setStep({ id: 'preparing' });
    void createReceiver(text, progress)
      .then(async (receiver) => {
        closeRef.current = receiver.close;
        setOwnCode(receiver.answerCode);
        setStep({ id: 'show', code: receiver.answerCode });
        const received = await receiver.received;
        await onReceivedRef.current(received);
        setStep({ id: 'done', name: received.metadata.name });
      })
      .catch((err: unknown) => {
        setStep({ id: 'error', message: errorText(err) });
      });
    return true;
  };

  const instructions: Record<P2PRole, { show: string; scan: string }> = {
    send: {
      show: 'On the other phone open Maps → Receive a map and scan this code.',
      scan: 'Now scan the code shown on the receiving phone.',
    },
    receive: {
      show: 'Now scan this code with the sending phone.',
      scan: 'Scan the code shown on the sending phone.',
    },
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      {step.id === 'preparing' && (
        <p className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
          <Loader2 className="size-5 animate-spin" /> Preparing connection…
        </p>
      )}

      {step.id === 'show' && (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">{instructions[role].show}</p>
          <QrCode
            value={step.code}
            label="Connection code for the other phone"
            className="mx-auto w-full max-w-80"
          />
          <p className="text-center text-[11px] text-slate-500">
            Turn the screen brightness up if it does not scan.
          </p>
          {role === 'send' ? (
            <Button
              icon={<ScanLine className="size-4" />}
              onClick={() => {
                setStep({ id: 'scan' });
              }}
            >
              Scan the receiving phone’s code
            </Button>
          ) : (
            <p className="flex items-center justify-center gap-2 text-xs text-slate-500">
              <Loader2 className="size-4 animate-spin" /> Waiting for the sending phone…
            </p>
          )}
        </>
      )}

      {step.id === 'scan' && (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">{instructions[role].scan}</p>
          <QrScanner accept={handleCode} />
        </>
      )}

      {(step.id === 'show' || step.id === 'scan') && (
        <CodeFallback
          code={ownCode}
          onSubmit={role === 'receive' && step.id === 'show' ? undefined : (text) => void handleCode(text)}
        />
      )}

      {step.id === 'transfer' && <TransferStats role={role} stats={stats} />}

      {step.id === 'done' && (
        <>
          <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-4 text-sm text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
            <Check className="size-5 shrink-0" />
            {role === 'send'
              ? `“${step.name}” was sent.`
              : `“${step.name}” was added to your maps and opened.`}
          </p>
          {stats && <TransferSummary stats={stats} />}
        </>
      )}

      {step.id === 'error' && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 px-3 py-3 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300"
        >
          {step.message}
        </p>
      )}
    </div>
  );
}

/** Direct phone-to-phone map transfer on the same network, connected by scanning QR codes both ways. */
export default function P2PTransferModal({ role, map, onReceived, onClose }: P2PTransferModalProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <Modal
      open
      onClose={onClose}
      title={role === 'send' ? 'Send to nearby phone' : 'Receive from nearby phone'}
      subtitle="Both phones must be on the same Wi-Fi. The map goes directly between them."
      footer={
        <Button
          variant="ghost"
          size="sm"
          icon={<RotateCcw className="size-4" />}
          onClick={() => {
            setAttempt((a) => a + 1);
          }}
        >
          Start over
        </Button>
      }
    >
      <Transfer key={attempt} role={role} map={map} onReceived={onReceived} />
    </Modal>
  );
}
