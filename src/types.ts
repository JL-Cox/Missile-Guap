/**
 * Four buckets, with rules simple enough to never have to think about:
 *
 *   Capture  - anything at all, unsorted. Zero decisions required.
 *   Task     - something to do. Optionally scheduled, optionally reminds you.
 *   Note     - something to remember or look up later.
 *   Subscription - recurring money leaving your account.
 *
 * Money has two more record kinds alongside subscriptions: income, and debts
 * with the one-row plan for paying them off.
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
   * For a repeating task or a routine: when it was last ticked off. Neither
   * stays done - a repeat rolls forward, a routine unticks its steps - so
   * without this "did I already take it today?" has no answer on screen. A
   * plain fact - never a streak or a count.
   */
  lastDoneAt?: number;
  /**
   * "Reuse these steps each time". Ticking it off records when, unticks the
   * steps and keeps it, rather than finishing it - for the checklists you run
   * again and again, like leaving the house or the weekly shop.
   */
  routine?: boolean;
  /**
   * Set only by "Getting ready for an appointment" in the editor, never guessed
   * from the title. From the task's day onward its row offers to write down
   * what was said.
   */
  appointment?: boolean;
  /**
   * The note written after the appointment, so the row opens it again rather
   * than starting a second one. A link, not ownership: deleting the task
   * leaves the note where it is, and a note deleted since just means the row
   * offers to write one again.
   */
  followUpNoteId?: Id;
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
 * What sort of debt something is. It only picks the presets and the labels in
 * the form: the payoff engine never branches on it, so a debt filed under the
 * "wrong" kind is still planned exactly right from the numbers typed.
 */
export type DebtKind =
  | 'creditCard'
  | 'storeCard'
  | 'personalLoan'
  | 'autoLoan'
  | 'studentFederal'
  | 'studentPrivate'
  | 'medical'
  | 'bnpl'
  | 'lineOfCredit'
  | 'person'
  | 'other';

/**
 * How the required payment is worked out each month. Money in cents; percent
 * as typed, so 1 means 1%.
 *
 *   fixed               - loans, buy now pay later, medical plans, family. 0 is
 *                         "no set amount", which is allowed.
 *   percentPlusInterest - most cards: 1% of the balance plus the month's
 *                         interest and fees, never less than the floor. 0% with
 *                         a $0 floor is "interest only", like a HELOC draw.
 *   percentOfBalance    - some store cards: e.g. 3% of the balance, at least $30.
 */
export type MinimumRule =
  | { kind: 'fixed'; amountMinor: number }
  | { kind: 'percentPlusInterest'; percent: number; floorMinor: number }
  | { kind: 'percentOfBalance'; percent: number; floorMinor: number };

/** A lower rate for now: an intro rate, a balance transfer, "no interest if paid in full". */
export interface DebtPromo {
  /** Usually 0. */
  aprPercent: number;
  /** The last day the promo rate applies - the "paid in full by" date, inclusive. */
  endsOn: DateKey;
  /**
   * True for "no interest if paid in full": if the promo balance is not
   * cleared by the end date, the interest since the purchase is added back.
   */
  deferred: boolean;
  /** The part of the balance on the promo, as of balanceAsOf. Absent means all of it. */
  balanceMinor?: number;
  /** Deferred only: interest held back so far, which some statements show, as of balanceAsOf. */
  heldBackMinor?: number;
}

/**
 * Something being paid back. Every number is typed by hand from a statement or
 * an app - nothing is looked up - and there is deliberately no field for an
 * account number, a login or anything else that would be worth stealing.
 */
