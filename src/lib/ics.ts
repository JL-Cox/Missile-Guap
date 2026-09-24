import type { DateKey, Debt, IncomeSource, Subscription, Task, TimeKey } from '../types';
import { aprBasisPoints, dueDatesFrom, hasSchedule, isEvery2Weeks } from './debt';
import { anchorDays, isIntervalFrequency, nextPayday, paydaysBetween, weekendShiftOf } from './pay';
import { advanceCycle, billingDatesBetween, billingDays, isFixedDayCycle, nextBilling, nextOccurrence } from './recurrence';
import { addDays, atTime, daysBetween, fromDateKey, todayKey } from './time';

/**
 * A browser tab cannot be trusted to wake up and remind you - it only fires
 * notifications while it is running. So Steady also hands reminders to the
 * thing on your phone that *is* always running: the calendar. Export once,
 * open the file, and Android's own alarms do the nagging.
 */

/**
 * RFC 5545 text escaping. Note the semicolon: in JavaScript '\;' is just ';',
 * so it takes '\\;' to write the backslash the calendar needs.
 */
function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** ICS lines must be folded at 75 octets, continued with a leading space. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines lose one octet to the space
    if (currentBytes + size > limit) {
      out.push(current);
      current = '';
      currentBytes = 0;
    }
    current += ch;
    currentBytes += size;
  }
  if (current) out.push(current);
  return out.join('\r\n ');
}

function stampUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function dateOnly(key: string): string {
  return key.replace(/-/g, '');
}

interface IcsEvent {
  uid: string;
  summary: string;
  description?: string;
  /** All-day event date key, or a precise start time in epoch ms. */
  allDay?: string;
  startMs?: number;
  durationMin?: number;
  /** Minutes before the start to alarm. */
  alarmMinutesBefore?: number;
  rrule?: string;
  /** Explicit extra dates, for schedules no recurrence rule can express. */
  rdates?: string[];
  /** For a timed event, the local time each extra date happens at. */
  rdateTime?: TimeKey;
}

function renderEvent(ev: IcsEvent, now: number): string[] {
  const lines = ['BEGIN:VEVENT', `UID:${ev.uid}`, `DTSTAMP:${stampUtc(now)}`];
  if (ev.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${dateOnly(ev.allDay)}`);
  } else if (ev.startMs !== undefined) {
    lines.push(`DTSTART:${stampUtc(ev.startMs)}`);
    const dur = ev.durationMin ?? 30;
    lines.push(`DTEND:${stampUtc(ev.startMs + dur * 60_000)}`);
  }
  lines.push(`SUMMARY:${escapeText(ev.summary)}`);
  if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
  if (ev.rrule) lines.push(`RRULE:${ev.rrule}`);
  if (ev.rdates?.length) {
    // Each extra date of a timed event is converted on its own day, so the
    // local time holds across a daylight-saving change.
    lines.push(
      ev.rdateTime
        ? `RDATE:${ev.rdates.map((d) => stampUtc(atTime(d, ev.rdateTime!))).join(',')}`
        : `RDATE;VALUE=DATE:${ev.rdates.map(dateOnly).join(',')}`,
    );
  }
  if (ev.alarmMinutesBefore !== undefined) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(ev.summary)}`,
      `TRIGGER:-PT${Math.max(0, Math.round(ev.alarmMinutesBefore))}M`,
      'END:VALARM',
    );
  }
  lines.push('END:VEVENT');
  return lines;
}

/** How far ahead explicit dates are written, where no rule can say it. */
const EXPLICIT_DAYS = 730;

/**
 * How a monthly schedule on a given day of the month goes into a calendar.
 *
 * A calendar does not clamp, and Steady does. So:
 *   1-28 - a plain monthly rule; every month has that day.
 *   31   - BYMONTHDAY=-1, which is exactly "the last day".
 *   29, 30 - no rule says "the 30th, or the last day if the month is shorter",
 *            so the dates are written out explicitly instead.
 */
type MonthEnd = 'plain' | 'lastDay' | 'explicit';
function monthEnd(day: number): MonthEnd {
  if (day >= 31) return 'lastDay';
  if (day >= 29) return 'explicit';
  return 'plain';
}

