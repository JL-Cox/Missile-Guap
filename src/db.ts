import Dexie, { type Table } from 'dexie';
import { DEFAULT_HOLIDAYS } from './lib/holidays';
import { todayKey } from './lib/time';
import {
  DEFAULT_SETTINGS,
  type AppLock,
  type Capture,
  type Debt,
  type DebtPlan,
  type IncomeSource,
  type Note,
  type Settings,
  type Subscription,
  type Task,
} from './types';

/**
 * IndexedDB, on this device, in this browser profile. There is no server
 * component to this app - not a private one, not a paid one. If you clear the
 * browser's site data, it is gone, which is why Settings nags about backups.
 */
class SteadyDb extends Dexie {
  captures!: Table<Capture, string>;
  tasks!: Table<Task, string>;
  notes!: Table<Note, string>;
  subscriptions!: Table<Subscription, string>;
  incomes!: Table<IncomeSource, string>;
  debts!: Table<Debt, string>;
  debtPlan!: Table<DebtPlan, string>;
  settings!: Table<Settings, string>;

  constructor() {
    super('steady');
    this.version(1).stores({
      captures: 'id, createdAt, clearedAt',
      tasks: 'id, date, doneAt, remindAt, updatedAt, *tags',
      notes: 'id, updatedAt, pinned, *tags',
      subscriptions: 'id, name, endedOn, updatedAt',
      settings: 'id',
    });
    // Adding a store only. Dexie upgrades in place and nothing already saved
    // is touched, so notes, tasks and subscriptions survive the bump.
    this.version(2).stores({
      incomes: 'id, name, endedOn, updatedAt',
    });
    // Two more stores, added the same way: nothing already saved is touched.
    // The plan is a table rather than a setting because "Delete everything"
    // keeps settings, and a spending estimate you typed has to go with the rest.
    this.version(3).stores({
      debts: 'id, name, paidOffOn, updatedAt',
      debtPlan: 'id',
    });
  }
}

export const db = new SteadyDb();

/**
 * Every table that holds something you wrote - which is every table except
 * settings. Read off the schema above rather than listed by hand, because a
 * hand-kept list is how "Delete everything" once cleared four tables of five
 * and left every paycheck behind while saying it had deleted everything.
 */
export function dataTables(): Table<{ id: string }, string>[] {
  return db.tables.filter((t) => t.name !== 'settings') as Table<{ id: string }, string>[];
}

/**
 * Deletes everything you wrote from this device, in one transaction so it is
 * all or nothing. Settings stay, so the app still looks the way you left it -
 * and so does the app lock, which lives in them. Settings says so.
 */
export async function wipeAll(): Promise<void> {
  const tables = dataTables();
  await db.transaction('rw', tables, async () => {
    await Promise.all(tables.map((t) => t.clear()));
  });
}

/** How many records each table holds, keyed by table name. */
export async function countAll(): Promise<Record<string, number>> {
  const tables = dataTables();
  const counts = await Promise.all(tables.map((t) => t.count()));
  return Object.fromEntries(tables.map((t, i) => [t.name, counts[i]]));
}

export function newId(): string {
  // crypto.randomUUID is available in every browser that can install a PWA.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function getSettings(): Promise<Settings> {
  const stored = await db.settings.get('settings');
  return { ...DEFAULT_SETTINGS, ...stored, id: 'settings' };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch, id: 'settings' as const };
  await db.settings.put(next);
  return next;
}

/**
 * Takes settings out of the stored record altogether. Saving `undefined` would
 * leave the key behind; for something like a low day, "not stored" has to
 * mean not stored. Only optional settings can be forgotten: the rest have a
 * default that would simply come back.
 */
type OptionalSetting = { [K in keyof Settings]-?: undefined extends Settings[K] ? K : never }[keyof Settings];

export async function forgetSettings(...keys: OptionalSetting[]): Promise<Settings> {
  const next: Partial<Settings> = { ...(await getSettings()) };
  for (const key of keys) delete next[key];
  await db.settings.put(next as Settings);
  return next as Settings;
}

/**
 * Sets the app lock, or removes it. Removing deletes the field outright rather
 * than writing `lock: undefined`, so a phone with no lock stores nothing about
 * one. Every other setting is left exactly as it was.
 */
export async function saveLock(lock: AppLock | null): Promise<Settings> {
  const { lock: _previous, ...rest } = await getSettings();
  const next: Settings = lock ? { ...rest, lock } : rest;
  await db.settings.put(next);
  return next;
}

const now = () => Date.now();

