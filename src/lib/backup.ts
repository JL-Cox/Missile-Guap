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

export async function exportBackup(): Promise<Backup> {
  const [captures, tasks, notes, subscriptions, incomes, settings] = await Promise.all([
    db.captures.toArray(),
    db.tasks.toArray(),
    db.notes.toArray(),
    db.subscriptions.toArray(),
    db.incomes.toArray(),
    getSettings(),
  ]);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    captures,
    tasks,
    notes,
    subscriptions,
    incomes,
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

export interface ImportResult {
  captures: number;
  tasks: number;
  notes: number;
  subscriptions: number;
  incomes: number;
}

/**
 * `merge` keeps anything already here and only adds records whose id is new,
 * so restoring an old backup can never silently delete this week's work.
 * `replace` is the deliberate "wipe and restore" and says so in the UI.
 */
export async function importBackup(backup: Backup, mode: ImportMode): Promise<ImportResult> {
  const result: ImportResult = { captures: 0, tasks: 0, notes: 0, subscriptions: 0, incomes: 0 };

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

  await db.transaction('rw', [db.captures, db.tasks, db.notes, db.subscriptions, db.incomes], async () => {
    if (mode === 'replace') {
      await Promise.all([
        db.captures.clear(),
        db.tasks.clear(),
        db.notes.clear(),
        db.subscriptions.clear(),
        db.incomes.clear(),
      ]);
    }
    result.captures = await restore(db.captures, backup.captures);
    result.tasks = await restore(db.tasks, backup.tasks);
    result.notes = await restore(db.notes, backup.notes);
    result.subscriptions = await restore(db.subscriptions, backup.subscriptions);
    result.incomes = await restore(db.incomes, backup.incomes);
  });

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
