import { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import type { WorkspaceSettings } from '@/src/domain/workspace/model';
import { getCalendarCells, moveMonth, zonedDateParts } from './calendar';

const WEEKDAYS = {
  1: ['一', '二', '三', '四', '五', '六', '日'],
  0: ['日', '一', '二', '三', '四', '五', '六'],
} as const;

export function CalendarWidget({ settings }: { readonly settings: WorkspaceSettings }) {
  const today = zonedDateParts(new Date(), settings.timeZone);
  const [view, setView] = useState({ year: today.year, month: today.month });
  const [mode, setMode] = useState(settings.calendarMode);
  const cells = getCalendarCells(view.year, view.month, settings.weekStartsOn, today);
  const monthLabel = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(view.year, view.month - 1, 1)));

  return (
    <section className={`grid-widget calendar-widget glass-surface calendar-widget--${mode}`} aria-label="日历组件">
      <div className="widget__topline">
        <span className="widget__eyebrow">{monthLabel}</span>
        <div className="calendar-widget__actions">
          <button className="mini-button" onClick={() => setMode(mode === 'compact' ? 'month' : 'compact')} aria-label={mode === 'compact' ? '展开完整月历' : '收起为日期摘要'} title={mode === 'compact' ? '完整月历' : '日期摘要'}>
            <CalendarDays size={16} />
          </button>
          {mode === 'month' && <>
            <button className="mini-button" onClick={() => setView(moveMonth(view.year, view.month, -1))} aria-label="上一月"><ChevronLeft size={16} /></button>
            <button className="mini-button" onClick={() => setView(moveMonth(view.year, view.month, 1))} aria-label="下一月"><ChevronRight size={16} /></button>
          </>}
        </div>
      </div>
      {mode === 'compact' ? (
        <button className="calendar-widget__body" onClick={() => setMode('month')} aria-label="查看完整月历">
          <span className="calendar-widget__day">{today.day}</span>
          <div><strong>{new Intl.DateTimeFormat('zh-CN', { weekday: 'long', timeZone: settings.timeZone === 'system' ? undefined : settings.timeZone }).format(new Date())}</strong><p>今天也值得被认真对待。</p></div>
        </button>
      ) : (
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
      )}
    </section>
  );
}
