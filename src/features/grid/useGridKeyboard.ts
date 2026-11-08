import { useCallback, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { GridColumns, LayoutItem } from '@/src/domain/grid/model';
import type { Direction, LayoutCommand, LayoutPreference } from '@/src/domain/grid/solver';
import { keyboardCommand, type KeyboardLayoutMode } from '@/src/domain/interaction/keyboardLayout';

/**
 * Stage 2B-1 keyboard layout (product baseline 7.3/7.4).
 *
 * Arrow keys move the focused object by one cell, Alt+Arrow resizes it by one
 * cell inside its readable-size constraint. `keyboardCommand` returns
 * undefined at the grid edge, on locked items, and whenever the target would
 * not change — so no key reaches the solver and no empty history entry is
 * recorded.
 *
 * Focus is restored by instanceId after the commit re-renders the grid, which
 * is what "重排后焦点保持在原操作对象上" requires even when the solver moves it.
 */

const ARROW_KEYS: Readonly<Record<string, Direction>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/** Text entry keeps its own arrow behaviour (7.3 last bullet). */
const TEXT_ENTRY_SELECTOR = 'input, textarea, select, [contenteditable="true"]';

export interface GridKeyboardOptions {
  readonly columns: GridColumns;
  readonly layout: readonly LayoutItem[];
  readonly preview: (columns: GridColumns, command: LayoutCommand, preference: LayoutPreference) => boolean;
  readonly commit: () => Promise<void>;
}

export function useGridKeyboard(options: GridKeyboardOptions) {
  /** Guards a re-entrant key repeat while the commit is still queued. */
  const busyRef = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const focusInstance = useCallback((instanceId: string) => {
    window.requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(`[data-instance-id="${CSS.escape(instanceId)}"]`);
      element?.focus({ preventScroll: true });
    });
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if ((event.target as Element | null)?.closest(TEXT_ENTRY_SELECTOR)) return;
    const direction = ARROW_KEYS[event.key];
    if (!direction) return;

    const instanceId = (event.target as Element | null)
      ?.closest<HTMLElement>('[data-instance-id]')?.dataset.instanceId;
    if (!instanceId) return;
    const item = optionsRef.current.layout.find((candidate) => candidate.instanceId === instanceId);
    if (!item) return;

    const mode: KeyboardLayoutMode = event.altKey ? 'resize' : 'move';
    const command = keyboardCommand(item, direction, optionsRef.current.columns, mode);
    // Undefined means grid edge, locked item, or no actual change.
    if (!command) return;

    // Arrows drive the layout here, so they must not also scroll the page.
    event.preventDefault();
    if (busyRef.current) return;

    if (!optionsRef.current.preview(optionsRef.current.columns, command, 'auto')) return;

    busyRef.current = true;
    void optionsRef.current.commit()
      .catch(() => undefined)
      .finally(() => {
        busyRef.current = false;
        focusInstance(instanceId);
      });
  };

  return { onKeyDown };
}
