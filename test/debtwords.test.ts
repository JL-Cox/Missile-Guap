import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  chargesAndPayments,
  dueWords,
  extraBecause,
  monthYear,
  orderWhy,
  ordinal,
  paidOffSummary,
  percentWords,
  promoWords,
  rateWords,
  spanWords,
  weekdayDate,
  wholeMoney,
} from '../src/lib/debtwords';
import type { PlanOrderEntry } from '../src/lib/payoff';
import type { Debt } from '../src/types';

/**
 * The words the debt screens use. Debt is a subject people carry shame about,
 * so these are held to two things: each says exactly what the numbers say,
 * and none of them - nor anything else the debt screens say - uses the words
 * that turn a plan into a judgement.
 */

const TODAY = '2026-09-24';

function debt(partial: Partial<Debt> = {}): Debt {
  return {
    id: 'd',
    name: 'Visa',
    kind: 'creditCard',
    balanceMinor: 248_000,
    balanceAsOf: TODAY,
    aprPercent: 24.99,
    minimum: { kind: 'percentPlusInterest', percent: 1, floorMinor: 3_500 },
    dueDay: 12,
    autopay: false,
    currency: 'USD',
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe('dates and spans', () => {
  it('names a month short, or long for the one date the plan is built around', () => {
    expect(monthYear('2029-03-05')).toBe('Mar 2029');
    expect(monthYear('2029-03-05', true)).toBe('March 2029');
  });

  it('gives a due date its weekday', () => {
    expect(weekdayDate('2026-10-12', TODAY)).toBe('Mon, Oct 12');
    expect(weekdayDate('2027-01-04', TODAY)).toBe('Mon, Jan 4, 2027');
  });

  it('says a span in years and months, and nothing for none', () => {
    expect(spanWords(0)).toBe('');
    expect(spanWords(1)).toBe('1 month');
    expect(spanWords(7)).toBe('7 months');
    expect(spanWords(12)).toBe('1 year');
    expect(spanWords(60)).toBe('5 years');
    expect(spanWords(91)).toBe('7 years 7 months');
    expect(spanWords(13)).toBe('1 year 1 month');
  });

  it('writes ordinals the way people say them', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '31st',
    ]);
  });
});

describe('a debt in words', () => {
  it('prints a rate as the statement does, and says when there is none', () => {
    expect(percentWords(24.99)).toBe('24.99%');
    expect(percentWords(7.5)).toBe('7.5%');
    expect(percentWords(0)).toBe('0%');
    expect(rateWords(debt())).toBe('24.99% APR');
    expect(rateWords(debt({ aprPercent: undefined }))).toBe('no rate yet');
  });

  it('says when it is due', () => {
    expect(dueWords(debt())).toBe('due the 12th');
    expect(dueWords(debt({ dueDay: 31 }))).toBe('due the last day');
    expect(dueWords(debt({ cadence: 'every2weeks', nextDueOn: '2026-10-01' }))).toBe('due every 2 weeks');
    expect(dueWords(debt({ dueDay: undefined }))).toBe('no due date yet');
  });

  it('describes a promo with the rate that follows it', () => {
    expect(promoWords(debt({ promo: { aprPercent: 0, endsOn: '2027-03-05', deferred: true } }), TODAY)).toBe(
      '0% until Mar 5, 2027, then 24.99%',
    );
    expect(promoWords(debt(), TODAY)).toBe('');
  });

  it('rounds an "about" figure to whole dollars, with a real minus sign', () => {
    expect(wholeMoney(342_049, 'USD')).toBe('$3,420');
    expect(wholeMoney(342_050, 'USD')).toBe('$3,421');
    expect(wholeMoney(-12_000, 'USD')).toBe('−$120');
  });
});

