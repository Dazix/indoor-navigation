import { describe, expect, it } from 'vitest';
import { isTypingTarget, toolForShortcut } from '../editorShortcuts';

const press = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe('toolForShortcut', () => {
  it('maps the tool letters in either case', () => {
    expect(toolForShortcut(press('s'))).toBe('select');
    expect(toolForShortcut(press('A'))).toBe('add_node');
    expect(toolForShortcut(press('c'))).toBe('link_nodes');
    expect(toolForShortcut(press('d'))).toBe('delete');
    expect(toolForShortcut(press('M'))).toBe('measure');
  });

  it('ignores other keys', () => {
    expect(toolForShortcut(press('x'))).toBeNull();
    expect(toolForShortcut(press('Enter'))).toBeNull();
  });

  it('ignores letters combined with ctrl, meta or alt', () => {
    expect(toolForShortcut(press('s', { ctrlKey: true }))).toBeNull();
    expect(toolForShortcut(press('c', { metaKey: true }))).toBeNull();
    expect(toolForShortcut(press('a', { altKey: true }))).toBeNull();
  });
});

describe('isTypingTarget', () => {
  it('detects text-entry elements', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('lets other elements through', () => {
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: false })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
