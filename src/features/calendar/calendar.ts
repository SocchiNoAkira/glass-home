export interface CalendarCell {
  readonly date: Date;
  readonly day: number;
  readonly inCurrentMonth: boolean;
  readonly isToday: boolean;
}

export function zonedDateParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'numeric', day: 'numeric',
    timeZone: timeZone === 'system' ? undefined : timeZone,
  }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
    day: Number(parts.find((part) => part.type === 'day')?.value),
  };
}

export function getCalendarCells(year: number, month: number, weekStartsOn: 0 | 1, today: { year: number; month: number; day: number }): CalendarCell[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (first.getUTCDay() - weekStartsOn + 7) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1, index - offset + 1));
    const cellYear = date.getUTCFullYear();
    const cellMonth = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    return {
      date, day, inCurrentMonth: cellMonth === month && cellYear === year,
      isToday: cellYear === today.year && cellMonth === today.month && day === today.day,
    };
  });
}

export function moveMonth(year: number, month: number, offset: number): { year: number; month: number } {
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}
