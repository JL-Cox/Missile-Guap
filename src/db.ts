import Dexie, { type Table } from 'dexie';
import { DEFAULT_HOLIDAYS } from './lib/holidays';
import {
  DEFAULT_SETTINGS,
  type Capture,
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
  }
}

export const db = new SteadyDb();

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
