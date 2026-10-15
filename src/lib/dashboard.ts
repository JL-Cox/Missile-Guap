import type { DateKey, IncomeSource, Note, Settings, Subscription, Task } from '../types';
import type { DebtPlanView } from './payoff';
import { agendaFor, stillOpen, unscheduled } from './agenda';
import type { PaycheckNow } from './paycheck';
import { fitsLowDay, isLowDay } from './lowday';
import { formatMoney } from './money';
import { sortTasks } from './priority';
import { countOf, cutTitle } from './sections';
import { monthYear } from './debtwords';
import { addDays, describeDate, shortDateTime, timeLabel } from './time';

/**
 * Home: the dashboard the app opens on. A card for each working page, with
 * the one or two things worth knowing about it on the card, so most glances
 * end here and a page is one tap away when they do not.
 *
 * Worked out here, from the same helpers the pages use, so Home can never
 * disagree with the page a card opens. Words, not alarms: nothing is called
 * late or overdue, and nothing is counted against anyone.
 */

/**
 * What one card says. Plain text throughout: a card is a button, and a
 * tappable blurred amount cannot sit inside a button, so with amounts blurred
 * a card leaves the amount out and says it in words instead.
 */
export interface CardBody {
  /** The one figure set large: a count or an amount. At most one per card. */
  figure?: string;
  /** A line or two under it, saying what the figure is or what is in there. */
  lines?: string[];
  /** A short list of what is coming up - when, then what - for a wide card. */
  list?: { when: string; what: string }[];
  /** Spans the row. For the one card in a group that has more to say. */
  wide?: boolean;
}

export interface Card extends CardBody {
  /** A fixed id: the zone the card opens, or on Home the page. Never words. */
  id: string;
  title: string;
}

/** A row of cards under a small heading. */
export interface CardGroup {
  id: string;
  title: string;
  cards: (Card & { id: HomePage })[];
}

/** The pages Home has a card for. Settings and About are in the Menu. */
export type HomePage = 'today' | 'inbox' | 'tasks' | 'backlog' | 'notes' | 'money' | 'debt';

export interface HomeData {
  today: DateKey;
  /** Epoch ms, for "the next reminder". */
  now: number;
  tasks: Task[];
  /** Captures still to sort. */
  inboxCount: number;
  notes: Note[];
  subs: Subscription[];
  incomes: IncomeSource[];
  debtView: DebtPlanView;
  /** The paycheck you are living on, as every money screen reads it (src/lib/paycheck.ts). */
  money: PaycheckNow;
  /** Debts still being paid, planned or not. */
  openDebts: number;
  settings: Pick<Settings, 'blurAmounts' | 'currency' | 'lowDay' | 'lookaheadDays'>;
}

/** How many of today's things the Today card lists before it says how many more. */
export const TODAY_LISTED = 4;
/** How far ahead "coming up" looks on the Tasks card: today and the next six days. */
export const WEEK_DAYS = 7;

/**
 * Home's cards, in three groups, always the same groups in the same order:
 * what is happening now (today, what to sort, the week's tasks), the lists
 * you keep, and money. Each group fills its rows: Today's wide card, then
 * two pairs.
 */
export function homeGroups(d: HomeData): CardGroup[] {
  return [
    { id: 'day', title: 'Today', cards: [todayCard(d), inboxCard(d), tasksCard(d)] },
    { id: 'lists', title: 'Lists', cards: [backlogCard(d), notesCard(d)] },
    { id: 'money', title: 'Money', cards: [moneyCard(d), debtCard(d)] },
  ];
}

/**
 * Today, wide: how many things are planned, the first few in the order the
 * day runs, and the next reminder. On a low day, only what a low day keeps.
 */
export function todayCard(d: HomeData): Card & { id: 'today' } {
  const low = isLowDay(d.settings, d.today);
  const agenda = agendaFor(d.today, d.tasks, d.subs, d.debtView.payments);
  const open = agenda.filter((i) => i.kind === 'task' && i.task && !i.task.doneAt);
  const shown = low ? open.filter((i) => fitsLowDay(i.task!, d.today)) : open;
  const done = agenda.filter((i) => i.kind === 'task' && i.task?.doneAt).length;
  const goingOut = agenda.filter((i) => i.kind === 'billing' || i.kind === 'payment');

  const rows = [
    ...shown.map((i) => ({ when: i.startTime ? timeLabel(i.startTime) : 'Any time', what: i.title })),
    // Money is never on a low day's list, so a low day leaves it out here too.
    ...(low ? [] : goingOut.map((i) => ({ when: i.paid ? 'Paid' : 'Goes out', what: i.title }))),
  ];
  const list = rows.slice(0, TODAY_LISTED);
  const more = rows.length - list.length;

  const lines: string[] = [];
  if (low) lines.push('A low day: only what has a time, is Critical or is marked doable on a low day');
  if (shown.length === 0) lines.push(open.length > 0 ? 'Nothing that needs doing today' : 'Nothing planned for today');
  if (more > 0) lines.push(`and ${more} more`);
  if (done > 0) lines.push(`${done} done today`);
  const reminder = nextReminder(d.tasks, d.now);
  if (reminder) lines.push(`Next reminder: ${cutTitle(reminder.title)}, ${shortDateTime(reminder.remindAt!, d.now)}`);

  return {
    id: 'today',
    title: 'Today',
    figure: shown.length > 0 ? countOf(shown.length, 'thing to do', 'things to do') : undefined,
    list,
    lines,
    wide: true,
  };
}

