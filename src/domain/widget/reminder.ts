/**
 * Reminder widget domain.
 *
 * Pure rules only: the component owns IndexedDB and the browser scheduler,
 * this module owns validation and restoration. Keeping the limits here means a
 * restored snapshot, an imported backup and a live submission follow the same
 * rules.
 */

export const REMINDER_MAX_ITEMS = 50;
export const REMINDER_MAX_TEXT_LENGTH = 80;

export interface ReminderItem {
  readonly id: string;
  /** Trimmed, non-empty description of what should be remembered. */
  readonly title: string;
  /** Epoch milliseconds in the user's local time. */
  readonly dueAt: number;
  readonly createdAt: string;
}

export interface ReminderState {
  readonly items: readonly ReminderItem[];
}

export type ReminderRejection =
  | 'empty-text'
  | 'text-too-long'
  | 'invalid-time'
  | 'past-time'
  | 'limit-reached'
  | 'duplicate-id'
  | 'not-found';

export type ReminderResult =
  | { readonly ok: true; readonly state: ReminderState }
  | { readonly ok: false; readonly reason: ReminderRejection };

export const EMPTY_REMINDER_STATE: ReminderState = { items: [] };

const reject = (reason: ReminderRejection): ReminderResult => ({ ok: false, reason });

export const REMINDER_REJECTION_TEXT: Readonly<Record<ReminderRejection, string>> = {
  'empty-text': '提醒内容不能为空。',
  'text-too-long': `单条最多 ${REMINDER_MAX_TEXT_LENGTH} 个字符。`,
  'invalid-time': '请选择有效的提醒时间。',
  'past-time': '提醒时间必须晚于当前时间。',
  'limit-reached': `最多只能保存 ${REMINDER_MAX_ITEMS} 条提醒。`,
  'duplicate-id': '提醒标识重复。',
  'not-found': '找不到这条提醒。',
};

export function normalizeReminderText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function reminderRejection(title: string, dueAt: number, nowMs: number): ReminderRejection | undefined {
  const text = normalizeReminderText(title);
  if (!text) return 'empty-text';
  if (text.length > REMINDER_MAX_TEXT_LENGTH) return 'text-too-long';
  if (!Number.isFinite(dueAt) || dueAt <= 0) return 'invalid-time';
  if (dueAt <= nowMs) return 'past-time';
  return undefined;
}

export function validateReminderInput(title: string, dueAt: number, nowMs = Date.now()): string | undefined {
  const reason = reminderRejection(title, dueAt, nowMs);
  return reason === undefined ? undefined : REMINDER_REJECTION_TEXT[reason];
}

export function addReminder(
  state: ReminderState,
  input: { readonly id: string; readonly title: string; readonly dueAt: number; readonly createdAt: string },
  nowMs = Date.now(),
): ReminderResult {
  const reason = reminderRejection(input.title, input.dueAt, nowMs);
  if (reason) return reject(reason);
  if (state.items.length >= REMINDER_MAX_ITEMS) return reject('limit-reached');
  if (state.items.some((item) => item.id === input.id)) return reject('duplicate-id');
  return {
    ok: true,
    state: {
      items: [...state.items, {
        id: input.id,
        title: normalizeReminderText(input.title),
        dueAt: input.dueAt,
        createdAt: input.createdAt,
      }],
    },
  };
}

export function removeReminder(state: ReminderState, id: string): ReminderResult {
  if (!state.items.some((item) => item.id === id)) return reject('not-found');
  return { ok: true, state: { items: state.items.filter((item) => item.id !== id) } };
}

/** Soonest first; expired reminders stay visible until removed. */
export function sortedReminders(state: ReminderState): readonly ReminderItem[] {
  return [...state.items].sort((a, b) => a.dueAt - b.dueAt || a.createdAt.localeCompare(b.createdAt));
}

export function reminderSummary(state: ReminderState, nowMs = Date.now()): { readonly total: number; readonly upcoming: number; readonly expired: number } {
  const expired = state.items.filter((item) => item.dueAt <= nowMs).length;
  return { total: state.items.length, upcoming: state.items.length - expired, expired };
}

/** Restores persisted data defensively; malformed rows are dropped, not thrown. */
export function parseReminderState(value: unknown): ReminderState {
  if (!isRecord(value) || !Array.isArray(value.items)) return EMPTY_REMINDER_STATE;
  const items: ReminderItem[] = [];
  for (const entry of value.items.slice(0, REMINDER_MAX_ITEMS)) {
    if (!isRecord(entry)) continue;
    const id = typeof entry.id === 'string' ? entry.id : undefined;
    const title = typeof entry.title === 'string' ? normalizeReminderText(entry.title) : undefined;
    const dueAt = typeof entry.dueAt === 'number' && Number.isFinite(entry.dueAt) ? entry.dueAt : undefined;
    if (!id || !title || !title.length || title.length > REMINDER_MAX_TEXT_LENGTH || dueAt === undefined || dueAt <= 0) continue;
    if (items.some((item) => item.id === id)) continue;
    items.push({
      id,
      title,
      dueAt,
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date(0).toISOString(),
    });
  }
  return { items };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
