import { db, saveTask } from '../db';
import type { DateKey, Recurrence, Task, TimeKey } from '../types';
import { nextOccurrence } from './recurrence';
import { atTime, clockLabel, daysBetween, fromDateKey, SHORT_MONTHS, SHORT_WEEKDAYS, todayKey } from './time';

/** Where a reminder counts from when the task has a day but no time. */
export const DEFAULT_REMIND_TIME: TimeKey = '09:00';

/* ---------------------------------------------------------------------------
   Reminders

   A reminder is stored as a moment (`remindAt`), but what you choose is an
   offset: "30 min before". The editor used to turn the offset into a moment
   once, when you tapped it, so moving the task afterwards left the reminder on
   the old moment, and taking the date off left an undated task that still went
   off. These keep the offset as the thing that is true and work the moment out
   again from the day and time whenever either changes.
   -------------------------------------------------------------------------- */

/** The moment to remind, or undefined when there is no day or no reminder. */
export function reminderAt(
  date: DateKey | undefined,
  startTime: TimeKey | undefined,
  offsetMin: number | null | undefined,
): number | undefined {
  if (!date || offsetMin === null || offsetMin === undefined) return undefined;
  return atTime(date, startTime ?? DEFAULT_REMIND_TIME) - offsetMin * 60_000;
}

/** The offset a saved task's reminder was set with, or null if it has none. */
export function reminderOffset(task: Pick<Task, 'date' | 'startTime' | 'remindAt'>): number | null {
  if (task.remindAt === undefined || !task.date) return null;
  return Math.round((atTime(task.date, task.startTime ?? DEFAULT_REMIND_TIME) - task.remindAt) / 60_000);
}

/**
 * The task with its reminder worked out from its own day and time.
 *
 * `remindedAt` is what stops a reminder firing twice. It is kept only when the
 * reminder has not moved: a reminder moved to a new moment is a new reminder,
 * and has to be able to go off.
 */
export function withReminder(task: Task, offsetMin: number | null, previous?: Pick<Task, 'remindAt' | 'remindedAt'>): Task {
  const remindAt = reminderAt(task.date, task.startTime, offsetMin);
  const unchanged = remindAt !== undefined && remindAt === previous?.remindAt;
  return { ...task, remindAt, remindedAt: unchanged ? previous?.remindedAt : undefined };
}

/* ---------------------------------------------------------------------------
   Repeats
   -------------------------------------------------------------------------- */

function dayOfMonth(date: DateKey): number {
  return fromDateKey(date).getDate();
}

function takesAnchor(rec: Recurrence): boolean {
  return rec.kind === 'monthly' || rec.kind === 'yearly';
}

/**
 * The task with its repeat's anchor day set, for saving from the editor.
 *
 * The anchor comes from the task's day, but only when that day means
 * something new: a fresh repeat, a day you just changed, or a repeat that
 * never had one. A task that has rolled to 28 Feb and is saved again for some
 * other reason keeps its 31 - otherwise editing its title would quietly move
 * it to the 28th for good.
 */
export function withAnchor(task: Task, previous?: Pick<Task, 'date' | 'recurrence'>): Task {
  const rec = task.recurrence;
  if (!rec) return task;
  if (!takesAnchor(rec) || !task.date) {
    const { anchorDay: _dropped, ...rest } = rec;
    return { ...task, recurrence: rest };
  }
  const keep =
    rec.anchorDay !== undefined && previous?.date === task.date && previous.recurrence?.kind === rec.kind;
  return { ...task, recurrence: { ...rec, anchorDay: keep ? rec.anchorDay : dayOfMonth(task.date) } };
}

/**
 * What a task becomes when you tick it off, without saving it.
 *
 * A repeat rolls to its first date strictly after today (or after its own
 * date, if you ticked it early) - one tick, however far behind it was. It used
 * to step one period per tick, so a daily task three days behind needed three
 * ticks, and each left a reminder in the past to be reported as "missed".
 *
 * The reminder moves by the same number of days. If that still leaves it
 * behind you - "a day before" a task that is now tomorrow - it is marked as
 * already reminded, because you have just done the thing it was reminding you
 * about.
 */
export function rolledForward(task: Task, at: number = Date.now()): Task {
  if (!task.recurrence || !task.date) return { ...task, doneAt: at };

  // Repeats saved before anchors existed take one from their day now, so they
  // stop drifting from here on.
  const rec: Recurrence =
    takesAnchor(task.recurrence) && task.recurrence.anchorDay === undefined
      ? { ...task.recurrence, anchorDay: dayOfMonth(task.date) }
      : task.recurrence;

  const today = todayKey(new Date(at));
  const after = daysBetween(task.date, today) > 0 ? today : task.date;
  let next = nextOccurrence(rec, task.date);
  // Stepping along the schedule keeps weekly repeats on their own days and in
  // phase. The bound is decades of daily repeats; it only stops a bad record
  // from hanging the app.
  for (let guard = 0; daysBetween(next, after) >= 0 && guard < 20_000; guard++) {
    next = nextOccurrence(rec, next);
  }

  const remindAt =
    task.remindAt !== undefined ? task.remindAt + (atTime(next, '12:00') - atTime(task.date, '12:00')) : undefined;

  return {
    ...task,
    recurrence: rec,
    date: next,
    doneAt: undefined,
    lastDoneAt: at,
    remindAt,
    remindedAt: remindAt !== undefined && remindAt <= at ? at : undefined,
    steps: task.steps.map((s) => ({ ...s, done: false })),
  };
}

/**
 * Ticking off a repeating task rolls it forward instead of ending it, so the
 * list never fills with a hundred completed copies of "take meds".
 */
export async function completeTask(task: Task, at: number = Date.now()): Promise<Task> {
  return saveTask(rolledForward(task, at));
}

/**
 * "Last ticked today, 8:02 AM" / "Last ticked Tue". A plain fact that answers
 * "did I already do it?" - no streak, no count, nothing to keep up.
 */
export function describeLastDone(lastDoneAt: number, now: number = Date.now()): string {
  const done = new Date(lastDoneAt);
  const ago = daysBetween(todayKey(done), todayKey(new Date(now)));
  if (ago <= 0) return `Last ticked today, ${clockLabel(lastDoneAt)}`;
  if (ago === 1) return 'Last ticked yesterday';
  if (ago < 7) return `Last ticked ${SHORT_WEEKDAYS[done.getDay()]}`;
  return `Last ticked ${SHORT_MONTHS[done.getMonth()]} ${done.getDate()}`;
}

export async function uncompleteTask(task: Task): Promise<Task> {
  return saveTask({ ...task, doneAt: undefined });
}

export async function toggleStep(task: Task, stepId: string): Promise<Task> {
  return saveTask({
    ...task,
    steps: task.steps.map((s) => (s.id === stepId ? { ...s, done: !s.done } : s)),
  });
}

/** Move a task to a different day, keeping any reminder the same distance from it. */
export async function moveTo(task: Task, date: string | undefined): Promise<Task> {
  if (!date) {
    return saveTask({ ...task, date: undefined, startTime: undefined, remindAt: undefined, remindedAt: undefined });
  }
  const shift = task.date && task.remindAt !== undefined
    ? task.remindAt + (atTime(date, '12:00') - atTime(task.date, '12:00'))
    : task.remindAt;
  return saveTask({ ...task, date, remindAt: shift, remindedAt: undefined });
}

export async function deleteTask(task: Task): Promise<void> {
  await db.tasks.delete(task.id);
}

export function stepProgress(task: Task): { done: number; total: number } {
  return { done: task.steps.filter((s) => s.done).length, total: task.steps.length };
}

export { todayKey };
