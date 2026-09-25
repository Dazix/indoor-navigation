import type { AppMode } from '../types/navigation';

/**
 * Only the editor has its own address. A hash (not a path) is used because GitHub Pages has no
 * SPA fallback, so a reload of /editor would 404; the hash also coexists with the ?map= parameter.
 */
export const EDITOR_HASH = '#editor';

export function modeFromHash(hash: string): AppMode {
  return hash === EDITOR_HASH ? 'editor' : 'user';
}

/** The same URL with the hash set for the editor, or cleared for any other mode. */
export function hrefForMode(href: string, mode: AppMode): string {
  const url = new URL(href);
  url.hash = mode === 'editor' ? EDITOR_HASH : '';
  // URL keeps a bare "#" after clearing the hash; drop it so navigation stays on the plain address.
  return url.href.replace(/#$/, '');
}
