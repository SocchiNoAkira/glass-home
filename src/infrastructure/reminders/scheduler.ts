import { browser } from 'wxt/browser';
import { parseReminderState, type ReminderItem, type ReminderState } from '@/src/domain/widget/reminder';

/**
 * Local reminder schedule shared by the widget page and the background worker.
 *
 * IndexedDB remains the widget's source of truth and travels with backups. The
 * small mirror in `storage.local` exists because the service worker cannot open
 * a new-tab page to read widget data, but can be woken by alarms at any time.
 * It contains only the reminder rows already present in the widget.
 */

export const REMINDER_SCHEDULE_KEY = 'glass-home.reminders.v1';
export const REMINDER_ALARM_PREFIX = 'glass-home-reminder:';
export const REMINDER_NOTIFICATION_PREFIX = 'glass-home-reminder:';
export const REFRESH_REMINDERS_MESSAGE = 'glass-home:refresh-reminders';

interface RefreshMessage {
  readonly type: typeof REFRESH_REMINDERS_MESSAGE;
}

export function isRefreshRemindersMessage(value: unknown): value is RefreshMessage {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === REFRESH_REMINDERS_MESSAGE;
}

export async function readScheduledReminders(): Promise<ReminderState> {
  const stored = await browser.storage.local.get(REMINDER_SCHEDULE_KEY);
  return parseReminderState(stored[REMINDER_SCHEDULE_KEY]);
}

/** Mirrors the widget state and refreshes alarms so they match it exactly. */
export async function publishReminderSchedule(state: ReminderState): Promise<void> {
  const upcoming = state.items.filter((item) => item.dueAt > Date.now());
  await browser.storage.local.set({ [REMINDER_SCHEDULE_KEY]: { items: upcoming } });
  // Alarms are extension-wide, so refreshing here removes any dependency on
  // the worker having finished starting when the widget is first opened.
  await refreshReminderAlarms();
  try {
    await browser.runtime.sendMessage({ type: REFRESH_REMINDERS_MESSAGE });
  } catch {
    // The alarm itself wakes the worker; a startup race must not fail the save.
  }
}

/** Drops the mirror and its alarms when reminder data is cleared or removed. */
export async function clearReminderSchedule(): Promise<void> {
  await browser.storage.local.remove(REMINDER_SCHEDULE_KEY);
  await refreshReminderAlarms();
}

export async function refreshReminderAlarms(): Promise<void> {
  const existing = await browser.alarms.getAll();
  await Promise.all(existing
    .filter((alarm) => alarm.name.startsWith(REMINDER_ALARM_PREFIX))
    .map((alarm) => browser.alarms.clear(alarm.name)));

  const reminders = await readScheduledReminders();
  for (const reminder of reminders.items) {
    if (reminder.dueAt > Date.now()) {
      await browser.alarms.create(`${REMINDER_ALARM_PREFIX}${reminder.id}`, { when: reminder.dueAt });
    }
  }
}

export async function showReminderNotification(reminder: ReminderItem): Promise<void> {
  // WXT's runtime type omits `getURL`, but the browser API provides it at runtime.
  const runtime = browser.runtime as unknown as { getURL: (path: string) => string };
  await browser.notifications.create(`${REMINDER_NOTIFICATION_PREFIX}${reminder.id}`, {
    type: 'basic',
    iconUrl: runtime.getURL('icon-128.png'),
    title: 'Glass Home 提醒',
    message: reminder.title,
  });
}

export function reminderIdFromAlarm(name: string): string | undefined {
  return name.startsWith(REMINDER_ALARM_PREFIX) ? name.slice(REMINDER_ALARM_PREFIX.length) : undefined;
}
