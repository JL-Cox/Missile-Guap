import type { BacklogSort, Priority, Task } from '../types';

/**
 * How pressing a task is, and the orders the Backlog can be read in.
 *
 * The Backlog is the list of things with no day on them - book the dentist,
 * order the ink, chase the landlord. They are ordinary tasks; the only thing
 * that makes them a list is that nobody has given them a date yet. So priority
 * is a field on a task and this module is just how you rank and order them.
 *
 * Nothing here escalates anything on its own. A thing you marked Low a month ago
 * is still Low today: the app never quietly decides something got urgent while
 * you weren't looking, because then the list stops being a record of what you
 * decided and starts being an argument.
 */

/** Most pressing first, which is also the order the buttons appear in. */
export const PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low'];

export const PRIORITY_LABELS: Record<Priority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/**
 * Rank for sorting: lower is more pressing, and **an unset priority ranks after
 * every set one**.
 *
 * Not because "unset" means unimportant - it means undecided, and something you
 * have actually thought about should outrank something you have not. It is the
 * same sentinel idea the rest of the app already uses for a missing value:
 * `Number.MAX_SAFE_INTEGER` for an untimed agenda item, `'99:99'` for a task
 * with no start time. Absent sorts last; it never sorts first by accident.
 */
export function priorityRank(priority?: Priority): number {
  const at = priority ? PRIORITIES.indexOf(priority) : -1;
  return at === -1 ? PRIORITIES.length : at;
}

/** The class a row's priority renders with. Critical is filled, High outlined. */
export function priorityClass(priority: Priority): string {
  if (priority === 'critical') return 'badge badge-critical';
  if (priority === 'high') return 'badge badge-high';
  return priority === 'low' ? 'prio-text prio-text-low' : 'prio-text';
}

export const SORTS: { id: BacklogSort; label: string }[] = [
  { id: 'priority', label: 'Most pressing' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'newest', label: 'Newest first' },
  { id: 'az', label: 'A to Z' },
];

/**
 * A sorted copy. Never the same array back.
 *
 * `Array.prototype.sort` mutates, and `Tasks.tsx` already sorts a grouped array
 * in place during render - which works by luck rather than by design. Copying
 * first costs nothing at this size and means sorting a list can never reorder
 * somebody else's.
 *
 * Every order is total: each comparator falls through to a tiebreak that cannot
 * itself tie in practice, so the result is stable no matter what the engine's
 * sort does with equal elements.
 */
export function sortTasks(tasks: Task[], sort: BacklogSort): Task[] {
  const copy = [...tasks];
  switch (sort) {
    case 'priority':
      // Within a level, oldest first: the whole point of a backlog is that
      // things do not quietly sink just because newer things arrived.
      return copy.sort(
        (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.createdAt - b.createdAt,
      );
    case 'oldest':
      return copy.sort((a, b) => a.createdAt - b.createdAt);
    case 'newest':
      return copy.sort((a, b) => b.createdAt - a.createdAt);
    case 'az':
      // Case-insensitive, so "Book dentist" and "book dentist" sit together
      // rather than in two separate alphabets.
      return copy.sort(
        (a, b) =>
          a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) ||
          a.createdAt - b.createdAt,
      );
  }
}

/** The heading a priority sits under, including the undecided pile. */
export function groupLabel(priority?: Priority): string {
  return priority ? PRIORITY_LABELS[priority] : 'No priority yet';
}
