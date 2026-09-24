/**
 * Proves the Dexie schema bumps do not touch data already on the device.
 *
 * Two phones, one per older schema, each in its own browser context:
 *
 *   v1 - notes, tasks, subscriptions and settings, from before income existed.
 *   v2 - the same plus the incomes store and a paycheck, from before debts.
 *
 * Each is written straight into a database of that shape, then the app is
 * loaded (it declares v3, adding the debts and debtPlan stores) and every
 * record is checked to still be there, with the new stores beside it.
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = Number(process.env.E2E_UPGRADE_PORT ?? 4196);
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'], { stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 4000));
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const ctx = await browser.newContext();
const page = await ctx.newPage();

// Land on the origin without booting the app, so the v1 database is ours alone.
await page.goto(`http://127.0.0.1:${PORT}/manifest.webmanifest`);

const seeded = await page.evaluate(() => new Promise((resolve, reject) => {
  const req = indexedDB.open('steady', 10); // Dexie stores version(1) as 10
  req.onupgradeneeded = () => {
    const db = req.result;
    db.createObjectStore('captures', { keyPath: 'id' });
    db.createObjectStore('tasks', { keyPath: 'id' });
    db.createObjectStore('notes', { keyPath: 'id' });
    db.createObjectStore('subscriptions', { keyPath: 'id' });
    db.createObjectStore('settings', { keyPath: 'id' });
  };
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction(['notes', 'tasks', 'subscriptions', 'settings'], 'readwrite');
    // Settings saved before any of the newer options existed. They must keep
    // what they hold, and the newer options must simply read their defaults.
    tx.objectStore('settings').put({ id: 'settings', theme: 'dark', textScale: 1.3, blurAmounts: true, rev: 4 });
    tx.objectStore('notes').put({ id: 'n1', title: 'Old note', body: 'from before the upgrade', tags: ['health'], pinned: false, createdAt: 1, updatedAt: 1 });
    tx.objectStore('tasks').put({ id: 't1', title: 'Old task', notes: '', steps: [], tags: [], createdAt: 1, updatedAt: 1 });
    tx.objectStore('subscriptions').put({ id: 's1', name: 'Old sub', amountMinor: 1299, currency: 'USD', cycle: 'monthly', every: 1, firstBilled: '2026-01-15', notes: '', cancelHow: '', remindDaysBefore: 3, createdAt: 1, updatedAt: 1 });
    tx.oncomplete = () => { db.close(); resolve('seeded v1 data'); };
    tx.onerror = () => reject(tx.error);
  };
  req.onerror = () => reject(req.error);
}));
console.log(seeded);

// Now boot the app, which opens the same database at v3.
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('.main');
await page.waitForTimeout(1500);

const after = await page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('steady');
  req.onsuccess = () => {
    const db = req.result;
    const stores = [...db.objectStoreNames];
    const tx = db.transaction(['notes', 'tasks', 'subscriptions', 'settings'], 'readonly');
    const out = {};
    tx.objectStore('settings').get('settings').onsuccess = (e) => { out.settings = e.target.result; };
    tx.objectStore('notes').getAll().onsuccess = (e) => { out.notes = e.target.result; };
    tx.objectStore('tasks').getAll().onsuccess = (e) => { out.tasks = e.target.result; };
    tx.objectStore('subscriptions').getAll().onsuccess = (e) => { out.subs = e.target.result; };
    tx.oncomplete = () => { const v = db.version; db.close(); resolve({ stores, version: v, ...out }); };
  };
}));

const problems = [];
const check = (label, actual, expected) => {
  const ok = actual === expected;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` (got ${JSON.stringify(actual)})`}`);
  if (!ok) problems.push(label);
};

check('the incomes store was added', after.stores.includes('incomes'), true);
check('the note survived', after.notes?.[0]?.title, 'Old note');
check('its tags survived', after.notes?.[0]?.tags?.join(','), 'health');
check('the task survived', after.tasks?.[0]?.title, 'Old task');
check('the subscription survived', after.subs?.[0]?.name, 'Old sub');
check('and kept its amount', after.subs?.[0]?.amountMinor, 1299);
check('old settings kept their theme', after.settings?.theme, 'dark');
check('and their text size', after.settings?.textScale, 1.3);
check('and still blur amounts', after.settings?.blurAmounts, true);
check(
  'the app is showing the saved theme, not a default',
  await page.evaluate(() => document.documentElement.dataset.theme),
  'dark',
);
check('nothing else was dropped', ['captures','tasks','notes','subscriptions','settings'].every((s) => after.stores.includes(s)), true);
check('the debts store was added', after.stores.includes('debts'), true);
check('the debtPlan store was added', after.stores.includes('debtPlan'), true);
check('the database is at v3', after.version, 30);
await ctx.close();

// --- a v2 phone: income already there, no debts yet ------------------------
// A fresh context is a fresh origin store, so this database is ours alone too.
const ctx2 = await browser.newContext();
const page2 = await ctx2.newPage();
await page2.goto(`http://127.0.0.1:${PORT}/manifest.webmanifest`);

const seeded2 = await page2.evaluate(() => new Promise((resolve, reject) => {
  const req = indexedDB.open('steady', 20); // Dexie stores version(2) as 20
  req.onupgradeneeded = () => {
    const db = req.result;
    // The v2 schema exactly as Dexie declared it, indexes included.
    const store = (name, indexes) => {
      const s = db.createObjectStore(name, { keyPath: 'id' });
      for (const [index, multiEntry] of indexes) s.createIndex(index, index, { multiEntry });
    };
    store('captures', [['createdAt'], ['clearedAt']]);
    store('tasks', [['date'], ['doneAt'], ['remindAt'], ['updatedAt'], ['tags', true]]);
    store('notes', [['updatedAt'], ['pinned'], ['tags', true]]);
    store('subscriptions', [['name'], ['endedOn'], ['updatedAt']]);
    store('settings', []);
    store('incomes', [['name'], ['endedOn'], ['updatedAt']]);
  };
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction(['incomes', 'notes', 'settings'], 'readwrite');
    tx.objectStore('settings').put({ id: 'settings', theme: 'midnight', rev: 7 });
    tx.objectStore('notes').put({ id: 'n2', title: 'v2 note', body: '', tags: [], pinned: true, createdAt: 1, updatedAt: 1 });
    tx.objectStore('incomes').put({
      id: 'i1', name: 'Old job', frequency: 'biweekly', firstPaid: '2026-09-18', weekendShift: 'friday',
      grossMinor: 250000, netMinor: 185000, deductions: [{ id: 'x1', label: 'Federal', amountMinor: 30000 }],
      currency: 'USD', notes: '', createdAt: 1, updatedAt: 1,
    });
    tx.oncomplete = () => { db.close(); resolve('seeded v2 data'); };
    tx.onerror = () => reject(tx.error);
  };
  req.onerror = () => reject(req.error);
}));
console.log(`\n${seeded2}`);

await page2.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page2.waitForSelector('.main');
await page2.waitForTimeout(1500);

const after2 = await page2.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('steady');
  req.onsuccess = () => {
    const db = req.result;
    const stores = [...db.objectStoreNames];
    const tx = db.transaction(['incomes', 'notes', 'settings', 'debts', 'debtPlan'], 'readonly');
    const out = {};
    tx.objectStore('incomes').getAll().onsuccess = (e) => { out.incomes = e.target.result; };
    tx.objectStore('notes').getAll().onsuccess = (e) => { out.notes = e.target.result; };
    tx.objectStore('settings').get('settings').onsuccess = (e) => { out.settings = e.target.result; };
    tx.objectStore('debts').count().onsuccess = (e) => { out.debts = e.target.result; };
    tx.objectStore('debtPlan').count().onsuccess = (e) => { out.debtPlan = e.target.result; };
    tx.oncomplete = () => { const v = db.version; db.close(); resolve({ stores, version: v, ...out }); };
  };
}));

check('v2: the income survived', after2.incomes?.[0]?.name, 'Old job');
check('v2: and kept its take-home', after2.incomes?.[0]?.netMinor, 185000);
check('v2: and its deduction lines', after2.incomes?.[0]?.deductions?.[0]?.label, 'Federal');
check('v2: the note survived', after2.notes?.[0]?.title, 'v2 note');
check('v2: settings kept their theme', after2.settings?.theme, 'midnight');
check('v2: the debts store was added, empty', after2.debts, 0);
check('v2: the debtPlan store was added, empty', after2.debtPlan, 0);
check('v2: nothing was dropped', ['captures','tasks','notes','subscriptions','settings','incomes'].every((s) => after2.stores.includes(s)), true);
check('v2: the database is at v3', after2.version, 30);
check(
  'v2: the app is showing the saved theme',
  await page2.evaluate(() => document.documentElement.dataset.theme),
  'midnight',
);

await browser.close();
try { process.kill(-server.pid, 'SIGKILL'); } catch {}
if (problems.length) { console.error(`\n${problems.length} check(s) failed.`); process.exit(1); }
console.log('\nUpgrade is safe: v1 and v2 data intact, debts stores added.');
