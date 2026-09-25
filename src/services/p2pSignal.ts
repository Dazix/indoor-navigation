import { z } from 'zod';

/** Prefix of handshake QR codes, so the scanner ignores location markers and unrelated codes. */
export const SIGNAL_PREFIX = 'IN1:';

export type SignalKind = 'offer' | 'answer';

export interface Signal {
  kind: SignalKind;
  sdp: string;
}

const SignalSchema = z.object({ t: z.enum(['o', 'a']), s: z.string().min(1).max(20_000) });

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Packs an SDP offer/answer into a short QR-friendly string (deflate + base64url). */
export async function encodeSignal(signal: Signal): Promise<string> {
  const json = JSON.stringify({ t: signal.kind === 'offer' ? 'o' : 'a', s: signal.sdp });
  const packed = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  return SIGNAL_PREFIX + toBase64Url(packed);
}

export function isSignalText(text: string): boolean {
  return text.startsWith(SIGNAL_PREFIX);
}

/** Inverse of encodeSignal. Throws on anything that is not a handshake code from this app. */
export async function decodeSignal(text: string): Promise<Signal> {
  const trimmed = text.trim();
  if (!isSignalText(trimmed)) throw new Error('This is not a map transfer code');
  let raw: unknown;
  try {
    const bytes = await pipe(
      fromBase64Url(trimmed.slice(SIGNAL_PREFIX.length)),
      new DecompressionStream('deflate-raw'),
    );
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('The transfer code is damaged');
  }
  const parsed = SignalSchema.safeParse(raw);
  if (!parsed.success) throw new Error('The transfer code is damaged');
  return { kind: parsed.data.t === 'o' ? 'offer' : 'answer', sdp: parsed.data.s };
}
