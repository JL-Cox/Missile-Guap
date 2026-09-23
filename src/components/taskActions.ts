import { useCallback } from 'react';
import { db } from '../db';
import type { Task } from '../types';
import { deleteTask, moveTo } from '../lib/tasks';
import { movedManyMessage, movedMessage } from '../lib/feedback';
import { undoAction } from '../lib/undo';
import { todayKey } from '../lib/time';
import { useToast } from './ui';

/**
 * The things a task list does to a task that make it move or vanish, each
 * followed by the same toast: where it went, and Undo. One place, so Today,
 * Tasks and Backlog cannot drift into three slightly different behaviours.
 */
export function useTaskActions() {
  const toast = useToast();

  const move = useCallback(
    async (task: Task, date: string | undefined) => {
      const after = await moveTo(task, date);
      toast(movedMessage(date, todayKey()), undoAction(db.tasks, [{ before: task, after }], toast));
    },
    [toast],
  );

  /** Takes the dates off several at once - they all go to the Backlog. */
  const undateAll = useCallback(
    async (tasks: Task[]) => {
      const pairs = [];
      for (const before of tasks) pairs.push({ before, after: await moveTo(before, undefined) });
      toast(movedManyMessage(tasks.length), undoAction(db.tasks, pairs, toast));
    },
    [toast],
  );

  /** Deletes the saved record - not the draft - so Undo brings back exactly what was there. */
  const remove = useCallback(
    async (task: Task) => {
      const before = await db.tasks.get(task.id);
      await deleteTask(task);
      if (before) toast('Deleted.', undoAction(db.tasks, [{ before, after: undefined }], toast));
    },
    [toast],
  );

  return { move, undateAll, remove };
}
