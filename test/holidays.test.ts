import { describe, expect, it } from 'vitest';
import {
  ALL_HOLIDAYS,
  DEFAULT_HOLIDAYS,
  easterSunday,
  holidayDates,
  holidaysOf,
  isHoliday,
} from '../src/lib/holidays';

/** The one date in each year, for readability in the assertions below. */
const on = (year: number, id: Parameters<typeof holidayDates>[1] extends undefined ? never : string) =>
  holidayDates(year, [id as never])[0];

describe('Easter, and Good Friday from it', () => {
  // The computus is modular arithmetic standing in for a lunisolar calendar -
  // unreadable by design - so it is checked against known dates, not by eye.
  it('matches known Easter Sundays', () => {
    expect(easterSunday(2024)).toBe('2024-03-31');
    expect(easterSunday(2025)).toBe('2025-04-20');
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(easterSunday(2028)).toBe('2028-04-16');
  });

  it('puts Good Friday two days before each', () => {
    expect(on(2024, 'goodFriday')).toBe('2024-03-29');
    expect(on(2025, 'goodFriday')).toBe('2025-04-18');
    expect(on(2026, 'goodFriday')).toBe('2026-04-03');
    expect(on(2027, 'goodFriday')).toBe('2027-03-26');
    expect(on(2028, 'goodFriday')).toBe('2028-04-14');
  });

  it('always lands on a Friday, whatever the year', () => {
    for (let year = 2024; year <= 2040; year++) {
      expect(new Date(`${on(year, 'goodFriday')}T12:00:00`).getDay()).toBe(5);
    }
  });
});

describe('holidays fixed to a weekday', () => {
  it('puts Memorial Day on the LAST Monday in May, not the fourth', () => {
    // 2027 has five Mondays in May - the classic off-by-one.
    expect(on(2026, 'memorial')).toBe('2026-05-25');
    expect(on(2027, 'memorial')).toBe('2027-05-31');
    expect(on(2028, 'memorial')).toBe('2028-05-29');
  });

  it('puts Labor Day on the first Monday in September', () => {
    expect(on(2026, 'labor')).toBe('2026-09-07');
    expect(on(2027, 'labor')).toBe('2027-09-06');
  });

  it('puts Thanksgiving on the fourth Thursday in November', () => {
    expect(on(2026, 'thanksgiving')).toBe('2026-11-26');
    expect(on(2027, 'thanksgiving')).toBe('2027-11-25');
    expect(on(2028, 'thanksgiving')).toBe('2028-11-23');
  });

  it('puts the extra day on the Friday straight after', () => {
    expect(on(2026, 'thanksgivingFriday')).toBe('2026-11-27');
    expect(on(2027, 'thanksgivingFriday')).toBe('2027-11-26');
  });

  it('never applies an observance rule to these, since they cannot fall on a weekend', () => {
    for (const id of ['memorial', 'labor', 'thanksgiving', 'thanksgivingFriday', 'goodFriday']) {
      for (let year = 2026; year <= 2032; year++) {
        const day = new Date(`${on(year, id)}T12:00:00`).getDay();
        expect([0, 6]).not.toContain(day);
      }
    }
  });
});

describe('fixed-date holidays and the day they are actually taken', () => {
  it('moves a Saturday holiday to the Friday before', () => {
    // 4 July 2026 is a Saturday; 25 Dec 2027 is a Saturday.
    expect(on(2026, 'independence')).toBe('2026-07-03');
    expect(on(2027, 'christmas')).toBe('2027-12-24');
  });

  it('moves a Sunday holiday to the Monday after', () => {
    // 4 July 2027 is a Sunday; 25 Dec 2022 was a Sunday.
    expect(on(2027, 'independence')).toBe('2027-07-05');
    expect(on(2022, 'christmas')).toBe('2022-12-26');
  });

  it('leaves a weekday holiday alone', () => {
    expect(on(2026, 'christmas')).toBe('2026-12-25'); // a Friday
    expect(on(2028, 'independence')).toBe('2028-07-04'); // a Tuesday
  });

  it("puts next year's New Year's Day in December when it is observed early", () => {
    // 1 Jan 2028 is a Saturday, so the day off is Friday 31 Dec 2027 - and that
    // is a payday on a last-day-of-the-month schedule.
    expect(holidayDates(2027, ['newYear'])).toContain('2027-12-31');
  });

  it("keeps New Year's Day itself when it falls midweek", () => {
    expect(holidayDates(2026, ['newYear'])).toContain('2026-01-01');
  });
});

describe('holidayDates', () => {
  it('returns only dates inside the year asked for', () => {
    for (const date of holidayDates(2027)) expect(date.startsWith('2027')).toBe(true);
  });

  it('is sorted and free of duplicates', () => {
    const dates = holidayDates(2027);
    expect([...dates].sort()).toEqual(dates);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it('returns nothing for an empty selection', () => {
    expect(holidayDates(2026, [])).toEqual([]);
  });

  it('covers only what was selected', () => {
    expect(holidayDates(2026, ['christmas'])).toEqual(['2026-12-25']);
  });
});

describe('isHoliday', () => {
  it('recognises a selected holiday', () => {
    expect(isHoliday('2026-12-25')).toBe(true);
    expect(isHoliday('2026-11-26')).toBe(true);
  });

  it('says no to an ordinary day', () => {
    expect(isHoliday('2026-12-22')).toBe(false);
  });

  it('respects a narrowed selection', () => {
    expect(isHoliday('2026-11-26', ['christmas'])).toBe(false);
    expect(isHoliday('2026-12-25', ['christmas'])).toBe(true);
  });

  it('is never true when nothing is selected', () => {
    expect(isHoliday('2026-12-25', [])).toBe(false);
  });

  it('sees a December date belonging to next year\'s New Year holiday', () => {
    expect(isHoliday('2027-12-31', ['newYear'])).toBe(true);
  });
});

describe('holidaysOf', () => {
  it('falls back to the default set for a job saved before this existed', () => {
    expect(holidaysOf({})).toEqual(DEFAULT_HOLIDAYS);
  });

  it('respects an explicit empty list rather than treating it as unset', () => {
    // "This employer works through every holiday" must not silently become
    // "this employer observes all of them".
    expect(holidaysOf({ holidays: [] })).toEqual([]);
  });

  it('defaults to the full catalogue', () => {
    expect(DEFAULT_HOLIDAYS).toEqual(ALL_HOLIDAYS);
  });
});
