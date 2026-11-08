import { useEffect, useState } from 'react';
import type { WorkspaceSettings } from '@/src/domain/workspace/model';

function getTimeZone(settings: WorkspaceSettings): string | undefined {
  return settings.timeZone === 'system' ? undefined : settings.timeZone;
}

export function ClockWidget({ settings }: { readonly settings: WorkspaceSettings }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') tick();
    }, settings.showSeconds ? 1000 : 15_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [settings.showSeconds]);

  const time = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', ...(settings.showSeconds ? { second: '2-digit' } : {}),
    hourCycle: settings.timeFormat === 'system' ? undefined : settings.timeFormat === '12h' ? 'h12' : 'h23',
    timeZone: getTimeZone(settings),
  }).formatToParts(now);
  const hour = time.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = time.find((part) => part.type === 'minute')?.value ?? '00';
  const second = time.find((part) => part.type === 'second')?.value ?? '';
  const dayPeriod = time.find((part) => part.type === 'dayPeriod')?.value;
  const date = new Intl.DateTimeFormat('zh-CN', {
    month: 'long', day: 'numeric', ...(settings.showWeekday ? { weekday: 'long' } : {}), timeZone: getTimeZone(settings),
  }).format(now);

  return (
    <section className="grid-widget clock-widget" aria-label="时钟组件">
      <div className="time-section__greeting">YOUR SPACE, YOUR MOMENT</div>
      <div className="clock" data-testid="clock">
        {dayPeriod && <span className="clock__period">{dayPeriod}</span>}
        <span>{hour}</span><span className="clock__colon">:</span><span>{minute}</span>
        {settings.showSeconds && <span className="clock__seconds">{second}</span>}
      </div>
      {settings.showDate && <p className="date-line">{date}<span className="date-line__dot">·</span><span>慢慢来，一切都刚刚好。</span></p>}
      {settings.timeZone !== 'system' && <p className="widget-hint">{settings.timeZone.replaceAll('_', ' ')}</p>}
    </section>
  );
}
