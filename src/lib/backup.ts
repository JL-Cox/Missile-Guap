import type { Table } from 'dexie';
import { db, getSettings, saveSettings } from '../db';
import type { Capture, IncomeSource, Note, Settings, Subscription, Task } from '../types';

/**
 * Your data, in a plain readable file, on demand. This is the difference
 * between "we promise not to lock you in" and not being able to lock you in.
 */

export const BACKUP_FORMAT = 'steady-backup';
export const BACKUP_VERSION = 2;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  captures: Capture[];
  tasks: Task[];
  notes: Note[];
  subscriptions: Subscription[];
  incomes: IncomeSource[];
  settings: Record<string, unknown>;
}

/**
 * The tables a backup carries: everything you wrote. Settings travel
 * separately, merged rather than replaced. test/data-coverage.test.ts fails if
 * this ever stops matching the database's own list, so a table added later
 * cannot be quietly left out of the backup file.
 */
export const BACKUP_TABLES = ['captures', 'tasks', 'notes', 'subscriptions', 'incomes'] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];

export async function exportBackup(): Promise<Backup> {
  const [rows, settings] = await Promise.all([
    Promise.all(BACKUP_TABLES.map((name) => db.table(name).toArray())),
    getSettings(),
  ]);
  const tables = Object.fromEntries(BACKUP_TABLES.map((name, i) => [name, rows[i]])) as Pick<Backup, BackupTable>;
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    ...tables,
    settings: settings as unknown as Record<string, unknown>,
  };
}

export class BackupError extends Error {}

export function parseBackup(raw: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new BackupError("That file isn't valid JSON, so it isn't a Steady backup.");
  }
  if (!data || typeof data !== 'object') throw new BackupError('That file is empty.');
  const candidate = data as Partial<Backup>;
  if (candidate.format !== BACKUP_FORMAT) {
    throw new BackupError('That file was not exported by Steady. Nothing has been changed.');
  }
  if (typeof candidate.version !== 'number' || candidate.version > BACKUP_VERSION) {
    throw new BackupError('That backup came from a newer version of Steady. Update the app first.');
  }
  return {
    format: BACKUP_FORMAT,
    version: candidate.version,
    exportedAt: candidate.exportedAt ?? '',
    captures: candidate.captures ?? [],
    tasks: candidate.tasks ?? [],
    notes: candidate.notes ?? [],
    subscriptions: candidate.subscriptions ?? [],
    // Absent from a v1 backup, which is fine - it simply had no income.
    incomes: candidate.incomes ?? [],
    settings: candidate.settings ?? {},
  };
}

export type ImportMode = 'merge' | 'replace';

/** How many records of each kind: in a file, on the phone, or just restored. */
export type RecordCounts = Record<BackupTable, number>;
export type ImportResult = RecordCounts;

/** What a backup file holds, counted before anything is touched. */
export function countBackup(backup: Backup): RecordCounts {
  return Object.fromEntries(
    BACKUP_TABLES.map((name) => [name, Array.isArray(backup[name]) ? backup[name].length : 0]),
  ) as RecordCounts;
}

export function totalRecords(counts: Partial<RecordCounts>): number {
  return BACKUP_TABLES.reduce((sum, name) => sum + (counts[name] ?? 0), 0);
}

const NOUNS: Record<BackupTable, [string, string]> = {
  tasks: ['task', 'tasks'],
  notes: ['note', 'notes'],
  subscriptions: ['subscription', 'subscriptions'],
  incomes: ['income', 'incomes'],
  captures: ['inbox item', 'inbox items'],
};

/** The order things are named in, most-used first. */
const SPOKEN_ORDER: BackupTable[] = ['tasks', 'notes', 'subscriptions', 'incomes', 'captures'];

/**
 * "42 tasks, 18 notes, 9 subscriptions, 1 income, 3 inbox items".
 *
 * Every kind is named, even at zero, so a count never silently skips one - the
 * old line left income out, which is how nobody noticed "Delete everything"
 * was leaving it behind.
 */
export function describeCounts(counts: Partial<RecordCounts>): string {
  return SPOKEN_ORDER.map((name) => {
    const n = counts[name] ?? 0;
    return `${n} ${NOUNS[name][n === 1 ? 0 : 1]}`;
  }).join(', ');
}

/** "21 Sep 2026", in the phone's own date style, or '' if the file has no date. */
export function backupDate(backup: Backup): string {
  const when = backup.exportedAt ? new Date(backup.exportedAt) : null;
  if (!when || Number.isNaN(when.getTime())) return '';
  return when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * `merge` keeps anything already here and only adds records whose id is new,
 * so restoring an old backup can never silently delete this week's work.
 * `replace` is the deliberate "wipe and restore": the screen shows what the
 * file holds and asks before this is ever called with it.
 */
export async function importBackup(backup: Backup, mode: ImportMode): Promise<ImportResult> {
  /** Restores one table and reports how many rows it actually wrote. */
  async function restore<T extends { id: string }>(table: Table<T, string>, rows: unknown[]): Promise<number> {
    if (!Array.isArray(rows)) return 0;
    const valid = rows.filter((r): r is T => Boolean(r) && typeof (r as { id?: unknown }).id === 'string');
    if (mode === 'replace') {
      await table.bulkPut(valid);
      return valid.length;
    }
    const existing = new Set(await table.toCollection().primaryKeys());
    const fresh = valid.filter((r) => !existing.has(r.id));
    await table.bulkPut(fresh);
    return fresh.length;
  }

  const tables = BACKUP_TABLES.map((name) => db.table(name) as Table<{ id: string }, string>);
  const written: number[] = [];
  await db.transaction('rw', tables, async () => {
    if (mode === 'replace') await Promise.all(tables.map((t) => t.clear()));
    // One at a time, so the counts line up with the names.
    for (let i = 0; i < tables.length; i++) written[i] = await restore(tables[i], backup[BACKUP_TABLES[i]]);
  });
  const result = Object.fromEntries(BACKUP_TABLES.map((name, i) => [name, written[i] ?? 0])) as ImportResult;

  if (mode === 'replace' && backup.settings && typeof backup.settings === 'object') {
    const { id: _ignored, ...rest } = backup.settings as Record<string, unknown>;
    await saveSettings(rest as Partial<Settings>);
  }
  // Nudge every view to refetch after the tables changed underneath them.
  const settings = await getSettings();
  await saveSettings({ rev: settings.rev + 1 });
  return result;
}

/** Trigger a file download without ever touching the network. */
export function downloadFile(filename: string, contents: string, mime: string): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the download a beat to start before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function backupFilename(now: Date = new Date()): string {
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `steady-backup-${stamp}.json`;
}
