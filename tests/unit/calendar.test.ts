import { describe, expect, it } from 'vitest';
import { getCalendarCells, moveMonth, zonedDateParts } from '@/src/features/calendar/calendar';

describe('calendar', () => {
  it('supports Monday-first and Sunday-first layouts with today highlighted once', () => {
    const today = { year: 2026, month: 11, day: 7 };
    const monday = getCalendarCells(2026, 11, 1, today);
    const sunday = getCalendarCells(2026, 11, 0, today);
    expect(monday).toHaveLength(42);
    expect(monday[0]?.date.getUTCDay()).toBe(1);
    expect(sunday[0]?.date.getUTCDay()).toBe(0);
    expect(monday.filter((cell) => cell.isToday)).toHaveLength(1);
  });

  it('crosses month and year boundaries correctly', () => {
    expect(moveMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(moveMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });

  it('uses calendar dates in the selected timezone', () => {
    const date = new Date('2026-11-06T16:30:00.000Z');
    expect(zonedDateParts(date, 'Asia/Shanghai')).toEqual({ year: 2026, month: 11, day: 7 });
    expect(zonedDateParts(date, 'UTC')).toEqual({ year: 2026, month: 11, day: 6 });
  });
});
