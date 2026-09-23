import { afterEach, describe, expect, it, vi } from 'vitest';
import { countAll, dataTables, db, wipeAll } from '../src/db';
import { BACKUP_TABLES, exportBackup, importBackup, parseBackup, type Backup } from '../src/lib/backup';

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
    expect(dataNames).toEqual(['captures', 'incomes', 'notes', 'subscriptions', 'tasks']);
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
