import type { DateKey, Subscription, Task } from '../types';
import { billingDatesBetween, nextBilling } from './recurrence';
import { addDays, atTime, daysBetween, todayKey } from './time';
import { yearlyMinor } from './money';

/**
 * One ordered list for a day: timed things in time order, then untimed things.
 * Deliberately not a grid or a calendar - a single column you read top to
 * bottom needs no spatial decoding.
 */

export type AgendaKind = 'task' | 'billing';

export interface AgendaItem {
  key: string;
  kind: AgendaKind;
  /** Epoch ms for sorting; untimed items sort after everything timed. */
  sortAt: number;
  timed: boolean;
  title: string;
  startTime?: string;
  durationMin?: number;
  task?: Task;
  subscription?: Subscription;
  amountMinor?: number;
}

export function agendaFor(date: DateKey, tasks: Task[], subs: Subscription[]): AgendaItem[] {
  const items: AgendaItem[] = [];

  for (const task of tasks) {
    if (task.date !== date) continue;
    const timed = Boolean(task.startTime);
    items.push({
      key: `task-${task.id}`,
      kind: 'task',
      timed,
      sortAt: timed ? atTime(date, task.startTime!) : Number.MAX_SAFE_INTEGER,
      title: task.title,
      startTime: task.startTime,
      durationMin: task.durationMin,
      task,
    });
  }

  for (const sub of subs) {
    if (sub.endedOn) continue;
    if (billingDatesBetween(sub, date, date).length === 0) continue;
    items.push({
      key: `bill-${sub.id}`,
      kind: 'billing',
      timed: false,
      sortAt: Number.MAX_SAFE_INTEGER,
      title: `${sub.name} renews`,
      subscription: sub,
      amountMinor: sub.amountMinor,
    });
  }

  return items.sort((a, b) => {
    if (a.sortAt !== b.sortAt) return a.sortAt - b.sortAt;
    return a.title.localeCompare(b.title);
  });
}

export interface UpcomingBill {
  sub: Subscription;
  date: DateKey;
  inDays: number;
}

/** Charges landing in the next `days` days, soonest first. */
export function upcomingBills(subs: Subscription[], days: number, from: DateKey = todayKey()): UpcomingBill[] {
  const to = addDays(from, days);
  const out: UpcomingBill[] = [];
  for (const sub of subs) {
    if (sub.endedOn) continue;
    for (const date of billingDatesBetween(sub, from, to)) {
      out.push({ sub, date, inDays: daysBetween(from, date) });
    }
  }
  return out.sort((a, b) => a.inDays - b.inDays || a.sub.name.localeCompare(b.sub.name));
}

/**
 * Anything scheduled for a day that has already passed and was never finished.
 * Shown as "still open", never as "overdue" - the wording matters when the
 * whole point is to reduce the dread that stops you opening the app at all.
 */
export function stillOpen(tasks: Task[], today: DateKey = todayKey()): Task[] {
  return tasks
    .filter((t) => !t.doneAt && t.date !== undefined && daysBetween(t.date, today) > 0)
    .sort((a, b) => (a.date! < b.date! ? 1 : -1));
}

export function unscheduled(tasks: Task[]): Task[] {
  return tasks.filter((t) => !t.doneAt && !t.date).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Backlog things you have finished, most recently first.
 *
 * Ticking something off makes it vanish from the list, which is correct and also
 * briefly alarming - on a bad day "where did it go?" is a real cost. So the
 * Backlog can show the last few back to you. It is proof of work, not a running
 * total: no streak, no count of what you managed this week.
 */
export function finishedWithoutDate(tasks: Task[], limit = 10): Task[] {
  return tasks
    .filter((t) => t.doneAt && !t.date)
    .sort((a, b) => b.doneAt! - a.doneAt!)
    .slice(0, limit);
}

/** The single most expensive active subscription, for the "worth a look?" prompt. */
export function priciest(subs: Subscription[]): Subscription | null {
  const active = subs.filter((s) => !s.endedOn);
  if (active.length === 0) return null;
  return active.reduce((max, s) => (yearlyMinor(s) > yearlyMinor(max) ? s : max));
}

export { nextBilling };
