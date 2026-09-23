import { describe, expect, it } from 'vitest';
import {
  describeLastDone,
  reminderAt,
  reminderOffset,
  rolledForward,
  withAnchor,
  withReminder,
} from '../src/lib/tasks';
import { nextOccurrence } from '../src/lib/recurrence';
import { atTime } from '../src/lib/time';
import type { Task } from '../src/types';

function task(partial: Partial<Task> = {}): Task {
  return { id: 't1', title: 'Take meds', notes: '', steps: [], tags: [], createdAt: 0, updatedAt: 0, ...partial };
}

describe('reminderAt', () => {
  it('counts back from the time on the day', () => {
    expect(reminderAt('2026-09-23', '09:30', 30)).toBe(atTime('2026-09-23', '09:00'));
    expect(reminderAt('2026-09-23', '09:30', 0)).toBe(atTime('2026-09-23', '09:30'));
  });

  it('counts from 9 in the morning when there is no time', () => {
    expect(reminderAt('2026-09-23', undefined, 60)).toBe(atTime('2026-09-23', '08:00'));
  });

  it('has nothing to count from without a day, and nothing to do without an offset', () => {
    expect(reminderAt(undefined, '09:30', 30)).toBeUndefined();
    expect(reminderAt('2026-09-23', '09:30', null)).toBeUndefined();
  });
});

describe('reminderOffset', () => {
  it('reads the chosen offset back off a saved task', () => {
    const t = task({ date: '2026-09-23', startTime: '09:30', remindAt: atTime('2026-09-23', '09:00') });
    expect(reminderOffset(t)).toBe(30);
  });

  it('is null when there is no reminder, or no day to hang it on', () => {
    expect(reminderOffset(task({ date: '2026-09-23' }))).toBeNull();
    expect(reminderOffset(task({ remindAt: 1 }))).toBeNull();
  });
});

/*
  The editor used to work out the reminder once, at the moment you tapped
  "30 min before". Change the time afterwards and the reminder stayed on the
  old moment; take the date off and an undated task still went off. The
  reminder is now an offset kept from the day and time, worked out again
  whenever either of them changes.
*/
describe('withReminder', () => {
  const saved = task({
    date: '2026-09-23',
    startTime: '09:30',
    remindAt: atTime('2026-09-23', '09:00'),
    remindedAt: atTime('2026-09-23', '09:00'),
  });

  it('follows the time when the time moves', () => {
    const next = withReminder({ ...saved, startTime: '14:00' }, 30, saved);
    expect(next.remindAt).toBe(atTime('2026-09-23', '13:30'));
  });

  it('follows the day when the day moves', () => {
    const next = withReminder({ ...saved, date: '2026-09-25' }, 30, saved);
    expect(next.remindAt).toBe(atTime('2026-09-25', '09:00'));
  });

  it('goes when the date is taken off, so an undated task never goes off', () => {
    const next = withReminder({ ...saved, date: undefined, startTime: undefined }, 30, saved);
    expect(next.remindAt).toBeUndefined();
    expect(next.remindedAt).toBeUndefined();
  });

  it('can fire again once it has moved, even if the old moment already fired', () => {
    expect(withReminder({ ...saved, startTime: '14:00' }, 30, saved).remindedAt).toBeUndefined();
  });

  it('does not fire twice for a reminder that has not moved', () => {
    expect(withReminder({ ...saved, title: 'Renamed' }, 30, saved).remindedAt).toBe(saved.remindedAt);
  });

  it('turns off cleanly', () => {
    expect(withReminder(saved, null, saved).remindAt).toBeUndefined();
  });
});

