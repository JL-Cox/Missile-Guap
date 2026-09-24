import { describe, expect, it } from 'vitest';
import { agendaFor, finishedWithoutDate, unscheduled, upcomingBills, upcomingPayments } from '../src/lib/agenda';
import type { ScheduledPayment } from '../src/lib/payoff';
import type { Debt, Subscription, Task } from '../src/types';

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

describe('a subscription cancelled today', () => {
  const cancelledToday: Subscription = {
    id: 's1', name: 'Gym', amountMinor: 3_000, currency: 'USD', cycle: 'monthly', every: 1,
    firstBilled: '2026-01-23', notes: '', cancelHow: '', remindDaysBefore: 3, createdAt: 0, updatedAt: 0,
    endedOn: '2026-09-23',
  };

  it('still shows its charge on Today, the same as the next-charge line does', () => {
    expect(agendaFor('2026-09-23', [], [cancelledToday]).map((i) => i.title)).toEqual(['Gym renews']);
    expect(upcomingBills([cancelledToday], 14, '2026-09-23').map((b) => b.date)).toEqual(['2026-09-23']);
  });

  it('has nothing after that', () => {
    expect(agendaFor('2026-10-23', [], [cancelledToday])).toEqual([]);
    expect(upcomingBills([cancelledToday], 60, '2026-09-24')).toEqual([]);
  });
});

/*
  Debt payments sit on Today beside subscription charges, as their own kind:
  "Card A payment", never "renews" and never "charged". They come from the
  plan's dated payments and are only added when passed, so a day without any
  is exactly what it was.
*/
describe('debt payments on a day', () => {
  const card: Debt = {
    id: 'd1', name: 'Card A', kind: 'creditCard', balanceMinor: 200_000, balanceAsOf: '2026-09-24',
    minimum: { kind: 'fixed', amountMinor: 6_300 }, dueDay: 5, autopay: true, currency: 'USD', notes: '',
    createdAt: 0, updatedAt: 0,
  };
  const loan: Debt = { ...card, id: 'd2', name: 'Loan', dueDay: 16, autopay: false };
  const payments: ScheduledPayment[] = [
    { debt: card, dueOn: '2026-10-05', amountMinor: 6_300, autopay: true },
    { debt: loan, dueOn: '2026-10-16', amountMinor: 18_000, autopay: false },
    { debt: card, dueOn: '2026-11-05', amountMinor: 5_700, autopay: true },
  ];

  it('lists a payment on its due date, named as a payment', () => {
    const items = agendaFor('2026-10-05', [], [], payments);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'payment', title: 'Card A payment', amountMinor: 6_300, timed: false });
    expect(items[0].debt?.id).toBe('d1');
  });

  it('adds nothing on other days, or when no payments are passed', () => {
    expect(agendaFor('2026-10-06', [], [], payments)).toEqual([]);
    expect(agendaFor('2026-10-05', [], [])).toEqual([]);
  });

  it('lists the payments coming up, soonest first', () => {
    expect(upcomingPayments(payments, 14, '2026-10-03').map((p) => [p.debt.name, p.date, p.amountMinor, p.inDays])).toEqual([
      ['Card A', '2026-10-05', 6_300, 2],
      ['Loan', '2026-10-16', 18_000, 13],
    ]);
    expect(upcomingPayments(payments, 1, '2026-10-17')).toEqual([]);
    expect(upcomingPayments(payments, 0, '2026-10-05').map((p) => p.inDays)).toEqual([0]);
  });
});
