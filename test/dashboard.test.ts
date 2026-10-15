import { describe, expect, it } from 'vitest';
import {
  backlogCard,
  homeGroups,
  inboxCard,
  moneyCard,
  debtCard,
  nextReminder,
  notesCard,
  tasksCard,
  todayCard,
  type HomeData,
} from '../src/lib/dashboard';
import { buildDebtPlan } from '../src/lib/payoff';
import { atTime } from '../src/lib/time';
import type { DebtPlan, Note, Subscription, Task } from '../src/types';

/**
 * Home is the first thing the app shows, so a wrong number there is the most
 * seen wrong number in the app. These hold its cards to what the pages they
 * open say, and to the app's voice: nothing late, nothing counted against
 * anyone, no amount while amounts are blurred.
 */

const TODAY = '2026-10-15';
const NOW = atTime(TODAY, '08:00');
const PLAN: DebtPlan = { id: 'plan', strategy: 'avalanche', createdAt: 0, updatedAt: 0 };

let clock = 1_000;
function task(partial: Partial<Task> = {}): Task {
  const ts = (clock += 1_000);
  return { id: `t${ts}`, title: 'Something', notes: '', steps: [], tags: [], createdAt: ts, updatedAt: ts, ...partial };
}

function note(partial: Partial<Note> = {}): Note {
  const ts = (clock += 1_000);
  return { id: `n${ts}`, title: 'A note', body: '', tags: [], pinned: false, createdAt: ts, updatedAt: ts, ...partial };
}

function sub(partial: Partial<Subscription> = {}): Subscription {
  const ts = (clock += 1_000);
  return {
    id: `s${ts}`,
    name: 'Netflix',
    amountMinor: 1_549,
    currency: 'USD',
    cycle: 'monthly',
    every: 1,
    firstBilled: '2026-01-20',
    notes: '',
    cancelHow: '',
    remindDaysBefore: 3,
    createdAt: ts,
    updatedAt: ts,
    ...partial,
  };
}

function data(partial: Partial<HomeData> = {}): HomeData {
  const subs = partial.subs ?? [];
  return {
    today: TODAY,
    now: NOW,
    tasks: [],
    inboxCount: 0,
    notes: [],
    subs,
    incomes: [],
    debtView: buildDebtPlan({ debts: [], plan: PLAN, incomes: [], subs, from: TODAY }),
    openDebts: 0,
    settings: { blurAmounts: false, currency: 'USD', lookaheadDays: 14 },
    ...partial,
  };
}

describe('Home', () => {
  it('has the same three groups in the same order, whatever is in them', () => {
    const groups = homeGroups(data());
    expect(groups.map((g) => g.title)).toEqual(['Today', 'Lists', 'Money']);
    expect(groups.map((g) => g.cards.map((c) => c.id).join(' '))).toEqual([
      'today inbox tasks',
      'backlog notes',
      'money debt',
    ]);
  });

  it('names every card after the page it opens', () => {
    for (const card of homeGroups(data()).flatMap((g) => g.cards)) {
      expect(card.title.toLowerCase()).toBe(card.id);
    }
  });
});

describe('the Today card', () => {
  it('lists the day in the order it runs, timed things first', () => {
    const card = todayCard(
      data({
        tasks: [
          task({ title: 'Water the plants', date: TODAY }),
          task({ title: 'Pick up the prescription', date: TODAY, startTime: '14:00' }),
          task({ title: 'Call the dentist', date: TODAY, startTime: '09:30' }),
        ],
      }),
    );
    expect(card.figure).toBe('3 things to do');
    expect(card.list).toEqual([
      { when: '9:30 AM', what: 'Call the dentist' },
      { when: '2:00 PM', what: 'Pick up the prescription' },
      { when: 'Any time', what: 'Water the plants' },
    ]);
    expect(card.wide).toBe(true);
  });

  it('says how many more there are past the first four', () => {
    const tasks = Array.from({ length: 6 }, (_, i) => task({ title: `Thing ${i}`, date: TODAY }));
    const card = todayCard(data({ tasks }));
    expect(card.list).toHaveLength(4);
    expect(card.lines).toContain('and 2 more');
  });

  it('says plainly when nothing is planned, with no figure', () => {
    const card = todayCard(data());
    expect(card.figure).toBeUndefined();
    expect(card.lines).toContain('Nothing planned for today');
  });

  it('on a low day, keeps only what a low day keeps, and leaves money out', () => {
    const card = todayCard(
      data({
        settings: { blurAmounts: false, currency: 'USD', lookaheadDays: 14, lowDay: TODAY },
        tasks: [
          task({ title: 'Call the dentist', date: TODAY, startTime: '09:30' }),
          task({ title: 'Sort the recycling', date: TODAY }),
        ],
        subs: [sub({ firstBilled: '2026-01-15' })],
      }),
    );
    expect(card.list?.map((r) => r.what)).toEqual(['Call the dentist']);
    expect(card.lines?.[0]).toMatch(/^A low day/);
  });

  it('carries the next reminder, never one already past or on a finished task', () => {
    const past = task({ title: 'Earlier', remindAt: NOW - 60_000 });
    const done = task({ title: 'Finished', remindAt: NOW + 60_000, doneAt: NOW - 1 });
    const next = task({ title: 'Take the tablets', remindAt: atTime(TODAY, '13:00') });
    const later = task({ title: 'Later', remindAt: atTime(TODAY, '18:00') });
    expect(nextReminder([later, past, done, next], NOW)?.title).toBe('Take the tablets');
    const lines = todayCard(data({ tasks: [later, next] })).lines ?? [];
    expect(lines.some((l) => l.startsWith('Next reminder: Take the tablets'))).toBe(true);
  });
});

