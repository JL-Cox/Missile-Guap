import { describe, expect, it } from 'vitest';
import { isDueReminder, reminderText } from '../src/lib/notify';
import { clockLabel } from '../src/lib/time';
import type { Task } from '../src/types';

function task(partial: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Ring the dentist',
    notes: 'Card ending 4417. Ask about the referral from Dr Hall.',
    steps: [],
    tags: [],
    date: '2026-09-23',
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

const nineAm = new Date(2026, 8, 23, 9, 0).getTime();

describe('clockLabel', () => {
  it('reads as a US 12-hour clock', () => {
    expect(clockLabel(nineAm)).toBe('9:00 AM');
    expect(clockLabel(new Date(2026, 8, 23, 14, 5).getTime())).toBe('2:05 PM');
  });

  it('gets noon and midnight right, which a bare modulo does not', () => {
    expect(clockLabel(new Date(2026, 8, 23, 12, 0).getTime())).toBe('12:00 PM');
    expect(clockLabel(new Date(2026, 8, 23, 0, 30).getTime())).toBe('12:30 AM');
  });
});

describe('reminderText', () => {
  // A notification can be read off a locked phone or a watch by whoever is
  // nearby. Notes are where people put card numbers and what the doctor said.
  it('by default shows the title and the time, and never the notes', () => {
    const shown = reminderText(task({ remindAt: nineAm }), 'titleTime');
    expect(shown).toEqual({ title: 'Ring the dentist', body: 'Reminder for 9:00 AM' });
    expect(JSON.stringify(shown)).not.toContain('4417');
  });

  it('can say nothing about the task at all', () => {
    const shown = reminderText(task({ remindAt: nineAm }), 'generic');
    expect(shown).toEqual({ title: 'Steady', body: 'You have a reminder' });
  });

  it('shows the notes only when asked to', () => {
    expect(reminderText(task({ remindAt: nineAm }), 'titleNotes').body).toContain('4417');
  });

  it('falls back to the time when there are no notes to show', () => {
    expect(reminderText(task({ remindAt: nineAm, notes: '  ' }), 'titleNotes').body).toBe('Reminder for 9:00 AM');
  });

  it('still has a title when the task somehow has none', () => {
    expect(reminderText(task({ remindAt: nineAm, title: '' }), 'titleTime').title).toBe('Reminder');
  });
});

describe('isDueReminder', () => {
  const at = nineAm + 60_000;

  it('is due once its time has come', () => {
    expect(isDueReminder(task({ remindAt: nineAm }), at)).toBe(true);
    expect(isDueReminder(task({ remindAt: at + 60_000 }), at)).toBe(false);
  });

  it('never fires twice, or for something finished', () => {
    expect(isDueReminder(task({ remindAt: nineAm, remindedAt: nineAm }), at)).toBe(false);
    expect(isDueReminder(task({ remindAt: nineAm, doneAt: nineAm }), at)).toBe(false);
  });

  // A reminder belongs to a day. An undated task carrying one is left over
  // from an editor that forgot to clear it when the date was taken off.
  it('ignores a leftover reminder on a task with no day', () => {
    expect(isDueReminder(task({ remindAt: nineAm, date: undefined }), at)).toBe(false);
  });
});
