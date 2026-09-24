import { describe, expect, it } from 'vitest';
import {
  buildCalendar,
  calendarContents,
  calendarForDebt,
  calendarForIncome,
  calendarForSubscription,
  calendarForTask,
  DEBT_CALENDAR_ENTRY_STAYS,
  DEBT_CALENDAR_FILENAME,
  DEBT_REMIND_DAYS,
  icsFilename,
} from '../src/lib/ics';
import type { Debt, IncomeSource, Subscription, Task } from '../src/types';

function task(partial: Partial<Task> = {}): Task {
  return { id: 't1', title: 'Ring the dentist', notes: '', steps: [], tags: [], createdAt: 0, updatedAt: 0, ...partial };
}

function sub(partial: Partial<Subscription> = {}): Subscription {
  return {
    id: 's1', name: 'Netflix', amountMinor: 1299, currency: 'GBP', cycle: 'monthly', every: 1,
    firstBilled: '2026-01-15', notes: '', cancelHow: '', remindDaysBefore: 3, createdAt: 0, updatedAt: 0, ...partial,
  };
}

const build = (tasks: Task[], subscriptions: Subscription[] = [], includeNotes = false) =>
  buildCalendar({ tasks, subscriptions, formatAmount: () => '£12.99', now: Date.UTC(2026, 8, 15, 10, 0, 0), includeNotes });

describe('calendar structure', () => {
  it('produces a well-formed calendar with CRLF line endings', () => {
    const ics = build([task({ date: '2026-09-20' })]);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics.split('\r\n').length).toBeGreaterThan(5);
  });

  it('skips tasks with no date, since they are not calendar events', () => {
    expect(build([task()])).not.toContain('BEGIN:VEVENT');
  });

  it('skips finished one-off tasks but keeps repeating ones', () => {
    expect(build([task({ date: '2026-09-20', doneAt: 1 })])).not.toContain('BEGIN:VEVENT');
    expect(build([task({ date: '2026-09-20', doneAt: 1, recurrence: { kind: 'weekly', every: 1 } })])).toContain('BEGIN:VEVENT');
  });
});

describe('all-day events land on the right day', () => {
  it('writes the date as given, with no timezone shift', () => {
    // The classic bug: a UTC conversion pushing the event to the previous day.
    const ics = build([task({ date: '2026-09-20' })]);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260920');
  });
});

describe('timed events', () => {
  it('writes a start, an end and an alarm', () => {
    const ics = build([task({ date: '2026-09-20', startTime: '14:30', durationMin: 45 })]);
    expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect(ics).toMatch(/DTEND:\d{8}T\d{6}Z/);
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics).toContain('TRIGGER:-PT10M');
  });

  it('turns an explicit reminder time into the right offset', () => {
    const start = new Date(2026, 8, 20, 14, 30).getTime();
    const ics = build([task({ date: '2026-09-20', startTime: '14:30', remindAt: start - 30 * 60_000 })]);
    expect(ics).toContain('TRIGGER:-PT30M');
  });
});

describe('repeating tasks become RRULEs', () => {
  it('maps each kind', () => {
    expect(build([task({ date: '2026-09-20', recurrence: { kind: 'daily', every: 2 } })])).toContain('RRULE:FREQ=DAILY;INTERVAL=2');
    expect(build([task({ date: '2026-09-20', recurrence: { kind: 'monthly', every: 1 } })])).toContain('RRULE:FREQ=MONTHLY;INTERVAL=1');
    expect(build([task({ date: '2026-09-20', recurrence: { kind: 'weekly', every: 1, weekdays: [1, 3, 5] } })])).toContain('BYDAY=MO,WE,FR');
  });
});

describe('subscriptions become repeating all-day events', () => {
  it('starts at the next charge and repeats on the billing cycle', () => {
    const ics = build([], [sub()]);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260915'); // billed on the 15th, and today is the 15th
    expect(ics).toContain('RRULE:FREQ=MONTHLY;INTERVAL=1');
    expect(ics).toContain('SUMMARY:Netflix - £12.99');
  });

  it('converts quarterly and yearly into months', () => {
    expect(build([], [sub({ cycle: 'quarterly' })])).toContain('RRULE:FREQ=MONTHLY;INTERVAL=3');
    expect(build([], [sub({ cycle: 'yearly' })])).toContain('RRULE:FREQ=MONTHLY;INTERVAL=12');
  });

  it('turns the warning into a lead-time alarm', () => {
    expect(build([], [sub({ remindDaysBefore: 3 })])).toContain('TRIGGER:-PT4320M');
    expect(build([], [sub({ remindDaysBefore: 0 })])).not.toContain('BEGIN:VALARM');
  });

  it('carries the cancellation steps into the description when you turn notes on', () => {
    const ics = build([], [sub({ cancelHow: 'Account > Membership > Cancel' })], true);
    expect(ics.replace(/\r\n /g, '')).toContain('To cancel: Account > Membership > Cancel');
  });

  it('leaves cancelled subscriptions out', () => {
    expect(build([], [sub({ endedOn: '2026-05-01' })])).not.toContain('BEGIN:VEVENT');
  });
});