describe('the one-sentence reasons', () => {
  it('says why a debt gets the extra, with the number to check it against', () => {
    expect(extraBecause('highestRate', debt(), TODAY)).toBe('it charges the most interest (24.99%)');
    expect(extraBecause('highestRate', debt({ aprPercent: undefined }), TODAY)).toBe('it charges the most interest');
    expect(extraBecause('smallestBalance', debt(), TODAY)).toBe('it has the smallest balance');
    // Second in line, after another debt has had its share.
    expect(extraBecause('highestRate', debt({ aprPercent: 6.9 }), TODAY, true)).toBe('it has the next highest rate (6.9%)');
    expect(extraBecause('smallestBalance', debt(), TODAY, true)).toBe('it has the next smallest balance');
    expect(
      extraBecause('promoDeadline', debt({ promo: { aprPercent: 0, endsOn: '2027-03-05', deferred: true } }), TODAY),
    ).toBe('its promo rate ends Mar 5, 2027, and this clears it a payment early');
  });

  const entry = (partial: Partial<PlanOrderEntry>): PlanOrderEntry => ({
    debtId: 'd',
    paidOffOn: '2027-08-05',
    reason: 'highestRate',
    firstStep: 0,
    firstExtraOn: '2026-10-12',
    after: null,
    ...partial,
  });
  const names = (id: string) => ({ a: 'Visa', b: 'Store card' })[id] ?? id;

  it("says where each debt is in the plan's order, and why", () => {
    expect(orderWhy(entry({}), debt(), names, TODAY)).toBe('First: it charges the most interest (24.99%).');
    expect(orderWhy(entry({ reason: 'smallestBalance' }), debt(), names, TODAY)).toBe('First: it has the smallest balance.');
    expect(orderWhy(entry({ firstStep: 10, after: 'a' }), debt(), names, TODAY)).toBe(
      'Minimum only for now. The extra moves here after Visa.',
    );
    expect(orderWhy(entry({ firstStep: 3, firstExtraOn: '2027-01-12' }), debt(), names, TODAY)).toBe(
      'Minimum only for now. The extra moves here in Jan 2027.',
    );
    expect(orderWhy(entry({ reason: null, firstStep: null }), debt(), names, TODAY)).toBe('Its own minimum finishes it.');
  });

  it('never promises a promo is cleared when the plan says it is not', () => {
    const store = debt({ promo: { aprPercent: 0, endsOn: '2027-03-05', deferred: true } });
    expect(orderWhy(entry({ reason: 'promoDeadline' }), store, names, TODAY)).toBe(
      'Its promo rate ends Mar 5, 2027. Part of the extra clears it a payment early.',
    );
    expect(orderWhy(entry({ reason: 'promoDeadline' }), store, names, TODAY, false)).not.toMatch(/clears it/);
  });
});

describe('counts', () => {
  it('counts charges and payments apart, because a payment is not a charge', () => {
    expect(chargesAndPayments(6, 1)).toBe('6 charges and 1 debt payment');
    expect(chargesAndPayments(1, 2)).toBe('1 charge and 2 debt payments');
    expect(chargesAndPayments(0, 1, 'payment')).toBe('1 payment');
    expect(chargesAndPayments(3, 0)).toBe('3 charges');
    expect(chargesAndPayments(0, 0)).toBe('');
  });

  it('says what is paid off without counting it up as an achievement', () => {
    expect(paidOffSummary([{ name: 'Store card', paidOffOn: '2026-10-03' }])).toBe('Store card, paid off Oct 2026');
    expect(
      paidOffSummary([
        { name: 'A', paidOffOn: '2026-10-03' },
        { name: 'B', paidOffOn: '2026-11-03' },
      ]),
    ).toBe('2 paid off');
  });
});

/**
 * Everything the debt screens say, read as the source, comments taken out
 * (a comment may name a word in order to rule it out). None of these words
 * belongs in the app's voice about someone's debt.
 */
describe('the debt screens never judge', () => {
  const FILES = [
    'src/views/Debt.tsx',
    'src/components/DebtEditor.tsx',
    'src/components/DebtPlanEditor.tsx',
    'src/lib/debtwords.ts',
    'src/views/Money.tsx',
    'src/views/Today.tsx',
  ];
  // "They are not late" on Today is the one use, and it is there to say the
  // opposite: a word ruled out with "not" is reassurance, not judgement.
  const SHAME = /(?<!\bnot )\b(owe|owes|owed|owing|overdue|behind|late|missed|delinquent|failed|debt-free)\b/i;

  const withoutComments = (source: string) =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

  for (const file of FILES) {
    it(`${file} uses none of the words that judge`, () => {
      const text = withoutComments(readFileSync(join(__dirname, '..', file), 'utf8'));
      const hits = text.split('\n').filter((line) => SHAME.test(line));
      expect(hits).toEqual([]);
    });
  }
});
