import { describe, expect, it } from 'vitest';
import { finishedWithoutDate, unscheduled } from '../src/lib/agenda';
import type { Task } from '../src/types';

/**
 * These two selectors decide what the Backlog contains. Until now agenda.ts had
 * no tests at all, and `unscheduled` was quietly reimplemented inline in
 * Tasks.tsx - so the definition of "has no date" existed twice with nothing
 * holding the copies together.
 */

let clock = 1_000;
function task(partial: Partial<Task> = {}): Task {
  const ts = (clock += 1_000);
  return {
    id: Math.random().toString(36).slice(2),
    title: 'Something',
    notes: '',
    steps: [],
    tags: [],
    createdAt: ts,
    updatedAt: ts,
    ...partial,
  };
}

describe('unscheduled', () => {
  it('keeps open tasks with no date', () => {
    const loose = task({ title: 'Book the dentist' });
    expect(unscheduled([loose]).map((t) => t.title)).toEqual(['Book the dentist']);
  });

  it('drops anything with a day on it, because that is planned rather than outstanding', () => {
    expect(unscheduled([task({ date: '2026-09-16' })])).toEqual([]);
  });

  it('drops anything finished', () => {
    expect(unscheduled([task({ doneAt: 5_000 })])).toEqual([]);
  });

  it('treats an empty-string date as no date, since that is what a cleared input gives', () => {
    expect(unscheduled([task({ date: '' })])).toHaveLength(1);
  });
});

describe('finishedWithoutDate', () => {
  it('returns what you ticked off, most recent first', () => {
    const early = task({ title: 'Ordered the ink', doneAt: 10_000 });
    const late = task({ title: 'Rang the surgery', doneAt: 20_000 });
    expect(finishedWithoutDate([early, late]).map((t) => t.title)).toEqual([
      'Rang the surgery',
      'Ordered the ink',
    ]);
  });

  it('leaves out anything still open', () => {
    expect(finishedWithoutDate([task({ title: 'still to do' })])).toEqual([]);
  });

  it('leaves out finished tasks that had a day, which belong to that day', () => {
    expect(finishedWithoutDate([task({ doneAt: 10_000, date: '2026-09-16' })])).toEqual([]);
  });

  it('caps the list, so a year of finished things is not a wall', () => {
    const many = Array.from({ length: 30 }, (_, i) => task({ doneAt: 1_000 + i }));
    expect(finishedWithoutDate(many)).toHaveLength(10);
    expect(finishedWithoutDate(many, 3)).toHaveLength(3);
  });

  it('never overlaps with unscheduled - a task is in one list or the other', () => {
    const items = [
      task({ title: 'open' }),
      task({ title: 'done', doneAt: 9_000 }),
      task({ title: 'planned', date: '2026-09-16' }),
    ];
    const open = new Set(unscheduled(items).map((t) => t.id));
    const done = new Set(finishedWithoutDate(items).map((t) => t.id));
    expect([...open].filter((id) => done.has(id))).toEqual([]);
  });
});
