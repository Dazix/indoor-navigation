import { CloudError } from './types';

function codeOf(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/** Translates Firebase SDK errors (Firestore and Auth) into errors the UI can explain to a non-technical user. */
export function toCloudError(err: unknown): CloudError {
  if (err instanceof CloudError) return err;

  switch (codeOf(err)) {
    case 'permission-denied':
      return new CloudError(
        'permission',
        'The security rules do not allow this. Sign in with a Google account that has access.',
      );
    case 'unauthenticated':
      return new CloudError('auth-required', 'Sign in with Google to continue');
    case 'unavailable':
    case 'deadline-exceeded':
    case 'auth/network-request-failed':
      return new CloudError(
        'network',
        'The cloud could not be reached. Your changes are kept on this device.',
      );
    case 'resource-exhausted':
      return new CloudError('unknown', 'The Firebase usage quota is exhausted. Try again later.');
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return new CloudError('auth-required', 'Sign-in was cancelled');
    case 'auth/popup-blocked':
      return new CloudError(
        'auth-required',
        'The browser blocked the sign-in window. Allow pop-ups for this site and try again.',
      );
    case 'auth/unauthorized-domain':
      return new CloudError(
        'auth-required',
        'This domain is not allowed to sign in. Add it under Authentication > Settings > Authorized domains in the Firebase console.',
      );
    case 'auth/operation-not-allowed':
      return new CloudError(
        'auth-required',
        'Google sign-in is not enabled. Enable it under Authentication > Sign-in method in the Firebase console.',
      );
    default:
      return new CloudError('unknown', err instanceof Error ? err.message : 'Unexpected cloud error');
  }
}

/** Rejects with a network error when `promise` takes longer than `ms`; Firestore writes queue forever offline. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new CloudError('network', 'The cloud did not respond in time. Your changes are kept on this device.'),
      );
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(toCloudError(err));
      },
    );
  });
}