/** The soonest reminder still to come on an open task. */
export function nextReminder(tasks: Task[], now: number): Task | null {
  let next: Task | null = null;
  for (const t of tasks) {
    if (t.doneAt || t.remindAt === undefined || t.remindAt <= now) continue;
    if (!next || t.remindAt < next.remindAt!) next = t;
  }
  return next;
}

export function inboxCard(d: HomeData): Card & { id: 'inbox' } {
  return {
    id: 'inbox',
    title: 'Inbox',
    figure: String(d.inboxCount),
    lines: [d.inboxCount === 0 ? 'Nothing to sort' : 'to sort'],
  };
}

/**
 * Tasks: what has a date in the coming week, and the next of them. What is
 * still waiting from earlier days is said as a plain count, never as late.
 */
export function tasksCard(d: HomeData): Card & { id: 'tasks' } {
  const end = addDays(d.today, WEEK_DAYS - 1);
  const coming = d.tasks
    .filter((t) => !t.doneAt && t.date && t.date >= d.today && t.date <= end)
    .sort((a, b) => a.date!.localeCompare(b.date!) || (a.startTime ?? '99').localeCompare(b.startTime ?? '99'));
  const waiting = stillOpen(d.tasks, d.today).length;
  const lines = [coming.length === 0 ? 'Nothing dated this week' : 'this week'];
  if (coming[0]) lines.push(`Next: ${cutTitle(coming[0].title)}, ${describeDate(coming[0].date!, d.today)}`);
  if (waiting > 0) lines.push(`${countOf(waiting, 'task', 'tasks')} from earlier still here`);
  return { id: 'tasks', title: 'Tasks', figure: String(coming.length), lines };
}

/** Backlog: how many things have no day, and the one at the top. Routines are not counted. */
export function backlogCard(d: HomeData): Card & { id: 'backlog' } {
  const open = sortTasks(
    unscheduled(d.tasks).filter((t) => !t.routine),
    'priority',
  );
  const lines = [open.length === 0 ? 'Nothing outstanding' : 'to get to'];
  if (open[0]) lines.push(`Top: ${cutTitle(open[0].title)}`);
  return { id: 'backlog', title: 'Backlog', figure: String(open.length), lines };
}

/** Notes: how many, and what is kept at the top. */
export function notesCard(d: HomeData): Card & { id: 'notes' } {
  const pinned = d.notes.filter((n) => n.pinned);
  const lines = [d.notes.length === 0 ? 'Nothing written down yet' : d.notes.length === 1 ? 'note' : 'notes'];
  if (pinned.length === 1) lines.push(`At the top: ${cutTitle(pinned[0].title || 'Untitled')}`);
  else if (pinned.length > 1) lines.push(`${pinned.length} kept at the top`);
  return { id: 'notes', title: 'Notes', figure: String(d.notes.length), lines };
}

/**
 * Money: what is still to come out before the next payday - the same figure
 * Money's Coming out opens on, read from the same place - and the next thing
 * to go. With amounts blurred, the figure is left out and the line says what
 * it would have been.
 */
export function moneyCard(d: HomeData): Card & { id: 'money' } {
  const { settings, today, money } = d;
  if (!money.hasCharges) {
    return { id: 'money', title: 'Money', lines: ['Add a subscription or your income to see what is coming out'] };
  }
  const figure = money.stillToCome ?? money.month;
  const what = money.stillToCome ? 'still to come out before your next payday' : 'still to come out this month';
  const lines = [settings.blurAmounts ? `What is ${what}` : what];
  if (money.next) lines.push(`Next: ${cutTitle(money.next.title)}, ${describeDate(money.next.date, today)}`);
  return {
    id: 'money',
    title: 'Money',
    figure: settings.blurAmounts ? undefined : formatMoney(figure.minor, settings.currency),
    lines,
  };
}

/**
 * Debt: what this paycheck puts toward debt - the Debt page's one large
 * figure - and when everything is paid off, when the plan finishes.
 */
export function debtCard(d: HomeData): Card & { id: 'debt' } {
  const { settings, debtView: view } = d;
  if (d.openDebts === 0) {
    return { id: 'debt', title: 'Debt', lines: ['Add a debt to see a plan for paying it off'] };
  }
  // The same check the Debt page calls "This paycheck".
  const check = view.checks[0];
  const lines: string[] = [];
  let figure: string | undefined;
  if (check && view.planned.length > 0) {
    if (settings.blurAmounts) lines.push('What this paycheck puts toward debt');
    else {
      figure = formatMoney(check.towardDebtMinor, settings.currency);
      lines.push('toward debt from this paycheck');
    }
  } else {
    lines.push(`${countOf(d.openDebts, 'debt', 'debts')} being paid`);
  }
  if (view.planned.length > 0 && view.result.status === 'paidOff' && view.result.paidOffOn) {
    lines.push(`All paid off by ${monthYear(view.result.paidOffOn)}`);
  }
  return { id: 'debt', title: 'Debt', figure, lines };
}
