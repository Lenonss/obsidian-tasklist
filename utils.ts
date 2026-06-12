/**
 * Generate a UUID v4 string.
 */
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get current ISO date-time string for the local timezone.
 */
export function getNowISO(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60000);
  return local.toISOString().replace('Z', '');
}

// ───── Date utilities (no moment.js dependency) ─────

/**
 * Format a Date as YYYY-MM-DD string.
 */
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Parse YYYY-MM-DD string to Date (local timezone).
 */
export function parseDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Get the Monday of the ISO week containing the given date.
 */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  // ISO week: Monday = 1, Sunday = 7. JS: Sunday = 0
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the Sunday of the ISO week containing the given date.
 */
export function getWeekEnd(date: Date): Date {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Get the first day of the month containing the given date.
 */
export function getMonthStart(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the last day of the month containing the given date.
 */
export function getMonthEnd(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Get the first day of the quarter containing the given date.
 */
export function getQuarterStart(date: Date): Date {
  const q = Math.floor(date.getMonth() / 3);
  const d = new Date(date.getFullYear(), q * 3, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the last day of the quarter containing the given date.
 */
export function getQuarterEnd(date: Date): Date {
  const q = Math.floor(date.getMonth() / 3);
  const d = new Date(date.getFullYear(), (q + 1) * 3, 0);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Get the first day of the year containing the given date.
 */
export function getYearStart(date: Date): Date {
  const d = new Date(date.getFullYear(), 0, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the last day of the year containing the given date.
 */
export function getYearEnd(date: Date): Date {
  const d = new Date(date.getFullYear(), 11, 31);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Compute ISO week number (1-53) for a given date.
 */
export function getISOWeekNumber(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // Thursday in current week decides the year
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  // January 4 is always in week 1
  const yearStart = new Date(d.getFullYear(), 0, 4);
  const weekNo =
    1 +
    Math.round(
      ((d.getTime() - yearStart.getTime()) / 86400000 -
        3 +
        ((yearStart.getDay() + 6) % 7)) /
        7
    );
  return weekNo;
}

/**
 * Get all days in a date range as objects.
 */
export interface DayInfo {
  date: string;
  dayName: string;
  dayOfWeek: number; // 1=Mon, 7=Sun
  dayOfMonth: number;
  month: number; // 0-based
  isToday: boolean;
}

const DAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'];

export function getDaysInRange(start: Date, end: Date): DayInfo[] {
  const days: DayInfo[] = [];
  const today = toDateStr(new Date());
  const current = new Date(start);

  while (current <= end) {
    const isoDay = current.getDay();
    days.push({
      date: toDateStr(current),
      dayName: DAY_NAMES[isoDay === 0 ? 6 : isoDay - 1],
      dayOfWeek: isoDay === 0 ? 7 : isoDay,
      dayOfMonth: current.getDate(),
      month: current.getMonth(),
      isToday: toDateStr(current) === today,
    });
    current.setDate(current.getDate() + 1);
  }

  return days;
}

/**
 * Get month calendar weeks for rendering a traditional month grid.
 * Returns an array of weeks, each week is an array of 7 DayInfo objects.
 */
export interface CalendarDayInfo extends DayInfo {
  isCurrentMonth: boolean;
}

export function getMonthCalendarWeeks(
  year: number,
  month: number
): CalendarDayInfo[][] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Find the Monday of the ISO week containing the 1st
  const gridStart = new Date(firstDay);
  const dayOfWeek = firstDay.getDay();
  const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  gridStart.setDate(gridStart.getDate() + offset);

  // Find the Sunday of the ISO week containing the last day
  const gridEnd = new Date(lastDay);
  const lastDow = lastDay.getDay();
  const endOffset = lastDow === 0 ? 0 : 7 - lastDow;
  gridEnd.setDate(gridEnd.getDate() + endOffset);

  const weeks: CalendarDayInfo[][] = [];
  const today = toDateStr(new Date());
  let current = new Date(gridStart);
  let week: CalendarDayInfo[] = [];

  while (current <= gridEnd) {
    const isoDay = current.getDay();
    week.push({
      date: toDateStr(current),
      dayName: DAY_NAMES[isoDay === 0 ? 6 : isoDay - 1],
      dayOfWeek: isoDay === 0 ? 7 : isoDay,
      dayOfMonth: current.getDate(),
      month: current.getMonth(),
      isToday: toDateStr(current) === today,
      isCurrentMonth: current.getMonth() === month,
    });

    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
    current.setDate(current.getDate() + 1);
  }

  return weeks;
}

/**
 * Format a date range label for display.
 */
export function formatDateLabel(
  timeRange: string,
  start: Date,
  end: Date,
  navOffset: number
): string {
  const now = new Date();
  // Apply navOffset to get the display date
  let displayDate = new Date(now);
  if (timeRange === 'week') {
    displayDate.setDate(displayDate.getDate() + navOffset * 7);
    const weekNum = getISOWeekNumber(displayDate);
    const weekStart = getWeekStart(displayDate);
    const weekEnd = getWeekEnd(displayDate);
    return `${displayDate.getFullYear()}年 · 第${weekNum}周 (${weekStart.getMonth() + 1}/${weekStart.getDate()} - ${weekEnd.getMonth() + 1}/${weekEnd.getDate()})`;
  } else if (timeRange === 'month') {
    displayDate.setMonth(displayDate.getMonth() + navOffset);
    return `${displayDate.getFullYear()}年${displayDate.getMonth() + 1}月`;
  } else if (timeRange === 'quarter') {
    displayDate.setMonth(displayDate.getMonth() + navOffset * 3);
    const q = Math.floor(displayDate.getMonth() / 3) + 1;
    return `${displayDate.getFullYear()}年Q${q}`;
  } else {
    displayDate.setFullYear(displayDate.getFullYear() + navOffset);
    return `${displayDate.getFullYear()}年`;
  }
}
