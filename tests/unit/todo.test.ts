import { describe, expect, it } from 'vitest';
import {
  EMPTY_TODO_STATE, TODO_MAX_ITEMS, TODO_MAX_TEXT_LENGTH, TODO_REJECTION_TEXT,
  addTodo, clearCompleted, editTodo, normalizeTodoText, parseTodoState, removeTodo,
  sortedTodos, todoSummary, toggleTodo, type TodoState,
} from '@/src/domain/widget/todo';

/**
 * To-do widget rules (baseline 10.x). The limits are enforced here rather than
 * in the component so a restored snapshot, an imported value and a live
 * keystroke are all held to the same contract.
 */

const at = (index: number) => `2026-11-09T00:00:0${index % 10}.000Z`;

function withItems(...texts: string[]): TodoState {
  let state: TodoState = EMPTY_TODO_STATE;
  texts.forEach((text, index) => {
    const result = addTodo(state, text, `id-${index}`, at(index));
    if (!result.ok) throw new Error(result.reason);
    state = result.state;
  });
  return state;
}

describe('text normalisation', () => {
  it('trims edges and collapses internal whitespace', () => {
    expect(normalizeTodoText('  buy   milk \n and eggs  ')).toBe('buy milk and eggs');
  });

  it('turns whitespace-only input into an empty string', () => {
    expect(normalizeTodoText('   \t\n ')).toBe('');
  });
});

describe('adding items', () => {
  it('appends with a stable increasing order', () => {
    const state = withItems('first', 'second', 'third');
    expect(state.items.map((item) => item.order)).toEqual([0, 1, 2]);
    expect(state.items.map((item) => item.text)).toEqual(['first', 'second', 'third']);
    expect(state.items.every((item) => !item.done)).toBe(true);
  });

  it('rejects blank and whitespace-only text', () => {
    expect(addTodo(EMPTY_TODO_STATE, '', 'a')).toEqual({ ok: false, reason: 'empty-text' });
    expect(addTodo(EMPTY_TODO_STATE, '   \n ', 'a')).toEqual({ ok: false, reason: 'empty-text' });
  });

  it('rejects text beyond the length limit instead of truncating', () => {
    const long = 'x'.repeat(TODO_MAX_TEXT_LENGTH + 1);
    expect(addTodo(EMPTY_TODO_STATE, long, 'a')).toEqual({ ok: false, reason: 'text-too-long' });
    // Exactly at the limit is allowed.
    const exact = 'y'.repeat(TODO_MAX_TEXT_LENGTH);
    expect(addTodo(EMPTY_TODO_STATE, exact, 'a').ok).toBe(true);
  });

  it('enforces the item count limit', () => {
    let state = EMPTY_TODO_STATE;
    for (let index = 0; index < TODO_MAX_ITEMS; index += 1) {
      const result = addTodo(state, `item ${index}`, `id-${index}`, at(index));
      if (!result.ok) throw new Error(result.reason);
      state = result.state;
    }
    expect(state.items).toHaveLength(TODO_MAX_ITEMS);
    expect(addTodo(state, 'one more', 'overflow')).toEqual({ ok: false, reason: 'limit-reached' });
  });

  it('refuses a duplicate id', () => {
    const state = withItems('a');
    expect(addTodo(state, 'b', 'id-0')).toEqual({ ok: false, reason: 'duplicate-id' });
  });

  it('does not mutate the input state', () => {
    const state = withItems('a');
    const before = state.items.slice();
    const result = addTodo(state, 'b', 'id-9');
    expect(state.items).toEqual(before);
    expect(result.ok).toBe(true);
  });
});

describe('toggling and editing', () => {
  it('flips the done flag and back', () => {
    const state = withItems('a');
    const checked = toggleTodo(state, 'id-0');
    expect(checked.ok && checked.state.items[0]!.done).toBe(true);
    const unchecked = toggleTodo(checked.ok ? checked.state : state, 'id-0');
    expect(unchecked.ok && unchecked.state.items[0]!.done).toBe(false);
  });

  it('reports a missing id instead of silently succeeding', () => {
    expect(toggleTodo(EMPTY_TODO_STATE, 'nope')).toEqual({ ok: false, reason: 'not-found' });
    expect(editTodo(EMPTY_TODO_STATE, 'nope', 'x')).toEqual({ ok: false, reason: 'not-found' });
    expect(removeTodo(EMPTY_TODO_STATE, 'nope')).toEqual({ ok: false, reason: 'not-found' });
  });

  it('applies the same text rules when editing', () => {
    const state = withItems('old');
    expect(editTodo(state, 'id-0', '   ').ok).toBe(false);
    expect(editTodo(state, 'id-0', 'z'.repeat(TODO_MAX_TEXT_LENGTH + 1)).ok).toBe(false);
    const edited = editTodo(state, 'id-0', '  new   text ');
    expect(edited.ok && edited.state.items[0]!.text).toBe('new text');
    // Order and done state survive an edit.
    expect(edited.ok && edited.state.items[0]!.order).toBe(0);
  });
});