describe('escaping and folding', () => {
  it('escapes the characters that would otherwise break the file', () => {
    const ics = build([task({ date: '2026-09-20', title: 'Buy milk, bread; and eggs' })]);
    // RFC 5545 escapes both commas and semicolons with a backslash. The old
    // test wrote '\\;' as '\;', which JavaScript reads as a bare ';' - so it
    // asserted the bug.
    expect(ics).toContain('SUMMARY:Buy milk\\, bread\\; and eggs');
  });

  it('turns newlines into the literal escape rather than a raw break', () => {
    const ics = build([task({ date: '2026-09-20', notes: 'line one\nline two' })], [], true);
    expect(ics).toContain('\\nline two');
  });

  it('folds long lines to 75 octets and no more', () => {
    const ics = build([task({ date: '2026-09-20', title: 'x'.repeat(300) })]);
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it('a folded line still rebuilds into the original text', () => {
    const long = 'y'.repeat(200);
    const ics = build([task({ date: '2026-09-20', title: long })]);
    expect(ics.replace(/\r\n /g, '')).toContain(`SUMMARY:${long}`);
  });
});

describe('a calendar for one subscription', () => {
  const at = Date.UTC(2026, 8, 15, 10, 0, 0);

  it('contains exactly that subscription and nothing else', () => {
    const ics = calendarForSubscription(sub(), '£12.99', at)!;
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('SUMMARY:Netflix - £12.99');
    expect(ics).toContain('RRULE:FREQ=MONTHLY;INTERVAL=1');
  });

  it('names the calendar after the subscription, so the import is recognisable', () => {
    expect(calendarForSubscription(sub({ name: 'Spotify' }), '£11.99', at)).toContain('X-WR-CALNAME:Spotify');
  });

  it('escapes a name that would otherwise break the calendar name line', () => {
    const ics = calendarForSubscription(sub({ name: 'Gym, the one on Bridge St' }), '£30.00', at)!;
    expect(ics).toContain('X-WR-CALNAME:Gym\\, the one on Bridge St');
  });

  it('keeps the same UID as the full export, so re-adding updates rather than duplicates', () => {
    const single = calendarForSubscription(sub(), '£12.99', at)!;
    const full = build([], [sub()]);
    const uid = /UID:(.+)/.exec(single)![1];
    expect(full).toContain(`UID:${uid}`);
  });

  it('returns null for a cancelled subscription rather than an empty calendar', () => {
    expect(calendarForSubscription(sub({ endedOn: '2026-05-01' }), '£12.99', at)).toBeNull();
  });
});

describe('a calendar for one task', () => {
  it('contains just that task', () => {
    const ics = calendarForTask(task({ date: '2026-09-20', title: 'Ring the dentist' }))!;
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('X-WR-CALNAME:Ring the dentist');
  });

  it('returns null for a task with no date', () => {
    expect(calendarForTask(task())).toBeNull();
  });
});

describe('icsFilename', () => {
  it('makes a name a phone will not choke on', () => {
    expect(icsFilename('Netflix')).toBe('netflix.ics');
    expect(icsFilename('Gym, the one on Bridge St')).toBe('gym-the-one-on-bridge-st.ics');
    expect(icsFilename('  Sky  ')).toBe('sky.ics');
  });

  it('never produces a nameless file', () => {
    expect(icsFilename('!!!')).toBe('steady.ics');
    expect(icsFilename('')).toBe('steady.ics');
  });

  it('keeps the name short enough to be usable', () => {
    expect(icsFilename('a'.repeat(200)).length).toBeLessThanOrEqual(44);
  });
});


describe('every-2-weeks subscriptions in the calendar', () => {
  it('repeats fortnightly, not weekly', () => {
    const ics = build([], [sub({ cycle: 'weekly', every: 2 })]);
    expect(ics).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2');
  });
});


describe('twice-a-month subscriptions in the calendar', () => {
  const twice = (days: number[]) =>
    sub({ cycle: 'semimonthly', every: 1, daysOfMonth: days, firstBilled: '2026-01-01' });

  it('repeats on the dates themselves, not on an interval', () => {
    // FREQ=MONTHLY;INTERVAL=1 from a single start date would give 12 charges a
    // year in the phone's calendar where the app says 24.
    expect(build([], [twice([1, 15])])).toContain('RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15');
  });

  it('writes the last day as -1, since a calendar has no clamping', () => {
    // BYMONTHDAY=31 simply produces nothing in the months without a 31st.
    const ics = build([], [twice([15, 31])]);
    expect(ics).toContain('RRULE:FREQ=MONTHLY;BYMONTHDAY=15,-1');
    expect(ics).not.toContain('BYMONTHDAY=15,31');
  });

  it('starts on the next charge rather than on the start date', () => {
    // Built on 15 September 2026, so the next one of the 1st and the 15th is
    // that same day.
    expect(build([], [twice([1, 15])])).toContain('DTSTART;VALUE=DATE:20260915');
  });

  it('names the dates even when none were recorded', () => {
    expect(build([], [sub({ cycle: 'semimonthly', every: 1 })])).toContain(
      'RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15',
    );
  });
});


describe('paydays in the calendar', () => {
  const at = Date.UTC(2026, 0, 5, 10, 0, 0);
  const job = (partial: Partial<IncomeSource> = {}): IncomeSource => ({
    id: 'i1', name: 'Main job', frequency: 'semimonthly', daysOfMonth: [15, 31],
    grossMinor: 250_000, netMinor: 185_000, deductions: [], currency: 'USD', notes: '',
    weekendShift: 'none', createdAt: 0, updatedAt: 0, ...partial,
  });
  const cal = (incomes: IncomeSource[]) =>
    buildCalendar({ tasks: [], subscriptions: [], incomes, formatAmount: () => '', formatPay: () => '$1,850.00', now: at });

  it('uses a recurrence rule when nothing shifts', () => {
    const ics = cal([job()]);
    expect(ics).toContain('RRULE:FREQ=MONTHLY;BYMONTHDAY=15,-1');
    expect(ics).not.toContain('RDATE');
  });

  it('writes explicit dates when paydays shift, because no rule can say it', () => {
    const ics = cal([job({ weekendShift: 'friday' })]);
    expect(ics).toContain('RDATE;VALUE=DATE:');
    expect(ics).not.toContain('RRULE');
  });

  it('puts no shifted payday on a weekend', () => {
    const ics = cal([job({ weekendShift: 'friday' })]).replace(/\r\n /g, '');
    const dates = /RDATE;VALUE=DATE:([\d,]+)/.exec(ics)![1].split(',');
    expect(dates.length).toBeGreaterThan(40); // two years of twice-monthly pay
    for (const d of dates) {
      const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
      expect([0, 6]).not.toContain(new Date(`${iso}T12:00:00`).getDay());
    }
  });

  it('leaves an ended job out', () => {
    expect(cal([job({ endedOn: '2025-12-01' })])).not.toContain('Main job');
  });
});


/*
  A calendar is often copied to a Google account, sometimes to a work one, and
  it is read on screens Steady does not control. Cancel steps can hold a login;
  notes hold whatever you put in them. So by default only the title, the date
  and the amount go in - the owner's decision - and the rest is opt-in.
*/
describe('what goes into a calendar entry', () => {
  const secret = 'password hunter2';
  const at = Date.UTC(2026, 8, 15, 10, 0, 0);
  const noisyTask = task({
    date: '2026-09-20',
    notes: `Portal ${secret}`,
    steps: [{ id: 's', text: `Log in with ${secret}`, done: false }],
  });
  const noisySub = sub({ notes: `Card ${secret}`, cancelHow: `Log in, ${secret}` });
  const noisyJob: IncomeSource = {
    id: 'i1', name: 'Main job', frequency: 'semimonthly', daysOfMonth: [15, 31],
    grossMinor: 250_000, netMinor: 185_000, deductions: [], currency: 'USD', notes: `HR ${secret}`,
    weekendShift: 'none', createdAt: 0, updatedAt: 0,
  };
  const everything = (includeNotes?: boolean) =>
    buildCalendar({
      tasks: [noisyTask],
      subscriptions: [noisySub],
      incomes: [noisyJob],
      formatAmount: () => '$12.99',
      formatPay: () => '$1,850.00',
      now: at,
      includeNotes,
    }).replace(/\r\n /g, '');

  it('leaves notes, steps and cancel steps out unless asked', () => {
    const ics = everything();
    expect(ics).not.toContain('hunter2');
    expect(ics).not.toContain('To cancel');
    expect(ics).not.toMatch(/^DESCRIPTION:(?!Ring|Netflix|Main)/m);
  });

  it('still carries the title, the date and the amount', () => {
    const ics = everything();
    expect(ics).toContain('SUMMARY:Ring the dentist');
    expect(ics).toContain('SUMMARY:Netflix - $12.99');
    expect(ics).toContain('SUMMARY:Main job - $1\\,850.00');
  });

  it('puts them in when you turn notes on', () => {
    const ics = everything(true);
    expect(ics).toContain('Portal password hunter2');
    expect(ics).toContain('To cancel: Log in\\, password hunter2');
    expect(ics).toContain('HR password hunter2');
  });

  it('holds to the same rule for the one-item buttons', () => {
    expect(calendarForTask(noisyTask, at)).not.toContain('hunter2');
    expect(calendarForSubscription(noisySub, '$12.99', at)).not.toContain('hunter2');
    expect(calendarForIncome(noisyJob, '$1,850.00', at)).not.toContain('hunter2');
    expect(calendarForTask(noisyTask, at, { includeNotes: true })).toContain('hunter2');
    expect(calendarForSubscription(noisySub, '$12.99', at, { includeNotes: true })).toContain('hunter2');
  });

  it('says in plain words what goes in, before anything leaves', () => {
    expect(calendarContents('subscription', false)).toBe(
      'Goes in: the name, the dates and the amount. Notes and how to cancel stay here unless you turn them on in Settings.',
    );
    expect(calendarContents('task', false)).toBe(
      'Goes in: the title, the day and the time. Notes and steps stay here unless you turn them on in Settings.',
    );
    expect(calendarContents('all', true)).toContain('notes');
  });
});


/*
  A calendar has no idea of "clamped to the end of the month". FREQ=MONTHLY
  from the 31st skips every month without one - February, April, June - and
  from the 30th it skips February and never lands on the 28th. Steady's own
  dates do clamp, so the calendar and the app disagreed on a third of the
  months. The 31st is exactly "the last day", which a rule can say
  (BYMONTHDAY=-1). The 29th and 30th have no such rule, so they are written
  out as two years of explicit dates, the way shifted paydays already are.
*/
describe('month-end days in the calendar', () => {
  const at = Date.UTC(2026, 0, 5, 10, 0, 0);
  const cal = (subs: Subscription[] = [], tasks: Task[] = [], incomes: IncomeSource[] = []) =>
    buildCalendar({ tasks, subscriptions: subs, incomes, formatAmount: () => '$9.99', formatPay: () => '$1', now: at }).replace(
      /\r\n /g,
      '',
    );
  const rdates = (ics: string) => (/RDATE[^:]*:([\dTZ,]+)/.exec(ics)?.[1] ?? '').split(',').filter(Boolean);

  it('says "the last day" for a subscription on the 31st, for every interval', () => {
    expect(cal([sub({ firstBilled: '2026-01-31' })])).toContain('RRULE:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1');
    expect(cal([sub({ firstBilled: '2026-01-31', cycle: 'quarterly' })])).toContain('RRULE:FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=-1');
    expect(cal([sub({ firstBilled: '2026-01-31', cycle: 'monthly', every: 6 })])).toContain(
      'RRULE:FREQ=MONTHLY;INTERVAL=6;BYMONTHDAY=-1',
    );
    expect(cal([sub({ firstBilled: '2026-01-31', cycle: 'yearly' })])).toContain('RRULE:FREQ=MONTHLY;INTERVAL=12;BYMONTHDAY=-1');
  });

  it('writes the real dates for a subscription on the 30th, February included', () => {
    const ics = cal([sub({ firstBilled: '2026-01-30' })]);
    expect(ics).not.toContain('RRULE');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260130');
    const dates = rdates(ics);
    expect(dates).toContain('20260228');
    expect(dates).toContain('20260330');
    expect(dates).not.toContain('20260331');
    expect(dates.length).toBeGreaterThanOrEqual(23); // two years, less the first
  });

  it('does the same for the 29th, landing on the 28th in February', () => {
    const dates = rdates(cal([sub({ firstBilled: '2026-01-29' })]));
    expect(dates).toContain('20260228');
    expect(dates).toContain('20260329');
  });

  it('leaves an ordinary day alone', () => {
    const ics = cal([sub({ firstBilled: '2026-01-15' })]);
    expect(ics).toContain('RRULE:FREQ=MONTHLY;INTERVAL=1\r\n');
    expect(ics).not.toContain('BYMONTHDAY');
  });

  it('treats a twice-a-month pair with the 30th the same way', () => {
    const ics = cal([sub({ cycle: 'semimonthly', daysOfMonth: [15, 30], firstBilled: '2026-01-01' })]);
    expect(ics).not.toContain('RRULE');
    expect(rdates(ics)).toContain('20260228');
  });

  it('holds a monthly task on the 31st to the last day', () => {
    const t = task({ date: '2026-01-31', recurrence: { kind: 'monthly', every: 1, anchorDay: 31 } });
    expect(cal([], [t])).toContain('RRULE:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1');
  });

  it('knows a rolled-forward task still belongs on the 31st', () => {
    const t = task({ date: '2026-02-28', recurrence: { kind: 'monthly', every: 1, anchorDay: 31 } });
    expect(cal([], [t])).toContain('BYMONTHDAY=-1');
  });

  it('writes out the dates of a monthly task on the 30th', () => {
    const t = task({ date: '2026-01-30', recurrence: { kind: 'monthly', every: 1, anchorDay: 30 } });
    const ics = cal([], [t]);
    expect(ics).not.toContain('RRULE');
    expect(rdates(ics)).toContain('20260228');
  });

  it('writes timed extra dates as times, at the same local time each day', () => {
    const t = task({ date: '2026-01-30', startTime: '09:00', recurrence: { kind: 'monthly', every: 1, anchorDay: 30 } });
    const ics = cal([], [t]);
    const feb = new Date(2026, 1, 28, 9, 0).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    expect(ics).toMatch(/RDATE:\d{8}T\d{6}Z/);
    expect(rdates(ics)).toContain(feb);
  });

  it('keeps a 29 February yearly task on the last day of February', () => {
    const t = task({ date: '2028-02-29', recurrence: { kind: 'yearly', every: 1, anchorDay: 29 } });
    expect(cal([], [t])).toContain('RRULE:FREQ=YEARLY;INTERVAL=1;BYMONTH=2;BYMONTHDAY=-1');
  });

  it('pays on the last day for a job paid on the 31st', () => {
    const job: IncomeSource = {
      id: 'i1', name: 'Main job', frequency: 'monthly', daysOfMonth: [31], grossMinor: 1, netMinor: 1,
      deductions: [], currency: 'USD', notes: '', weekendShift: 'none', createdAt: 0, updatedAt: 0,
    };
    expect(cal([], [], [job])).toContain('RRULE:FREQ=MONTHLY;BYMONTHDAY=-1');
    expect(cal([], [], [{ ...job, daysOfMonth: [30] }])).not.toContain('RRULE');
    // A monthly job holding two days is paid on the first of them, once.
    expect(cal([], [], [{ ...job, daysOfMonth: [15, 31] }])).toContain('RRULE:FREQ=MONTHLY;BYMONTHDAY=15\r\n');
  });
});

/*
  A debt goes into the calendar one at a time, only from its own button. A
  lender's or a hospital's name next to an amount says more than a streaming
  bill, so the file name, the share title and the calendar's name are all
  neutral, and notes stay out unless Settings says otherwise.
*/
describe('a debt in the calendar', () => {
  const at = Date.UTC(2026, 8, 24, 12, 0, 0);
  const loan = (partial: Partial<Debt> = {}): Debt => ({
    id: 'd1', name: 'Car loan', kind: 'autoLoan', balanceMinor: 1_000_000, balanceAsOf: '2026-09-24', aprPercent: 6.9,
    minimum: { kind: 'fixed', amountMinor: 39_509 }, dueDay: 10, autopay: false, currency: 'USD',
    notes: 'Account 1234 at the dealer', createdAt: 0, updatedAt: 0, ...partial,
  });
  const unfold = (ics: string) => ics.replace(/\r\n /g, '');

  it('is one repeating all-day entry from the next due date, with a reminder 3 days before', () => {
    const ics = calendarForDebt(loan(), '$395.09', at)!;
    expect(ics).toContain('UID:debt-d1@steady.local');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261010');
    expect(ics).toContain('RRULE:FREQ=MONTHLY\r\n');
    expect(ics).toContain('SUMMARY:Car loan payment - $395.09');
    expect(DEBT_REMIND_DAYS).toBe(3);
    expect(ics).toContain('TRIGGER:-PT4320M');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it('names the calendar "Steady" and the file neutrally, never after the lender', () => {
    const ics = calendarForDebt(loan(), '$395.09', at)!;
    expect(ics).toContain('X-WR-CALNAME:Steady');
    expect(DEBT_CALENDAR_FILENAME).toBe('payment-dates.ics');
  });

  it('keeps notes out unless they are switched on', () => {
    expect(calendarForDebt(loan(), '$395.09', at)).not.toContain('Account 1234');
    expect(unfold(calendarForDebt(loan(), '$395.09', at, { includeNotes: true })!)).toContain(
      'DESCRIPTION:Account 1234 at the dealer',
    );
  });

  it('leaves the amount out when it changes every month', () => {
    const card = loan({ name: 'Blue card', minimum: { kind: 'percentPlusInterest', percent: 1, floorMinor: 3_500 } });
    const ics = calendarForDebt(card, null, at)!;
    expect(ics).toContain('SUMMARY:Blue card payment due');
    expect(calendarForDebt(loan({ minimum: { kind: 'fixed', amountMinor: 0 } }), '$0.00', at)).toContain(
      'SUMMARY:Car loan payment due',
    );
  });

  it('starts after a payment marked paid', () => {
    expect(calendarForDebt(loan({ paidThrough: '2026-10-10' }), '$395.09', at)).toContain('DTSTART;VALUE=DATE:20261110');
  });

  it('stops after the last payment when the count is known: a set amount at 0%', () => {
    const family = loan({ name: 'Mom', aprPercent: 0, balanceMinor: 125_000, minimum: { kind: 'fixed', amountMinor: 10_000 }, dueDay: 1 });
    expect(calendarForDebt(family, '$100.00', at)).toContain('RRULE:FREQ=MONTHLY;COUNT=13');
  });

  it('keeps month-end due dates right: the last day, or dates written out for the 29th and 30th', () => {
    expect(calendarForDebt(loan({ dueDay: 31 }), '$395.09', at)).toContain('RRULE:FREQ=MONTHLY;BYMONTHDAY=-1');
    const thirtieth = unfold(calendarForDebt(loan({ dueDay: 30 }), '$395.09', at)!);
    expect(thirtieth).not.toContain('RRULE');
    expect(thirtieth).toContain('DTSTART;VALUE=DATE:20260930');
    expect(thirtieth).toContain('20270228');
    const family = loan({ name: 'Mom', aprPercent: 0, balanceMinor: 125_000, minimum: { kind: 'fixed', amountMinor: 10_000 }, dueDay: 30 });
    const dates = /RDATE;VALUE=DATE:([\d,]+)/.exec(unfold(calendarForDebt(family, '$100.00', at)!))![1].split(',');
    expect(dates).toHaveLength(12);
  });

  it('repeats every 2 weeks for a pay-in-4 plan', () => {
    const bnpl = loan({ kind: 'bnpl', cadence: 'every2weeks', dueDay: undefined, nextDueOn: '2026-10-01', aprPercent: 0, balanceMinor: 30_000, minimum: { kind: 'fixed', amountMinor: 10_000 } });
    const ics = calendarForDebt(bnpl, '$100.00', at)!;
    expect(ics).toContain('DTSTART;VALUE=DATE:20261001');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3');
  });

  it('has nothing to add for a debt that is paid off, at zero or has no due date', () => {
    expect(calendarForDebt(loan({ paidOffOn: '2026-09-01' }), '$395.09', at)).toBeNull();
    expect(calendarForDebt(loan({ balanceMinor: 0 }), '$395.09', at)).toBeNull();
    expect(calendarForDebt(loan({ dueDay: undefined }), '$395.09', at)).toBeNull();
  });

  it('is never part of the whole-app export', () => {
    const all = buildCalendar({ tasks: [], subscriptions: [], formatAmount: () => '', now: at });
    expect(all).not.toContain('debt-');
  });

  it('says what goes in, and what stays', () => {
    expect(calendarContents('debt', false)).toBe(
      "Goes in: the name and the due dates, and the amount when it's the same every month. Notes stay here unless you turn them on in Settings.",
    );
    expect(calendarContents('debt', true)).toMatch(/with its notes\.$/);
    expect(DEBT_CALENDAR_ENTRY_STAYS).toContain("Steady can't reach your calendar");
  });
});
