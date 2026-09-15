import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, BackupError, backupFilename, parseBackup } from '../src/lib/backup';

const good = JSON.stringify({
  format: BACKUP_FORMAT,
  version: 1,
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