export async function addCapture(text: string): Promise<Capture> {
  const capture: Capture = { id: newId(), text: text.trim(), createdAt: now() };
  await db.captures.add(capture);
  return capture;
}

export async function clearCapture(id: string): Promise<void> {
  await db.captures.update(id, { clearedAt: now() });
}

export async function unclearCapture(id: string): Promise<void> {
  await db.captures.update(id, { clearedAt: undefined });
}

export function blankTask(partial: Partial<Task> = {}): Task {
  const ts = now();
  return {
    id: newId(),
    title: '',
    notes: '',
    steps: [],
    tags: [],
    createdAt: ts,
    updatedAt: ts,
    ...partial,
  };
}

export async function saveTask(task: Task): Promise<Task> {
  const next = { ...task, updatedAt: now() };
  await db.tasks.put(next);
  return next;
}

export function blankNote(partial: Partial<Note> = {}): Note {
  const ts = now();
  return { id: newId(), title: '', body: '', tags: [], pinned: false, createdAt: ts, updatedAt: ts, ...partial };
}

export async function saveNote(note: Note): Promise<Note> {
  const next = { ...note, updatedAt: now() };
  await db.notes.put(next);
  return next;
}

export function blankSubscription(partial: Partial<Subscription> = {}): Subscription {
  const ts = now();
  return {
    id: newId(),
    name: '',
    amountMinor: 0,
    currency: DEFAULT_SETTINGS.currency,
    cycle: 'monthly',
    every: 1,
    firstBilled: new Date().toISOString().slice(0, 10),
    notes: '',
    cancelHow: '',
    remindDaysBefore: 3,
    createdAt: ts,
    updatedAt: ts,
    ...partial,
  };
}

export async function saveSubscription(sub: Subscription): Promise<Subscription> {
  const next = { ...sub, updatedAt: now() };
  await db.subscriptions.put(next);
  return next;
}

export function blankIncome(partial: Partial<IncomeSource> = {}): IncomeSource {
  const ts = now();
  return {
    id: newId(),
    name: '',
    frequency: 'biweekly',
    daysOfMonth: [15, 31],
    weekendShift: 'friday',
    holidays: [...DEFAULT_HOLIDAYS],
    grossMinor: 0,
    netMinor: 0,
    deductions: [],
    currency: DEFAULT_SETTINGS.currency,
    notes: '',
    createdAt: ts,
    updatedAt: ts,
    ...partial,
  };
}

export async function saveIncome(source: IncomeSource): Promise<IncomeSource> {
  const next = { ...source, updatedAt: now() };
  await db.incomes.put(next);
  return next;
}

/**
 * A new debt, ready for the form. It starts as a credit card with the usual
 * card minimum - 1% of the balance plus interest, at least $35 - because that
 * is the commonest case and every preset is one tap away. No due day: the form
 * asks for one rather than guessing a date money has to leave on.
 */
export function blankDebt(partial: Partial<Debt> = {}): Debt {
  const ts = now();
  return {
    id: newId(),
    name: '',
    kind: 'creditCard',
    balanceMinor: 0,
    balanceAsOf: todayKey(),
    minimum: { kind: 'percentPlusInterest', percent: 1, floorMinor: 3_500 },
    autopay: false,
    currency: DEFAULT_SETTINGS.currency,
    notes: '',
    createdAt: ts,
    updatedAt: ts,
    ...partial,
  };
}

export async function saveDebt(debt: Debt): Promise<Debt> {
  const next = { ...debt, updatedAt: now() };
  await db.debts.put(next);
  return next;
}

/**
 * The plan as stored, or the default one: least interest first, no amount
 * chosen. The default is not written until something is actually chosen, so
 * someone who never opens the plan has nothing stored about one.
 */
export async function getDebtPlan(): Promise<DebtPlan> {
  const stored = await db.debtPlan.get('plan');
  if (stored) return { ...stored, id: 'plan' };
  const ts = now();
  return { id: 'plan', strategy: 'avalanche', createdAt: ts, updatedAt: ts };
}

/**
 * Changes some of the plan and saves it. A field patched to `undefined` is
 * taken out of the record rather than stored as undefined, so clearing the
 * spending estimate really does leave nothing behind, the same rule
 * forgetSettings follows.
 */
export async function saveDebtPlan(patch: Partial<Omit<DebtPlan, 'id'>>): Promise<DebtPlan> {
  const next: Record<string, unknown> = { ...(await getDebtPlan()), ...patch, id: 'plan', updatedAt: now() };
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  await db.debtPlan.put(next as unknown as DebtPlan);
  return next as unknown as DebtPlan;
}
