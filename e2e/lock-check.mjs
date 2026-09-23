/**
 * Browser check of the optional app lock.
 *
 * The lock only hides the screen - it does not encrypt anything - so what it
 * has to get exactly right is what is on the page while it is locked: nothing.
 * This drives the real app through setting a PIN, going to the background,
 * wrong and right PINs, a reload, "Hide now", the recovery phrase, backups,
 * restores and "Delete everything", and at every locked moment it reads the
 * whole DOM for the seeded task, note, capture and subscription.
 *
 *     npm run build
 *     node e2e/lock-check.mjs
 *
 * It starts and stops its own preview server, like e2e/app-check.mjs, on
 * E2E_LOCK_PORT. SCREENSHOT_DIR says where the pictures go.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = Number(process.env.E2E_LOCK_PORT ?? 4177);
const PATH_BASE = process.env.VITE_BASE?.trim() ? `/${process.env.VITE_BASE.replace(/^\/+|\/+$/g, '')}/` : '/';
const BASE = `http://127.0.0.1:${PORT}${PATH_BASE}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OUT = process.env.SCREENSHOT_DIR ?? 'e2e/screenshots-lock';
const CHROME = process.env.CHROME_PATH;

mkdirSync(OUT, { recursive: true });

// Same guard as app-check.mjs: a dist/ built for another base never mounts,
// which looks like a hang rather than the mismatch it is.
{
  const indexHtml = readFileSync('dist/index.html', 'utf8');
  const scriptSrc = /<script[^>]+src="([^"]+)"/.exec(indexHtml)?.[1] ?? '';
  const distBase = scriptSrc.slice(0, scriptSrc.indexOf('assets/'));
  if (distBase !== PATH_BASE) {
    throw new Error(
      `dist/ was built for base "${distBase}", but this run serves "${PATH_BASE}".\n` +
        `Rebuild first: ${PATH_BASE === '/' ? 'npm run build' : `VITE_BASE=${PATH_BASE} npm run build`}`,
    );
  }
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
  stdio: 'ignore',
  detached: true,
  env: process.env,
});
const stopServer = () => {
  try {
    process.kill(-server.pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
};
process.on('exit', stopServer);
await new Promise((r) => setTimeout(r, 4000));

const problems = [];
const check = (label, actual, expected) => {
  const ok = actual === expected;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` (got ${JSON.stringify(actual)})`}`);
  if (!ok) problems.push(label);
};

/**
 * What must never be on the page while it is locked. Real writing, the kind
 * the lock exists for: a doctor's name, a referral number, a locker code.
 */
const SECRETS = ['Okafor', '88213', 'Locker 14', 'spare key', 'Headspace'];
const PIN = '2468';

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, acceptDownloads: true });

// Every request for the whole run, as in app-check.mjs: the lock adds no
// network code, and this is the run-long record that says so.
const offOrigin = [];
ctx.on('request', (req) => {
  const url = req.url();
  if (url.startsWith('blob:') || url.startsWith('data:')) return;
  if (new URL(url).origin !== ORIGIN) offOrigin.push(url);
});

// Installed before any page script, on every load: notes whether a secret or
// any part of the app's furniture was EVER in the DOM, at any mutation. This is
// how "locked before any content" is checked, rather than by looking once the
// page has settled.
await ctx.addInitScript((secrets) => {
  window.__sawSecret = false;
  window.__sawApp = false;
  const look = () => {
    const html = document.documentElement?.outerHTML ?? '';
    if (secrets.some((s) => html.includes(s))) window.__sawSecret = true;
    if (document.querySelector('.main, .nav, .header, .toast')) window.__sawApp = true;
  };
  new MutationObserver(look).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
}, SECRETS);

const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

/* ------------------------------------------------------------------ helpers */

const idb = (fn, arg) => page.evaluate(fn, arg);