export interface Debt {
  id: Id;
  name: string;
  kind: DebtKind;
  balanceMinor: number;
  /** When the balance was typed. The plan starts from it today either way. */
  balanceAsOf: DateKey;
  /** Absent is "not added yet": planned as 0 and flagged, never guessed. */
  aprPercent?: number;
  minimum: MinimumRule;
  /** Absent means monthly. Pay-in-4 plans are every 2 weeks. */
  cadence?: 'monthly' | 'every2weeks';
  /** 1-31, clamped to the month like every other day of the month here. Needed when monthly. */
  dueDay?: number;
  /** Needed when every 2 weeks: later dates are this plus 14 days at a time. */
  nextDueOn?: DateKey;
  /** Shown as a label only. The maths is the same either way. */
  autopay: boolean;
  promo?: DebtPromo;
  creditLimitMinor?: number;
  /** An annual or monthly fee. A yearly one says which month it lands in, 1-12. */
  fee?: { amountMinor: number; every: 'month' | 'year'; month?: number };
  /**
   * The loan as it was taken out. Used to work out a payment and to say when it
   * was scheduled to finish; the engine itself never reads these.
   */
  loan?: { originalMinor?: number; termMonths?: number; firstPaymentOn?: DateKey };
  /**
   * The latest due date marked "Paid", so a payment already made is not shown
   * as still to come. A single date, never a history of payments.
   */
  paidThrough?: DateKey;
  /** Set by "Mark as paid off". Kept rather than deleted, like a subscription's endedOn. */
  paidOffOn?: DateKey;
  currency: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Which debt gets the money above the minimums first.
 *
 *   avalanche - the highest rate, so the least goes to interest
 *   snowball  - the smallest balance, so whole debts finish sooner
 */
export type DebtStrategy = 'avalanche' | 'snowball';

/**
 * The plan's inputs. One row, id 'plan'.
 *
 * A table rather than a setting, on purpose: "Delete everything" keeps
 * settings, and a spending estimate someone typed is their data, so it has to
 * go with everything else - and travel in a backup with everything else.
 */
export interface DebtPlan {
  id: 'plan';
  strategy: DebtStrategy;
  /**
   * Per income source: the total toward debt from each of its checks, the
   * minimums included. Keeping the total the same while debts finish is how a
   * finished debt's payment rolls on to the next. Absent means none chosen,
   * which keeps paying today's minimums.
   */
  perCheckMinor?: Record<Id, number>;
  /** Used only when no payday can be placed at all. */
  perMonthMinor?: number;
  /** Rent, food, gas and the rest, a month. Absent means not set, so no suggestion is made. */
  untrackedMonthlyMinor?: number;
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
export const BUILT_IN_THEMES = [
  'calm',
  'amber',
  'overcast',
  'dark',
  'midnight',
  'contrast',
  // Just for fun. Opt-in, and held to the same contrast test as the rest.
  'synthwave',
  'bubblegum',
  'aurora',
] as const;
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

/** Minutes out of sight before the app lock closes over the screen. 0 is "immediately". */
export type LockAfter = 0 | 1 | 5 | 15;

/**
 * The optional app lock, as stored. Everything needed to check a PIN or the
 * recovery phrase, and nothing else: never the PIN, never the phrase, not how
 * long the PIN is, and no record of attempts. See src/lib/lock.ts.
 *
 * It belongs to this phone, not to your data, so it never goes into a backup
 * file and a restore can neither set it nor clear it.
 */
export interface AppLock {
  /** PBKDF2-SHA256 of the PIN, base64. */
  pinHash: string;
  /** 16 random bytes, base64, made fresh every time a PIN is set. */
  pinSalt: string;
  /** PBKDF2-SHA256 of the recovery phrase, base64. */
  phraseHash: string;
  phraseSalt: string;
  /** Stored rather than assumed, so a later version can raise it without locking anyone out. */
  iterations: number;
  afterMinutes: LockAfter;
}

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
  /**
   * The day "Today is a low day" was turned on for. It is compared with
   * today's date rather than cleared by a timer, so it ends by itself at
   * midnight. One left from an earlier day is deleted, it never goes into a
   * backup and a restore never sets it: no record of low days is kept.
   */
  lowDay?: DateKey;
  /**
   * The app lock, if one is set. Optional with no default, like customTheme:
   * absent means no lock, and nothing is stored for anyone who never sets one.
   * Device-only - see DEVICE_SETTINGS in src/lib/backup.ts.
   */
  lock?: AppLock;
  /**
   * The sections you folded or opened, where that differs from how they start
   * (see src/lib/sections.ts). Optional with no default, like customTheme:
   * someone who never folds anything stores nothing. It holds only fixed
   * section names, never anything you wrote. A preference, so it travels in
   * backups, a restore that replaces everything puts it back, and Delete
   * everything leaves it.
   */
  sections?: Record<string, boolean>;
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
