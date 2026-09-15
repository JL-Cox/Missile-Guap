import type { BillingCycle } from '../types';

/**
 * Categories as a fixed list of buttons rather than a free-text box. Typing a
 * category means inventing one, and inventing one means a decision; tapping one
 * of nine does not. "Something else" is still there for the odd case, and any
 * category already in use is offered alongside these.
 */
export const COMMON_CATEGORIES = [
  'TV & film',
  'Music',
  'Games',
  'Phone & internet',
  'Bills & utilities',
  'Health & fitness',
  'Software & apps',
  'Storage & cloud',
  'Food & delivery',
] as const;

export interface ServicePreset {
  name: string;
  category: string;
  cycle: BillingCycle;
}

/**
 * Autocomplete for the name field. Typing "net" offers Netflix and fills the
 * category in for you, which removes two decisions from the most common case.
 *
 * Deliberately no prices: they change constantly, and a wrong number quietly
 * sitting in your budget is worse than no number. You type the amount because
 * only you know what you actually pay.
 *
 * This list is static and bundled - nothing is looked up over the network.
 */
export const SERVICE_PRESETS: ServicePreset[] = [
  { name: 'Netflix', category: 'TV & film', cycle: 'monthly' },
  { name: 'Disney+', category: 'TV & film', cycle: 'monthly' },
  { name: 'Amazon Prime', category: 'TV & film', cycle: 'monthly' },
  { name: 'NOW', category: 'TV & film', cycle: 'monthly' },
  { name: 'Apple TV+', category: 'TV & film', cycle: 'monthly' },
  { name: 'Sky', category: 'TV & film', cycle: 'monthly' },
  { name: 'BBC TV Licence', category: 'TV & film', cycle: 'yearly' },
  { name: 'Spotify', category: 'Music', cycle: 'monthly' },
  { name: 'Apple Music', category: 'Music', cycle: 'monthly' },
  { name: 'YouTube Premium', category: 'Music', cycle: 'monthly' },
  { name: 'Audible', category: 'Music', cycle: 'monthly' },
  { name: 'Xbox Game Pass', category: 'Games', cycle: 'monthly' },
  { name: 'PlayStation Plus', category: 'Games', cycle: 'monthly' },
  { name: 'Nintendo Switch Online', category: 'Games', cycle: 'yearly' },
  { name: 'Mobile phone', category: 'Phone & internet', cycle: 'monthly' },
  { name: 'Broadband', category: 'Phone & internet', cycle: 'monthly' },
  { name: 'Electricity', category: 'Bills & utilities', cycle: 'monthly' },
  { name: 'Gas', category: 'Bills & utilities', cycle: 'monthly' },
  { name: 'Water', category: 'Bills & utilities', cycle: 'monthly' },
  { name: 'Council tax', category: 'Bills & utilities', cycle: 'monthly' },
  { name: 'Home insurance', category: 'Bills & utilities', cycle: 'yearly' },
  { name: 'Car insurance', category: 'Bills & utilities', cycle: 'yearly' },
  { name: 'Gym', category: 'Health & fitness', cycle: 'monthly' },
  { name: 'Prescriptions', category: 'Health & fitness', cycle: 'monthly' },
  { name: 'Adobe', category: 'Software & apps', cycle: 'monthly' },
  { name: 'Microsoft 365', category: 'Software & apps', cycle: 'yearly' },
  { name: 'iCloud', category: 'Storage & cloud', cycle: 'monthly' },
  { name: 'Google One', category: 'Storage & cloud', cycle: 'monthly' },
  { name: 'Dropbox', category: 'Storage & cloud', cycle: 'monthly' },
];

/** Case-insensitive lookup, so "netflix" and "Netflix " both match. */
export function findPreset(name: string): ServicePreset | undefined {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  return SERVICE_PRESETS.find((p) => p.name.toLowerCase() === needle);
}

/** The category buttons to show: the common ones, plus any already in use. */
export function categoryChoices(used: (string | undefined)[]): string[] {
  const extra = used
    .map((c) => c?.trim())
    .filter((c): c is string => Boolean(c))
    .filter((c) => !COMMON_CATEGORIES.some((k) => k.toLowerCase() === c.toLowerCase()));
  return [...COMMON_CATEGORIES, ...new Set(extra)];
}
