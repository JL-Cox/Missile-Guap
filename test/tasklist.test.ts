import { describe, expect, it } from 'vitest';
import { groupTasks, taskMatches } from '../src/lib/tasklist';
import { splitCapture } from '../src/lib/inbox';
import { SORTS } from '../src/lib/priority';
import { cancelledMessage, doneMessage, movedManyMessage, movedMessage, savedTaskWhere } from '../src/lib/feedback';
import { canRestore, undoneMessage } from '../src/lib/undo';
import type { Task } from '../src/types';

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: id,
  notes: '',
  steps: [],
  tags: [],
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

const today = '2026-09-23';

describe('the Tasks screen groups', () => {
  const list = [
    task('undated-low', { priority: 'low', createdAt: 1 }),
    task('undated-critical', { priority: 'critical', createdAt: 2 }),
    task('last-week', { date: '2026-09-16' }),
    task('yesterday', { date: '2026-09-22' }),
    task('next-week', { date: '2026-09-30' }),
    task('tomorrow', { date: '2026-09-24' }),
    task('today-late', { date: today, startTime: '15:00' }),
    task('today-early', { date: today, startTime: '09:00' }),
  ];
  const groups = groupTasks(list, today);

  it('reads Today, then what is coming, then earlier days, then no date', () => {
    expect(groups.map((g) => g.label)).toEqual([
      'Today',
      'Tomorrow',
      'Wed, Sep 30 · in 7 days',
      'Earlier, still open',
      'No date yet',
    ]);
  });

  it('puts every past day into one group, oldest first, each row carrying its date', () => {
    const earlier = groups.find((g) => g.key === 'earlier')!;
    expect(earlier.tasks.map((t) => t.id)).toEqual(['last-week', 'yesterday']);
    expect(earlier.showDate).toBe(true);
  });

  it('orders a day by its times', () => {
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['today-early', 'today-late']);
  });

  it('ranks the undated group the way the Backlog does', () => {
    expect(groups[groups.length - 1].tasks.map((t: Task) => t.id)).toEqual(['undated-critical', 'undated-low']);
  });

  it('leaves out groups with nothing in them', () => {
    expect(groupTasks([task('only', { date: today })], today).map((g) => g.label)).toEqual(['Today']);
    expect(groupTasks([], today)).toEqual([]);
  });

  it('shows finished things newest first, in one group', () => {
    const done = groupTasks([task('a', { doneAt: 5 }), task('b', { doneAt: 9 })], today, true);
    expect(done.map((g) => g.label)).toEqual(['Finished']);
    expect(done[0].tasks.map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('searching tasks', () => {
  const t = task('x', {
    title: 'Call the pharmacy',
    notes: 'Ask about the REPEAT',
    tags: ['health'],
    steps: [{ id: 's', text: 'Find the letter', done: false }],
  });

  it('looks in titles, notes, tags and steps, ignoring case', () => {
    expect(taskMatches(t, 'PHARMACY')).toBe(true);
    expect(taskMatches(t, 'repeat')).toBe(true);
    expect(taskMatches(t, 'Health')).toBe(true);
    expect(taskMatches(t, 'letter')).toBe(true);
    expect(taskMatches(t, 'dentist')).toBe(false);
  });

  it('matches everything when there is nothing to search for', () => {
    expect(taskMatches(t, '   ')).toBe(true);
  });
});

describe('a capture made into a task', () => {
  it('takes the first line as the title and keeps the rest as notes', () => {
    expect(splitCapture('Call the pharmacy\nask about the repeat\nref 40118')).toEqual({
      title: 'Call the pharmacy',
      notes: 'ask about the repeat\nref 40118',
    });
  });

  it('leaves a one-line capture as just a title', () => {
    expect(splitCapture('  Book the eye test  ')).toEqual({ title: 'Book the eye test', notes: '' });
  });

  it('drops blank lines between the two rather than keeping them as notes', () => {
    expect(splitCapture('Title\n\n\nThe rest')).toEqual({ title: 'Title', notes: 'The rest' });
  });
});

describe('backlog sort labels', () => {
  it('are short enough to sit on one row', () => {
    expect(SORTS.map((s) => s.label)).toEqual(['Priority', 'Oldest', 'Newest', 'A–Z']);
  });
});

describe('what a toast says after something moves', () => {
  it('says which tab a saved task went to', () => {
    expect(savedTaskWhere({ date: today })).toBe('Saved to Tasks.');
    expect(savedTaskWhere({})).toBe('Saved to Backlog.');
  });

  it('says where a moved task is now', () => {
    expect(movedMessage(today, today)).toBe('On Today now.');
    expect(movedMessage(undefined, today)).toBe('Moved to Backlog.');
    expect(movedMessage('2026-09-24', today)).toBe('Moved to Tomorrow.');
    expect(movedManyMessage(1)).toBe('Moved 1 to Backlog.');
    expect(movedManyMessage(4)).toBe('Moved 4 to Backlog.');
  });

  it('says when a repeat comes round again, instead of just "done"', () => {
    expect(doneMessage({ doneAt: 5, date: today }, today)).toBe('Done.');
    expect(doneMessage({ date: '2026-09-24' }, today)).toBe('Done. Next: Tomorrow.');
  });

  it('names what was cancelled', () => {
    expect(cancelledMessage('Netflix')).toBe('Netflix marked cancelled.');
    expect(cancelledMessage('  ')).toBe('That subscription marked cancelled.');
  });
});

describe('undo only puts back what is still as the change left it', () => {
  it('restores a change nobody has touched since', () => {
    expect(canRestore({ id: 'a', updatedAt: 5 }, { id: 'a', updatedAt: 5 })).toBe(true);
  });

  it('leaves a record alone once it has been edited again', () => {
    expect(canRestore({ id: 'a', updatedAt: 9 }, { id: 'a', updatedAt: 5 })).toBe(false);
  });

  it('restores a delete only while it is still deleted', () => {
    expect(canRestore(undefined, undefined)).toBe(true);
    expect(canRestore({ id: 'a', updatedAt: 1 }, undefined)).toBe(false);
  });

  it('does not bring back something deleted after the change', () => {
    expect(canRestore(undefined, { id: 'a', updatedAt: 5 })).toBe(false);
  });

  it('says plainly which of the two happened', () => {
    expect(undoneMessage('restored')).toBe('Put back as it was.');
    expect(undoneMessage('changed')).toMatch(/changed since/);
  });
});
