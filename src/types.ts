/**
 * Four buckets, with rules simple enough to never have to think about:
 *
 *   Capture  - anything at all, unsorted. Zero decisions required.
 *   Task     - something to do. Optionally scheduled, optionally reminds you.
 *   Note     - something to remember or look up later.
 *   Subscription - recurring money leaving your account.
 *
 * A reminder is a *property of a task*, not a fifth bucket, so there is never
 * a moment of "is this a task or a reminder?".
 */

export type Id = string;

/** 'YYYY-MM-DD' in local time. Never a Date object in storage - those serialise badly. */
export type DateKey = string;
/** 'HH:MM' in 24h local time. */
export type TimeKey = string;

export interface Capture {
  id: Id;
  text: string;
  createdAt: number;
  /** Set once it has been turned into a task/note or explicitly dismissed. */
  clearedAt?: number;
}

export interface Step {
  id: Id;
  text: string;
  done: boolean;
}

export type Energy = 'low' | 'medium' | 'high';

export interface Recurrence {
  kind: 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** Every N days/weeks/months/years. 1 = every one. */
  every: number;
  /** For weekly: 0=Sunday .. 6=Saturday. Empty means "same weekday as the start date". */
  weekdays?: number[];
}

export interface Task {
  id: Id;
  title: string;
  notes: string;
  /** Broken-down sub-steps. The whole point is that "big thing" becomes startable. */
  steps: Step[];
  tags: string[];
  energy?: Energy;

  /** The day this is planned for. Absent = unscheduled, which is fine and not a failure. */
  date?: DateKey;
  startTime?: TimeKey;
  durationMin?: number;

  /** Epoch ms for a notification. Absent = no nagging. */
  remindAt?: number;
  /** Last time we actually showed a notification for this, so we never double-fire. */
  remindedAt?: number;

  recurrence?: Recurrence;

  doneAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Note {
  id: Id;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export type BillingCycle = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface Subscription {
  id: Id;
  name: string;
  /** Integer minor units (pence/cents). Floats and money do not mix. */
  amountMinor: number;
  currency: string;
  cycle: BillingCycle;
  /** Every N cycles, e.g. every 2 months. */
  every: number;
  /** First billing date; every future date is derived from this. */
  firstBilled: DateKey;
  category?: string;
  notes: string;
  /**
   * How to actually cancel it. Written down at signup time, when you still know,
   * rather than hunted for at 11pm when you don't.
   */
  cancelHow: string;
  /** Warn this many days before each charge. 0 = never. */
  remindDaysBefore: number;
  /** Set when cancelled; kept for history rather than deleted. */
  endedOn?: DateKey;
  createdAt: number;
  updatedAt: number;
}

/**
 * How often you are paid. US payroll distinguishes two that sound alike and are
 * not: every 2 weeks is 26 cheques a year on a 14-day interval, twice a month
 * is 24 on fixed dates. Conflating them misstates annual income by two whole
 * paycheques.
 */
export type PayFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

/**
 * What happens when a payday lands on a weekend. Most US employers pay the
 * Friday before rather than late; some pay the Monday after.
 */
export type WeekendShift = 'none' | 'friday' | 'monday';

/** Re-exported so IncomeSource does not drag a lib import into the type file. */
export type HolidayId =
  | 'newYear'
  | 'goodFriday'
  | 'memorial'
  | 'independence'
  | 'labor'
  | 'thanksgiving'
  | 'thanksgivingFriday'
  | 'christmas';

/** One line off a paystub between gross and net. */
export interface Deduction {
  id: Id;
  label: string;
  amountMinor: number;
}

export interface IncomeSource {
  id: Id;
  name: string;
  frequency: PayFrequency;
  /**
   * Any past payday, for the interval frequencies. Every other payday is
   * counted from here, so it only has to be right once.
   */
  firstPaid?: DateKey;
  /**
   * Which days of the month you are paid, for the fixed-date frequencies.
   * Values are clamped to the month's length, so 31 means "the last day" and
   * lands on the 28th in February - no special case needed.
   */
  daysOfMonth?: number[];
  /** Absent on records saved before this existed; treated as 'friday'. */
  weekendShift?: WeekendShift;
  /**
   * Which holidays this employer closes for. Absent means the default set; an
   * explicit empty array means none, and the two are not the same thing.
   */
  holidays?: HolidayId[];

  /**
   * Both taken straight off the stub rather than calculated. This app does not
   * estimate anyone's tax: rates vary by state and filing status and change
   * yearly, and a plausible wrong number in your budget is worse than no
   * number. Typed in, they are right by construction.
   */
  grossMinor: number;
  netMinor: number;
  /** The lines explaining the gap. Partial lists are fine - see unitemisedMinor. */
  deductions: Deduction[];

  currency: string;
  notes: string;
  /** Kept rather than deleted, like a cancelled subscription. */
  endedOn?: DateKey;
  createdAt: number;
  updatedAt: number;
}

export type ThemeName = 'calm' | 'dark' | 'contrast';

export interface Settings {
  id: 'settings';
  theme: ThemeName;
  /** 0.9 - 1.6, multiplies the base font size. */
  textScale: number;
  reduceMotion: boolean;
  /** Hide the money totals until tapped, for when seeing them is too much today. */
  blurAmounts: boolean;
  currency: string;
  /** Days ahead that "coming up" looks. */
  lookaheadDays: number;
  notificationsAsked: boolean;
  /**
   * The build we last told the user about. Deliberately optional with no
   * default: `undefined` is what marks a first-ever launch, and a default would
   * suppress the update notice permanently.
   */
  lastSeenBuild?: string;
  /** Offer tag suggestions learned from your own notes. */
  suggestTags: boolean;
  /** Bumped by backup import so views know to refetch. */
  rev: number;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  theme: 'calm',
  textScale: 1,
  reduceMotion: false,
  blurAmounts: false,
  currency: 'USD',
  lookaheadDays: 14,
  notificationsAsked: false,
  suggestTags: true,
  rev: 0,
};
