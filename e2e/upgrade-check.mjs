/**
 * Proves the Dexie v1 -> v2 bump does not touch data already on the device.
 *
 * Writes records straight into a v1-shaped database, then loads the app (which
 * declares v2 with the new incomes store) and checks everything is still there.
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const server = spawn('npx', ['vite', 'preview', '--port', '4196', '--host', '127.0.0.1'], { stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 4000));
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const ctx = await browser.newContext();
const page = await ctx.newPage();

// Land on the origin without booting the app, so the v1 database is ours alone.
await page.goto('http://127.0.0.1:4196/manifest.webmanifest');

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
    const tx = db.transaction(['notes', 'tasks', 'subscriptions'], 'readwrite');
    tx.objectStore('notes').put({ id: 'n1', title: 'Old note', body: 'from before the upgrade', tags: ['health'], pinned: false, createdAt: 1, updatedAt: 1 });
    tx.objectStore('tasks').put({ id: 't1', title: 'Old task', notes: '', steps: [], tags: [], createdAt: 1, updatedAt: 1 });
    tx.objectStore('subscriptions').put({ id: 's1', name: 'Old sub', amountMinor: 1299, currency: 'USD', cycle: 'monthly', every: 1, firstBilled: '2026-01-15', notes: '', cancelHow: '', remindDaysBefore: 3, createdAt: 1, updatedAt: 1 });
    tx.oncomplete = () => { db.close(); resolve('seeded v1 data'); };
    tx.onerror = () => reject(tx.error);
  };
  req.onerror = () => reject(req.error);
}));
console.log(seeded);

// Now boot the app, which opens the same database at v2.
await page.goto('http://127.0.0.1:4196/', { waitUntil: 'networkidle' });
await page.waitForSelector('.main');
await page.waitForTimeout(1500);

const after = await page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('steady');
  req.onsuccess = () => {
    const db = req.result;
    const stores = [...db.objectStoreNames];
    const tx = db.transaction(['notes', 'tasks', 'subscriptions'], 'readonly');
    const out = {};
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
check('nothing else was dropped', ['captures','tasks','notes','subscriptions','settings'].every((s) => after.stores.includes(s)), true);

await browser.close();
try { process.kill(-server.pid, 'SIGKILL'); } catch {}
if (problems.length) { console.error(`\n${problems.length} check(s) failed.`); process.exit(1); }
console.log('\nUpgrade is safe: v1 data intact.');
