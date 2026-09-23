import type { Table } from 'dexie';

/**
 * Undo, for anything that makes a record move or vanish.
 *
 * The record is snapshotted before the change and put back exactly - every
 * field, updatedAt included - so Undo is a real undo rather than a second edit
 * that happens to look similar.
 *
 * Put back only if nothing has changed it since. A toast stays up for a few
 * seconds; if in that time the same task was edited somewhere else, the edit is
 * yours and it wins. Undo then says so instead of quietly throwing it away.
 */

interface Versioned {
  id: string;
  updatedAt: number;
}

/**
 * Whether `current` is still exactly what the change left behind. `after`
 * undefined means the change was a delete, so the only safe state to restore
 * over is "still gone".
 */
export function canRestore(current: Versioned | undefined, after: Versioned | undefined): boolean {
  if (!after) return current === undefined;
  return current !== undefined && current.updatedAt === after.updatedAt;
}

export type UndoOutcome = 'restored' | 'changed';

/** Puts each record back where it has not been changed since. */
export async function restore<T extends Versioned>(
  table: Table<T, string>,
  pairs: { before: T; after: T | undefined }[],
): Promise<UndoOutcome> {
  let skipped = 0;
  for (const { before, after } of pairs) {
    const current = await table.get(before.id);
    if (canRestore(current, after)) await table.put(before);
    else skipped += 1;
  }
  return skipped === 0 ? 'restored' : 'changed';
}

/**
 * Whether the fields a change set are still as it left them. This is the same
 * rule for a change made inside an open form, where there is no saved record
 * yet - only the draft: if you have changed those fields since, your change
 * wins. Compared by value, because a step list read back from the database is
 * a new array with the same steps in it.
 */
export function stillAsLeft<T extends object>(current: T, after: Partial<T>): boolean {
  return (Object.keys(after) as (keyof T)[]).every(
    (key) => JSON.stringify(current[key]) === JSON.stringify(after[key]),
  );
}

/** The line shown after Undo. */
export function undoneMessage(outcome: UndoOutcome): string {
  return outcome === 'restored' ? 'Put back as it was.' : 'It had been changed since, so it was left as it is now.';
}

/**
 * The toast button that puts records back, and then says which way it went.
 * `say` is the toast itself, so the result replaces the toast that offered it.
 */
export function undoAction<T extends Versioned>(
  table: Table<T, string>,
  pairs: { before: T; after: T | undefined }[],
  say: (message: string) => void,
): { label: string; run: () => Promise<void> } {
  return {
    label: 'Undo',
    run: async () => say(undoneMessage(await restore(table, pairs))),
  };
}
