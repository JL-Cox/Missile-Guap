import type { DateKey, Subscription } from '../types';
import { isOngoing, monthlyMinor, yearlyMinor } from './money';
import { describeBilling, nextBilling } from './recurrence';

/**
 * Your subscriptions as a spreadsheet file, to take somewhere else and look at
 * hard: which ones overlap, which have a cheaper plan, which you forgot.
 *
 * CSV because everything opens it - a spreadsheet app, Google Sheets, or an
 * assistant you paste it into - and because it is plain text you can read
 * before you send it. Like every other way out of this app, it only leaves
 * when you tap the button, and only to the app you pick.
 *
 * What goes in is the least that is useful for that job. "How to cancel" never
 * does: those steps are where logins and account numbers end up. Notes only go
 * in when you tick the box, for the same reason.
 */

export interface SubscriptionExportOptions {
  today: DateKey;
  /** Off unless asked for, each time - notes can hold things you would not share. */
  includeNotes?: boolean;
}

/** Amounts as plain numbers ("15.49"), so a spreadsheet can add them up. */
function plainAmount(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * One CSV cell, quoted when it has to be (RFC 4180).
 *
 * A cell starting with = + - @ or a tab is a formula to a spreadsheet, so a
 * subscription named "=HYPERLINK(...)" could do something when the file is
 * opened. Those get a leading apostrophe, which spreadsheets show as text.
 * Amounts are written by plainAmount and never start that way except as a
 * real negative number, which is passed through untouched.
 */
export function csvCell(value: string, numeric = false): string {
  let text = value;
  if (!numeric && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const COLUMNS = [
  'Name',
  'Category',
  'Price',
  'Currency',
  'Billed',
  'Monthly cost',
  'Yearly cost',
  'Next charge',
  'Subscribed since',
] as const;

/**
 * Every subscription not marked as cancelled, most expensive first, with a
 * total row at the end. Monthly and yearly figures use the same rules as the
 * Money page, so the file and the page agree.
 */
export function subscriptionsCsv(subs: Subscription[], options: SubscriptionExportOptions): string {
  const { today, includeNotes = false } = options;
  const active = subs
    .filter(isOngoing)
    .sort((a, b) => yearlyMinor(b) - yearlyMinor(a) || a.name.localeCompare(b.name));

  const header = includeNotes ? [...COLUMNS, 'Notes'] : [...COLUMNS];
  const rows: string[][] = [header.map((h) => csvCell(h))];

  for (const sub of active) {
    const row = [
      csvCell(sub.name.trim()),
      csvCell(sub.category?.trim() ?? ''),
      csvCell(plainAmount(sub.amountMinor), true),
      csvCell(sub.currency),
      csvCell(describeBilling(sub)),
      csvCell(plainAmount(monthlyMinor(sub)), true),
      csvCell(plainAmount(yearlyMinor(sub)), true),
      csvCell(nextBilling(sub, today) ?? ''),
      csvCell(sub.firstBilled),
    ];
    if (includeNotes) row.push(csvCell(sub.notes.trim()));
    rows.push(row);
  }

  // Totals per currency, so two currencies are never added together.
  const currencies = [...new Set(active.map((s) => s.currency))].sort();
  for (const currency of currencies) {
    const these = active.filter((s) => s.currency === currency);
    const month = these.reduce((sum, s) => sum + monthlyMinor(s), 0);
    const year = these.reduce((sum, s) => sum + yearlyMinor(s), 0);
    const row = [
      csvCell(currencies.length > 1 ? `Total (${currency})` : 'Total'),
      '',
      '',
      csvCell(currency),
      '',
      csvCell(plainAmount(month), true),
      csvCell(plainAmount(year), true),
      '',
      '',
    ];
    if (includeNotes) row.push('');
    rows.push(row);
  }

  return rows.map((r) => r.join(',')).join('\r\n') + '\r\n';
}

/** `subscriptions-2026-10-07.csv`: dated, so a second export doesn't look like the first. */
export function subscriptionsFilename(today: DateKey): string {
  return `subscriptions-${today}.csv`;
}

/** The line beside the button: exactly what the file holds. */
export function subscriptionsExportContents(includeNotes: boolean): string {
  return includeNotes
    ? 'Goes in: each active subscription with its price, how often it bills, its monthly and yearly cost, next charge date, and notes. How-to-cancel steps stay here.'
    : 'Goes in: each active subscription with its price, how often it bills, its monthly and yearly cost and next charge date. Notes and how-to-cancel steps stay here.';
}