/** The settings record, straight out of IndexedDB. */
const readSettings = () =>
  idb(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('steady');
        req.onsuccess = () => {
          const get = req.result.transaction('settings', 'readonly').objectStore('settings').get('settings');
          get.onsuccess = () => {
            req.result.close();
            resolve(get.result ?? null);
          };
        };
      }),
  );

/** Merges a patch into the stored settings - never replacing, so the lock survives. */
const patchSettings = (patch) =>
  idb(
    (changes) =>
      new Promise((resolve) => {
        const req = indexedDB.open('steady');
        req.onsuccess = () => {
          const tx = req.result.transaction('settings', 'readwrite');
          const store = tx.objectStore('settings');
          const get = store.get('settings');
          get.onsuccess = () => store.put({ ...(get.result ?? { id: 'settings' }), ...changes });
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
        };
      }),
    patch,
  );

const rowCount = (name) =>
  idb(
    (store) =>
      new Promise((resolve) => {
        const req = indexedDB.open('steady');
        req.onsuccess = () => {
          const count = req.result.transaction(store, 'readonly').objectStore(store).count();
          count.onsuccess = () => {
            req.result.close();
            resolve(count.result);
          };
        };
      }),
    name,
  );

/** Which of the secrets are anywhere in the page - text or attributes. */
const leaks = () => page.evaluate((secrets) => secrets.filter((s) => document.documentElement.outerHTML.includes(s)), SECRETS);

const isLocked = async () => (await page.locator('main.lock').count()) === 1;

/** Taps a PIN out on whichever pad is showing. */
async function typePin(pin, scope = '') {
  for (const digit of pin) await page.click(`${scope} .pin-pad button:text-is("${digit}")`);
}
const submitPad = (scope = '') => page.click(`${scope} .pin-pad button.btn-primary`);

/** Unlocks with the PIN and waits for the app to be back. */
async function unlock(pin = PIN) {
  await typePin(pin, 'main.lock');
  await submitPad('main.lock');
  await page.waitForSelector('.main', { timeout: 10_000 });
}

/**
 * Sends the page to the background and back, as switching apps would. The
 * clock is moved on by `awayMs` in between, so "5 minutes away" takes no time.
 */
async function goBackground() {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}
async function comeBack(awayMs = 0) {
  await page.evaluate((ms) => {
    if (!window.__realNow) {
      window.__realNow = Date.now;
      window.__skew = 0;
      Date.now = () => window.__realNow() + window.__skew;
    }
    window.__skew += ms;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  }, awayMs);
  await page.waitForTimeout(150);
}

/**
 * A picture of one Settings section. The header is sticky and the nav fixed,
 * so for this shot only they are let go of - otherwise they sit on top of the
 * section in the image, which is not what the phone shows.
 */
const shotSection = async (name) => {
  const style = await page.addStyleTag({ content: '.header{position:static!important}.nav{display:none!important}' });
  await page.locator(LOCK_SECTION).screenshot({ path: `${OUT}/${name}.png` });
  await style.evaluate((el) => el.remove());
};

/** Opens Settings, or stays there if it is already open (unlocking returns to where you were). */
const openSettings = async () => {
  if ((await page.locator('.header button:text-is("Done")').count()) === 0) {
    await page.click('.header button:text-is("Settings")');
  }
  await page.waitForSelector('section[aria-label="App lock"]');
};
const LOCK_SECTION = 'section[aria-label="App lock"]';

/** Goes through "Set a PIN" to the end and returns the six words it showed. */
async function setUpLock(pin = PIN) {
  await openSettings();
  await page.click(`${LOCK_SECTION} button:text-is("Set a PIN")`);
  await typePin(pin, LOCK_SECTION);
  await submitPad(LOCK_SECTION);
  await typePin(pin, LOCK_SECTION);
  await submitPad(LOCK_SECTION);
  await page.waitForSelector('ol.phrase-words li');
  const words = await page.locator('ol.phrase-words li').allTextContents();
  await page.click(`${LOCK_SECTION} label.check`);
  await page.click(`${LOCK_SECTION} button:text-is("Turn the lock on")`);
  await page.waitForSelector('.toast:has-text("The lock is on")', { timeout: 10_000 });
  return words;
}

