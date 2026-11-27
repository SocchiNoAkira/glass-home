import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { BellPlus, X } from 'lucide-react';
import {
  EMPTY_REMINDER_STATE,
  REMINDER_MAX_ITEMS,
  REMINDER_MAX_TEXT_LENGTH,
  REMINDER_REJECTION_TEXT,
  addReminder,
  parseReminderState,
  reminderSummary,
  removeReminder,
  sortedReminders,
  type ReminderState,
} from '@/src/domain/widget/reminder';
import { publishReminderSchedule } from '@/src/infrastructure/reminders/scheduler';
import type { WidgetStorage } from '@/src/infrastructure/persistence/widgetStorage';

const STATE_KEY = 'state';
const CLOCK_TICK_MS = 30_000;

export type ReminderStorageBridge = Pick<WidgetStorage, 'read' | 'write'>;

function toDateTimeInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultReminderTime(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setSeconds(0, 0);
  return toDateTimeInput(date);
}

function dueAtFromInput(value: string): number {
  if (!value) return Number.NaN;
  return new Date(value).getTime();
}

function formatDueAt(dueAt: number, nowMs: number): string {
  const date = new Date(dueAt);
  const now = new Date(nowMs);
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  const day = sameDay
    ? '今天'
    : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date);
  const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  return `${day} ${time}`;
}

export function ReminderWidget({ instanceId, storage, namespace, dataVersion = 0, onError }: {
  readonly instanceId: string;
  readonly storage: ReminderStorageBridge;
  readonly namespace: string;
  readonly dataVersion?: number;
  readonly onError?: (message: string) => void;
}) {
  const [state, setState] = useState<ReminderState>(EMPTY_REMINDER_STATE);
  const [loaded, setLoaded] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftTime, setDraftTime] = useState(defaultReminderTime);
  const [notice, setNotice] = useState<string>();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const textId = useId();
  const timeId = useId();
  const mountedRef = useRef(true);
  const storageRef = useRef(storage);
  storageRef.current = storage;
  const namespaceRef = useRef(namespace);
  namespaceRef.current = namespace;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS);
    const onVisible = () => setNowMs(Date.now());
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void storageRef.current.read<unknown>(namespaceRef.current, STATE_KEY)
      .then((stored) => {
        if (cancelled || !mountedRef.current) return;
        const next = parseReminderState(stored);
        setState(next);
        setDraftText('');
        setDraftTime(defaultReminderTime());
        setNotice(undefined);
        setLoaded(true);
        void publishReminderSchedule(next).catch((error: unknown) => {
          if (!mountedRef.current) return;
          const message = error instanceof Error ? error.message : '提醒调度未能恢复。';
          setNotice(message);
          onErrorRef.current?.(message);
        });
      })
      .catch(() => {
        if (cancelled || !mountedRef.current) return;
        setState(EMPTY_REMINDER_STATE);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [dataVersion]);

  const persist = useCallback((next: ReminderState) => {
    void storageRef.current.write(namespaceRef.current, STATE_KEY, next)
      .then(() => publishReminderSchedule(next))
      .catch((error: unknown) => {
        if (!mountedRef.current) return;
        const message = error instanceof Error ? error.message : '提醒保存失败，请重试。';
        setNotice(message);
        onErrorRef.current?.(message);
      });
  }, []);

  const submit = () => {
    const result = addReminder(state, {
      id: crypto.randomUUID(),
      title: draftText,
      dueAt: dueAtFromInput(draftTime),
      createdAt: new Date().toISOString(),
    }, Date.now());
    if (!result.ok) {
      setNotice(REMINDER_REJECTION_TEXT[result.reason]);
      return;
    }
    setState(result.state);
    setDraftText('');
    setDraftTime(defaultReminderTime());
    setNotice(undefined);
    setNowMs(Date.now());
    persist(result.state);
  };

  const remove = (id: string) => {
    const result = removeReminder(state, id);
    if (!result.ok) return;
    setState(result.state);
    setNotice(undefined);
    persist(result.state);
  };

  const items = sortedReminders(state);
  const summary = reminderSummary(state, nowMs);
  const atLimit = state.items.length >= REMINDER_MAX_ITEMS;

  return (
    <section
      className="grid-widget reminder-widget glass-surface"
      aria-label="提醒事项组件"
      data-adaptive-ink=""
      data-widget-instance={instanceId}
      data-reminder-count={summary.total}
      data-reminder-upcoming={summary.upcoming}
      data-reminder-loaded={loaded ? 'true' : 'false'}
    >
      <div className="widget__topline">
        <span className="widget__eyebrow"><BellPlus size={13} /> 提醒事项</span>
        <span className="reminder-widget__summary">{summary.upcoming} 项待提醒</span>
      </div>

      <div className="reminder-widget__composer">
        <label htmlFor={textId} className="sr-only">提醒内容</label>
        <input
          id={textId}
          className="reminder-widget__text-input"
          value={draftText}
          maxLength={REMINDER_MAX_TEXT_LENGTH}
          placeholder="要提醒什么？"
          disabled={atLimit}
          onChange={(event) => setDraftText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.stopPropagation();
            submit();
          }}
        />
        <label htmlFor={timeId} className="sr-only">提醒时间</label>
        <input
          id={timeId}
          className="reminder-widget__time-input"
          type="datetime-local"
          value={draftTime}
          disabled={atLimit}
          onChange={(event) => setDraftTime(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.stopPropagation();
            submit();
          }}
        />
        <button
          className="mini-button reminder-widget__add"
          onClick={submit}
          disabled={atLimit || !draftText.trim() || !draftTime}
          aria-label="添加提醒"
          title="添加提醒"
        ><BellPlus size={14} /></button>
      </div>

      {items.length === 0 ? (
        <p className="reminder-widget__empty">
          {loaded ? '还没有提醒。写下来，到点提醒你。' : '正在读取本地提醒…'}
        </p>
      ) : (
        <ul className="reminder-widget__list" aria-label="提醒列表">
          {items.map((item) => {
            const expired = item.dueAt <= nowMs;
            return (
              <li key={item.id} className={`reminder-widget__item ${expired ? 'is-expired' : ''}`} data-reminder-id={item.id}>
                <span className="reminder-widget__dot" aria-hidden="true" />
                <span className="reminder-widget__body">
                  <span className="reminder-widget__title">{item.title}</span>
                  <span className="reminder-widget__time">{expired ? '已过期 · ' : ''}{formatDueAt(item.dueAt, nowMs)}</span>
                </span>
                <button
                  className="reminder-widget__remove"
                  onClick={() => remove(item.id)}
                  aria-label={`删除提醒 ${item.title}`}
                  title="删除"
                ><X size={12} /></button>
              </li>
            );
          })}
        </ul>
      )}

      {notice && <p className="reminder-widget__notice" role="status">{notice}</p>}
    </section>
  );
}