/** Dates `step` produces after `first`, up to two years on - the first excluded. */
function datesAfter(first: DateKey, step: (d: DateKey) => DateKey): DateKey[] {
  const end = addDays(first, EXPLICIT_DAYS);
  const out: DateKey[] = [];
  for (let d = step(first), guard = 0; daysBetween(d, end) >= 0 && guard < 1000; d = step(d), guard++) out.push(d);
  return out;
}

function taskRrule(task: Task): string | undefined {
  const rec = task.recurrence;
  if (!rec) return undefined;
  const every = Math.max(1, Math.floor(rec.every));
  const names = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  switch (rec.kind) {
    case 'daily':
      return `FREQ=DAILY;INTERVAL=${every}`;
    case 'weekly': {
      const byday = rec.weekdays?.length ? `;BYDAY=${rec.weekdays.map((d) => names[d]).join(',')}` : '';
      return `FREQ=WEEKLY;INTERVAL=${every}${byday}`;
    }
    case 'monthly':
      return monthEnd(taskAnchor(task)) === 'lastDay'
        ? `FREQ=MONTHLY;INTERVAL=${every};BYMONTHDAY=-1`
        : `FREQ=MONTHLY;INTERVAL=${every}`;
    case 'yearly':
      // 29 February is "the last day of February", which a rule can say.
      return task.date && fromDateKey(task.date).getMonth() === 1 && taskAnchor(task) >= 29
        ? `FREQ=YEARLY;INTERVAL=${every};BYMONTH=2;BYMONTHDAY=-1`
        : `FREQ=YEARLY;INTERVAL=${every}`;
  }
}

/** The day of the month a monthly or yearly task belongs on. */
function taskAnchor(task: Task): number {
  return task.recurrence?.anchorDay ?? (task.date ? fromDateKey(task.date).getDate() : 1);
}

/** A monthly task on the 29th or 30th, which needs its dates written out. */
function taskNeedsExplicitDates(task: Task): boolean {
  return task.recurrence?.kind === 'monthly' && monthEnd(taskAnchor(task)) === 'explicit';
}

/**
 * Whether an entry carries more than its title, date and amount.
 *
 * Off unless you turn it on in Settings. A calendar is often copied to a
 * Google account - sometimes a work one - and read on screens this app does
 * not control. Cancel steps can hold a login, and notes hold whatever you put
 * in them, so they only leave when you have said they may.
 */
export interface CalendarOptions {
  includeNotes?: boolean;
}

function taskEvent(task: Task, now: number, { includeNotes = false }: CalendarOptions = {}): IcsEvent | null {
  if (!task.date) return null;
  const summary = task.title;
  const steps = task.steps.filter((s) => !s.done).map((s) => `- ${s.text}`).join('\n');
  const description = includeNotes ? [task.notes, steps].filter(Boolean).join('\n\n') || undefined : undefined;
  const base: IcsEvent = {
    uid: `task-${task.id}@steady.local`,
    summary,
    description,
    rrule: taskRrule(task),
  };
  if (taskNeedsExplicitDates(task)) {
    const rec = { ...task.recurrence!, anchorDay: taskAnchor(task) };
    base.rrule = undefined;
    base.rdates = datesAfter(task.date, (d) => nextOccurrence(rec, d));
    base.rdateTime = task.startTime;
  }
  if (task.startTime) {
    base.startMs = atTime(task.date, task.startTime);
    base.durationMin = task.durationMin ?? 30;
    base.alarmMinutesBefore = task.remindAt ? Math.round((base.startMs - task.remindAt) / 60_000) : 10;
  } else {
    base.allDay = task.date;
    base.alarmMinutesBefore = 0;
  }
  void now;
  return base;
}

/**
 * A list of days of the month as RFC5545 sees them, or null when no rule can
 * say it.
 *
 * The 31st is written as -1, the last day, which is exactly what it means
 * here: BYMONTHDAY=31 would produce nothing in the months with no 31st,
 * silently dropping charges. The 29th and 30th have no equivalent - -1 would
 * put them on the 31st in March - so a list holding either returns null, and
 * the caller writes the dates out.
 */
function byMonthDay(days: number[]): string | null {
  if (days.some((d) => monthEnd(d) === 'explicit')) return null;
  return days.map((d) => (monthEnd(d) === 'lastDay' ? '-1' : String(Math.max(1, Math.floor(d))))).join(',');
}