describe('the list cards', () => {
  it('Inbox counts what is still to sort', () => {
    expect(inboxCard(data({ inboxCount: 3 }))).toMatchObject({ figure: '3', lines: ['to sort'] });
    expect(inboxCard(data())).toMatchObject({ figure: '0', lines: ['Nothing to sort'] });
  });

  it('Tasks counts the coming week, and calls earlier ones "still here", never late', () => {
    const card = tasksCard(
      data({
        tasks: [
          task({ title: 'Tomorrow thing', date: '2026-10-16' }),
          task({ title: 'Six days out', date: '2026-10-21' }),
          task({ title: 'A week out', date: '2026-10-22' }),
          task({ title: 'From Monday', date: '2026-10-12' }),
          task({ title: 'Finished', date: '2026-10-16', doneAt: 1 }),
        ],
      }),
    );
    expect(card.figure).toBe('2');
    expect(card.lines).toContain('Next: Tomorrow thing, Tomorrow');
    expect(card.lines).toContain('1 task from earlier still here');
    expect(card.lines?.join(' ')).not.toMatch(/late|overdue/i);
  });

  it('Backlog counts what has no date, leaves routines out, and names the top one by priority', () => {
    const card = backlogCard(
      data({
        tasks: [
          task({ title: 'Order the ink' }),
          task({ title: 'Renew the permit', priority: 'critical' }),
          task({ title: 'Leaving the house', routine: true }),
          task({ title: 'Has a day', date: TODAY }),
        ],
      }),
    );
    expect(card.figure).toBe('2');
    expect(card.lines).toEqual(['to get to', 'Top: Renew the permit']);
  });

  it('Notes counts every note, and says what is kept at the top', () => {
    expect(notesCard(data({ notes: [note({ title: 'Boiler code', pinned: true }), note()] })).lines).toEqual([
      'notes',
      'At the top: Boiler code',
    ]);
    expect(notesCard(data({ notes: [note({ pinned: true }), note({ pinned: true })] })).lines).toContain(
      '2 kept at the top',
    );
    expect(notesCard(data()).lines).toEqual(['Nothing written down yet']);
  });
});

describe('the money cards', () => {
  it('Money asks for a subscription before it has anything to add up', () => {
    const card = moneyCard(data());
    expect(card.figure).toBeUndefined();
    expect(card.lines?.[0]).toMatch(/Add a subscription/);
  });

  it('Money shows what is still to come out this month, and the next thing to go', () => {
    const card = moneyCard(data({ subs: [sub({ name: 'Netflix', firstBilled: '2026-01-20' })] }));
    expect(card.figure).toBe('$15.49');
    expect(card.lines?.[0]).toBe('still to come out this month');
    expect(card.lines).toContain('Next: Netflix, Tuesday, in 5 days');
  });

  it('leaves every amount out while amounts are blurred, and says what it would be', () => {
    const blurred = { blurAmounts: true, currency: 'USD', lookaheadDays: 14 };
    const card = moneyCard(data({ subs: [sub()], settings: blurred }));
    expect(card.figure).toBeUndefined();
    expect(card.lines?.[0]).toBe('What is still to come out this month');
    expect(JSON.stringify(card)).not.toMatch(/\$/);
  });

  it('Debt asks for a debt before there is one', () => {
    expect(debtCard(data()).lines).toEqual(['Add a debt to see a plan for paying it off']);
  });
});
