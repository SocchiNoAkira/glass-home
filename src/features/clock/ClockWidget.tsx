import { useEffect, useState } from 'react';
import type { WorkspaceSettings } from '@/src/domain/workspace/model';

function getTimeZone(settings: WorkspaceSettings): string | undefined {
  return settings.timeZone === 'system' ? undefined : settings.timeZone;
}

export function ClockWidget({ settings }: { readonly settings: WorkspaceSettings }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer = 0;
    const tick = () => setNow(new Date());

    /*
      Without seconds the display only needs to change once a minute, but a
      fixed 15s interval means the minute can be up to 15s stale: a minute
      boundary that falls just after a tick waits for the next one. Aligning
      each timeout to the next real minute boundary removes the lag entirely
      without ticking every second.

      With seconds shown the value changes every second, so the offset is 1000ms.
    */
    const nextDelay = () => {
      if (settings.showSeconds) return 1000 - (Date.now() % 1000);
      // Milliseconds until the start of the next minute, with a 50ms margin so
      // the callback fires after the boundary rather than just before it.
      const msIntoMinute = Date.now() % 60_000;
      return 60_000 - msIntoMinute + 50;
    };

    const schedule = () => {
      timer = window.setTimeout(() => {
        if (document.visibilityState === 'visible') tick();
        schedule();
      }, nextDelay());
    };
    schedule();

    // A sleeping tab misses callbacks; re-sync as soon as it becomes visible.
    const onVisible = () => {
      tick();
      window.clearTimeout(timer);
      schedule();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
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
      <div className="time-section__greeting" data-adaptive-ink="">YOUR SPACE, YOUR MOMENT</div>
      <div className="clock" data-testid="clock" data-adaptive-ink="">
        {dayPeriod && <span className="clock__period">{dayPeriod}</span>}
        <span>{hour}</span><span className="clock__colon">:</span><span>{minute}</span>
        {settings.showSeconds && <span className="clock__seconds">{second}</span>}
      </div>
      {settings.showDate && <p className="date-line" data-adaptive-ink="">{date}<span className="date-line__dot">·</span><span>慢慢来，一切都刚刚好。</span></p>}
      {settings.timeZone !== 'system' && <p className="widget-hint" data-adaptive-ink="">{settings.timeZone.replaceAll('_', ' ')}</p>}
    </section>
  );
}
