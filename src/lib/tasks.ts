import { db, saveTask } from '../db';
import type { Task } from '../types';
import { nextOccurrence } from './recurrence';
import { atTime, todayKey } from './time';

/**
 * Ticking off a repeating task rolls it forward instead of ending it, so the
 * list never fills with a hundred completed copies of "take meds".
 */
export async function completeTask(task: Task, at: number = Date.now()): Promise<Task> {
  if (!task.recurrence || !task.date) {
    return saveTask({ ...task, doneAt: at });
  }
  const nextDate = nextOccurrence(task.recurrence, task.date);
  const remindAt =
    task.remindAt !== undefined && task.date
      ? task.remindAt + (atTime(nextDate, '12:00') - atTime(task.date, '12:00'))
      : undefined;
  return saveTask({
    ...task,
    date: nextDate,
    doneAt: undefined,
    remindAt,
    remindedAt: undefined,
    steps: task.steps.map((s) => ({ ...s, done: false })),
  });
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
  if (!date) return saveTask({ ...task, date: undefined, startTime: undefined, remindAt: undefined });
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
