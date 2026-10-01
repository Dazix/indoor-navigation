import type { EditorTool } from '../types/navigation';

const TOOL_BY_KEY: Record<string, EditorTool> = {
  s: 'select',
  a: 'add_node',
  c: 'link_nodes',
  d: 'delete',
  m: 'measure',
};

interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** Editor tool picked by a plain letter key (S, A, C, D, M); null for anything else or with modifiers. */
export function toolForShortcut(e: ShortcutEvent): EditorTool | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  return TOOL_BY_KEY[e.key.toLowerCase()] ?? null;
}

/** True when keystrokes on this element are text input, so single-key shortcuts must stay out of the way. */
export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!target) return false;
  return target.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName ?? '');
}
