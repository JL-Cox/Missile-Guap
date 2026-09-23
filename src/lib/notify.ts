import { db, getSettings } from '../db';
import type { ReminderContent, Task } from '../types';
import { clockLabel } from './time';

/**
 * Honest limits, because a reminder you *think* is set is worse than none:
 *
 *   - While Steady is open (or backgrounded but not evicted), it checks every
 *     30s and fires notifications itself. This is reliable enough day-to-day.
 *   - When the app has been closed for a while, Android may have stopped it.
 *     Anything that came due meanwhile is shown as "missed while you were away"
 *     the moment you open the app, instead of being quietly dropped.
 *   - For anything that genuinely must not be missed, export to your calendar
 *     from Settings. The phone's own alarms do not depend on this app running.
 *
 * There is deliberately no push server, because a push server would mean
 * sending your reminders to someone else's computer.
 */

export type PermissionState = 'unsupported' | 'default' | 'granted' | 'denied';

export function notificationSupport(): PermissionState {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as PermissionState;
}

export async function requestPermission(): Promise<PermissionState> {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    return (await Notification.requestPermission()) as PermissionState;
  } catch {
    return 'denied';
  }
}

async function show(title: string, body: string, tag: string): Promise<void> {
  if (notificationSupport() !== 'granted') return;
  const options: NotificationOptions = {
    body,
    tag,
    icon: `${import.meta.env.BASE_URL}icon-192.png`,
    badge: `${import.meta.env.BASE_URL}icon-192.png`,
    // Stay on screen. A notification that vanishes before it is read has not reminded anyone.
    requireInteraction: true,
  };
  try {
    // On Android, notifications must come from the service worker registration.
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, options);
      return;
    }
  } catch {
    // Fall through to the plain constructor below.
  }
  try {
    new Notification(title, options);
  } catch {
    // Some browsers throw for the plain constructor on mobile. Nothing else to do.
  }
}

/**
 * What a notification says. It can be read off a locked phone, or a watch, by
 * whoever is nearby - so by default it is the title and the time and nothing
 * else. Notes are where people keep card numbers and what the doctor said;
 * they only appear if you chose that in Settings.
 */
export function reminderText(task: Task, content: ReminderContent): { title: string; body: string } {
  if (content === 'generic') return { title: 'Steady', body: 'You have a reminder' };
  const title = task.title.trim() || 'Reminder';
  const when = `Reminder for ${clockLabel(task.remindAt ?? Date.now())}`;
  if (content === 'titleNotes') return { title, body: task.notes?.trim() || when };
  return { title, body: when };
}

/**
 * Whether a task's reminder should go off at `at`.
 *
 * A reminder belongs to a day, so a task with no day never fires. The editor
 * now clears the reminder when the date is taken off; this also quietens any
 * left over from before it did.
 */
export function isDueReminder(task: Task, at: number): boolean {
  return (
    !task.doneAt &&
    task.date !== undefined &&
    task.remindAt !== undefined &&
    task.remindAt <= at &&
    !task.remindedAt
  );
}

/** Tasks whose reminder time has arrived and which have not been notified yet. */
export async function dueReminders(at: number = Date.now()): Promise<Task[]> {
  const candidates = await db.tasks.where('remindAt').belowOrEqual(at).toArray();
  return candidates.filter((t) => isDueReminder(t, at));
}

async function markReminded(tasks: Task[], at: number): Promise<void> {
  await db.transaction('rw', db.tasks, async () => {
    for (const t of tasks) await db.tasks.update(t.id, { remindedAt: at });
  });
}

/** How late a reminder can be before we treat it as "missed" rather than firing it now. */
const MISSED_AFTER_MS = 30 * 60_000;

export interface Tick {
  fired: Task[];
  missed: Task[];
}

/**
 * One scheduler pass. Anything due in the last 30 minutes still gets a real
 * notification; anything older is returned as `missed` so the UI can show it
 * calmly in one place rather than firing a pile of stale alerts at once.
 */
export async function runOnce(at: number = Date.now(), content: ReminderContent = 'titleTime'): Promise<Tick> {
  const due = await dueReminders(at);
  if (due.length === 0) return { fired: [], missed: [] };

  const fired = due.filter((t) => at - (t.remindAt ?? 0) <= MISSED_AFTER_MS);
  const missed = due.filter((t) => at - (t.remindAt ?? 0) > MISSED_AFTER_MS);

  for (const task of fired) {
    const { title, body } = reminderText(task, content);
    await show(title, body, `task-${task.id}`);
  }
  await markReminded(due, at);
  return { fired, missed };
}

/** Start the polling loop. Returns a stop function. */
export function startScheduler(onTick: (tick: Tick) => void, intervalMs = 30_000): () => void {
  let stopped = false;

  const pass = async () => {
    if (stopped) return;
    try {
      // Read fresh each pass, so changing what reminders show applies to the
      // very next one rather than after a restart.
      const { reminderContent } = await getSettings();
      const tick = await runOnce(Date.now(), reminderContent);
      if (!stopped && (tick.fired.length || tick.missed.length)) onTick(tick);
    } catch {
      // A failed pass must never take the app down; the next one will retry.
    }
  };

  void pass();
  const timer = window.setInterval(pass, intervalMs);
  // Coming back to the tab is the most likely moment for something to be due.
  const onVisible = () => {
    if (document.visibilityState === 'visible') void pass();
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    stopped = true;
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
