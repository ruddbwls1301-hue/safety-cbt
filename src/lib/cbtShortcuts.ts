/** Keyboard rules for the CBT screen: 1–4 answer, ←/→ move, Enter checks the selected answer. */
export type ShortcutTarget = 'text-input' | 'answer-option' | 'control' | 'other';

export type CbtShortcut = { type: 'answer'; value: number } | { type: 'move'; index: number } | { type: 'check' };

export type CbtShortcutState = {
  checked: boolean;
  canCheck: boolean;
  index: number;
  total: number;
  choiceCount: number;
};

export function shortcutTargetKind(target: EventTarget | null): ShortcutTarget {
  const element = target as Element | null;
  if (!element || typeof element.closest !== 'function') return 'other';
  if (element.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return 'text-input';
  if (element.closest('.answer-option')) return 'answer-option';
  if (element.closest('button, a[href], summary')) return 'control';
  return 'other';
}

export function resolveCbtShortcut(
  input: { key: string; isComposing?: boolean; modifier?: boolean; target: ShortcutTarget },
  state: CbtShortcutState,
): CbtShortcut | null {
  // Never steal typing, IME composition (Korean input) or browser/OS shortcuts.
  if (input.isComposing || input.modifier || input.target === 'text-input') return null;
  if (/^[1-9]$/u.test(input.key)) {
    const value = Number(input.key);
    return !state.checked && value <= state.choiceCount ? { type: 'answer', value } : null;
  }
  if (input.key === 'ArrowLeft') return state.index > 0 ? { type: 'move', index: state.index - 1 } : null;
  if (input.key === 'ArrowRight') return state.index < state.total - 1 ? { type: 'move', index: state.index + 1 } : null;
  // A focused control (bookmark, check button…) keeps its own Enter activation.
  if (input.key === 'Enter') return state.canCheck && input.target !== 'control' ? { type: 'check' } : null;
  return null;
}
