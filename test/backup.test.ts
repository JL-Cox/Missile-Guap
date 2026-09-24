import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT,
  BackupError,
  DEVICE_SETTINGS,
  withoutDeviceSettings,
  backupFilename,
  countBackup,
  describeCounts,
  parseBackup,
  totalRecords,
} from '../src/lib/backup';

const good = JSON.stringify({
  format: BACKUP_FORMAT,
  version: 2,
  exportedAt: '2026-09-15T10:00:00.000Z',
  tasks: [{ id: 't1', title: 'Ring the dentist' }],
  notes: [],
  captures: [],
  subscriptions: [],
  settings: { theme: 'dark' },
});

describe('parseBackup', () => {
  it('accepts a file this app wrote', () => {
    const backup = parseBackup(good);
    expect(backup.tasks).toHaveLength(1);
    expect(backup.settings).toEqual({ theme: 'dark' });
  });

  it('fills in missing collections rather than throwing', () => {
    const partial = JSON.stringify({ format: BACKUP_FORMAT, version: 1, tasks: [] });
    const backup = parseBackup(partial);
    expect(backup.notes).toEqual([]);
    expect(backup.subscriptions).toEqual([]);
  });

  // Every rejection below must leave the user's existing data alone. The
  // messages say so in plain words, because a scary error at restore time is
  // exactly when someone panics and does something worse.
  it('rejects a file that is not JSON', () => {
    expect(() => parseBackup('not json at all')).toThrow(BackupError);
    expect(() => parseBackup('not json at all')).toThrow(/isn't valid JSON/);
  });

  it('rejects JSON from some other app', () => {
    expect(() => parseBackup('{"notes":["hello"]}')).toThrow(/not exported by Steady/);
  });

  it('refuses a backup from a newer version rather than mangling it', () => {
    const future = JSON.stringify({ format: BACKUP_FORMAT, version: 99 });
    expect(() => parseBackup(future)).toThrow(/newer version/);
  });

  it('rejects a JSON literal that is not an object', () => {
    expect(() => parseBackup('null')).toThrow(BackupError);
    expect(() => parseBackup('42')).toThrow(BackupError);
    expect(() => parseBackup('"a string"')).toThrow(BackupError);
  });
});

describe('backupFilename', () => {
  it('sorts chronologically in a file manager', () => {
    expect(backupFilename(new Date(2026, 8, 5))).toBe('steady-backup-2026-09-05.json');
    expect(backupFilename(new Date(2026, 11, 31))).toBe('steady-backup-2026-12-31.json');
  });
});


describe('income in backups', () => {
  it('round-trips income sources', () => {
    const withIncome = JSON.stringify({
      format: BACKUP_FORMAT,
      version: 2,
      incomes: [{ id: 'i1', name: 'Main job', frequency: 'semimonthly', grossMinor: 250_000, netMinor: 185_000 }],
    });
    expect(parseBackup(withIncome).incomes).toHaveLength(1);
    expect(parseBackup(withIncome).incomes[0].name).toBe('Main job');
  });

  it('still restores a backup written before income existed', () => {
    // Someone's v1 backup from last week must not become unreadable because a
    // feature was added afterwards.
    const v1 = JSON.stringify({ format: BACKUP_FORMAT, version: 1, notes: [{ id: 'n1' }] });
    const parsed = parseBackup(v1);
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.incomes).toEqual([]);
  });

  it('refuses a backup from a future version rather than losing what it cannot read', () => {
    // Version 3 (debts) is this version now; 4 is the next one.
    const v4 = JSON.stringify({ format: BACKUP_FORMAT, version: 4 });
    expect(() => parseBackup(v4)).toThrow(/newer version/);
  });
});

describe('debts in backups', () => {
  it('round-trips debts and the debt plan', () => {
    const withDebts = JSON.stringify({
      format: BACKUP_FORMAT,
      version: 3,
      debts: [{ id: 'd1', name: 'Blue card', balanceMinor: 200_000 }],
      debtPlan: [{ id: 'plan', strategy: 'snowball', untrackedMonthlyMinor: 180_000 }],
    });
    const parsed = parseBackup(withDebts);
    expect(parsed.debts.map((d) => d.name)).toEqual(['Blue card']);
    expect(parsed.debtPlan[0].strategy).toBe('snowball');
    expect(countBackup(parsed)).toMatchObject({ debts: 1, debtPlan: 1 });
  });

  it('still restores a backup written before debts existed', () => {
    const v2 = JSON.stringify({ format: BACKUP_FORMAT, version: 2, incomes: [{ id: 'i1' }] });
    const parsed = parseBackup(v2);
    expect(parsed.incomes).toHaveLength(1);
    expect(parsed.debts).toEqual([]);
    expect(parsed.debtPlan).toEqual([]);
  });

  it('names debts and the plan in the counts', () => {
    expect(describeCounts({ debts: 2, debtPlan: 1 })).toBe(
      '0 tasks, 0 notes, 0 subscriptions, 0 incomes, 2 debts, 1 debt plan, 0 inbox items',
    );
  });
});

describe('what a backup holds, said before anything is touched', () => {
  it('counts every kind of record in the file', () => {
    const file = parseBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: 2,
        tasks: [{ id: 't1' }, { id: 't2' }],
        notes: [{ id: 'n1' }],
        incomes: [{ id: 'i1' }],
      }),
    );
    expect(countBackup(file)).toEqual({ captures: 0, tasks: 2, notes: 1, subscriptions: 0, incomes: 1, debts: 0, debtPlan: 0 });
    expect(totalRecords(countBackup(file))).toBe(4);
  });

  it('names income, which the old count line left out', () => {
    expect(describeCounts({ tasks: 42, notes: 18, subscriptions: 9, incomes: 1, captures: 3 })).toBe(
      '42 tasks, 18 notes, 9 subscriptions, 1 income, 0 debts, 0 debt plans, 3 inbox items',
    );
  });

  it('uses the singular for one and still names a kind at zero', () => {
    expect(describeCounts({ tasks: 1 })).toBe(
      '1 task, 0 notes, 0 subscriptions, 0 incomes, 0 debts, 0 debt plans, 0 inbox items',
    );
  });
});

describe('settings a backup never carries', () => {
  it('include the low day', () => {
    expect(DEVICE_SETTINGS).toContain('lowDay');
  });

  it('do not include which sections are folded, which is a preference that travels', () => {
    expect(DEVICE_SETTINGS).not.toContain('sections');
    const sections = { 'today.bills': false };
    expect(withoutDeviceSettings({ theme: 'dark', lowDay: '2026-09-23', sections })).toEqual({ theme: 'dark', sections });
  });

  it('are taken out of a copy, leaving the rest and the original alone', () => {
    const settings = { id: 'settings', theme: 'dark', lowDay: '2026-09-23' };
    expect(withoutDeviceSettings(settings)).toEqual({ id: 'settings', theme: 'dark' });
    expect(settings.lowDay).toBe('2026-09-23');
  });
});
