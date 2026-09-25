import { describe, expect, it } from 'vitest';
import { decodeSignal, encodeSignal, SIGNAL_PREFIX } from './p2pSignal';

const SDP = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:1 1 udp 2122260223 3f1c1d52-0b7e-4f0b-a2d5-1f6f1f3a9b1e.local 54321 typ host generation 0',
  'a=ice-ufrag:abcd',
  'a=ice-pwd:0123456789abcdefghijklmn',
  'a=fingerprint:sha-256 AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  '',
].join('\r\n');

describe('p2p signalling codes', () => {
  it('round-trips an offer and an answer', async () => {
    for (const kind of ['offer', 'answer'] as const) {
      const code = await encodeSignal({ kind, sdp: SDP });
      expect(code.startsWith(SIGNAL_PREFIX)).toBe(true);
      expect(code).toMatch(/^IN1:[\w-]+$/);
      await expect(decodeSignal(code)).resolves.toEqual({ kind, sdp: SDP });
    }
  });

  it('compresses the SDP so it fits a QR code comfortably', async () => {
    const code = await encodeSignal({ kind: 'offer', sdp: SDP });
    expect(code.length).toBeLessThan(SDP.length);
  });

  it('rejects codes from other sources', async () => {
    await expect(decodeSignal('LOC-12')).rejects.toThrow('not a map transfer code');
    await expect(decodeSignal('IN1:not-deflate')).rejects.toThrow('damaged');
  });
});