function subscriptionEvent(
  sub: Subscription,
  amountLabel: string,
  now: number,
  { includeNotes = false }: CalendarOptions = {},
): IcsEvent | null {
  const next = nextBilling(sub, todayKey(new Date(now)));
  if (!next) return null;
  const months = sub.every * (sub.cycle === 'quarterly' ? 3 : sub.cycle === 'yearly' ? 12 : 1);
  const anchor = fromDateKey(sub.firstBilled).getDate();
  let cycleRrule: string | undefined;
  if (sub.cycle === 'weekly') {
    cycleRrule = `FREQ=WEEKLY;INTERVAL=${sub.every}`;
  } else if (isFixedDayCycle(sub.cycle)) {
    // Twice a month is two dates, not an interval, so it is written as the
    // dates. An every-other-week approximation would drift two charges a year.
    const days = byMonthDay(billingDays(sub));
    cycleRrule = days ? `FREQ=MONTHLY;BYMONTHDAY=${days}` : undefined;
  } else if (monthEnd(anchor) === 'lastDay') {
    cycleRrule = `FREQ=MONTHLY;INTERVAL=${months};BYMONTHDAY=-1`;
  } else if (monthEnd(anchor) === 'plain') {
    cycleRrule = `FREQ=MONTHLY;INTERVAL=${months}`;
  }
  // No rule fits the 29th or 30th: write out Steady's own dates instead.
  const rdates = cycleRrule
    ? undefined
    : billingDatesBetween(sub, next, addDays(next, EXPLICIT_DAYS)).filter((d) => d !== next);
  return {
    uid: `sub-${sub.id}@steady.local`,
    summary: `${sub.name} - ${amountLabel}`,
    description: includeNotes
      ? [sub.notes, sub.cancelHow && `To cancel: ${sub.cancelHow}`].filter(Boolean).join('\n\n') || undefined
      : undefined,
    allDay: next,
    rrule: cycleRrule,
    rdates,
    alarmMinutesBefore: sub.remindDaysBefore > 0 ? sub.remindDaysBefore * 24 * 60 : undefined,
  };
}

