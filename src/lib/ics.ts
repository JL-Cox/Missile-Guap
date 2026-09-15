import type { Subscription, Task } from '../types';
import { advanceCycle, nextBilling } from './recurrence';
import { atTime, fromDateKey, todayKey } from './time';

/**
 * A browser tab cannot be trusted to wake up and remind you - it only fires
 * notifications while it is running. So Steady also hands reminders to the
 * thing on your phone that *is* always running: the calendar. Export once,
 * open the file, and Android's own alarms do the nagging.
 */

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
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
      return `FREQ=MONTHLY;INTERVAL=${every}`;
    case 'yearly':
      return `FREQ=YEARLY;INTERVAL=${every}`;
  }
}

function taskEvent(task: Task, now: number): IcsEvent | null {
  if (!task.date) return null;
  const summary = task.title;
  const steps = task.steps.filter((s) => !s.done).map((s) => `- ${s.text}`).join('\n');
  const description = [task.notes, steps].filter(Boolean).join('\n\n') || undefined;
  const base: IcsEvent = {
    uid: `task-${task.id}@steady.local`,
    summary,
    description,
    rrule: taskRrule(task),
  };
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

function subscriptionEvent(sub: Subscription, amountLabel: string, now: number): IcsEvent | null {
  const next = nextBilling(sub, todayKey(new Date(now)));
  if (!next) return null;
  const cycleRrule =
    sub.cycle === 'weekly'
      ? `FREQ=WEEKLY;INTERVAL=${sub.every}`
      : `FREQ=MONTHLY;INTERVAL=${sub.every * (sub.cycle === 'quarterly' ? 3 : sub.cycle === 'yearly' ? 12 : 1)}`;
  return {
    uid: `sub-${sub.id}@steady.local`,
    summary: `${sub.name} - ${amountLabel}`,
    description: [sub.notes, sub.cancelHow && `To cancel: ${sub.cancelHow}`].filter(Boolean).join('\n\n') || undefined,
    allDay: next,
    rrule: cycleRrule,
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

export interface CalendarInput {
  tasks: Task[];
  subscriptions: Subscription[];
  /** Formats a subscription amount for its event title. */
  formatAmount: (sub: Subscription) => string;
  now?: number;
}

export function buildCalendar({ tasks, subscriptions, formatAmount, now = Date.now() }: CalendarInput): string {
  const events: IcsEvent[] = [];
  for (const task of tasks) {
    if (task.doneAt && !task.recurrence) continue;
    const ev = taskEvent(task, now);
    if (ev) events.push(ev);
  }
  for (const sub of subscriptions) {
    if (sub.endedOn) continue;
    const ev = subscriptionEvent(sub, formatAmount(sub), now);
    if (ev) events.push(ev);
  }
  return wrapCalendar(events, now, 'Steady');
}

/**
 * A calendar containing exactly one subscription, for the "put this in my
 * calendar" button that appears the moment you finish adding it. The UID is
 * stable, so adding the same subscription twice updates the existing entry in
 * most calendar apps rather than creating a duplicate.
 */
export function calendarForSubscription(sub: Subscription, amountLabel: string, now: number = Date.now()): string | null {
  const ev = subscriptionEvent(sub, amountLabel, now);
  if (!ev) return null;
  return wrapCalendar([ev], now, sub.name);
}

/** A calendar containing exactly one task. */
export function calendarForTask(task: Task, now: number = Date.now()): string | null {
  const ev = taskEvent(task, now);
  if (!ev) return null;
  return wrapCalendar([ev], now, task.title);
}

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
