import type { MapData } from '../types/map';
import { MAX_IMPORT_BYTES, parseMapData } from './mapStorage';
import { decodeSignal, encodeSignal } from './p2pSignal';

/**
 * Direct phone-to-phone map transfer over a WebRTC data channel.
 *
 * No STUN/TURN servers are configured, so only local-network (host / mDNS) candidates are
 * gathered: the phones must be on the same network, and no third-party server is involved.
 * Signalling is manual: the sender shows an offer QR, the receiver scans it and shows an answer
 * QR, the sender scans that. ICE gathering completes before each code is shown (no trickle).
 */

export const CHUNK_BYTES = 64 * 1024;
const BUFFER_HIGH_WATER = 1024 * 1024;
const ICE_GATHER_TIMEOUT_MS = 3000;
/** How long the sender waits for the channel to open after scanning the answer. */
export const CONNECT_TIMEOUT_MS = 15_000;
/** How long the receiver waits for the sender to scan its answer code. */
const RECEIVER_WAIT_MS = 5 * 60_000;

export const CONNECT_FAILED_MESSAGE =
  'The phones could not connect directly. Both must be on the same Wi-Fi; guest and corporate networks that isolate devices block this. Use Share instead.';

/** connecting → transferring → finishing (receiver unpacks and validates) → done */
export type TransferPhase = 'connecting' | 'transferring' | 'finishing' | 'done';

export interface TransferProgress {
  phase: TransferPhase;
  /** Compressed bytes that have reached the receiver. */
  done: number;
  /** Compressed payload size; 0 until known. */
  total: number;
  /** Size of the map JSON before compression. */
  rawBytes: number;
}

export type Progress = (progress: TransferProgress) => void;

type ControlMessage =
  | { kind: 'meta'; name: string; bytes: number; rawBytes: number }
  | { kind: 'got'; bytes: number }
  | { kind: 'done' }
  | { kind: 'ack' };

// ---- Pure helpers ----------------------------------------------------------------------------

export function splitChunks(bytes: Uint8Array, size = CHUNK_BYTES): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.subarray(i, i + size));
  return chunks;
}

export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export function gzipText(text: string): Promise<Uint8Array> {
  return pipe(new TextEncoder().encode(text), new CompressionStream('gzip'));
}

export async function gunzipText(bytes: Uint8Array): Promise<string> {
  return new TextDecoder().decode(await pipe(bytes, new DecompressionStream('gzip')));
}

function parseControl(data: string): ControlMessage | null {
  try {
    const msg = JSON.parse(data) as Partial<ControlMessage>;
    return typeof msg.kind === 'string' ? (msg as ControlMessage) : null;
  } catch {
    return null;
  }
}

// ---- WebRTC plumbing -------------------------------------------------------------------------

function createPeer(): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: [] });
}

function waitForIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, ICE_GATHER_TIMEOUT_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

async function localCode(pc: RTCPeerConnection, kind: 'offer' | 'answer'): Promise<string> {
  await waitForIce(pc);
  const sdp = pc.localDescription?.sdp;
  if (!sdp) throw new Error('Could not prepare the connection');
  return encodeSignal({ kind, sdp });
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function waitForOpen(channel: RTCDataChannel): Promise<void> {
  if (channel.readyState === 'open') return Promise.resolve();
  return new Promise((resolve, reject) => {
    channel.addEventListener('open', () => {
      resolve();
    });
    channel.addEventListener('close', () => {
      reject(new Error(CONNECT_FAILED_MESSAGE));
    });
  });
}

function drain(channel: RTCDataChannel): Promise<void> {
  if (channel.bufferedAmount <= BUFFER_HIGH_WATER) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onLow = () => {
      channel.removeEventListener('close', onClose);
      resolve();
    };
    const onClose = () => {
      channel.removeEventListener('bufferedamountlow', onLow);
      reject(new Error('The connection was lost during the transfer'));
    };
    channel.addEventListener('bufferedamountlow', onLow, { once: true });
    channel.addEventListener('close', onClose, { once: true });
  });
}

// ---- Sender ----------------------------------------------------------------------------------

export interface MapSender {
  /** QR payload to show to the receiving phone. */
  offerCode: string;
  /** Applies the receiver's answer, then sends the map once connected. Resolves after the receiver confirms. */
  send: (answerCode: string, json: string, name: string, onProgress: Progress) => Promise<void>;
  close: () => void;
}

