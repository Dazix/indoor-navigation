import { CloudError, type CloudAdapter } from './types';

const notConfigured = () => new CloudError('unknown', 'Cloud sync is not configured');

/** Fallback when no Firebase credentials exist: the app stays purely local and reads find nothing. */
export const nullAdapter: CloudAdapter = {
  configured: false,
  getHead: () => Promise.resolve(null),
  pull: () => Promise.resolve(null),
  push: () => Promise.reject(notConfigured()),
  watch: () => () => undefined,
  signIn: () => Promise.reject(notConfigured()),
  signOut: () => Promise.resolve(),
  onAuthChange: (callback) => {
    callback(null);
    return () => undefined;
  },
  currentUser: () => null,
};
