import type { BillingCycle, IntervalCycle } from '../types';

/**
 * The billing rhythms offered as buttons.
 *
 * "Every 2 weeks" is not its own cycle - it is weekly billed every second week -
 * so a preset sets both `cycle` and `every` together. That keeps the stored
 * shape unchanged, so nothing already saved needs migrating.
 *
 * "Twice a month" is its own cycle, because it genuinely is one: 24 charges a
 * year on set dates against 26 on a 14-day interval. The same pair sits in the
 * income editor, and they must stay the same pair - a subscription that bills
 * on the 1st and the 15th matched against an every-2-weeks approximation would
 * be out by two charges a year, every year.
 *
 * The labels say exactly how often money moves. Deliberately not "semi-weekly",
 * "bi-weekly" or "fortnightly": the first two mean opposite things to different
 * people and the third is regional, and a label you have to decode is no use on
 * a screen whose whole job is to stop you second-guessing your own budget.
 */
export interface CyclePreset {
  id: string;
  label: string;
  cycle: BillingCycle;
  every: number;
}

export const CYCLE_PRESETS: CyclePreset[] = [
  { id: 'weekly', label: 'Weekly', cycle: 'weekly', every: 1 },
  { id: 'fortnightly', label: 'Every 2 weeks', cycle: 'weekly', every: 2 },
  { id: 'semimonthly', label: 'Twice a month', cycle: 'semimonthly', every: 1 },
  { id: 'monthly', label: 'Monthly', cycle: 'monthly', every: 1 },
  { id: 'quarterly', label: 'Every 3 months', cycle: 'quarterly', every: 1 },
  { id: 'yearly', label: 'Yearly', cycle: 'yearly', every: 1 },
];

/** The day pairs offered for a twice-a-month subscription, matching income's. */
export const BILLING_DAY_CHOICES: { label: string; days: number[] }[] = [
  { label: '1st and 15th', days: [1, 15] },
  { label: '15th and last day', days: [15, 31] },
];

/**
 * The preset matching a saved subscription, or `undefined` for a rhythm no
 * button covers - every 2 months, say.
 *
 * `undefined` is the right answer there, not a failure: the form then highlights
 * nothing and leaves the custom value alone under More options, so an unusual
 * subscription is never quietly rewritten into a tidier one that bills on
 * different days.
 */
export function findCyclePreset(cycle: BillingCycle, every: number): CyclePreset | undefined {
  return CYCLE_PRESETS.find((p) => p.cycle === cycle && p.every === every);
}

/**
 * The plain noun for a cycle's period, for "bill every how many ___?".
 *
 * Interval cycles only, and the type says so: a twice-a-month subscription has
 * no period to count, so the question itself does not apply and the form does
 * not ask it.
 */
export function cycleUnit(cycle: IntervalCycle): string {
  return { weekly: 'weeks', monthly: 'months', quarterly: 'quarters', yearly: 'years' }[cycle];
}

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

/**
 * Known services whose name starts with, or contains, what has been typed.
 *
 * Shown as tappable chips rather than a native `<datalist>`. A datalist renders
 * each option's *label*, not its value, so options written `<option value="x"/>`
 * appear as blank rows on Android - you pick something invisible and hope. More
 * to the point, the app's rule is that nothing hides inside a native widget:
 * if a choice exists, it is a button you can see.
 */
export function matchPresets(query: string, limit = 4): ServicePreset[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const starts = SERVICE_PRESETS.filter((p) => p.name.toLowerCase().startsWith(needle));
  const contains = SERVICE_PRESETS.filter(
    (p) => !p.name.toLowerCase().startsWith(needle) && p.name.toLowerCase().includes(needle),
  );
  // An exact match is already typed out in full - offering it back is noise.
  return [...starts, ...contains].filter((p) => p.name.toLowerCase() !== needle).slice(0, limit);
}

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
