import { registerSW } from 'virtual:pwa-register';

// A refresh after a deploy first renders the old precached version; the new service worker then
// installs and workbox-window reloads the page. This store drives an overlay for that window.

/** Hides the overlay if the reload never comes, so it can never trap the user. */
const UPDATE_TIMEOUT_MS = 20_000;

let updating = false;
let timeout: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function setUpdating(value: boolean): void {
  if (updating === value) return;
  updating = value;
  clearTimeout(timeout);
  if (value)
    timeout = setTimeout(() => {
      setUpdating(false);
    }, UPDATE_TIMEOUT_MS);
  listeners.forEach((listener) => {
    listener();
  });
}

export function subscribeAppUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAppUpdating(): boolean {
  return updating;
}

function watch(worker: ServiceWorker | null): void {
  // No controller means a first install: nothing stale is on screen and no reload follows.
  if (!worker || !navigator.serviceWorker.controller) return;
  setUpdating(true);
  // Success ends with the automatic reload; only a failed install needs the overlay removed.
  worker.addEventListener('statechange', () => {
    if (worker.state === 'redundant') setUpdating(false);
  });
}

export function registerAppUpdates(): void {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      watch(registration.installing);
      registration.addEventListener('updatefound', () => {
        watch(registration.installing);
      });
    },
  });
}
