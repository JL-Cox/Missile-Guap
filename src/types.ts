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

/**
 * How pressing something is.
 *
 * Optional, like every other field on a task: not choosing is a valid answer and
 * the form never demands one. An unset priority is not "lowest" - it is "nobody
 * has decided yet", which is why it sorts after everything that has been decided
 * rather than below Low.
 */
export type Priority = 'low' | 'medium' | 'high' | 'critical';

/**
 * How the Backlog is ordered. Declared here rather than in `lib/priority.ts` for
 * the same reason as HolidayId: Settings stores it, and the type file must not
 * drag a lib import in behind it.
 */
export type BacklogSort = 'priority' | 'oldest' | 'newest' | 'az';

export interface Recurrence {
  kind: 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** Every N days/weeks/months/years. 1 = every one. */
  every: number;
  /** For weekly: 0=Sunday .. 6=Saturday. Empty means "same weekday as the start date". */
  weekdays?: number[];
  /**
   * For monthly and yearly: the day of the month it belongs on, 1-31. Kept so a
   * repeat on the 31st goes 31 Jan -> 28 Feb -> 31 Mar, rather than stepping
   * from the 28th and staying there. Absent on repeats saved before this
   * existed; they take it from their date the next time they roll forward.
   */
  anchorDay?: number;
}

export interface Task {
  id: Id;
  title: string;
  notes: string;
  /** Broken-down sub-steps. The whole point is that "big thing" becomes startable. */
  steps: Step[];
  tags: string[];
  energy?: Energy;
  /** Absent means nobody has said. See Priority - that is not the same as Low. */
  priority?: Priority;

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
  /**
   * For a repeating task: when it was last ticked off. A repeat rolls forward
   * rather than staying done, so without this "did I already take it today?"
   * has no answer on screen. A plain fact - never a streak or a count.
   */
  lastDoneAt?: number;
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

/**
 * How often a subscription takes money. These come in the same two shapes as
 * pay schedules, and for the same reason they must not be conflated: every 2
 * weeks is 26 charges a year on a 14-day interval, twice a month is 24 on set
 * dates.
 */
export type BillingCycle = 'weekly' | 'semimonthly' | 'monthly' | 'quarterly' | 'yearly';

/** Cycles that are a fixed number of days or months apart. */
export type IntervalCycle = Exclude<BillingCycle, 'semimonthly'>;

/** Cycles pinned to days of the month, where `every` means nothing. */
export type FixedDayCycle = 'semimonthly';

export interface Subscription {
  id: Id;
  name: string;
  /** Integer minor units (pence/cents). Floats and money do not mix. */
  amountMinor: number;
  currency: string;
  cycle: BillingCycle;
  /** Every N cycles, e.g. every 2 months. Ignored by the fixed-day cycles. */
  every: number;
  /**
   * First billing date. For the interval cycles every future date is derived
   * from this one; for a twice-a-month subscription it is only the start, and
   * `daysOfMonth` says which dates it lands on.
   */
  firstBilled: DateKey;
  /**
   * Which days of the month it charges on, for the fixed-date cycles. Values
   * are clamped to the month's length, so 31 means "the last day" and lands on
   * the 28th in February - the same rule income uses.
   */
  daysOfMonth?: number[];
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

/**
 * The themes that ship as token blocks in `src/styles.css`.
 *
 * This list is the contract: `test/theme.test.ts` reads the stylesheet and fails
 * if a name here has no block, or a block exists that is not named here. Adding a
 * theme means adding it in both places, on purpose.
 *
 * Nothing is ever renamed or removed. A theme name is a saved preference on
 * somebody's phone, and a preference that silently stops existing is a bug.
 */
export const BUILT_IN_THEMES = ['calm', 'amber', 'overcast', 'dark', 'midnight', 'contrast'] as const;
export type BuiltInTheme = (typeof BUILT_IN_THEMES)[number];

/** 'custom' has no CSS block - its tokens are assembled in src/lib/theme.ts. */
export type ThemeName = BuiltInTheme | 'custom';

/**
 * A custom theme is two named picks, never a colour wheel. The ground carries the
 * whole neutral ramp, so the part that decides whether text is readable is not
 * adjustable; the accent is the one colour the app is allowed to use. Every
 * combination is contrast-checked in the tests, which is why there is no warning
 * anywhere in the UI - an unreadable pair cannot be expressed.
 */
export type GroundId = 'warmWhite' | 'coolWhite' | 'sepia' | 'warmNight' | 'trueBlack';
export type AccentId = 'sage' | 'teal' | 'slate' | 'indigo' | 'plum' | 'clay' | 'ochre' | 'ink';

export interface CustomTheme {
  ground: GroundId;
  accent: AccentId;
}

/**
 * What a reminder notification says. It can show on the lock screen and on a
 * paired watch, so the default says only the title and the time - never notes.
 *
 *   titleTime  - "Ring the dentist", "Reminder for 9:00 AM"
 *   generic    - "Steady", "You have a reminder"
 *   titleNotes - the title, and the task's notes as the body
 */
export type ReminderContent = 'titleTime' | 'generic' | 'titleNotes';

export interface Settings {
  id: 'settings';
  theme: ThemeName;
  /**
   * The colours behind `theme: 'custom'`. Optional with no default: settings are
   * merged over DEFAULT_SETTINGS, so an absent field needs no database migration,
   * and someone who has never opened the custom editor stores nothing at all.
   */
  customTheme?: CustomTheme;
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
  /** How the Backlog was last sorted. Remembered so the list opens as you left it. */
  backlogSort: BacklogSort;
  /**
   * What a reminder notification shows. Added after release: settings are
   * merged over DEFAULT_SETTINGS, so a phone that never stored it reads the
   * default and nothing needs migrating.
   */
  reminderContent: ReminderContent;
  /**
   * Whether calendar entries carry notes, steps and how-to-cancel text. Off by
   * default: a calendar is often copied to a Google account, and cancel steps
   * can hold logins. Titles, dates and amounts go in either way.
   */
  calendarIncludeNotes: boolean;
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
  backlogSort: 'priority',
  reminderContent: 'titleTime',
  calendarIncludeNotes: false,
  rev: 0,
};
