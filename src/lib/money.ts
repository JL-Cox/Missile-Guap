import type { BillingCycle, IncomeSource, Subscription } from '../types';
import { isActiveIncome, PERIODS_PER_YEAR as PAY_PERIODS_PER_YEAR } from './pay';
import { isFixedDayCycle } from './recurrence';

/** Average number of billing periods in a year, for normalising costs. */
const PERIODS_PER_YEAR: Record<BillingCycle, number> = {
  weekly: 52,
  semimonthly: 24,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
};

export function isActive(sub: Subscription): boolean {
  return !sub.endedOn;
}

/**
 * What this subscription costs per year, in minor units.
 *
 * Weekly is 52 weeks rather than 365/7, which is how people actually budget,
 * and twice a month is 24 rather than 26 - the two-charge gap between that and
 * every 2 weeks is precisely why they are separate options.
 *
 * "Every N" is an interval idea, so the fixed-day cycles ignore it. Dividing by
 * a stale `every: 2` left behind by a previous choice would halve the cost
 * while the dates carried on twice a month.
 */
export function yearlyMinor(sub: Subscription): number {
  const every = isFixedDayCycle(sub.cycle) ? 1 : Math.max(1, Math.floor(sub.every));
  return Math.round((sub.amountMinor * PERIODS_PER_YEAR[sub.cycle]) / every);
}

export function monthlyMinor(sub: Subscription): number {
  return Math.round(yearlyMinor(sub) / 12);
}

export function totalYearlyMinor(subs: Subscription[]): number {
  return subs.filter(isActive).reduce((sum, s) => sum + yearlyMinor(s), 0);
}

export function totalMonthlyMinor(subs: Subscription[]): number {
  return Math.round(totalYearlyMinor(subs) / 12);
}

/** Group active subscriptions by category, most expensive first. */
export function byCategoryYearly(subs: Subscription[]): { category: string; minor: number }[] {
  const map = new Map<string, number>();
  for (const s of subs.filter(isActive)) {
    const key = s.category?.trim() || 'Uncategorised';
    map.set(key, (map.get(key) ?? 0) + yearlyMinor(s));
  }
  return [...map.entries()]
    .map(([category, minor]) => ({ category, minor }))
    .sort((a, b) => b.minor - a.minor);
}

export function formatMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);
  } catch {
    // Unknown currency code - still show the number rather than an error.
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

/** Parse "12.99", "£12.99", "12,99" into minor units. Returns null if it isn't a number. */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[^\d.,-]/g, '').replace(/,(\d{2})$/, '.$1').replace(/,/g, '');
  if (!cleaned || !/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/* ---------------------------------------------------------------------------
   Income
   -------------------------------------------------------------------------- */

/**
 * Gross and net are transcribed from the paystub rather than calculated, so
 * annualising them is just multiplication. Nothing here estimates tax: rates
 * vary by state and filing status and change yearly, and a plausible-looking
 * wrong number in someone's budget is the exact failure this app exists to
 * avoid.
 */
export function grossYearlyMinor(source: IncomeSource): number {
  return source.grossMinor * PAY_PERIODS_PER_YEAR[source.frequency];
}

export function netYearlyMinor(source: IncomeSource): number {
  return source.netMinor * PAY_PERIODS_PER_YEAR[source.frequency];
}

export function netMonthlyMinor(source: IncomeSource): number {
  return Math.round(netYearlyMinor(source) / 12);
}

/** What the itemised lines add up to, per pay period. */
export function itemisedDeductionsMinor(source: IncomeSource): number {
  return source.deductions.reduce((sum, d) => sum + d.amountMinor, 0);
}

/**
 * The part of the gap between gross and net that has not been written down.
 *
 * A positive number means lines are missing, which is allowed and common - a
 * stub has a dozen rows and nobody wants to type them all. It is reported as
 * "not itemised", never as an error, and never blocks saving.
 */
export function unitemisedMinor(source: IncomeSource): number {
  return Math.max(0, source.grossMinor - source.netMinor - itemisedDeductionsMinor(source));
}

export function totalNetYearlyMinor(sources: IncomeSource[]): number {
  return sources.filter(isActiveIncome).reduce((sum, s) => sum + netYearlyMinor(s), 0);
}

export function totalNetMonthlyMinor(sources: IncomeSource[]): number {
  return Math.round(totalNetYearlyMinor(sources) / 12);
}

export function totalGrossYearlyMinor(sources: IncomeSource[]): number {
  return sources.filter(isActiveIncome).reduce((sum, s) => sum + grossYearlyMinor(s), 0);
}

/** Yearly deductions grouped by the label on the stub, biggest first. */
export function deductionsByLabel(sources: IncomeSource[]): { label: string; minor: number }[] {
  const map = new Map<string, number>();
  for (const source of sources.filter(isActiveIncome)) {
    const periods = PAY_PERIODS_PER_YEAR[source.frequency];
    for (const d of source.deductions) {
      const key = d.label.trim() || 'Unlabelled';
      map.set(key, (map.get(key) ?? 0) + d.amountMinor * periods);
    }
    const rest = unitemisedMinor(source) * periods;
    if (rest > 0) map.set('Not itemised', (map.get('Not itemised') ?? 0) + rest);
  }
  return [...map.entries()]
    .map(([label, minor]) => ({ label, minor }))
    .sort((a, b) => b.minor - a.minor);
}

/**
 * What is left each month once the tracked subscriptions come out.
 *
 * Honest about its own limits: this app only knows about subscriptions, so the
 * remainder covers rent, food and everything else too. It is "what is left for
 * everything else", not "spare money".
 */
export function leftoverMonthlyMinor(sources: IncomeSource[], subs: Subscription[]): number {
  return totalNetMonthlyMinor(sources) - totalMonthlyMinor(subs);
}