export async function createSender(): Promise<MapSender> {
  const pc = createPeer();
  const channel = pc.createDataChannel('map', { ordered: true });
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = BUFFER_HIGH_WATER / 2;
  await pc.setLocalDescription(await pc.createOffer());
  const offerCode = await localCode(pc, 'offer');

  const send: MapSender['send'] = async (answerCode, json, name, onProgress) => {
    const answer = await decodeSignal(answerCode);
    if (answer.kind !== 'answer') throw new Error('Scan the code shown on the receiving phone');
    const acked = new Promise<void>((resolve, reject) => {
      channel.addEventListener('message', (e: MessageEvent) => {
        if (typeof e.data === 'string' && parseControl(e.data)?.kind === 'ack') resolve();
      });
      channel.addEventListener('close', () => {
        reject(new Error('The receiving phone disconnected before confirming'));
      });
    });
    const rawBytes = new TextEncoder().encode(json).length;
    onProgress({ phase: 'connecting', done: 0, total: 0, rawBytes });
    await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
    await withTimeout(waitForOpen(channel), CONNECT_TIMEOUT_MS, CONNECT_FAILED_MESSAGE);

    const payload = await gzipText(json);
    const total = payload.length;
    // Progress follows what the receiver confirmed, not what sits in the local send buffer.
    channel.addEventListener('message', (e: MessageEvent) => {
      if (typeof e.data !== 'string') return;
      const msg = parseControl(e.data);
      if (msg?.kind === 'got') {
        onProgress({
          phase: msg.bytes >= total ? 'finishing' : 'transferring',
          done: msg.bytes,
          total,
          rawBytes,
        });
      }
    });
    channel.send(JSON.stringify({ kind: 'meta', name, bytes: total, rawBytes } satisfies ControlMessage));
    onProgress({ phase: 'transferring', done: 0, total, rawBytes });
    for (const chunk of splitChunks(payload)) {
      await drain(channel);
      channel.send(chunk as Uint8Array<ArrayBuffer>);
    }
    channel.send(JSON.stringify({ kind: 'done' } satisfies ControlMessage));
    await acked;
    onProgress({ phase: 'done', done: total, total, rawBytes });
  };

  return {
    offerCode,
    send,
    close: () => {
      pc.close();
    },
  };
}

// ---- Receiver --------------------------------------------------------------------------------

export interface MapReceiver {
  /** QR payload to show back to the sending phone. */
  answerCode: string;
  /** Resolves with the validated map once the whole transfer has arrived. */
  received: Promise<MapData>;
  close: () => void;
}

export async function createReceiver(offerCode: string, onProgress: Progress): Promise<MapReceiver> {
  const offer = await decodeSignal(offerCode);
  if (offer.kind !== 'offer') throw new Error('Scan the code shown on the sending phone');
  const pc = createPeer();

  const received = new Promise<MapData>((resolve, reject) => {
    pc.addEventListener('datachannel', ({ channel }) => {
      channel.binaryType = 'arraybuffer';
      let total = 0;
      let rawBytes = 0;
      let got = 0;
      const chunks: Uint8Array[] = [];

      const report = (phase: TransferPhase) => {
        onProgress({ phase, done: got, total, rawBytes });
      };
      if (channel.readyState === 'open') report('connecting');
      else
        channel.addEventListener('open', () => {
          report('connecting');
        });
      channel.addEventListener('close', () => {
        reject(new Error('The sending phone disconnected before the transfer finished'));
      });
      channel.addEventListener('message', (e: MessageEvent) => {
        if (e.data instanceof ArrayBuffer) {
          const chunk = new Uint8Array(e.data);
          got += chunk.length;
          if (got > MAX_IMPORT_BYTES) {
            reject(new Error('The map is too large'));
            channel.close();
            return;
          }
          chunks.push(chunk);
          channel.send(JSON.stringify({ kind: 'got', bytes: got } satisfies ControlMessage));
          report('transferring');
          return;
        }
        if (typeof e.data !== 'string') return;
        const msg = parseControl(e.data);
        if (msg?.kind === 'meta') {
          total = msg.bytes;
          rawBytes = msg.rawBytes;
          report('transferring');
        } else if (msg?.kind === 'done') {
          report('finishing');
          void (async () => {
            try {
              const text = await gunzipText(joinChunks(chunks));
              if (text.length > MAX_IMPORT_BYTES) throw new Error('The map is too large');
              const parsed = parseMapData(JSON.parse(text));
              if (!parsed.ok) throw new Error(`The received map is invalid: ${parsed.error}`);
              channel.send(JSON.stringify({ kind: 'ack' } satisfies ControlMessage));
              report('done');
              resolve(parsed.data);
            } catch (err) {
              reject(err instanceof Error ? err : new Error('The received data is damaged'));
            }
          })();
        }
      });
    });
  });

  await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  const answerCode = await localCode(pc, 'answer');

  return {
    answerCode,
    received: withTimeout(received, RECEIVER_WAIT_MS, CONNECT_FAILED_MESSAGE),
    close: () => {
      pc.close();
    },
  };
}
