import { describe, expect, it } from 'vitest';
import { csvCell, subscriptionsCsv, subscriptionsExportContents, subscriptionsFilename } from '../src/lib/subexport';
import type { Subscription } from '../src/types';

function sub(partial: Partial<Subscription> = {}): Subscription {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'Test',
    amountMinor: 1000,
    currency: 'USD',
    cycle: 'monthly',
    every: 1,
    firstBilled: '2026-01-15',
    notes: '',
    cancelHow: '',
    remindDaysBefore: 3,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

const today = '2026-10-07';
const lines = (csv: string) => csv.trimEnd().split('\r\n');

describe('the subscriptions file', () => {
  const subs = [
    sub({ name: 'Netflix', amountMinor: 1549, category: 'Streaming', firstBilled: '2025-03-20' }),
    sub({ name: 'Gym', amountMinor: 4000, category: 'Health', firstBilled: '2026-02-01' }),
    sub({ name: 'Domain', amountMinor: 1200, cycle: 'yearly', firstBilled: '2024-11-02' }),
    sub({ name: 'Old app', amountMinor: 999, endedOn: '2026-06-01' }),
  ];

  it('has a header, one row per running subscription, most expensive first, and a total', () => {
    const rows = lines(subscriptionsCsv(subs, { today }));
    expect(rows[0]).toBe('Name,Category,Price,Currency,Billed,Monthly cost,Yearly cost,Next charge,Subscribed since');
    expect(rows.slice(1).map((r) => r.split(',')[0])).toEqual(['Gym', 'Netflix', 'Domain', 'Total']);
  });

  it('writes amounts as plain numbers a spreadsheet can add up', () => {
    const rows = lines(subscriptionsCsv(subs, { today }));
    expect(rows[2]).toBe('Netflix,Streaming,15.49,USD,every month,15.49,185.88,2026-10-20,2025-03-20');
    expect(rows[3]).toBe('Domain,,12.00,USD,every year,1.00,12.00,2026-11-02,2024-11-02');
    expect(rows[4]).toBe('Total,,,USD,,56.49,677.88,,');
  });

  it('leaves out cancelled subscriptions', () => {
    expect(subscriptionsCsv(subs, { today })).not.toContain('Old app');
  });

  it('never includes how to cancel, and notes only when asked', () => {
    const secret = [sub({ name: 'Hulu', notes: 'Family plan, 4 screens', cancelHow: 'login me@x.com pw hunter2' })];
    const plain = subscriptionsCsv(secret, { today });
    expect(plain).not.toContain('Family plan');
    expect(plain).not.toContain('hunter2');
    const withNotes = subscriptionsCsv(secret, { today, includeNotes: true });
    expect(lines(withNotes)[0].endsWith(',Notes')).toBe(true);
    expect(withNotes).toContain('"Family plan, 4 screens"');
    expect(withNotes).not.toContain('hunter2');
  });

  it('totals each currency on its own', () => {
    const rows = lines(subscriptionsCsv([sub({ currency: 'USD' }), sub({ currency: 'EUR', amountMinor: 500 })], { today }));
    expect(rows.slice(-2)).toEqual(['Total (EUR),,,EUR,,5.00,60.00,,', 'Total (USD),,,USD,,10.00,120.00,,']);
  });

  it('is just a header when there is nothing to export', () => {
    expect(lines(subscriptionsCsv([], { today }))).toHaveLength(1);
  });
});

describe('a CSV cell', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('defuses anything a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('-5.00', true)).toBe('-5.00');
  });
});

describe('around the button', () => {
  it('dates the file name', () => {
    expect(subscriptionsFilename(today)).toBe('subscriptions-2026-10-07.csv');
  });

  it('says what goes in, and that cancel steps never do', () => {
    expect(subscriptionsExportContents(false)).toContain('Notes and how-to-cancel steps stay here');
    expect(subscriptionsExportContents(true)).toContain('notes');
    expect(subscriptionsExportContents(true)).toContain('How-to-cancel steps stay here');
  });
});
