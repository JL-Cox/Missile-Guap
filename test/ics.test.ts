import { describe, expect, it } from 'vitest';
import { buildCalendar, calendarForSubscription, calendarForTask, icsFilename } from '../src/lib/ics';
import type { IncomeSource, Subscription, Task } from '../src/types';

function task(partial: Partial<Task> = {}): Task {
  return { id: 't1', title: 'Ring the dentist', notes: '', steps: [], tags: [], createdAt: 0, updatedAt: 0, ...partial };
}

function sub(partial: Partial<Subscription> = {}): Subscription {
  return {
    id: 's1', name: 'Netflix', amountMinor: 1299, currency: 'GBP', cycle: 'monthly', every: 1,
    firstBilled: '2026-01-15', notes: '', cancelHow: '', remindDaysBefore: 3, createdAt: 0, updatedAt: 0, ...partial,
  };
}

const build = (tasks: Task[], subscriptions: Subscription[] = []) =>
  buildCalendar({ tasks, subscriptions, formatAmount: () => '£12.99', now: Date.UTC(2026, 8, 15, 10, 0, 0) });

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

  it('carries the cancellation steps into the description, where you will need them', () => {
    const ics = build([], [sub({ cancelHow: 'Account > Membership > Cancel' })]);
    expect(ics.replace(/\r\n /g, '')).toContain('To cancel: Account > Membership > Cancel');
  });

  it('leaves cancelled subscriptions out', () => {
    expect(build([], [sub({ endedOn: '2026-05-01' })])).not.toContain('BEGIN:VEVENT');
  });
});

describe('escaping and folding', () => {
  it('escapes the characters that would otherwise break the file', () => {
    const ics = build([task({ date: '2026-09-20', title: 'Buy milk, bread; and eggs' })]);
    expect(ics).toContain('SUMMARY:Buy milk\\, bread\; and eggs');
  });

  it('turns newlines into the literal escape rather than a raw break', () => {
    const ics = build([task({ date: '2026-09-20', notes: 'line one\nline two' })]);
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
