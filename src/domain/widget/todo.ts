import type { LayoutItem } from '@/src/domain/grid/model';

/**
 * To-do widget domain (product baseline 10.x, "本地任务增删改和完成状态").
 *
 * Pure functions only: the widget component owns persistence, this module owns
 * the rules. Keeping validation here means the same limits apply to a
 * restored snapshot, an imported value and a live keystroke.
 */

export const TODO_MAX_ITEMS = 50;
export const TODO_MAX_TEXT_LENGTH = 120;

export interface TodoItem {
  readonly id: string;
  /** Always trimmed and non-empty; the UI rejects blank input before calling in. */
  readonly text: string;
  readonly done: boolean;
  readonly createdAt: string;
  /** Stable ordering key; new items sort after existing ones. */
  readonly order: number;
}

export interface TodoState {
  readonly items: readonly TodoItem[];
}

export type TodoRejection =
  | 'empty-text'
  | 'text-too-long'
  | 'limit-reached'
  | 'duplicate-id'
  | 'not-found';

export type TodoResult =
  | { readonly ok: true; readonly state: TodoState }
  | { readonly ok: false; readonly reason: TodoRejection };

export const EMPTY_TODO_STATE: TodoState = { items: [] };

const reject = (reason: TodoRejection): TodoResult => ({ ok: false, reason });

export const TODO_REJECTION_TEXT: Readonly<Record<TodoRejection, string>> = {
  'empty-text': '内容不能为空。',
  'text-too-long': `单条最多 ${TODO_MAX_TEXT_LENGTH} 个字符。`,
  'limit-reached': `最多只能保存 ${TODO_MAX_ITEMS} 条待办。`,
  'duplicate-id': '待办标识重复。',
  'not-found': '找不到这条待办。',
};

/** Normalises user input: trims and collapses internal whitespace runs. */
export function normalizeTodoText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function addTodo(state: TodoState, rawText: string, id: string, now = new Date().toISOString()): TodoResult {
  const text = normalizeTodoText(rawText);
  if (!text) return reject('empty-text');
  if (text.length > TODO_MAX_TEXT_LENGTH) return reject('text-too-long');
  if (state.items.length >= TODO_MAX_ITEMS) return reject('limit-reached');
  if (state.items.some((item) => item.id === id)) return reject('duplicate-id');
  const order = state.items.reduce((max, item) => Math.max(max, item.order), -1) + 1;
  return { ok: true, state: { items: [...state.items, { id, text, done: false, createdAt: now, order }] } };
}

export function toggleTodo(state: TodoState, id: string): TodoResult {
  if (!state.items.some((item) => item.id === id)) return reject('not-found');
  return { ok: true, state: { items: state.items.map((item) => item.id === id ? { ...item, done: !item.done } : item) } };
}

export function editTodo(state: TodoState, id: string, rawText: string): TodoResult {
  const existing = state.items.find((item) => item.id === id);
  if (!existing) return reject('not-found');
  const text = normalizeTodoText(rawText);
  if (!text) return reject('empty-text');
  if (text.length > TODO_MAX_TEXT_LENGTH) return reject('text-too-long');
  return { ok: true, state: { items: state.items.map((item) => item.id === id ? { ...item, text } : item) } };
}

export function removeTodo(state: TodoState, id: string): TodoResult {
  if (!state.items.some((item) => item.id === id)) return reject('not-found');
  return { ok: true, state: { items: state.items.filter((item) => item.id !== id) } };
}

export function clearCompleted(state: TodoState): TodoResult {
  const items = state.items.filter((item) => !item.done);
  if (items.length === state.items.length) return reject('not-found');
  return { ok: true, state: { items } };
}

/** Display order: unfinished first, then completion, then stable creation order. */
export function sortedTodos(state: TodoState): readonly TodoItem[] {
  return [...state.items].sort((a, b) => Number(a.done) - Number(b.done) || a.order - b.order || a.id.localeCompare(b.id));
}

export function todoSummary(state: TodoState): { readonly total: number; readonly remaining: number } {
  return { total: state.items.length, remaining: state.items.filter((item) => !item.done).length };
}

/**
 * Restores persisted data defensively. A single malformed entry must not wipe
 * the whole list, so anything unrecognised is dropped rather than thrown.
 */
export function parseTodoState(value: unknown): TodoState {
  if (!isRecord(value) || !Array.isArray(value.items)) return EMPTY_TODO_STATE;
  const items: TodoItem[] = [];
  for (const entry of value.items.slice(0, TODO_MAX_ITEMS)) {
    if (!isRecord(entry)) continue;
    const id = typeof entry.id === 'string' ? entry.id : undefined;
    const text = typeof entry.text === 'string' ? normalizeTodoText(entry.text) : undefined;
    if (!id || !text || text.length > TODO_MAX_TEXT_LENGTH) continue;
    if (items.some((item) => item.id === id)) continue;
    items.push({
      id,
      text,
      done: entry.done === true,
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date(0).toISOString(),
      order: typeof entry.order === 'number' && Number.isFinite(entry.order) ? entry.order : items.length,
    });
  }
  return { items };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Layout size constraint helper: the to-do widget is a normal grid widget. */
export function todoSizeConstraint(): { presets: readonly (readonly [number, number])[]; minW: number; minH: number; maxW: number; maxH: number } {
  return { presets: [[2, 2], [4, 2], [4, 4]], minW: 2, minH: 2, maxW: 4, maxH: 4 };
}

/** Guard used by the host before mounting: the layout rect must be sane. */
export function isValidTodoLayout(item: LayoutItem): boolean {
  return item.kind === 'widget' && Number.isInteger(item.w) && Number.isInteger(item.h) && item.w >= 2 && item.h >= 2;
}
