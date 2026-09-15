import { describe, expect, it } from 'vitest';
import { addDays, addMonths, atTime, daysBetween, describeDate, describeDuration, fromDateKey, toDateKey } from '../src/lib/time';

describe('date keys stay in local time', () => {
  it('round-trips a date without drifting a day', () => {
    const d = new Date(2026, 2, 1, 13, 45);
    expect(toDateKey(d)).toBe('2026-03-01');
    expect(toDateKey(fromDateKey('2026-03-01'))).toBe('2026-03-01');
  });

  it('does not shift across the new year', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });
});

describe('addMonths clamps short months', () => {
  it('31 Jan plus one month is the end of February, not March', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29'); // leap year
  });

  it('keeps the day of month where it fits', () => {
    expect(addMonths('2026-01-15', 3)).toBe('2026-04-15');
    expect(addMonths('2026-11-30', 2)).toBe('2027-01-30');
  });
});

describe('daysBetween', () => {
  it('counts whole days in both directions', () => {
    expect(daysBetween('2026-03-01', '2026-03-08')).toBe(7);
    expect(daysBetween('2026-03-08', '2026-03-01')).toBe(-7);
    expect(daysBetween('2026-03-01', '2026-03-01')).toBe(0);
  });

  it('is exact across a spring-forward boundary', () => {
    // A 23-hour day must still count as one day, or every date maths goes wrong.
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
  });
});

describe('atTime', () => {
  it('builds a local timestamp on the right day', () => {
    const ms = atTime('2026-06-10', '14:30');
    const d = new Date(ms);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(10);
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
  });
});

describe('plain-language dates', () => {
  const today = '2026-09-15';
  it('uses words for the near dates', () => {
    expect(describeDate('2026-09-15', today)).toBe('Today');
    expect(describeDate('2026-09-16', today)).toBe('Tomorrow');
    expect(describeDate('2026-09-14', today)).toBe('Yesterday');
  });

  it('names the weekday and the gap within a week', () => {
    expect(describeDate('2026-09-18', today)).toBe('Friday, in 3 days');
    expect(describeDate('2026-09-12', today)).toBe('Saturday, 3 days ago');
  });

  it('falls back to a real date further out, still with the gap', () => {
    expect(describeDate('2026-10-20', today)).toContain('in 35 days');
  });
});

describe('describeDuration', () => {
  it('reads as a person would say it', () => {
    expect(describeDuration(45)).toBe('45 min');
    expect(describeDuration(60)).toBe('1 hr');
    expect(describeDuration(90)).toBe('1 hr 30 min');
  });
});