describe('removing', () => {
  it('removes one item and keeps the rest', () => {
    const state = withItems('a', 'b', 'c');
    const result = removeTodo(state, 'id-1');
    expect(result.ok && result.state.items.map((item) => item.text)).toEqual(['a', 'c']);
  });

  it('clears completed items only', () => {
    let state = withItems('a', 'b', 'c');
    // Each toggle returns a result union, so the state must be unwrapped
    // before it can be fed into the next call.
    const first = toggleTodo(state, 'id-0');
    if (!first.ok) throw new Error(first.reason);
    const second = toggleTodo(first.state, 'id-2');
    if (!second.ok) throw new Error(second.reason);
    state = second.state;
    const cleared = clearCompleted(state);
    expect(cleared.ok && cleared.state.items.map((item) => item.text)).toEqual(['b']);
  });

  it('reports nothing to clear rather than writing an identical state', () => {
    const state = withItems('a', 'b');
    expect(clearCompleted(state)).toEqual({ ok: false, reason: 'not-found' });
    expect(clearCompleted(EMPTY_TODO_STATE)).toEqual({ ok: false, reason: 'not-found' });
  });
});

describe('display order and summary', () => {
  it('lists unfinished items before completed ones', () => {
    const state = withItems('a', 'b', 'c');
    const toggled = toggleTodo(state, 'id-0');
    if (!toggled.ok) throw new Error(toggled.reason);
    expect(sortedTodos(toggled.state).map((item) => item.text)).toEqual(['b', 'c', 'a']);
  });

  it('keeps creation order inside each group', () => {
    const state = withItems('a', 'b', 'c', 'd');
    const first = toggleTodo(state, 'id-3');
    const second = first.ok ? toggleTodo(first.state, 'id-0') : first;
    if (!second.ok) throw new Error(second.reason);
    expect(sortedTodos(second.state).map((item) => item.text)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('counts total and remaining', () => {
    const state = withItems('a', 'b', 'c');
    const toggled = toggleTodo(state, 'id-1');
    if (!toggled.ok) throw new Error(toggled.reason);
    expect(todoSummary(toggled.state)).toEqual({ total: 3, remaining: 2 });
    expect(todoSummary(EMPTY_TODO_STATE)).toEqual({ total: 0, remaining: 0 });
  });

  it('does not return the live array', () => {
    const state = withItems('b', 'a');
    const sorted = sortedTodos(state);
    expect(sorted).not.toBe(state.items);
  });
});

describe('restoring persisted data', () => {
  it('returns an empty state for anything unusable', () => {
    expect(parseTodoState(undefined)).toEqual(EMPTY_TODO_STATE);
    expect(parseTodoState(null)).toEqual(EMPTY_TODO_STATE);
    expect(parseTodoState('nope')).toEqual(EMPTY_TODO_STATE);
    expect(parseTodoState({})).toEqual(EMPTY_TODO_STATE);
    expect(parseTodoState({ items: 'nope' })).toEqual(EMPTY_TODO_STATE);
  });

  it('drops malformed entries instead of losing the whole list', () => {
    const restored = parseTodoState({
      items: [
        { id: 'ok', text: 'kept', done: false, createdAt: at(0), order: 0 },
        { id: 'blank', text: '   ', done: false },
        { id: 'no-text', done: true },
        { text: 'no-id' },
        'garbage',
        { id: 'too-long', text: 'x'.repeat(TODO_MAX_TEXT_LENGTH + 1) },
        { id: 'dup', text: 'first dup' },
        { id: 'dup', text: 'second dup' },
      ],
    });
    expect(restored.items.map((item) => item.id)).toEqual(['ok', 'dup']);
    expect(restored.items.map((item) => item.text)).toEqual(['kept', 'first dup']);
  });

  it('normalises text and coerces the done flag on load', () => {
    const restored = parseTodoState({
      items: [{ id: 'a', text: '  spaced   out  ', done: 'yes', createdAt: at(1), order: 3 }],
    });
    expect(restored.items[0]).toMatchObject({ id: 'a', text: 'spaced out', done: false, order: 3 });
    // A non-boolean truthy value must not be treated as completed.
    expect(restored.items[0]!.done).toBe(false);
  });

  it('caps a hostile payload at the item limit', () => {
    const items = Array.from({ length: TODO_MAX_ITEMS + 20 }, (_, index) => ({
      id: `id-${index}`, text: `item ${index}`, done: false, createdAt: at(index), order: index,
    }));
    const restored = parseTodoState({ items });
    expect(restored.items).toHaveLength(TODO_MAX_ITEMS);
  });

  it('fills a missing order instead of producing NaN', () => {
    const restored = parseTodoState({ items: [{ id: 'a', text: 'no order', done: false }] });
    expect(Number.isFinite(restored.items[0]!.order)).toBe(true);
    expect(restored.items[0]!.order).toBe(0);
  });
});

describe('rejection messages', () => {
  it('has a user-facing sentence for every rejection reason', () => {
    const reasons = ['empty-text', 'text-too-long', 'limit-reached', 'duplicate-id', 'not-found'] as const;
    for (const reason of reasons) {
      expect(TODO_REJECTION_TEXT[reason].length).toBeGreaterThan(0);
    }
  });
});
