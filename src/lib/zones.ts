/**
 * The app's pages, and the zones each one is split into.
 *
 * Home is the dashboard the app opens on: a card for each working page, with
 * what is worth knowing about it on the card. Pages are listed in the Menu,
 * in a fixed order that never changes. Each of the seven working pages opens
 * on an overview - a card for each of its zones, saying what is in it - so no
 * page is one long scroll, and a zone is one tap down. A zone is always
 * there, whatever is in it: an empty one says what it is for. Settings and
 * About have no zones.
 *
 * Ids are like theme names and fold ids: fixed words, never renamed or
 * removed, because an old backup can still carry the zone a page was left on.
 * They are never made from anything you wrote.
 */

/**
 * Fixed order, fixed labels, every time. The Menu never reorders itself.
 *
 * Home first, on its own: it is where the app opens and where Back ends up.
 * Then the old bottom nav's order, so the habit carries over: Today, the four
 * lists, then the two money pages side by side, then the app's own pages.
 * Each working page keeps the glyph it had in the nav, from the same set of
 * shapes, and never an emoji; Debt's is a circle part-way filled - "part-way
 * there" - and Home's is four squares, for a page of cards. Settings and
 * About have none, which also marks them as a group of their own.
 */
export const PAGES = [
  { id: 'home', title: 'Home', glyph: '⊞', group: 0 },
  { id: 'today', title: 'Today', glyph: '◎', group: 1 },
  { id: 'inbox', title: 'Inbox', glyph: '↓', group: 1 },
  { id: 'tasks', title: 'Tasks', glyph: '✓', group: 1 },
  { id: 'backlog', title: 'Backlog', glyph: '◇', group: 1 },
  { id: 'notes', title: 'Notes', glyph: '≡', group: 1 },
  { id: 'debt', title: 'Debt', glyph: '◔', group: 2 },
  { id: 'money', title: 'Money', glyph: '$', group: 2 },
  { id: 'settings', title: 'Settings', glyph: '', group: 3 },
  { id: 'about', title: 'About', glyph: '', group: 3 },
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
 * Each working page's zones, in the order its overview shows their cards.
 * Four at most, so an overview is two rows of cards and never a list of its
 * own.
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
 * Where a working page opens: its overview, a card for each zone. A zone is
 * one tap down from there, and Back from a zone comes back here. Not a zone
 * id of any page, and never saved.
 */
export const HUB = 'hub';

/** A page's overview or one of its zones. */
export type ZoneOrHub<P extends ZonedPage> = ZoneOf<P> | typeof HUB;

/** The label of one of a page's zones, as its card and its heading say it. */
export function zoneLabel(page: ZonedPage, zone: string): string {
  return ZONES[page].find((z) => z.id === zone)?.label ?? pageTitle(page);
}