function wrapCalendar(events: IcsEvent[], now: number, name: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Steady//Local Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    ...events.flatMap((ev) => renderEvent(ev, now)),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

/**
 * A payday as a repeating all-day entry.
 *
 * Interval schedules map cleanly onto WEEKLY rules. Twice-a-month does not -
 * "the 15th and the last day" is BYMONTHDAY=15,-1 - so that is expressed
 * directly rather than approximated as every-other-week, which would drift two
 * paydays a year.
 */
function paydayEvent(
  source: IncomeSource,
  amountLabel: string,
  now: number,
  { includeNotes = false }: CalendarOptions = {},
): IcsEvent | null {
  const next = nextPayday(source, todayKey(new Date(now)));
  if (!next) return null;
  const description = includeNotes ? source.notes || undefined : undefined;

  /*
    A recurrence rule cannot say "the Friday before, if this lands on a
    weekend" - RRULE has no such operator. So a shifted schedule is written out
    as explicit dates instead. Two years of them is a few hundred bytes and
    always right, where a rule that ignored the shift would put a fifth of the
    paydays on the wrong day.
  */
  if (weekendShiftOf(source) !== 'none') {
    const dates = paydaysBetween(source, next, addDays(next, 730));
    return {
      uid: `income-${source.id}@steady.local`,
      summary: `${source.name} - ${amountLabel}`,
      description,
      allDay: dates[0] ?? next,
      rdates: dates.slice(1),
    };
  }

  let rrule: string | undefined;
  if (isIntervalFrequency(source.frequency)) {
    rrule = `FREQ=WEEKLY;INTERVAL=${source.frequency === 'weekly' ? 1 : 2}`;
  } else {
    // The same days the app itself pays on - one for monthly, two for twice a month.
    const days = byMonthDay(anchorDays(source));
    rrule = days ? `FREQ=MONTHLY;BYMONTHDAY=${days}` : undefined;
  }

  return {
    uid: `income-${source.id}@steady.local`,
    summary: `${source.name} - ${amountLabel}`,
    description,
    allDay: next,
    rrule,
    rdates: rrule ? undefined : paydaysBetween(source, next, addDays(next, EXPLICIT_DAYS)).slice(1),
  };
}

export interface CalendarInput {
  tasks: Task[];
  subscriptions: Subscription[];
  incomes?: IncomeSource[];
  /** Formats a subscription amount for its event title. */
  formatAmount: (sub: Subscription) => string;
  /** Formats a paycheque amount for its event title. */
  formatPay?: (source: IncomeSource) => string;
  now?: number;
  /** See CalendarOptions. Off unless the Settings switch is on. */
  includeNotes?: boolean;
}

export function buildCalendar({
  tasks,
  subscriptions,
  incomes = [],
  formatAmount,
  formatPay,
  now = Date.now(),
  includeNotes = false,
}: CalendarInput): string {
  const options: CalendarOptions = { includeNotes };
  const events: IcsEvent[] = [];
  for (const task of tasks) {
    if (task.doneAt && !task.recurrence) continue;
    const ev = taskEvent(task, now, options);
    if (ev) events.push(ev);
  }
  for (const sub of subscriptions) {
    if (sub.endedOn) continue;
    const ev = subscriptionEvent(sub, formatAmount(sub), now, options);
    if (ev) events.push(ev);
  }
  for (const source of incomes) {
    if (source.endedOn) continue;
    const ev = paydayEvent(source, formatPay?.(source) ?? 'Payday', now, options);
    if (ev) events.push(ev);
  }
  return wrapCalendar(events, now, 'Steady');
}

/** A calendar containing just one income source's paydays. */
export function calendarForIncome(
  source: IncomeSource,
  amountLabel: string,
  now: number = Date.now(),
  options: CalendarOptions = {},
): string | null {
  const ev = paydayEvent(source, amountLabel, now, options);
  return ev ? wrapCalendar([ev], now, source.name) : null;
}

/** Days before each debt payment its calendar entry reminds you. Fixed, so there is no field to set. */
export const DEBT_REMIND_DAYS = 3;

/**
 * The file name for a debt's calendar entry. Deliberately neutral: the share
 * sheet and Downloads show the file name, and a lender's or a hospital's name
 * has no business appearing there.
 */
export const DEBT_CALENDAR_FILENAME = 'payment-dates.ics';

/**
 * A debt's payments as a repeating all-day entry, from the next due date not
 * yet marked paid.
 *
 * The title carries the amount only when it is a set amount - "Car loan
 * payment - $395.09" - because a card's minimum changes every month, and an
 * entry that is wrong most months is worse than one that says "Card payment
 * due". A set amount at 0% has a known number of payments left, so the entry
 * stops after the last one instead of repeating forever.
 */
function debtEvent(
  debt: Debt,
  amountLabel: string | null,
  now: number,
  { includeNotes = false }: CalendarOptions = {},
): IcsEvent | null {
  if (debt.paidOffOn || !(debt.balanceMinor > 0) || !hasSchedule(debt)) return null;
  const today = todayKey(new Date(now));
  const setAmount = debt.minimum.kind === 'fixed' && debt.minimum.amountMinor > 0 ? debt.minimum.amountMinor : 0;
  const left = setAmount && aprBasisPoints(debt.aprPercent) === 0 ? Math.ceil(debt.balanceMinor / setAmount) : 0;
  const upcoming = dueDatesFrom(debt, today, left || 25);
  const next = upcoming[0];
  if (!next) return null;
  const count = left ? `;COUNT=${left}` : '';

  let rrule: string | undefined;
  let rdates: DateKey[] | undefined;
  if (isEvery2Weeks(debt)) {
    rrule = `FREQ=WEEKLY;INTERVAL=2${count}`;
  } else {
    const end = monthEnd(Math.min(31, Math.max(1, Math.floor(debt.dueDay ?? 1))));
    if (end === 'plain') rrule = `FREQ=MONTHLY${count}`;
    else if (end === 'lastDay') rrule = `FREQ=MONTHLY;BYMONTHDAY=-1${count}`;
    // The 29th and 30th: Steady's own dates, written out - every one of them
    // when the payments left are known, two years of them otherwise.
    else rdates = upcoming.slice(1).filter((d) => left > 0 || daysBetween(next, d) <= EXPLICIT_DAYS);
  }

  return {
    uid: `debt-${debt.id}@steady.local`,
    summary: setAmount && amountLabel ? `${debt.name} payment - ${amountLabel}` : `${debt.name} payment due`,
    description: includeNotes ? debt.notes || undefined : undefined,
    allDay: next,
    rrule,
    rdates,
    alarmMinutesBefore: DEBT_REMIND_DAYS * 24 * 60,
  };
}

/**
 * A calendar containing one debt's payment dates, for the button on that
 * debt. Debts are never in the whole-app export: a lender's name and an amount
 * in a calendar that may copy itself to an online account says more than a
 * streaming bill does, so each one goes in only when it is chosen.
 *
 * `amountLabel` is the set payment, formatted, or null. The calendar is named
 * "Steady" rather than after the debt, for the same reason as the file name.
 */
export function calendarForDebt(
  debt: Debt,
  amountLabel: string | null,
  now: number = Date.now(),
  options: CalendarOptions = {},
): string | null {
  const ev = debtEvent(debt, amountLabel, now, options);
  return ev ? wrapCalendar([ev], now, 'Steady') : null;
}

/**
 * Said when a debt is marked paid off. The entry lives in the phone's
 * calendar, which Steady cannot reach, so it keeps repeating until it is
 * deleted there.
 */
export const DEBT_CALENDAR_ENTRY_STAYS =
  "If you put its payment dates in your phone's calendar, delete the repeating entry there - Steady can't reach your calendar.";

/**
 * A calendar containing exactly one subscription, for the "put this in my
 * calendar" button that appears the moment you finish adding it. The UID is
 * stable, so adding the same subscription twice updates the existing entry in
 * most calendar apps rather than creating a duplicate.
 */
export function calendarForSubscription(
  sub: Subscription,
  amountLabel: string,
  now: number = Date.now(),
  options: CalendarOptions = {},
): string | null {
  const ev = subscriptionEvent(sub, amountLabel, now, options);
  if (!ev) return null;
  return wrapCalendar([ev], now, sub.name);
}

/** A calendar containing exactly one task. */
export function calendarForTask(task: Task, now: number = Date.now(), options: CalendarOptions = {}): string | null {
  const ev = taskEvent(task, now, options);
  if (!ev) return null;
  return wrapCalendar([ev], now, task.title);
}

export type CalendarKind = 'task' | 'subscription' | 'income' | 'debt' | 'all';

/**
 * One plain line saying what a calendar file will carry, shown next to every
 * button that makes one - so you know what is leaving before it leaves.
 */
export function calendarContents(kind: CalendarKind, includeNotes: boolean): string {
  switch (kind) {
    case 'task':
      return includeNotes
        ? 'Goes in: the title, the day and the time, with its notes and steps.'
        : 'Goes in: the title, the day and the time. Notes and steps stay here unless you turn them on in Settings.';
    case 'subscription':
      return includeNotes
        ? 'Goes in: the name, the dates and the amount, with its notes and how to cancel.'
        : 'Goes in: the name, the dates and the amount. Notes and how to cancel stay here unless you turn them on in Settings.';
    case 'income':
      return includeNotes
        ? 'Goes in: the name, the paydays and the amount, with its notes.'
        : 'Goes in: the name, the paydays and the amount. Notes stay here unless you turn them on in Settings.';
    case 'debt':
      return includeNotes
        ? "Goes in: the name and the due dates, and the amount when it's the same every month, with its notes."
        : "Goes in: the name and the due dates, and the amount when it's the same every month. Notes stay here unless you turn them on in Settings.";
    case 'all':
      return includeNotes
        ? 'Goes in: titles, dates and amounts for every dated task, subscription and payday, with their notes, steps and how to cancel.'
        : 'Goes in: titles, dates and amounts for every dated task, subscription and payday. Notes, steps and how to cancel stay here unless you turn them on below.';
  }
}

/** Said next to every calendar button, because it is true of all of them. */
export const CALENDAR_CAUTION =
  "Your calendar app may copy this to your Google account. If the share sheet shows a Work tab, don't pick it.";

/** A filename a phone will not choke on. */
export function icsFilename(label: string): string {
  const safe = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${safe || 'steady'}.ics`;
}

/** Exported for tests: proves the DTSTART for an all-day event lands on the right day. */
export const _internals = { fold, escapeText, dateOnly, fromDateKey, advanceCycle };