describe('nextOccurrence keeps a month-end repeat on its day', () => {
  const monthly31 = { kind: 'monthly' as const, every: 1, anchorDay: 31 };

  it('comes back to the 31st after a short month rather than drifting to the 28th', () => {
    expect(nextOccurrence(monthly31, '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrence(monthly31, '2026-02-28')).toBe('2026-03-31');
    expect(nextOccurrence(monthly31, '2026-03-31')).toBe('2026-04-30');
    expect(nextOccurrence(monthly31, '2026-04-30')).toBe('2026-05-31');
  });

  it('keeps a 29 February birthday on the 29th when there is one', () => {
    const yearly29 = { kind: 'yearly' as const, every: 1, anchorDay: 29 };
    expect(nextOccurrence(yearly29, '2028-02-29')).toBe('2029-02-28');
    expect(nextOccurrence(yearly29, '2031-02-28')).toBe('2032-02-29');
  });

  it('leaves a repeat saved before the anchor existed working as it did', () => {
    expect(nextOccurrence({ kind: 'monthly', every: 1 }, '2026-02-28')).toBe('2026-03-28');
  });
});

describe('withAnchor', () => {
  const monthly = { kind: 'monthly' as const, every: 1 };

  it('takes the anchor from the day a monthly repeat is saved on', () => {
    expect(withAnchor(task({ date: '2026-01-31', recurrence: monthly })).recurrence?.anchorDay).toBe(31);
  });

  it('keeps the anchor when a rolled-forward task is saved without touching the day', () => {
    const rolled = task({ date: '2026-02-28', recurrence: { ...monthly, anchorDay: 31 } });
    expect(withAnchor({ ...rolled, title: 'Pay rent' }, rolled).recurrence?.anchorDay).toBe(31);
  });

  it('moves the anchor when you choose a different day', () => {
    const rolled = task({ date: '2026-02-28', recurrence: { ...monthly, anchorDay: 31 } });
    expect(withAnchor({ ...rolled, date: '2026-03-15' }, rolled).recurrence?.anchorDay).toBe(15);
  });

  it('drops it for repeats that have no day of the month', () => {
    const was = task({ date: '2026-01-31', recurrence: { ...monthly, anchorDay: 31 } });
    const weekly = withAnchor({ ...was, recurrence: { kind: 'weekly', every: 1, anchorDay: 31 } }, was);
    expect(weekly.recurrence?.anchorDay).toBeUndefined();
  });
});

describe('rolledForward', () => {
  // Wednesday 23 September 2026, just after ten in the morning.
  const at = new Date(2026, 8, 23, 10, 5).getTime();
  const daily = { kind: 'daily' as const, every: 1 };

  it('catches a daily task up in one tick instead of one tick per missed day', () => {
    const behind = task({ date: '2026-09-20', recurrence: daily });
    expect(rolledForward(behind, at).date).toBe('2026-09-24');
  });

  it('moves the reminder by the same number of days', () => {
    const behind = task({
      date: '2026-09-20',
      startTime: '09:00',
      recurrence: daily,
      remindAt: atTime('2026-09-20', '08:50'),
      remindedAt: atTime('2026-09-20', '08:50'),
    });
    const next = rolledForward(behind, at);
    expect(next.remindAt).toBe(atTime('2026-09-24', '08:50'));
    expect(next.remindedAt).toBeUndefined();
  });

  it('does not count a reminder already behind you as missed', () => {
    // "1 day before" a task tomorrow at 9 was due this morning at 9 - before
    // the tick. It has not been missed; you have just done the thing.
    const t = task({
      date: '2026-09-22',
      startTime: '09:00',
      recurrence: daily,
      remindAt: atTime('2026-09-21', '09:00'),
    });
    const next = rolledForward(t, at);
    expect(next.date).toBe('2026-09-24');
    expect(next.remindAt).toBe(atTime('2026-09-23', '09:00'));
    expect(next.remindedAt).toBe(at);
  });

  it('keeps a weekly schedule on its own days while catching up', () => {
    // Mon and Thu, last planned for Monday the 7th. The next one after today
    // (Wednesday the 23rd) is Thursday the 24th.
    const t = task({ date: '2026-09-07', recurrence: { kind: 'weekly', every: 1, weekdays: [1, 4] } });
    expect(rolledForward(t, at).date).toBe('2026-09-24');
  });

  it('rolls to the next one when ticked early', () => {
    const t = task({ date: '2026-09-25', recurrence: daily });
    expect(rolledForward(t, at).date).toBe('2026-09-26');
  });

  it('holds a month-end repeat on the 31st through February', () => {
    const jan = task({ date: '2026-01-31', recurrence: { kind: 'monthly', every: 1, anchorDay: 31 } });
    const feb = rolledForward(jan, new Date(2026, 0, 31, 9).getTime());
    expect(feb.date).toBe('2026-02-28');
    expect(rolledForward(feb, new Date(2026, 1, 28, 9).getTime()).date).toBe('2026-03-31');
  });

  it('gives an older repeat an anchor from its day, so it stops drifting from here on', () => {
    const t = task({ date: '2026-01-31', recurrence: { kind: 'monthly', every: 1 } });
    const next = rolledForward(t, new Date(2026, 0, 31, 9).getTime());
    expect(next.recurrence?.anchorDay).toBe(31);
  });

  it('records when it was last ticked, and resets the steps', () => {
    const t = task({ date: '2026-09-23', recurrence: daily, steps: [{ id: 's', text: 'Pill box', done: true }] });
    const next = rolledForward(t, at);
    expect(next.lastDoneAt).toBe(at);
    expect(next.steps[0].done).toBe(false);
    expect(next.doneAt).toBeUndefined();
  });

  it('simply finishes a task that does not repeat', () => {
    const next = rolledForward(task({ date: '2026-09-23' }), at);
    expect(next.doneAt).toBe(at);
    expect(next.date).toBe('2026-09-23');
  });

  it('simply finishes a repeat with no day to roll from', () => {
    expect(rolledForward(task({ recurrence: daily }), at).doneAt).toBe(at);
  });
});

describe('describeLastDone', () => {
  const now = new Date(2026, 8, 23, 18, 0).getTime(); // Wednesday evening

  it('gives the time for today', () => {
    expect(describeLastDone(new Date(2026, 8, 23, 8, 2).getTime(), now)).toBe('Last ticked today, 8:02 AM');
  });

  it('says yesterday for yesterday', () => {
    expect(describeLastDone(new Date(2026, 8, 22, 21, 0).getTime(), now)).toBe('Last ticked yesterday');
  });

  it('names the weekday within the week', () => {
    expect(describeLastDone(new Date(2026, 8, 22 - 1, 9, 0).getTime(), now)).toBe('Last ticked Mon');
    expect(describeLastDone(new Date(2026, 8, 17, 9, 0).getTime(), now)).toBe('Last ticked Thu');
  });

  it('gives the date when it was longer ago', () => {
    expect(describeLastDone(new Date(2026, 8, 3, 9, 0).getTime(), now)).toBe('Last ticked Sep 3');
  });
});
