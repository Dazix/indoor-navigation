import { afterEach, describe, expect, it, vi } from 'vitest';
import { toCloudError, withTimeout } from '../errors';
import { CloudError } from '../types';

const firebaseError = (code: string) => Object.assign(new Error(`Firebase: ${code}`), { code });

describe('toCloudError', () => {
  it.each([
    ['permission-denied', 'permission'],
    ['unauthenticated', 'auth-required'],
    ['unavailable', 'network'],
    ['deadline-exceeded', 'network'],
    ['auth/network-request-failed', 'network'],
    ['auth/popup-closed-by-user', 'auth-required'],
    ['auth/cancelled-popup-request', 'auth-required'],
    ['auth/popup-blocked', 'auth-required'],
    ['auth/unauthorized-domain', 'auth-required'],
    ['auth/operation-not-allowed', 'auth-required'],
    ['resource-exhausted', 'unknown'],
  ] as const)('maps %s to %s', (code, expected) => {
    expect(toCloudError(firebaseError(code)).code).toBe(expected);
  });

  it('explains how to fix the two common setup mistakes', () => {
    expect(toCloudError(firebaseError('auth/unauthorized-domain')).message).toContain('Authorized domains');
    expect(toCloudError(firebaseError('auth/operation-not-allowed')).message).toContain('Sign-in method');
  });

  it('passes CloudErrors through unchanged', () => {
    const err = new CloudError('conflict', 'moved');
    expect(toCloudError(err)).toBe(err);
  });

  it('keeps the message of unknown errors and copes with non-errors', () => {
    expect(toCloudError(new Error('boom')).message).toBe('boom');
    expect(toCloudError('weird').code).toBe('unknown');
    expect(toCloudError(null).code).toBe('unknown');
  });
});

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the value when fast enough', async () => {
    await expect(withTimeout(Promise.resolve(5), 1000)).resolves.toBe(5);
  });

  it('rejects with a network error when too slow', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise<never>(() => undefined), 1000);
    const assertion = expect(pending).rejects.toMatchObject({ code: 'network' });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('translates SDK errors', async () => {
    await expect(withTimeout(Promise.reject(firebaseError('permission-denied')), 1000)).rejects.toMatchObject(
      {
        code: 'permission',
      },
    );
  });
});
