import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db';
import { undoFiling, unchangedSince } from '../src/lib/inbox';
import type { Note } from '../src/types';

const filed: Note = {
  id: 'n1',
  title: 'Ring the surgery',
  body: 'Ring the surgery about the results',
  tags: [],
  pinned: false,
  createdAt: 100,
  updatedAt: 101,
};

afterEach(() => vi.restoreAllMocks());

describe('undoing "Keep as a note"', () => {
  it('counts a note as untouched only if it is exactly as filed', () => {
    expect(unchangedSince(filed, filed)).toBe(true);
    expect(unchangedSince({ ...filed, updatedAt: 500 }, filed)).toBe(false);
    expect(unchangedSince(undefined, filed)).toBe(false);
  });

  it('removes the note it made, so filing again does not make a second copy', async () => {
    vi.spyOn(db.notes, 'get').mockResolvedValue(filed as never);
    const remove = vi.spyOn(db.notes, 'delete').mockResolvedValue(undefined as never);
    expect(await undoFiling(filed)).toBe(true);
    expect(remove).toHaveBeenCalledWith('n1');
  });

  it('leaves a note you have changed since', async () => {
    vi.spyOn(db.notes, 'get').mockResolvedValue({ ...filed, body: 'Results fine', updatedAt: 900 } as never);
    const remove = vi.spyOn(db.notes, 'delete').mockResolvedValue(undefined as never);
    expect(await undoFiling(filed)).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });
});
