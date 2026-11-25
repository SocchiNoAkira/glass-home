import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { WorkspaceSettings } from '@/src/domain/workspace/model';
import { getCalendarCells, moveMonth, zonedDateParts } from './calendar';

const WEEKDAYS = {
  1: ['一', '二', '三', '四', '五', '六', '日'],
  0: ['日', '一', '二', '三', '四', '五', '六'],
} as const;

/** Day-level freshness; a minute is far finer than the value being rendered. */
const TICK_MS = 60_000;

export function CalendarWidget({ settings }: { readonly settings: WorkspaceSettings }) {
  /*
   * A live clock, not a mount-time snapshot.
   *
   * `today` used to be computed once from `new Date()` during the first render.
   * Nothing re-rendered the widget afterwards, so a tab left open overnight kept
   * showing yesterday: the "今天" marker silently pointed at the wrong cell (or
   * vanished entirely once the month rolled over). Ticking on an interval fixes
   * both — the day recalculates, and the month-view cells follow it.
   */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') tick();
    }, TICK_MS);
    // A sleeping tab misses intervals; the day is re-read as soon as it is seen.
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  const today = zonedDateParts(now, settings.timeZone);

  /**
   * Which month is on screen.
   *
   * `followed` records whether the user has navigated away from the current
   * month. While they have not, the view tracks today so a month boundary does
   * not leave the calendar showing a month that no longer contains today.
   * Once they browse, their choice is respected.
   */
  const [view, setView] = useState({ year: today.year, month: today.month, followed: true });
  useEffect(() => {
    setView((current) => (current.followed ? { year: today.year, month: today.month, followed: true } : current));
  }, [today.year, today.month]);

  const cells = getCalendarCells(view.year, view.month, settings.weekStartsOn, today);
  const monthLabel = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(view.year, view.month - 1, 1)));

  const browse = (delta: number) => setView({ ...moveMonth(view.year, view.month, delta), followed: false });

  return (
    <section className="grid-widget calendar-widget glass-surface calendar-widget--month" aria-label="日历组件" data-adaptive-ink="">
      <div className="widget__topline">
        <span className="widget__eyebrow">{monthLabel}</span>
        <div className="calendar-widget__actions">
          <button className="mini-button" onClick={() => browse(-1)} aria-label="上一月"><ChevronLeft size={16} /></button>
          <button className="mini-button" onClick={() => browse(1)} aria-label="下一月"><ChevronRight size={16} /></button>
        </div>
      </div>
      <div className="month-calendar">
        <div className="month-calendar__week">{WEEKDAYS[settings.weekStartsOn].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
        <div className="month-calendar__days">
          {cells.map((cell) => <span
            key={cell.date.toISOString()}
            className={`${cell.inCurrentMonth ? '' : 'is-outside'} ${cell.isToday ? 'is-today' : ''}`}
            aria-current={cell.isToday ? 'date' : undefined}
          >{cell.day}</span>)}
        </div>
      </div>
    </section>
  );
}
