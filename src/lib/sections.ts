/**
 * Sections that fold, and how each one starts.
 *
 * A long screen is easier to face when the parts you are not using today can
 * be folded down to one line. Every section that folds is listed here, with
 * the way it starts on a phone that has never folded anything. This is the one
 * place those defaults live: a section says which entry it is, never whether
 * it starts open, so there is no second place for a default to drift from.
 *
 * `memory` says what happens to a fold you changed:
 *
 *   remember - kept, in settings, so the screen opens the way you left it.
 *              For the screens you glance at many times a day.
 *   visit    - forgotten when you leave. Settings and About look the same
 *              every time you open them, because you go there to do one
 *              thing and a page that remembers is a page that moved.
 *
 * Ids are like theme names: fixed words, never renamed or removed, because a
 * remembered fold is a saved preference on somebody's phone. They are never
 * made from anything you wrote, so the settings hold nothing but these words.
 */

export type FoldMemory = 'remember' | 'visit';

export interface Fold {
  open: boolean;
  memory: FoldMemory;
}

export const FOLDS = {
  'today.waiting': { open: true, memory: 'remember' },
  'today.bills': { open: true, memory: 'remember' },
  'today.nextPayday': { open: true, memory: 'remember' },
  'today.loose': { open: true, memory: 'remember' },
  'inbox.cleared': { open: false, memory: 'remember' },
  'backlog.routines': { open: true, memory: 'remember' },
  'backlog.finished': { open: false, memory: 'remember' },
  'money.paychecks': { open: true, memory: 'remember' },
  'money.subscriptions': { open: true, memory: 'remember' },
  'money.income': { open: true, memory: 'remember' },
  'money.averages': { open: false, memory: 'remember' },
  'debt.plan': { open: true, memory: 'remember' },
  'debt.list': { open: true, memory: 'remember' },
  // Looking back, and the reference page: there when wanted, folded to start.
  'debt.paidOff': { open: false, memory: 'remember' },
  'debt.howItWorks': { open: false, memory: 'remember' },
  'settings.look': { open: false, memory: 'visit' },
  'settings.money': { open: false, memory: 'visit' },
  'settings.notes': { open: false, memory: 'visit' },
  'settings.reminders': { open: false, memory: 'visit' },
  'settings.lock': { open: false, memory: 'visit' },
  'settings.backup': { open: false, memory: 'visit' },
  'settings.data': { open: false, memory: 'visit' },
  'settings.privacy': { open: false, memory: 'visit' },
  'about.updates': { open: false, memory: 'visit' },
} as const satisfies Record<string, Fold>;

export type FoldId = keyof typeof FOLDS;

export const FOLD_IDS = Object.keys(FOLDS) as FoldId[];

export function isFoldId(id: string): id is FoldId {
  return Object.prototype.hasOwnProperty.call(FOLDS, id);
}

/**
 * Whether a section is open, given what has been saved. Only remembered
 * sections read the saved map; a visit section starts the same way every time,
 * even if a hand-edited backup file says otherwise.
 */
export function isOpen(id: FoldId, stored?: Record<string, boolean>): boolean {
  const fold: Fold = FOLDS[id];
  if (fold.memory === 'visit') return fold.open;
  const saved = stored?.[id];
  return typeof saved === 'boolean' ? saved : fold.open;
}

/**
 * The saved map with one section changed. It keeps only what differs from how
 * each section starts, and drops anything that is not a remembered section, so
 * the map stays small and "put everything back" is simply having none.
 */
export function withFold(
  stored: Record<string, boolean> | undefined,
  id: FoldId,
  open: boolean,
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(stored ?? {})) {
    if (!isFoldId(key)) continue;
    const fold: Fold = FOLDS[key];
    if (fold.memory === 'remember' && typeof value === 'boolean' && value !== fold.open) next[key] = value;
  }
  const fold: Fold = FOLDS[id];
  if (fold.memory === 'remember') {
    if (open === fold.open) delete next[id];
    else next[id] = open;
  }
  return next;
}

/* ---------------------------------------------------------------------------
   Words for a folded section's one line
   -------------------------------------------------------------------------- */

/**
 * A title quoted in a summary, cut to about `max` characters at a word break.
 * The summary itself is never cut short on screen; only a long title inside it
 * is, so one wordy task cannot turn a one-line summary into four.
 */
export function cutTitle(title: string, max = 32): string {
  const text = title.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  // One character more than fits, so a word that ends exactly at the limit is kept.
  const cut = text.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(' ');
  // A break in the first half would leave too little to recognise.
  const end = lastSpace > max / 2 ? lastSpace : max;
  return `${cut.slice(0, end).replace(/[\s,;:.-]+$/, '')}…`;
}

/** "Rent", "Rent and Phone", "Rent, Phone and 2 more". */
export function nameList(names: string[], shown = 2): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2 && shown >= 2) return `${names[0]} and ${names[1]}`;
  const first = names.slice(0, shown);
  const rest = names.length - first.length;
  if (rest === 0) return `${first.slice(0, -1).join(', ')} and ${first[first.length - 1]}`;
  return `${first.join(', ')} and ${rest} more`;
}

/** "1 task", "3 tasks". */
export function countOf(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
