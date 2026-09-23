import type { DateKey, Settings, Task } from '../types';

/**
 * "Today is a low day": a lighter Today screen for the days when the full one
 * is too much. It is a view of the same tasks, not a mode anything else knows
 * about, and it keeps no history - the setting holds one date, and that date
 * stops meaning anything at midnight.
 *
 * The app never suggests it. It is a button you press, and nothing here looks
 * at how much you did or did not do.
 */

/** Whether today is the low day. A date comparison, so midnight ends it without a timer. */
export function isLowDay(settings: Pick<Settings, 'lowDay'>, today: DateKey): boolean {
  return settings.lowDay === today;
}

/**
 * A low day left over from an earlier day. It is deleted rather than kept, so
 * the settings never hold a past low day.
 */
export function isStaleLowDay(settings: Pick<Settings, 'lowDay'>, today: DateKey): boolean {
  return settings.lowDay !== undefined && settings.lowDay !== today;
}

/**
 * What stays on screen on a low day: anything today with a set time, because
 * a time usually means someone else is expecting you; anything marked
 * Critical; and anything you said you can do even on a low day. The rest is
 * still there, folded away in its usual place.
 */
export function fitsLowDay(task: Task, today: DateKey): boolean {
  if (task.date === today && task.startTime) return true;
  return task.priority === 'critical' || task.energy === 'low';
}
