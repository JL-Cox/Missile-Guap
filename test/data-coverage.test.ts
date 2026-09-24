import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  blankDebt,
  countAll,
  dataTables,
  db,
  forgetSettings,
  getDebtPlan,
  getSettings,
  saveDebt,
  saveDebtPlan,
  saveLock,
  wipeAll,
} from '../src/db';
import {
  BACKUP_TABLES,
  DEVICE_SETTINGS,
  exportBackup,
  importBackup,
  parseBackup,
  withoutDeviceSettings,
  type Backup,
} from '../src/lib/backup';
import { toBase64 } from '../src/lib/lock';
import type { AppLock } from '../src/types';

/**
 * "Delete everything" once cleared four tables out of five and then said
 * everything had been deleted - the paychecks stayed. These tests hold every
 * path that promises to cover "all your data" to the real schema, so a table
 * added later cannot be quietly left out of any of them.
 *
 * There is no IndexedDB in the test runner and no fake one in the project, so
 * the tables' storage methods are stood in for with an in-memory map. The table
 * *list* is the real one Dexie builds from src/db.ts.
 */

const declared = db.tables.map((t) => t.name).sort();
const dataNames = declared.filter((n) => n !== 'settings');

/** Rows per table, standing in for IndexedDB. */
let store: Record<string, { id: string }[]>;

