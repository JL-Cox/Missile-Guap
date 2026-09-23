import type { DateKey, Task } from '../types';
import { describeDate } from './time';

/**
 * The words after something moves or disappears. Each says where the thing
 * went, in terms of the tab you would look in, so nothing ever just vanishes
 * and leaves you wondering. Plain statements; nothing congratulates or scolds.
 */

/** After saving a task from the Inbox. */
export function savedTaskWhere(task: Pick<Task, 'date'>): string {
  return task.date ? 'Saved to Tasks.' : 'Saved to Backlog.';
}

/** After giving a task a different day, or none. */
export function movedMessage(date: DateKey | undefined, today: DateKey): string {
  if (!date) return 'Moved to Backlog.';
  if (date === today) return 'On Today now.';
  return `Moved to ${describeDate(date, today)}.`;
}

/** After several at once went to the Backlog. */
export function movedManyMessage(count: number): string {
  return count === 1 ? 'Moved 1 to Backlog.' : `Moved ${count} to Backlog.`;
}

/**
 * After ticking something off. A repeat does not finish - it rolls to its next
 * day - so it says when that is, which is also the answer to "did it take?".
 */
export function doneMessage(after: Pick<Task, 'date' | 'doneAt'>, today: DateKey): string {
  if (!after.doneAt && after.date) return `Done. Next: ${describeDate(after.date, today)}.`;
  return 'Done.';
}

export function cancelledMessage(name: string): string {
  return `${name.trim() || 'That subscription'} marked cancelled.`;
}
