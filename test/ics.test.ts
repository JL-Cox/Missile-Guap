import { describe, expect, it } from 'vitest';
import { buildCalendar, calendarForSubscription, calendarForTask, icsFilename } from '../src/lib/ics';
import type { Subscription, Task } from '../src/types';

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
