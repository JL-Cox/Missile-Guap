import type { DateKey, TimeKey } from '../types';

/**
 * Everything here works in *local* time on purpose. `new Date('2026-03-01')`
 * parses as UTC midnight and can land on the wrong day, which is exactly the
 * kind of quiet wrongness that makes a planner untrustworthy.
 */

export function toDateKey(d: Date): DateKey {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromDateKey(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey(now: Date = new Date()): DateKey {
  return toDateKey(now);
}

export function addDays(key: DateKey, n: number): DateKey {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

export function addMonths(key: DateKey, n: number): DateKey {
  const d = fromDateKey(key);
  const targetDay = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  // Clamp: 31 Jan + 1 month is 28/29 Feb, not 2/3 March.
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(targetDay, lastDay));
  return toDateKey(d);
}

export function daysBetween(from: DateKey, to: DateKey): number {
  const a = fromDateKey(from).getTime();
  const b = fromDateKey(to).getTime();
  // Round rather than floor so a DST shift inside the range cannot lose a day.
  return Math.round((b - a) / 86_400_000);
}

/** Combine a local date and time into epoch ms. */
export function atTime(key: DateKey, time: TimeKey): number {
  const [h, min] = time.split(':').map(Number);
  const d = fromDateKey(key);
  d.setHours(h, min, 0, 0);
  return d.getTime();
}

export function timeKeyOf(ms: number): TimeKey {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * "9:00 AM". Written out by hand rather than left to the phone's locale, so a
 * reminder reads the same on the lock screen as it does in the app, and so the
 * tests can pin it down.
 */
export function clockLabel(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Plain-language dates. "In 3 days" is easier to act on than "18/09/2026",
 * and being told the actual weekday beats having to count.
 */
export function describeDate(key: DateKey, today: DateKey = todayKey()): string {
  const diff = daysBetween(today, key);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const d = fromDateKey(key);
  const weekday = WEEKDAYS[d.getDay()];
  if (diff > 1 && diff < 7) return `${weekday}, in ${diff} days`;
  if (diff < -1 && diff > -7) return `${weekday}, ${Math.abs(diff)} days ago`;
  const label = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  if (diff > 0) return `${label} (in ${diff} days)`;
  return `${label} (${Math.abs(diff)} days ago)`;
}

export function describeDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}
