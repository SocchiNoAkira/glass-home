import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import {
  isRefreshRemindersMessage,
  readScheduledReminders,
  refreshReminderAlarms,
  reminderIdFromAlarm,
  showReminderNotification,
} from '@/src/infrastructure/reminders/scheduler';

/** Fire local browser notifications from alarms created by the reminder widget. */
export default defineBackground(() => {
  const run = (task: Promise<unknown>): void => {
    void task.catch((error: unknown) => console.error('[reminder]', error));
  };

  run(refreshReminderAlarms());
  browser.runtime.onInstalled.addListener(() => run(refreshReminderAlarms()));
  browser.runtime.onStartup.addListener(() => run(refreshReminderAlarms()));

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (isRefreshRemindersMessage(message)) run(refreshReminderAlarms());
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    const id = reminderIdFromAlarm(alarm.name);
    if (!id) return;
    run((async () => {
      const reminders = await readScheduledReminders();
      const reminder = reminders.items.find((item) => item.id === id);
      if (!reminder || reminder.dueAt > Date.now()) return;
      await showReminderNotification(reminder);
    })());
  });
});
