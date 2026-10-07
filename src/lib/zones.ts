/**
 * The app's pages, and the zones each one is split into.
 *
 * Pages are listed in the Menu, in a fixed order that never changes. Each of
 * the seven working pages is split into a few zones, reached from the bar at
 * the bottom of the screen, so no page is one long scroll. A zone is always
 * there, whatever is in it: an empty one says what it is for. Settings and
 * About have no zones and no bar.
 *
 * Ids are like theme names and fold ids: fixed words, never renamed or
 * removed, because the zone a page was left on is a saved preference on
 * somebody's phone. They are never made from anything you wrote, so the
 * settings hold nothing but these words.
 */

/**
 * Fixed order, fixed labels, every time. The Menu never reorders itself.
 *
 * The order is the old bottom nav's, so the habit carries over: Today first,
 * then the four lists, then the two money pages side by side, then the app's
 * own pages. Each working page keeps the glyph it had in the nav, from the
 * same set of shapes, and never an emoji; Debt's is a circle part-way filled -
 * "part-way there". Settings and About have none, which also marks them as a
 * group of their own.
 */
export const PAGES = [
  { id: 'today', title: 'Today', glyph: '◎', group: 0 },
  { id: 'inbox', title: 'Inbox', glyph: '↓', group: 0 },
  { id: 'tasks', title: 'Tasks', glyph: '✓', group: 0 },
  { id: 'backlog', title: 'Backlog', glyph: '◇', group: 0 },
  { id: 'notes', title: 'Notes', glyph: '≡', group: 0 },
  { id: 'debt', title: 'Debt', glyph: '◔', group: 1 },
  { id: 'money', title: 'Money', glyph: '$', group: 1 },
  { id: 'settings', title: 'Settings', glyph: '', group: 2 },
  { id: 'about', title: 'About', glyph: '', group: 2 },
] as const;

export type PageId = (typeof PAGES)[number]['id'];

export const PAGE_IDS: PageId[] = PAGES.map((p) => p.id);

export function isPageId(id: string): id is PageId {
  return (PAGE_IDS as string[]).includes(id);
}

export function pageTitle(page: PageId): string {
  return PAGES.find((p) => p.id === page)!.title;
}

/**
 * Each working page's zones, in the order the bar shows them. The first is
 * where the page starts. Four at most: five did not fit a 360px screen at
 * large text, even with the smallest label size.
 */
export const ZONES = {
  today: [
    { id: 'day', label: 'Today' },
    { id: 'waiting', label: 'Waiting' },
    { id: 'money', label: 'Money' },
    { id: 'undated', label: 'No date' },
  ],
  inbox: [
    { id: 'open', label: 'To sort' },
    { id: 'cleared', label: 'Dealt with' },
  ],
  tasks: [
    { id: 'dated', label: 'Has a date' },
    { id: 'undated', label: 'No date' },
    { id: 'finished', label: 'Finished' },
    { id: 'search', label: 'Search' },
  ],
  backlog: [
    { id: 'open', label: 'To do' },
    { id: 'routines', label: 'Routines' },
    { id: 'finished', label: 'Finished' },
  ],
  notes: [
    { id: 'all', label: 'All notes' },
    { id: 'search', label: 'Search' },
  ],
  debt: [
    { id: 'paychecks', label: 'Paychecks' },
    { id: 'plan', label: 'Plan' },
    { id: 'debts', label: 'Debts' },
  ],
  money: [
    { id: 'soon', label: 'Coming out' },
    { id: 'paychecks', label: 'Paychecks' },
    { id: 'subscriptions', label: 'Subscriptions' },
    { id: 'income', label: 'Income' },
  ],
} as const;

export type ZonedPage = keyof typeof ZONES;
/** One page's zone ids: ZoneOf<'money'> is 'soon' | 'paychecks' | 'subscriptions' | 'income'. */
export type ZoneOf<P extends ZonedPage> = (typeof ZONES)[P][number]['id'];
export type ZoneId = ZoneOf<ZonedPage>;

export function hasZones(page: string): page is ZonedPage {
  return Object.prototype.hasOwnProperty.call(ZONES, page);
}

export function zonesOf(page: ZonedPage): readonly { id: string; label: string }[] {
  return ZONES[page];
}

export function firstZone<P extends ZonedPage>(page: P): ZoneOf<P> {
  return ZONES[page][0].id as ZoneOf<P>;
}

export function isZoneOf<P extends ZonedPage>(page: P, zone: unknown): zone is ZoneOf<P> {
  return typeof zone === 'string' && ZONES[page].some((z) => z.id === zone);
}

/**
 * Whether a page opens on the zone it was left on. Every page does except
 * Today: Today is home, and "Today opens on today" is the one rule nobody
 * should have to think about. Its other zones are a tap away on the bar.
 */
export function remembersZone(page: ZonedPage): boolean {
  return page !== 'today';
}

/**
 * The zone a page opens on: the saved one if it is one of this page's, and
 * the first otherwise. Unknown pages, ids that are not this page's, and
 * anything that is not a word are ignored, so a hand-edited backup can never
 * open a page on nothing.
 */
export function zoneFor<P extends ZonedPage>(page: P, stored?: Record<string, string>): ZoneOf<P> {
  if (!remembersZone(page)) return firstZone(page);
  const saved = stored && Object.prototype.hasOwnProperty.call(stored, page) ? stored[page] : undefined;
  return isZoneOf(page, saved) ? saved : firstZone(page);
}

/**
 * The saved map with one page changed. It keeps only valid entries that are
 * not a page's first zone - the first is where a page starts anyway - and
 * never Today's, so someone who stays on first zones stores nothing at all and
 * "put every page back" is simply having none.
 */
export function withZone(stored: Record<string, string> | undefined, page: ZonedPage, zone: string): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(stored ?? {})) {
    if (!hasZones(key) || !remembersZone(key)) continue;
    if (isZoneOf(key, value) && value !== firstZone(key)) next[key] = value;
  }
  delete next[page];
  if (remembersZone(page) && isZoneOf(page, zone) && zone !== firstZone(page)) next[page] = zone;
  return next;
}
