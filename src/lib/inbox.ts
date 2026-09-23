import { db } from '../db';
import type { Note } from '../types';

/**
 * Undoing "Keep as a note".
 *
 * Filing a capture as a note makes a new note and clears the capture. "Put it
 * back" used to restore the capture and leave the note, so filing it again
 * made a second copy. Now the note goes too - but only if it is exactly as it
 * was filed. If it has been changed since, it is yours, and it stays.
 */
export function unchangedSince(current: Note | undefined, filed: Pick<Note, 'id' | 'updatedAt'>): boolean {
  return Boolean(current) && current!.id === filed.id && current!.updatedAt === filed.updatedAt;
}

/** Removes the filed note if it is untouched. Says whether it did. */
export async function undoFiling(filed: Pick<Note, 'id' | 'updatedAt'>): Promise<boolean> {
  const current = await db.notes.get(filed.id);
  if (!unchangedSince(current, filed)) return false;
  await db.notes.delete(filed.id);
  return true;
}

/**
 * A capture turned into a task: the first line is the title, anything after it
 * is kept as the task's notes. "Call the pharmacy\nask about the repeat, ref
 * 40118" should not become a forty-word title, and nothing typed is dropped.
 */
export function splitCapture(text: string): { title: string; notes: string } {
  const trimmed = text.trim();
  const at = trimmed.indexOf('\n');
  if (at === -1) return { title: trimmed, notes: '' };
  return { title: trimmed.slice(0, at).trim(), notes: trimmed.slice(at + 1).trim() };
}