function fakeStorage(seed: Record<string, { id: string }[]>) {
  store = Object.fromEntries(declared.map((n) => [n, [...(seed[n] ?? [])]]));
  // Dexie hands out the same table by two routes - `db.table(name)` and the
  // named property `db.notes` - as separate objects, so both are covered.
  const routes = [...db.tables, ...declared.map((n) => (db as unknown as Record<string, typeof db.tables[number]>)[n])];
  for (const table of routes) {
    const name = table.name;
    // Dexie's methods return its own promise type; plain promises stand in fine.
    const fake = (method: string, impl: (...args: never[]) => unknown) =>
      vi.spyOn(table as unknown as Record<string, () => unknown>, method).mockImplementation(impl as never);
    fake('clear', async () => {
      store[name] = [];
    });
    fake('count', async () => store[name].length);
    fake('toArray', async () => [...store[name]]);
    fake('get', async (key: never) => store[name].find((r) => r.id === key));
    fake('put', async (row: never) => {
      const r = row as { id: string };
      store[name] = [...store[name].filter((x) => x.id !== r.id), r];
      return r.id;
    });
    fake('bulkPut', async (rows: never) => {
      for (const r of rows as { id: string }[]) store[name] = [...store[name].filter((x) => x.id !== r.id), r];
    });
    fake('toCollection', () => ({ primaryKeys: async () => store[name].map((r) => r.id) }));
  }
  // A transaction just runs its body: the in-memory map has nothing to roll back.
  vi.spyOn(db, 'transaction').mockImplementation(((...args: unknown[]) =>
    (args[args.length - 1] as () => unknown)()) as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

const oneOfEach = () =>
  Object.fromEntries(dataNames.map((n) => [n, [{ id: `${n}-1` }, { id: `${n}-2` }]]));

describe('every table is covered', () => {
  it('knows about every table the database declares', () => {
    // If this fails, a table was added to src/db.ts. It is covered by backup,
    // restore, delete and the counts automatically - check the UI names it.
    expect(dataNames).toEqual(['captures', 'debtPlan', 'debts', 'incomes', 'notes', 'subscriptions', 'tasks']);
    expect(dataTables().map((t) => t.name).sort()).toEqual(dataNames);
  });

  it('backs up every table except settings, which is saved separately', () => {
    expect([...BACKUP_TABLES].sort()).toEqual(dataNames);
  });
});

describe('wipeAll', () => {
  it('empties every table that holds what you wrote, incomes included', async () => {
    fakeStorage({ ...oneOfEach(), settings: [{ id: 'settings' }] });
    await wipeAll();
    for (const name of dataNames) expect(store[name], name).toEqual([]);
  });

  it('keeps your settings, so the app still looks the way you left it', async () => {
    fakeStorage({ ...oneOfEach(), settings: [{ id: 'settings' }] });
    await wipeAll();
    expect(store.settings).toEqual([{ id: 'settings' }]);
  });
});

describe('countAll', () => {
  it('counts every table, so "On this device" cannot leave one out', async () => {
    fakeStorage({ ...oneOfEach(), incomes: [{ id: 'i1' }] });
    const counts = await countAll();
    expect(Object.keys(counts).sort()).toEqual(dataNames);
    expect(counts.incomes).toBe(1);
    expect(counts.tasks).toBe(2);
  });
});

describe('exportBackup and importBackup', () => {
  it('exports every table', async () => {
    fakeStorage(oneOfEach());
    const backup = await exportBackup();
    for (const name of dataNames) {
      expect((backup as unknown as Record<string, unknown[]>)[name], name).toHaveLength(2);
    }
  });

  it('a replace restore puts every table back exactly', async () => {
    fakeStorage(oneOfEach());
    const backup = parseBackup(JSON.stringify(await exportBackup()));
    fakeStorage({ tasks: [{ id: 'made-after-the-backup' }] });
    const result = await importBackup(backup, 'replace');
    for (const name of dataNames) {
      expect(store[name].map((r) => r.id).sort(), name).toEqual([`${name}-1`, `${name}-2`]);
      expect(result[name as keyof typeof result], name).toBe(2);
    }
  });

  it('a merge restore adds only what is missing, in every table', async () => {
    fakeStorage(oneOfEach());
    const backup: Backup = parseBackup(JSON.stringify(await exportBackup()));
    fakeStorage(Object.fromEntries(dataNames.map((n) => [n, [{ id: `${n}-1` }]])));
    const result = await importBackup(backup, 'merge');
    for (const name of dataNames) {
      expect(result[name as keyof typeof result], name).toBe(1);
      expect(store[name]).toHaveLength(2);
    }
  });
});

/*
  The debt plan is what you chose - a strategy, an amount per check, a
  spending estimate - so it is data, not a setting: backed up, restored and
  deleted with everything else. It is one row, and nothing is stored until
  something is actually chosen.
*/
describe('debts and the debt plan', () => {
  it('reads a default plan without writing one', async () => {
    fakeStorage({});
    const plan = await getDebtPlan();
    expect(plan).toMatchObject({ id: 'plan', strategy: 'avalanche' });
    expect(plan.perCheckMinor).toBeUndefined();
    expect(plan.untrackedMonthlyMinor).toBeUndefined();
    expect(store.debtPlan).toEqual([]);
  });

  it('saves a change as the one plan row, keeping what was there', async () => {
    fakeStorage({});
    await saveDebtPlan({ strategy: 'snowball' });
    await saveDebtPlan({ untrackedMonthlyMinor: 180_000 });
    expect(store.debtPlan).toHaveLength(1);
    expect(store.debtPlan[0]).toMatchObject({ id: 'plan', strategy: 'snowball', untrackedMonthlyMinor: 180_000 });
  });

  it('clearing a field takes it out of the row, not just its value', async () => {
    fakeStorage({ debtPlan: [{ id: 'plan', strategy: 'avalanche', untrackedMonthlyMinor: 180_000 } as never] });
    const after = await saveDebtPlan({ untrackedMonthlyMinor: undefined });
    expect('untrackedMonthlyMinor' in after).toBe(false);
    expect('untrackedMonthlyMinor' in store.debtPlan[0]).toBe(false);
  });

  it('Delete everything takes the plan and every debt', async () => {
    fakeStorage({});
    await saveDebt(blankDebt({ name: 'Blue card', balanceMinor: 200_000, dueDay: 5 }));
    await saveDebtPlan({ perCheckMinor: { job: 20_000 } });
    await wipeAll();
    expect(store.debts).toEqual([]);
    expect(store.debtPlan).toEqual([]);
  });

  it('starts a new debt as a card with the usual card minimum, and no due day guessed', () => {
    const debt = blankDebt();
    expect(debt).toMatchObject({
      kind: 'creditCard',
      autopay: false,
      notes: '',
      currency: 'USD',
      balanceMinor: 0,
      minimum: { kind: 'percentPlusInterest', percent: 1, floorMinor: 3_500 },
    });
    expect(debt.balanceAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(debt.dueDay).toBeUndefined();
    expect(blankDebt({ currency: 'EUR' }).currency).toBe('EUR');
  });
});

/*
  A low day is today's setting, not something you wrote. It must never travel
  in a backup file - that would be a record of low days - and a restore must
  neither switch one on from an old file nor switch today's off.
*/
describe('settings that stay on this phone', () => {
  const settingsRow = () => (store.settings[0] ?? {}) as Record<string, unknown>;
  const withLowDay = (extra: Record<string, unknown> = {}) =>
    ({ id: 'settings', lowDay: '2026-09-23', ...extra }) as { id: string };

  it('leaves the low day out of a backup file', async () => {
    fakeStorage({ ...oneOfEach(), settings: [withLowDay({ theme: 'dark' })] });
    const backup = await exportBackup();
    expect('lowDay' in backup.settings).toBe(false);
    expect(JSON.stringify(backup)).not.toContain('lowDay');
    // Everything else in settings still travels.
    expect(backup.settings.theme).toBe('dark');
  });

  it('ignores a low day in a file on a replace restore', async () => {
    fakeStorage(oneOfEach());
    const file = parseBackup(
      JSON.stringify({ ...(await exportBackup()), settings: { theme: 'midnight', lowDay: '2026-09-23' } }),
    );
    fakeStorage({ settings: [{ id: 'settings' }] });
    await importBackup(file, 'replace');
    expect(settingsRow().theme).toBe('midnight');
    expect('lowDay' in settingsRow()).toBe(false);
  });

  it("keeps today's low day through a replace restore", async () => {
    fakeStorage(oneOfEach());
    const file = parseBackup(JSON.stringify(await exportBackup()));
    fakeStorage({ settings: [withLowDay()] });
    await importBackup(file, 'replace');
    expect(settingsRow().lowDay).toBe('2026-09-23');
  });

  it('ignores a low day in a file on a merge restore', async () => {
    fakeStorage(oneOfEach());
    const file = parseBackup(JSON.stringify({ ...(await exportBackup()), settings: { lowDay: '2026-09-23' } }));
    fakeStorage({ settings: [{ id: 'settings' }] });
    await importBackup(file, 'merge');
    expect('lowDay' in settingsRow()).toBe(false);
  });

  it('forgetting a setting takes the key away, not just its value', async () => {
    fakeStorage({ settings: [withLowDay({ theme: 'dark' })] });
    const after = await forgetSettings('lowDay');
    expect('lowDay' in after).toBe(false);
    expect('lowDay' in settingsRow()).toBe(false);
    expect(settingsRow().theme).toBe('dark');
  });
});

/**
 * Which sections you folded is a preference, like the theme or the Backlog's
 * sort. So it travels in a backup (a new phone opens the way the old one did),
 * a replace restore puts it back, a merge restore leaves this phone's alone,
 * Delete everything keeps it - Settings promises "your settings stay as they
 * are" - and the app lock never touches it.
 */
describe('folded sections are a preference that travels', () => {
  const settingsRow = () => (store.settings[0] ?? {}) as Record<string, unknown>;
  const folded = { 'today.bills': false, 'money.averages': true };

  it('is not a device-only setting', () => {
    expect([...DEVICE_SETTINGS]).not.toContain('sections');
  });

  it('goes into a backup file', async () => {
    fakeStorage({ ...oneOfEach(), settings: [{ id: 'settings', sections: folded } as never] });
    const backup = await exportBackup();
    expect(backup.settings.sections).toEqual(folded);
  });

  it('is put back by a replace restore', async () => {
    fakeStorage({ ...oneOfEach(), settings: [{ id: 'settings', sections: folded } as never] });
    const file = parseBackup(JSON.stringify(await exportBackup()));
    fakeStorage({ settings: [{ id: 'settings', sections: { 'inbox.cleared': true } } as never] });
    await importBackup(file, 'replace');
    expect(settingsRow().sections).toEqual(folded);
  });

  it('is left as this phone has it by a merge restore', async () => {
    fakeStorage({ ...oneOfEach(), settings: [{ id: 'settings', sections: folded } as never] });
    const file = parseBackup(JSON.stringify(await exportBackup()));
    fakeStorage({ settings: [{ id: 'settings', sections: { 'inbox.cleared': true } } as never] });
    await importBackup(file, 'merge');
    expect(settingsRow().sections).toEqual({ 'inbox.cleared': true });
  });

  it('is kept by Delete everything', async () => {
    fakeStorage({ ...oneOfEach(), settings: [{ id: 'settings', sections: folded } as never] });
    await wipeAll();
    expect(settingsRow().sections).toEqual(folded);
  });

  it('is not touched by setting or removing the app lock', async () => {
    fakeStorage({ settings: [{ id: 'settings', sections: folded } as never] });
    await saveLock({
      pinHash: toBase64(new Uint8Array(32).fill(4)),
      pinSalt: toBase64(new Uint8Array(16).fill(5)),
      phraseHash: toBase64(new Uint8Array(32).fill(6)),
      phraseSalt: toBase64(new Uint8Array(16).fill(7)),
      iterations: 600_000,
      afterMinutes: 5,
    });
    expect((await getSettings()).sections).toEqual(folded);
    await saveLock(null);
    expect((await getSettings()).sections).toEqual(folded);
  });

  it('"Put every section back" takes the whole setting away and nothing else', async () => {
    fakeStorage({ settings: [{ id: 'settings', theme: 'amber', sections: folded } as never] });
    const after = await forgetSettings('sections');
    expect('sections' in after).toBe(false);
    expect('sections' in settingsRow()).toBe(false);
    expect(settingsRow().theme).toBe('amber');
  });
});

/**
 * The app lock belongs to this phone, not to what you wrote. A backup file
 * must never carry its hashes, and a restore must never be able to set a lock
 * (an old file locking you out of a new phone) or clear one (a file turning
 * someone else's lock off).
 */
describe('the app lock stays on this phone', () => {
  const lockNamed = (seed: number): AppLock => ({
    pinHash: toBase64(new Uint8Array(32).fill(seed)),
    pinSalt: toBase64(new Uint8Array(16).fill(seed + 1)),
    phraseHash: toBase64(new Uint8Array(32).fill(seed + 2)),
    phraseSalt: toBase64(new Uint8Array(16).fill(seed + 3)),
    iterations: 600_000,
    afterMinutes: 5,
  });
  const mine = lockNamed(1);
  const theirs = lockNamed(9);

  it('the lock is the device-only setting', () => {
    expect([...DEVICE_SETTINGS]).toEqual(['lock', 'lowDay']);
    expect(withoutDeviceSettings({ theme: 'dark', lock: mine })).toEqual({ theme: 'dark' });
  });

  it('a backup file carries no lock and none of its hashes', async () => {
    fakeStorage({ ...oneOfEach(), settings: [{ id: 'settings', theme: 'midnight', lock: mine } as never] });
    const backup = await exportBackup();
    expect(backup.settings.theme).toBe('midnight');
    expect('lock' in backup.settings).toBe(false);
    const file = JSON.stringify(backup);
    for (const value of [mine.pinHash, mine.pinSalt, mine.phraseHash, mine.phraseSalt]) {
      expect(file).not.toContain(value);
    }
  });

  it('a replace restore of a file that holds a lock does not set one', async () => {
    fakeStorage({ settings: [{ id: 'settings' }] });
    const file = parseBackup(JSON.stringify({ format: 'steady-backup', version: 2, settings: { theme: 'dark', lock: theirs } }));
    await importBackup(file, 'replace');
    const after = await getSettings();
    expect(after.theme).toBe('dark');
    expect(after.lock).toBeUndefined();
  });

  it('a restore, in either mode, neither clears nor replaces the lock that is set', async () => {
    for (const mode of ['replace', 'merge'] as const) {
      for (const settings of [{ theme: 'dark' }, { theme: 'dark', lock: theirs }, { lock: null }]) {
        fakeStorage({ settings: [{ id: 'settings', lock: mine } as never] });
        const file = parseBackup(JSON.stringify({ format: 'steady-backup', version: 2, settings }));
        await importBackup(file, mode);
        expect((await getSettings()).lock, `${mode} ${JSON.stringify(settings)}`).toEqual(mine);
      }
    }
  });

  it('Delete everything leaves the lock in place', async () => {
    fakeStorage({ ...oneOfEach(), settings: [{ id: 'settings', lock: mine } as never] });
    await wipeAll();
    expect((await getSettings()).lock).toEqual(mine);
  });

  it('turning the lock off removes it outright and touches nothing else', async () => {
    fakeStorage({ settings: [{ id: 'settings', theme: 'amber', textScale: 1.3, lock: mine } as never] });
    const after = await saveLock(null);
    expect('lock' in after).toBe(false);
    expect('lock' in store.settings[0]).toBe(false);
    expect(after.theme).toBe('amber');
    expect(after.textScale).toBe(1.3);
    expect((await saveLock(theirs)).lock).toEqual(theirs);
    expect((await getSettings()).theme).toBe('amber');
  });
});
