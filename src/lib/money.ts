import type { BillingCycle, Subscription } from '../types';

/** Average number of billing periods in a year, for normalising costs. */
const PERIODS_PER_YEAR: Record<BillingCycle, number> = {
  weekly: 52,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
};

export function isActive(sub: Subscription): boolean {
  return !sub.endedOn;
}

/**
 * What this subscription costs per year, in minor units.
 * Weekly is 52 weeks rather than 365/7, which is how people actually budget.
 */
export function yearlyMinor(sub: Subscription): number {
  const every = Math.max(1, Math.floor(sub.every));
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
