import type { DateKey, Task } from '../types';
import { sortTasks } from './priority';
import { daysBetween, describeDate } from './time';

/**
 * Whether a task matches a search. Titles, notes, steps and tags, ignoring
 * case - the same rule on the Tasks screen and in the "matching tasks" line on
 * Notes, so the two can never disagree about what a search found.
 */
export function taskMatches(task: Task, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    task.title.toLowerCase().includes(needle) ||
    task.notes.toLowerCase().includes(needle) ||
    task.tags.some((tag) => tag.toLowerCase().includes(needle)) ||
    task.steps.some((s) => s.text.toLowerCase().includes(needle))
  );
}

export interface TaskGroup {
  key: string;
  label: string;
  tasks: Task[];
  /** Rows in this group need their own date, because the heading does not give one. */
  showDate: boolean;
}

const byTime = (a: Task, b: Task) => (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99');

/**
 * The Tasks screen's groups, in reading order: Today first, because it is the
 * question you opened the list with; then what is coming, in date order; then
 * everything from earlier days that is still open, in one group rather than a
 * heading per past day; then the things with no date at all.
 *
 * Earlier days come after the future on purpose. They are the least actionable
 * part of the list and the part most likely to feel like a reproach, so they
 * sit below what you can still plan - present, never on top.
 */
export function groupTasks(tasks: Task[], today: DateKey, finished = false): TaskGroup[] {
  if (finished) {
    const done = [...tasks].sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
    return done.length ? [{ key: 'finished', label: 'Finished', tasks: done, showDate: true }] : [];
  }

  const groups: TaskGroup[] = [];
  const todays = tasks.filter((t) => t.date === today).sort(byTime);
  if (todays.length) groups.push({ key: today, label: 'Today', tasks: todays, showDate: false });

  const future = tasks.filter((t) => t.date && daysBetween(today, t.date) > 0);
  const days = [...new Set(future.map((t) => t.date!))].sort();
  for (const day of days) {
    groups.push({
      key: day,
      label: describeDate(day, today),
      tasks: future.filter((t) => t.date === day).sort(byTime),
      showDate: false,
    });
  }

  const earlier = tasks
    .filter((t) => t.date && daysBetween(today, t.date) < 0)
    .sort((a, b) => a.date!.localeCompare(b.date!) || byTime(a, b));
  if (earlier.length) groups.push({ key: 'earlier', label: 'Earlier, still open', tasks: earlier, showDate: true });

  // The same ranking the Backlog uses, so the two lists agree about order.
  const undated = sortTasks(tasks.filter((t) => !t.date), 'priority');
  if (undated.length) groups.push({ key: 'none', label: 'No date yet', tasks: undated, showDate: false });

  return groups;
}