/* --------------------------------------------------------------------- seed */

console.log(`Checking ${BASE}\n`);
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.main');

await idb(
  () =>
    new Promise((resolve) => {
      const req = indexedDB.open('steady');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['tasks', 'notes', 'captures', 'subscriptions'], 'readwrite');
        const d = new Date();
        const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const at = Date.now();
        tx.objectStore('tasks').put({
          id: 'lock-task', title: 'Ring Dr Okafor about the MRI results', notes: 'Referral number 88213',
          steps: [], tags: ['health'], date: today, createdAt: at, updatedAt: at,
        });
        tx.objectStore('notes').put({
          id: 'lock-note', title: 'Pool locker', body: 'Locker 14, code on the back of the card', tags: [],
          pinned: true, createdAt: at, updatedAt: at,
        });
        tx.objectStore('captures').put({ id: 'lock-capture', text: 'Ask Sam about the spare key', createdAt: at });
        tx.objectStore('subscriptions').put({
          id: 'lock-sub', name: 'Headspace', amountMinor: 1299, currency: 'USD', cycle: 'monthly', every: 1,
          firstBilled: today, notes: '', cancelHow: '', remindDaysBefore: 3, createdAt: at, updatedAt: at,
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    }),
);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.main');
await page.waitForTimeout(400);
check('the seeded task is on Today (so the leak checks below mean something)', (await leaks()).includes('Okafor'), true);

/* ------------------------------------------------- with no lock, nothing new */

check('with no lock, there is no Hide now', await page.locator('.header button:text-is("Hide now")').count(), 0);
await goBackground();
check('with no lock, going to the background does not blank the page', await page.evaluate(() => document.documentElement.classList.contains('veiled')), false);
await comeBack(60 * 60_000);
check('and coming back an hour later shows the app, not a lock', await isLocked(), false);
check('with the task still there', (await leaks()).includes('Okafor'), true);
await openSettings();
check('Settings offers to set a PIN', await page.locator(`${LOCK_SECTION} button:text-is("Set a PIN")`).count(), 1);
const lockCopy = await page.textContent(LOCK_SECTION);
check('Settings says the lock hides the screen', lockCopy.includes('It hides the screen.'), true);
check('and that it does not encrypt the data', lockCopy.includes('It does not encrypt your data.'), true);
check(
  'and names the reminder option that keeps titles off the phone lock screen',
  lockCopy.includes('Just "You have a reminder"'),
  true,
);
check('nothing about a lock is stored until one is set', 'lock' in ((await readSettings()) ?? {}), false);
await page.click('.header button:text-is("Done")');

/* --------------------------------------------------------------- setting up */

await openSettings();
await page.click(`${LOCK_SECTION} button:text-is("Set a PIN")`);
check(
  'the PIN is typed on the pad, with no text box a password manager could take it from',
  await page.locator(`${LOCK_SECTION} input[type="password"], ${LOCK_SECTION} input[type="text"]`).count(),
  0,
);
check('Next waits for at least 4 digits', await page.locator(`${LOCK_SECTION} .pin-pad button.btn-primary`).isDisabled(), true);
await typePin(PIN, LOCK_SECTION);
check('only dots are shown, never the digits', (await page.textContent(`${LOCK_SECTION} .pin-dots`)).trim(), '●'.repeat(4));
await shotSection(`setup-pin`);
await submitPad(LOCK_SECTION);
check('it asks for the PIN a second time', (await page.textContent(LOCK_SECTION)).includes('Enter the same PIN again'), true);
// A physical keyboard works too - and a typo here starts the PIN again.
await page.keyboard.type('2460');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
check('two different PINs are caught', (await page.textContent(LOCK_SECTION)).includes("Those two didn't match"), true);
check('and nothing is saved', 'lock' in ((await readSettings()) ?? {}), false);
await typePin(PIN, LOCK_SECTION);
await submitPad(LOCK_SECTION);
await typePin(PIN, LOCK_SECTION);
await submitPad(LOCK_SECTION);
await page.waitForSelector('ol.phrase-words li');
const words = await page.locator('ol.phrase-words li').allTextContents();
check('the recovery phrase is six words', words.length, 6);
check('six different words', new Set(words).size, 6);
check('and there is still no lock until it has been written down', 'lock' in ((await readSettings()) ?? {}), false);
check(
  'Turn the lock on waits for the "written down" box',
  await page.locator(`${LOCK_SECTION} button:text-is("Turn the lock on")`).isDisabled(),
  true,
);
await shotSection(`setup-phrase`);
await page.click(`${LOCK_SECTION} label.check:has-text("I have written this down somewhere other than this phone")`);
await page.click(`${LOCK_SECTION} button:text-is("Turn the lock on")`);
await page.waitForSelector('.toast:has-text("The lock is on")', { timeout: 10_000 });
check('it says the lock is on, and how it closes', (await page.textContent('.toast')).includes('after 1 minute out of sight'), true);

const stored = await readSettings();
const lock = stored.lock;
check(
  'it stores exactly the six fields, and nothing else',
  JSON.stringify(Object.keys(lock ?? {}).sort()),
  JSON.stringify(['afterMinutes', 'iterations', 'phraseHash', 'phraseSalt', 'pinHash', 'pinSalt']),
);
check('with at least 210,000 PBKDF2 rounds', (lock?.iterations ?? 0) >= 210_000, true);
check('never the PIN', Object.values(lock ?? {}).includes(PIN) || JSON.stringify(stored).includes(`"${PIN}"`), false);
check(
  'never the phrase',
  JSON.stringify(stored).includes(words.join(' ')) || JSON.stringify(stored).includes([...words].sort().join(' ')),
  false,
);
check('the recovery phrase is gone from the screen once the lock is on', await page.locator('ol.phrase-words').count(), 0);
await page.click('.header button:text-is("Done")');
await openSettings();
const settingsText = await page.textContent('.main');
check(
  'and it is not shown again anywhere in Settings',
  settingsText.includes(words.join('')) || settingsText.includes(words.join(' ')) || (await page.locator('ol.phrase-words').count()) > 0,
  false,
);
check('Settings says the lock is on', (await page.textContent(LOCK_SECTION)).includes('On. Steady asks for the PIN'), true);
await shotSection(`settings-lock-on`);
await page.click('.header button:text-is("Done")');
check('Hide now is in the header once a lock is set', await page.locator('.header button:text-is("Hide now")').count(), 1);
await page.screenshot({ path: `${OUT}/today-hide-now.png` });

/* ---------------------------------------------------------- the background */

await goBackground();
check('going to the background blanks the page at once', await page.evaluate(() => document.documentElement.classList.contains('veiled')), true);
check('blanked means nothing is drawn', await page.evaluate(() => getComputedStyle(document.getElementById('root')).opacity), '0');
await comeBack(20_000);
check('a 20-second trip to another app does not lock', await isLocked(), false);
check('and the page is not left blank', await page.evaluate(() => document.documentElement.classList.contains('veiled')), false);

await page.click('.nav-btn:has-text("Tasks")');
await page.waitForTimeout(200);
await goBackground();
await comeBack(2 * 60_000);
check('two minutes away with a 1-minute lock: locked', await isLocked(), true);
check('the veil comes off only once the lock is up', await page.evaluate(() => document.documentElement.classList.contains('veiled')), false);
check('while locked, no task, note, capture or subscription is anywhere in the DOM', (await leaks()).join(', '), '');
check('no header', await page.locator('.header').count(), 0);
check('no nav', await page.locator('.nav').count(), 0);
check('no tab is mounted, not even hidden', await page.locator('.main, .view').count(), 0);
check('no toast', await page.locator('.toast').count(), 0);
check('the lock screen says so, plainly', (await page.textContent('main.lock h1')).trim(), 'Steady is locked');
await page.waitForTimeout(300);
check(
  'the lock sits at the bottom of the history, so Back leaves rather than changing tabs behind it',
  await page.evaluate(() => window.history.state?.steady ?? 0),
  0,
);
await page.screenshot({ path: `${OUT}/lock-screen.png` });

/* ------------------------------------------------------------- wrong, right */

check('Unlock waits for at least 4 digits', await page.locator('main.lock .pin-pad button.btn-primary').isDisabled(), true);
await typePin('1111', 'main.lock');
await submitPad('main.lock');
await page.waitForSelector('main.lock .notice');
check('a wrong PIN is refused', await isLocked(), true);
check('in plain words', (await page.textContent('main.lock .notice')).includes("That isn't the PIN"), true);
check('still nothing on the page', (await leaks()).join(', '), '');

/** Waits until a PIN check has finished and its answer is on screen. */
const settled = () =>
  page.waitForFunction(() => !document.querySelector('main.lock p[role="status"]') && document.querySelector('main.lock .notice'), null, {
    timeout: 10_000,
  });
for (const wrong of ['1112', '1113', '1114']) {
  await typePin(wrong, 'main.lock');
  await submitPad('main.lock');
  await settled();
}
await typePin('1115', 'main.lock');
await submitPad('main.lock');
await page.waitForSelector('main.lock .notice:has-text("couple of seconds")', { timeout: 10_000 });
check('after five misses in a row the keys rest', await page.locator('main.lock .pin-pad button:text-is("5")').isDisabled(), true);
const pauseText = await page.textContent('main.lock .notice');
check('and it says so without counting anything', /\d/.test(pauseText), false);
await page.screenshot({ path: `${OUT}/lock-wrong-pause.png` });
await page.waitForTimeout(2300);
check('two seconds later they are back - no lockout', await page.locator('main.lock .pin-pad button:text-is("5")').isDisabled(), false);
check('nothing about the misses was saved', JSON.stringify(await readSettings()) === JSON.stringify(stored), true);

await unlock();
check('the right PIN opens it', await isLocked(), false);
check('back where you were', await page.getAttribute('.nav-btn:has-text("Tasks")', 'aria-current'), 'page');
check('with everything there', (await leaks()).includes('Okafor'), true);

/* ------------------------------------------------------------------ reload */

await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('main.lock');
await page.waitForTimeout(300);
check('a reload opens on the lock', await isLocked(), true);
check('no secret was in the DOM at any moment of the reload', await page.evaluate(() => window.__sawSecret), false);
check('and no part of the app was ever drawn before the lock', await page.evaluate(() => window.__sawApp), false);
await unlock();

/* ---------------------------------------------------------------- hide now */

await page.click('.header button:text-is("Hide now")');
await page.waitForSelector('main.lock');
check('Hide now locks straight away', await isLocked(), true);
check('and leaves nothing on the page', (await leaks()).join(', '), '');
await unlock();

/* -------------------------------------------------------------- immediately */

await openSettings();
await page.click(`${LOCK_SECTION} button:text-is("Immediately")`);
await page.waitForTimeout(200);
check('the timing can be changed to immediately', (await readSettings()).lock.afterMinutes, 0);
check('without touching the PIN', (await readSettings()).lock.pinHash, lock.pinHash);
await goBackground();
await page.waitForTimeout(100);
check('with "Immediately", the lock is up while it is still in the background', await isLocked(), true);
check('so the page holds nothing while it is away', (await leaks()).join(', '), '');
await comeBack(0);
check('and it is locked on coming back, even at once', await isLocked(), true);
await unlock();
await openSettings();
await page.click(`${LOCK_SECTION} button:text-is("After 1 minute")`);
await page.waitForTimeout(200);

/* ----------------------------------------------------------- changing a PIN */

await page.click(`${LOCK_SECTION} button:text-is("Change the PIN")`);
check('changing the PIN asks for the current one first', (await page.textContent(LOCK_SECTION)).includes('First, enter the PIN you use now'), true);
await typePin('9999', LOCK_SECTION);
await submitPad(LOCK_SECTION);
await page.waitForSelector(`${LOCK_SECTION} .notice`);
check('and will not go on with a wrong one', (await page.textContent(LOCK_SECTION)).includes("That isn't the PIN"), true);
await typePin(PIN, LOCK_SECTION);
await submitPad(LOCK_SECTION);
await page.waitForSelector(`${LOCK_SECTION} :text("Choose a new PIN")`);
await typePin('13579', LOCK_SECTION);
await submitPad(LOCK_SECTION);
await typePin('13579', LOCK_SECTION);
await submitPad(LOCK_SECTION);
await page.waitForSelector('.toast:has-text("PIN changed")', { timeout: 10_000 });
const changed = (await readSettings()).lock;
check('a new PIN gets a new salt', changed.pinSalt !== lock.pinSalt, true);
check('and keeps the recovery phrase', changed.phraseHash, lock.phraseHash);
await page.click('.header button:text-is("Hide now")');
await page.waitForSelector('main.lock');
await typePin(PIN, 'main.lock');
await submitPad('main.lock');
await page.waitForSelector('main.lock .notice');
check('the old PIN no longer opens it', await isLocked(), true);
await unlock('13579');
check('the new one does', await isLocked(), false);

/* ------------------------------------------------ backups and restores */

await openSettings();
const download = await Promise.all([
  page.waitForEvent('download'),
  page.click('button:has-text("Save a backup file")'),
]).then(([d]) => d);
const backupPath = `${OUT}/lock-backup.json`;
await download.saveAs(backupPath);
const backupText = readFileSync(backupPath, 'utf8');
const backup = JSON.parse(backupText);
check('the backup still carries the data', backup.tasks.some((t) => t.title.includes('Okafor')), true);
check('and the rest of the settings', typeof backup.settings.theme, 'string');
check('but no lock', 'lock' in backup.settings, false);
check(
  'and none of the lock\'s hashes or salts, anywhere in the file',
  [changed.pinHash, changed.pinSalt, changed.phraseHash, changed.phraseSalt].some((v) => backupText.includes(v)),
  false,
);
check('Settings says the lock is left out of backups', (await page.textContent('.main')).includes('Two things stay on this phone: the app lock, and a low day'), true);

// A file that carries a different lock, as a hand-edited or foreign file might.
const foreign = {
  ...backup,
  settings: { ...backup.settings, lock: { ...changed, pinHash: 'A'.repeat(43) + '=', pinSalt: 'B'.repeat(22) + '==' } },
};
const foreignPath = `${OUT}/lock-foreign-backup.json`;
writeFileSync(foreignPath, JSON.stringify(foreign));

await page.click('button:text-is("Wipe and replace")');
await page.setInputFiles('input[type="file"]', foreignPath);
await page.click('button:has-text("Replace everything with this file")');
await page.click('button:has-text("Yes, replace everything")');
await page.waitForTimeout(800);
check('wipe-and-replace with a file holding a lock does not change this phone\'s lock', (await readSettings()).lock.pinHash, changed.pinHash);

await page.setInputFiles('input[type="file"]', backupPath);
await page.click('button:has-text("Replace everything with this file")');
await page.click('button:has-text("Yes, replace everything")');
await page.waitForTimeout(800);
check('wipe-and-replace with a file holding no lock does not clear it', (await readSettings()).lock?.pinHash, changed.pinHash);

await page.click('button:text-is("Add what\'s missing")');
await page.setInputFiles('input[type="file"]', foreignPath);
await page.waitForTimeout(800);
check('adding what is missing from a file holding a lock does not change it either', (await readSettings()).lock.pinHash, changed.pinHash);
check('and the data is all still here after the restores', await rowCount('tasks'), 1);

/* --------------------------------------------------------- the phrase */

await page.click('.header button:text-is("Hide now")');
await page.waitForSelector('main.lock');
await page.click('main.lock button:text-is("Forgot the PIN? Use the recovery phrase")');
check('the phrase box turns autocomplete off', await page.getAttribute('#lock-phrase', 'autocomplete'), 'off');
check('and is not a password box', await page.getAttribute('#lock-phrase', 'type'), 'text');
await page.fill('#lock-phrase', `${words.slice(0, 5).join(' ')} ${words[5]}x`);
await page.click('main.lock button:text-is("Open with the phrase")');
await page.waitForSelector('main.lock .notice');
check('a misspelt word is pointed out', (await page.textContent('main.lock .notice')).includes(`"${words[5]}x" isn't one of the words`), true);
await page.screenshot({ path: `${OUT}/lock-phrase.png` });
// Shouted, reordered and spaced out - it is still the same six words.
await page.fill('#lock-phrase', `  ${[...words].reverse().map((w) => w.toUpperCase()).join(',   ')}  `);
await page.click('main.lock button:text-is("Open with the phrase")');
await page.waitForSelector('.main', { timeout: 10_000 });
check('the phrase opens the app, however it is typed', await isLocked(), false);
check('and says the lock is off', await page.locator('.card:has-text("The lock is off.")').count(), 1);
check('the lock is removed outright', 'lock' in ((await readSettings()) ?? {}), false);
check('Hide now goes with it', await page.locator('.header button:text-is("Hide now")').count(), 0);
check('and nothing was lost', (await rowCount('tasks')) + (await rowCount('notes')) + (await rowCount('captures')), 3);
await page.screenshot({ path: `${OUT}/phrase-unlocked.png` });
await page.click('.card:has-text("The lock is off.") button:text-is("Got it")');
await page.click('.header button:text-is("Done")');
await page.click('.nav-btn:has-text("Today")');
check('the task is right there on Today', (await leaks()).includes('Okafor'), true);

/* ----------------------------------------------------- delete everything */

const words2 = await setUpLock();
check('a new setup shows a new phrase', words2.join(' ') !== words.join(' '), true);
const lockBeforeWipe = (await readSettings()).lock;
check(
  'Settings says Delete everything leaves the lock in place',
  (await page.textContent('.main')).includes('and so does the app lock'),
  true,
);
await page.click('button:has-text("Delete everything on this device")');
await page.click('button:has-text("Yes, delete all of it")');
await page.waitForTimeout(600);
check('Delete everything empties the data', await rowCount('tasks'), 0);
check('and leaves the lock exactly as it was', JSON.stringify((await readSettings()).lock), JSON.stringify(lockBeforeWipe));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('main.lock');
check('so the next open is still locked', await isLocked(), true);
await unlock();

/* ------------------------------------------ the look, across themes and sizes */

/**
 * Calm and Midnight, at 1.0x and 1.6x text: the lock screen, its phrase view,
 * the header, and the Settings section in each of its states. Keys are
 * measured as well as photographed.
 */
for (const theme of ['calm', 'midnight']) {
  for (const textScale of [1, 1.6]) {
    const tag = `${theme}-${textScale === 1 ? '1.0x' : '1.6x'}`;
    await patchSettings({ theme, textScale });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('main.lock');
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/lock-screen-${tag}.png` });

    const keys = await page.evaluate(() =>
      [...document.querySelectorAll('.pin-key')].map((b) => {
        const r = b.getBoundingClientRect();
        return { text: b.textContent, w: r.width, h: r.height, fits: b.scrollWidth <= b.clientWidth + 1 };
      }),
    );
    check(`${tag}: every key is at least 44px each way`, keys.every((k) => k.w >= 44 && k.h >= 44), true);
    check(`${tag}: every key's label fits inside it`, keys.filter((k) => !k.fits).map((k) => k.text).join(', '), '');
    check(
      `${tag}: nothing scrolls sideways`,
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );

    await page.click('main.lock button:text-is("Forgot the PIN? Use the recovery phrase")');
    await page.screenshot({ path: `${OUT}/lock-phrase-${tag}.png` });
    await page.click('main.lock button:text-is("Use the PIN instead")');
    await unlock();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/header-${tag}.png` });

    await openSettings();
    await shotSection(`settings-lock-${tag}`);
    await page.click(`${LOCK_SECTION} button:text-is("Change the PIN")`);
    await shotSection(`settings-check-${tag}`);
    await typePin(PIN, LOCK_SECTION);
    await submitPad(LOCK_SECTION);
    await page.waitForSelector(`${LOCK_SECTION} :text("Choose a new PIN")`);
    await typePin('1357', LOCK_SECTION);
    await shotSection(`settings-new-pin-${tag}`);
    await page.click(`${LOCK_SECTION} button:text-is("Cancel")`);
    await page.click(`${LOCK_SECTION} button:text-is("Make a new recovery phrase")`);
    await typePin(PIN, LOCK_SECTION);
    await submitPad(LOCK_SECTION);
    await page.waitForSelector('ol.phrase-words li');
    await shotSection(`settings-phrase-${tag}`);
    await page.click(`${LOCK_SECTION} button:text-is("Cancel")`);
    check(`${tag}: cancelling a new phrase keeps the old one`, (await readSettings()).lock.phraseHash, lockBeforeWipe.phraseHash);
    await page.click('.header button:text-is("Done")');
  }
}

// The "lock is off" note, in the dark theme at the largest text.
await page.click('.header button:text-is("Hide now")');
await page.waitForSelector('main.lock');
await page.click('main.lock button:text-is("Forgot the PIN? Use the recovery phrase")');
await page.fill('#lock-phrase', words2.join(' '));
await page.click('main.lock button:text-is("Open with the phrase")');
await page.waitForSelector('.card:has-text("The lock is off.")', { timeout: 10_000 });
await page.screenshot({ path: `${OUT}/phrase-unlocked-midnight-1.6x.png` });
check('turning the lock off by phrase works at any size', 'lock' in ((await readSettings()) ?? {}), false);
await patchSettings({ theme: 'calm', textScale: 1 });

/* ------------------------------------- where WebCrypto is missing, it says so */

const plain = await browser.newContext({ viewport: { width: 412, height: 915 } });
plain.on('request', (req) => {
  const url = req.url();
  if (!url.startsWith('blob:') && !url.startsWith('data:') && new URL(url).origin !== ORIGIN) offOrigin.push(url);
});
await plain.addInitScript(() => {
  Object.defineProperty(window.crypto, 'subtle', { configurable: true, get: () => undefined });
});
const bare = await plain.newPage();
await bare.goto(BASE, { waitUntil: 'networkidle' });
await bare.waitForSelector('.main');
await bare.click('.header button:text-is("Settings")');
await bare.waitForSelector(LOCK_SECTION);
check(
  'without WebCrypto the lock says it is unavailable, rather than failing',
  (await bare.textContent(LOCK_SECTION)).includes("can't be used in this browser"),
  true,
);
check('and offers no PIN to set', await bare.locator(`${LOCK_SECTION} button:text-is("Set a PIN")`).count(), 0);
await plain.close();

/* ------------------------------------------------------------ the privacy claim */

check("no request left the app's own server", offOrigin.join(' '), '');
check('no console errors', consoleErrors.length, 0);
if (consoleErrors.length) console.log(consoleErrors.join('\n'));

await browser.close();
stopServer();

console.log(`\nScreenshots in ${OUT}/`);
if (problems.length) {
  console.error(`\n${problems.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll lock checks passed.');
