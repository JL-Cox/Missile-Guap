/**
 * Screenshots of every surface, in every theme, at both ends of the text-size
 * range. This is the design review: if a state is not in here, it was not
 * looked at.
 *
 *     npm run build
 *     CHROME_PATH=/opt/pw-browsers/chromium node e2e/design-shots.mjs
 *
 * It starts and stops its own preview server, like e2e/app-check.mjs.
 *
 * The seed content below is real writing, in the app's own voice - a referral
 * to chase, a surgery's phone number, a boiler code. Placeholder names and
 * lorem ipsum hide exactly the problems screenshots are for: how a long title
 * wraps, what two lines of metadata do to a row, whether a real amount still
 * lines up once it has a thousands separator.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = Number(process.env.E2E_SHOTS_PORT ?? 4188);
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SCREENSHOT_DIR ?? 'e2e/screenshots-design';
const CHROME = process.env.CHROME_PATH;

mkdirSync(OUT, { recursive: true });

{
  const indexHtml = readFileSync('dist/index.html', 'utf8');
  const scriptSrc = /<script[^>]+src="([^"]+)"/.exec(indexHtml)?.[1] ?? '';
  const distBase = scriptSrc.slice(0, scriptSrc.indexOf('assets/'));
  if (distBase !== '/') {
    throw new Error(`dist/ was built for base "${distBase}", not "/". Run: npm run build`);
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

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const day = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

let count = 0;

/**
 * A whole screen, top to bottom.
 *
 * The zone bar is `position: fixed` in the real app, which in a full-page
 * capture strands it wherever the viewport happened to be - halfway down the
 * image. For these shots only, it is pinned to the bottom of the document
 * instead, so one picture shows the entire zone with its bar once, where it
 * belongs. Nothing else is touched, and the `phone-*` shots below are the
 * unmodified view.
 */
const pinNav = () =>
  page.evaluate(() => {
    if (document.getElementById('shot-css')) return;
    const style = document.createElement('style');
    style.id = 'shot-css';
    style.textContent = 'body{position:relative}.nav{position:absolute!important;top:auto;bottom:0}';
    document.head.appendChild(style);
  });

const shot = async (name) => {
  await page.waitForTimeout(220);
  await pinNav();
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  await page.evaluate(() => document.getElementById('shot-css')?.remove());
  count += 1;
};

/** Exactly what the phone shows: one viewport, the zone bar fixed where it is. */
const shotPhone = async (name) => {
  // Changing page or zone starts at the top by itself now; this is for a
  // shot taken after scrolling within one.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(220);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  count += 1;
};

/* ---------------------------------------------------------------- appearance */

/**
 * Writes the appearance settings straight into IndexedDB and reloads, which is
 * both faster and less brittle than driving the Settings screen 14 times.
 */
async function appearance({ theme, textScale = 1, customTheme, lowDay }) {
  await page.evaluate(
    ([theme, textScale, customTheme, lowDay]) =>
      new Promise((resolve) => {
        const req = indexedDB.open('steady');
        req.onsuccess = () => {
          const tx = req.result.transaction('settings', 'readwrite');
          // The whole record, so each pass also starts with every page on its
          // first zone and no lock.
          tx.objectStore('settings').put({
            id: 'settings',
            theme,
            textScale,
            ...(customTheme ? { customTheme } : {}),
            ...(lowDay ? { lowDay } : {}),
            reduceMotion: false,
            blurAmounts: false,
            currency: 'USD',
            lookaheadDays: 14,
            notificationsAsked: true,
            suggestTags: true,
            rev: 0,
            // lastSeenBuild is deliberately left out: absent means "first ever
            // launch", which shows no update banner. See src/lib/version.ts.
          });
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
        };
      }),
    [theme, textScale, customTheme ?? null, lowDay ?? null],
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.main');
  await page.waitForTimeout(400);
}

/*
  Getting around, as in app-check.mjs: pages through the Menu, zones from the
  bar, both by their fixed ids.
*/
/** Each working page's zones, in the bar's order. Settings and About have none. */
const ZONES = {
  today: ['day', 'waiting', 'money', 'undated'],
  inbox: ['open', 'cleared'],
  tasks: ['dated', 'undated', 'finished', 'search'],
  backlog: ['open', 'routines', 'finished'],
  notes: ['all', 'search'],
  debt: ['paychecks', 'plan', 'debts'],
  money: ['soon', 'paychecks', 'subscriptions', 'income'],
};
const onPage = () => page.evaluate(() => document.querySelector('.main')?.getAttribute('data-page') ?? null);
const zoneNow = () =>
  page.evaluate(() => document.querySelector('.zones [role="tab"][aria-selected="true"]')?.getAttribute('data-zone') ?? null);
const openMenu = async () => {
  if (!(await page.locator('#menu').count())) await page.click('.header .menu-btn');
  await page.waitForSelector('#menu');
};
const goTo = async (pageId, zoneId) => {
  if ((await onPage()) !== pageId) {
    await openMenu();
    await page.click(`#menu .drawer-item[data-page="${pageId}"]`);
    await page.waitForSelector(`.main[data-page="${pageId}"]`);
  }
  if (zoneId && (await zoneNow()) !== zoneId) await page.click(`.zones [role="tab"][data-zone="${zoneId}"]`);
  await page.waitForTimeout(260);
};

/* --------------------------------------------------------------------- seed */

/**
 * Three debts people really have: a store card on a "no interest if paid in
 * full" promo, a car loan with its terms, and a hospital bill on a 0% payment
 * plan. The card is due tomorrow, so it is always on this paycheck.
 */
function debtSeed(now = Date.now()) {
  const dom = (offset) => Number(day(offset).slice(8));
  return [
    {
      id: 'debt1',
      name: 'Furniture store card',
      kind: 'storeCard',
      balanceMinor: 118_000,
      balanceAsOf: day(-6),
      aprPercent: 29.99,
      minimum: { kind: 'percentPlusInterest', percent: 1, floorMinor: 3_500 },
      dueDay: dom(1),
      autopay: false,
      promo: { aprPercent: 0, endsOn: day(210), deferred: true, balanceMinor: 90_000 },
      creditLimitMinor: 250_000,
      currency: 'USD',
      notes: 'Pay online, or call the number on the statement.',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'debt2',
      name: 'Car loan',
      kind: 'autoLoan',
      balanceMinor: 1_142_000,
      balanceAsOf: day(-3),
      aprPercent: 6.9,
      minimum: { kind: 'fixed', amountMinor: 39_509 },
      dueDay: dom(12),
      autopay: true,
      loan: { originalMinor: 2_000_000, termMonths: 60, firstPaymentOn: '2024-03-12' },
      currency: 'USD',
      notes: '',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'debt3',
      name: 'Hospital bill',
      kind: 'medical',
      balanceMinor: 64_000,
      balanceAsOf: day(-20),
      aprPercent: 0,
      minimum: { kind: 'fixed', amountMinor: 8_000 },
      dueDay: dom(20),
      autopay: false,
      currency: 'USD',
      notes: 'Billing office: (212) 555-0182. Ask for the payment plan team.',
      createdAt: now,
      updatedAt: now,
    },
  ];
}

async function seed() {
  const debts = debtSeed();
  await page.evaluate(
    ([today, yesterday, lastWeek, nextWeek, soon, debts]) =>
      new Promise((resolve) => {
        const req = indexedDB.open('steady');
        req.onsuccess = () => {
          const db = req.result;
          const now = Date.now();
          const tx = db.transaction(
            ['captures', 'tasks', 'notes', 'subscriptions', 'incomes', 'debts'],
            'readwrite',
          );
          const put = (store, rows) => rows.forEach((r) => tx.objectStore(store).put(r));

          put('captures', [
            {
              id: 'c1',
              text: "Ask about the referral letter when the doctor's office calls back",
              createdAt: now - 3600_000,
            },
            { id: 'c2', text: 'Trash pickup is Thursday this week, not Wednesday', createdAt: now - 7200_000 },
            {
              id: 'c3',
              text: 'That noise the furnace makes when the heat comes on - mention it to the technician',
              createdAt: now - 86_400_000,
            },
            // Dealt with already, so the Inbox's second zone has something in it.
            {
              id: 'c4',
              text: 'Library closes early on Saturday',
              createdAt: now - 3 * 86_400_000,
              clearedAt: now - 2 * 86_400_000,
            },
          ]);

          put('tasks', [
            {
              id: 't1',
              title: 'Call the dentist about the referral',
              notes: 'Ask for Dr Hall. The letter is in the blue folder on the shelf.',
              steps: [
                { id: 's1', text: 'Find the referral letter', done: true },
                { id: 's2', text: 'Call at 9am, when they open', done: false },
              ],
              tags: ['health', 'phone calls'],
              energy: 'high',
              date: today,
              startTime: '09:30',
              durationMin: 30,
              createdAt: now,
              updatedAt: now,
            },
            {
              id: 't2',
              title: 'Pick up the prescription',
              notes: '',
              steps: [],
              tags: ['health'],
              energy: 'low',
              date: today,
              startTime: '14:00',
              durationMin: 15,
              createdAt: now,
              updatedAt: now,
            },
            {
              id: 't3',
              title: 'Take the trash out',
              notes: '',
              steps: [],
              tags: ['house'],
              date: today,
              doneAt: now - 1800_000,
              createdAt: now,
              updatedAt: now,
            },
            {
              id: 't4',
              title: 'Email the landlord about the furnace',
              notes: 'It is the same fault as March. There is a photo of the error code on the phone.',
              steps: [],
              tags: ['house'],
              date: yesterday,
              createdAt: now,
              updatedAt: now,
            },
            {
              id: 't5',
              title: 'Send the meter reading',
              notes: '',
              steps: [],
              tags: ['house'],
              date: lastWeek,
              createdAt: now,
              updatedAt: now,
            },
            {
              id: 't6',
              title: 'Find the passport before the form needs it',
              notes: '',
              steps: [],
              tags: ['admin'],
              energy: 'medium',
              priority: 'high',
              createdAt: now,
              updatedAt: now,
            },
            {
              id: 't7',
              title: 'Book the eye exam',
              notes: '',
              steps: [],
              tags: ['health'],
              createdAt: now,
              updatedAt: now,
            },
            {
              id: 't9',
              title: 'Renew the car registration before it runs out',
              notes: 'The form is online; the insurance card is in the glove box.',
              steps: [],
              tags: ['admin'],
              priority: 'critical',
              createdAt: now - 86_400_000,
              updatedAt: now,
            },
            {
              id: 't10',
              title: 'Order more printer ink',
              notes: '',
              steps: [],
              tags: [],
              priority: 'low',
              createdAt: now,
              updatedAt: now,
            },
            {
              id: 't8',
              title: 'Ask the pharmacy about the repeat prescription service',
              notes: '',
              steps: [],
              tags: [],
              date: nextWeek,
              createdAt: now,
              updatedAt: now,
            },
            // A routine, and something from the backlog already ticked off, so
            // the Backlog's Routines and Finished zones are not empty.
            {
              id: 't11',
              title: 'Leaving the house',
              notes: '',
              steps: [
                { id: 's3', text: 'Keys', done: false },
                { id: 's4', text: 'Wallet', done: false },
                { id: 's5', text: 'Phone and charger', done: false },
              ],
              tags: [],
              routine: true,
              lastDoneAt: now - 86_400_000,
              createdAt: now,
              updatedAt: now,
            },
            {
              id: 't12',
              title: 'Return the library books',
              notes: '',
              steps: [],
              tags: [],
              doneAt: now - 2 * 86_400_000,
              createdAt: now - 5 * 86_400_000,
              updatedAt: now,
            },
          ]);

          put('notes', [
            {
              id: 'n1',
              title: "Doctor's office",
              body: 'Front desk: (212) 555-0147\nAsk for Dr Hall.\nPhones open at 8, but they are busy until about 9:15.\nRefills go through the patient portal, not the front desk.',
              tags: ['health', 'phone numbers'],
              pinned: true,
              createdAt: now,
              updatedAt: now - 86_400_000,
            },
            {
              id: 'n2',
              title: 'Furnace reset, what the technician said',
              body: 'Hold the reset button for five seconds, then set the thermostat back to 68.\nIf the pilot light is out, call the gas company before anything else.\nThe filter gets changed every October.',
              tags: ['house'],
              pinned: false,
              createdAt: now,
              updatedAt: now - 3 * 86_400_000,
            },
            {
              id: 'n3',
              title: 'What to say when I call about the referral',
              body: '"I was referred by Dr Hall in March and I have not heard anything. Can you tell me whether it was received?"\nReference on the letter: RF-40118.',
              tags: ['health', 'phone calls'],
              pinned: false,
              createdAt: now,
              updatedAt: now - 5 * 86_400_000,
            },
            {
              id: 'n4',
              title: 'Trash pickup',
              body: 'Recycling: every other Tuesday.\nTrash: every Tuesday.\nYard waste stops in December.',
              tags: [],
              pinned: false,
              createdAt: now,
              updatedAt: now - 9 * 86_400_000,
            },
          ]);

          put('subscriptions', [
            {
              id: 'sub1',
              name: 'Netflix',
              amountMinor: 1299,
              currency: 'USD',
              cycle: 'monthly',
              every: 1,
              firstBilled: today,
              category: 'TV & film',
              notes: '',
              cancelHow: 'Account > Membership > Cancel Membership. Takes effect at the end of the month.',
              remindDaysBefore: 3,
              createdAt: now,
              updatedAt: now,
            },
            {
              id: 'sub2',
              name: 'Phone',
              amountMinor: 1800,
              currency: 'USD',
              cycle: 'monthly',
              every: 1,
              firstBilled: nextWeek,
              category: 'Phone',
              notes: '',
              cancelHow: '',
              remindDaysBefore: 3,
              createdAt: now,
              updatedAt: now,
            },
            {
              id: 'sub3',
              name: 'Gym',
              amountMinor: 2400,
              currency: 'USD',
              cycle: 'monthly',
              every: 1,
              firstBilled: soon,
              category: 'Health',
              notes: '',
              cancelHow: 'Has to be done in person at the desk, with 30 days notice.',
              remindDaysBefore: 7,
              createdAt: now,
              updatedAt: now,
            },
            {
              id: 'sub4',
              name: 'Spotify',
              amountMinor: 1199,
              currency: 'USD',
              cycle: 'monthly',
              every: 1,
              firstBilled: nextWeek,
              category: 'Music',
              notes: '',
              cancelHow: '',
              remindDaysBefore: 3,
              createdAt: now,
              updatedAt: now,
            },
            {
              id: 'sub5',
              name: 'Cloud storage',
              amountMinor: 249,
              currency: 'USD',
              cycle: 'yearly',
              every: 1,
              firstBilled: nextWeek,
              category: 'Storage',
              notes: '',
              cancelHow: '',
              remindDaysBefore: 14,
              createdAt: now,
              updatedAt: now,
            },
            {
              id: 'sub6',
              name: 'Produce box',
              amountMinor: 1500,
              currency: 'USD',
              cycle: 'weekly',
              every: 2,
              firstBilled: today,
              category: 'Food',
              notes: 'Skips are done on the website by Sunday night.',
              cancelHow: '',
              remindDaysBefore: 3,
              createdAt: now,
              updatedAt: now,
            },
            // Cancelled, so the Subscriptions zone shows its Cancelled list.
            {
              id: 'sub7',
              name: 'Meditation app',
              amountMinor: 699,
              currency: 'USD',
              cycle: 'monthly',
              every: 1,
              firstBilled: lastWeek,
              category: 'Health',
              notes: '',
              cancelHow: 'Settings > Subscription > Cancel, in the app itself.',
              remindDaysBefore: 3,
              endedOn: yesterday,
              createdAt: now,
              updatedAt: now,
            },
          ]);

          put('debts', debts);

          put('incomes', [
            {
              id: 'inc1',
              name: 'Main job',
              frequency: 'semimonthly',
              daysOfMonth: [15, 31],
              weekendShift: 'friday',
              holidays: ['newYear', 'memorial', 'independence', 'labor', 'thanksgiving', 'christmas'],
              grossMinor: 250000,
              netMinor: 185000,
              deductions: [
                { id: 'd1', label: 'Federal income tax', amountMinor: 42000 },
                { id: 'd2', label: 'Social Security', amountMinor: 15500 },
                { id: 'd3', label: 'Medicare', amountMinor: 3600 },
                { id: 'd4', label: 'Health insurance', amountMinor: 2400 },
              ],
              currency: 'USD',
              notes: '',
              createdAt: now,
              updatedAt: now,
            },
          ]);

          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    [day(0), day(-1), day(-7), day(5), day(2), debts],
  );
}

/**
 * Replaces every debt and the plan, for the Debt tab's own shots. `plan`
 * adds an amount per check and an estimate for everything else, so the
 * suggestion and the extra show; `paidOff` adds one already paid off, so
 * that section has something in it.
 */
async function setDebts({ debts = [], plan = false, paidOff = false } = {}) {
  const rows = [...debts];
  if (paidOff) {
    rows.push({
      id: 'debt4',
      name: 'Old store card',
      kind: 'storeCard',
      balanceMinor: 0,
      balanceAsOf: day(-40),
      aprPercent: 27.99,
      minimum: { kind: 'percentPlusInterest', percent: 1, floorMinor: 3_500 },
      dueDay: 8,
      autopay: false,
      paidOffOn: day(-40),
      currency: 'USD',
      notes: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  await page.evaluate(
    ([rows, plan]) =>
      new Promise((resolve) => {
        const req = indexedDB.open('steady');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['debts', 'debtPlan'], 'readwrite');
          tx.objectStore('debts').clear();
          tx.objectStore('debtPlan').clear();
          for (const row of rows) tx.objectStore('debts').put(row);
          if (plan) {
            tx.objectStore('debtPlan').put({
              id: 'plan',
              strategy: 'avalanche',
              perCheckMinor: { inc1: 50_000 },
              untrackedMonthlyMinor: 190_000,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    [rows, plan],
  );
}

/* ------------------------------------------------------------------ capture */

/**
 * Every page. With `allZones`, each zone of each working page; otherwise only
 * the zone each page opens on. Then Settings and About, which have no zone
 * bar, and Settings with one group open.
 */
async function everyScreen(tag, { allZones = false, alsoAsPhone = false } = {}) {
  for (const [pageId, zones] of Object.entries(ZONES)) {
    for (const zone of allZones ? zones : zones.slice(0, 1)) {
      await goTo(pageId, zone);
      await shot(`${tag}-${pageId}-${zone}`);
      if (alsoAsPhone) await shotPhone(`phone-${tag}-${pageId}-${zone}`);
    }
  }
  // The averages and the year, folded away at the end of Income until asked for.
  await goTo('money', 'income');
  const averages = page.locator('section[aria-label="Averages"] > .fold-heading > .fold-btn');
  if ((await averages.count()) && (await averages.getAttribute('aria-expanded')) === 'false') {
    await averages.click();
    await shot(`${tag}-money-income-averages`);
    // Folded again, so the next theme's Money shot starts the way it would.
    await averages.click();
  }
  await goTo('settings');
  await shot(`${tag}-settings`);
  if (alsoAsPhone) await shotPhone(`phone-${tag}-settings`);
  // One group open, as it is when you go to change something.
  await page.click('section[aria-label="How it looks"] > .fold-heading > .fold-btn');
  await shot(`${tag}-settings-open`);
  await goTo('about');
  await shot(`${tag}-about`);
  if (alsoAsPhone) await shotPhone(`phone-${tag}-about`);
  await goTo('today');
}

/** The forms, opened on real records and cancelled again so nothing changes. */
async function everyEditor(tag) {
  await goTo('tasks', 'dated');
  await page.click('button.item-title:has-text("Call the dentist")');
  await page.waitForTimeout(200);
  await shot(`${tag}-task-expanded`);
  await page.click('button:text-is("Edit")');
  await page.waitForSelector('#task-title');
  await shot(`${tag}-task-editor`);
  await page.click('form.card button:text-is("Cancel")');
  await page.waitForTimeout(200);

  await goTo('money', 'subscriptions');
  // Scoped to the card, not the zone. Subscriptions lists the cancelled ones
  // under the active ones, and each has an "Edit", so a bare
  // button:text-is("Edit") opens the wrong one - silently, and the failure
  // surfaces later as a mystery timeout.
  await page.click('button.item-title:has-text("Netflix")');
  await page.waitForTimeout(200);
  await shot(`${tag}-subscription-open`);
  await page.locator('.card-tight', { hasText: 'Netflix' }).first().locator('button:text-is("Edit")').click();
  await page.waitForSelector('#sub-name');
  await shot(`${tag}-subscription-editor`);
  // Saving an existing record updates it in place - no duplicate - and is the
  // only route to the confirmation screen, which is a real surface worth seeing.
  await page.click('form.card button[type="submit"]:text-is("Save")');
  await page.waitForTimeout(400);
  await shot(`${tag}-subscription-saved`);
  await page.click('button:text-is("Done")');
  await page.waitForTimeout(250);

  await goTo('money', 'income');
  await page.locator('.card-tight', { hasText: 'Main job' }).first().locator('button:text-is("Edit")').click();
  await page.waitForSelector('#income-name');
  await shot(`${tag}-income-editor`);
  await page.click('form.card button:text-is("Cancel")');
  await page.waitForTimeout(200);
}

console.log(`Shooting into ${OUT}/\n`);
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForTimeout(1200);

/* --- the first run: nothing saved yet, which is a designed state ----------- */
// Every zone empty says what it is for, so the empty run looks at all of them.
for (const [tag, opts, allZones] of [
  ['empty-calm-1.0', { theme: 'calm' }, true],
  ['empty-calm-1.6', { theme: 'calm', textScale: 1.6 }, true],
  ['empty-dark-1.0', { theme: 'dark' }, false],
  ['empty-custom-1.0', { theme: 'custom', customTheme: { ground: 'sepia', accent: 'plum' } }, false],
  ['empty-synthwave-1.0', { theme: 'synthwave' }, false],
]) {
  await appearance(opts);
  await everyScreen(tag, { allZones });
}

/* --- with a real week's worth of content ---------------------------------- */
await seed();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.main');

const FULL = [
  ['calm-1.0', { theme: 'calm' }],
  ['calm-1.6', { theme: 'calm', textScale: 1.6 }],
  ['dark-1.0', { theme: 'dark' }],
  ['dark-1.6', { theme: 'dark', textScale: 1.6 }],
  ['custom-1.0', { theme: 'custom', customTheme: { ground: 'trueBlack', accent: 'teal' } }],
  ['custom-1.6', { theme: 'custom', textScale: 1.6, customTheme: { ground: 'trueBlack', accent: 'teal' } }],
  // Just for fun - held to the same shots as the everyday themes.
  ['synthwave-1.0', { theme: 'synthwave' }],
  ['synthwave-1.6', { theme: 'synthwave', textScale: 1.6 }],
  ['bubblegum-1.0', { theme: 'bubblegum' }],
  ['bubblegum-1.6', { theme: 'bubblegum', textScale: 1.6 }],
  ['aurora-1.0', { theme: 'aurora' }],
  ['aurora-1.6', { theme: 'aurora', textScale: 1.6 }],
];
/** The themes and sizes whose every zone is looked at; the rest show each page's first. */
const EVERY_ZONE = new Set(['calm-1.0', 'calm-1.6', 'dark-1.0', 'synthwave-1.0']);

for (const [tag, opts] of FULL) {
  await appearance(opts);
  // The everyday sizes get the untouched phone-frame shots too.
  await everyScreen(tag, { allZones: EVERY_ZONE.has(tag), alsoAsPhone: tag.endsWith('-1.0') });
  await everyEditor(tag);
}

/* --- the rest of the theme set, so the range is visible -------------------- */
// Midnight, and High contrast at large text, zone by zone.
for (const [tag, opts] of [
  ['midnight-1.0', { theme: 'midnight' }],
  ['contrast-1.6', { theme: 'contrast', textScale: 1.6 }],
]) {
  await appearance(opts);
  await everyScreen(tag, { allZones: true, alsoAsPhone: tag.endsWith('-1.0') });
}
for (const [tag, opts] of [
  ['amber-1.0', { theme: 'amber' }],
  ['overcast-1.0', { theme: 'overcast' }],
  ['contrast-1.0', { theme: 'contrast' }],
  ['custom-warmwhite-clay', { theme: 'custom', customTheme: { ground: 'warmWhite', accent: 'clay' } }],
  ['custom-coolwhite-indigo', { theme: 'custom', customTheme: { ground: 'coolWhite', accent: 'indigo' } }],
  ['custom-warmnight-ochre', { theme: 'custom', customTheme: { ground: 'warmNight', accent: 'ochre' } }],
]) {
  await appearance(opts);
  await goTo('today', 'day');
  await shot(`${tag}-today-day`);
  await goTo('money', 'soon');
  await shot(`${tag}-money-soon`);
  await goTo('settings');
  await shot(`${tag}-settings`);
}

/* --- the toast, and the toast with Undo ----------------------------------- */
await appearance({ theme: 'calm' });
await goTo('today', 'day');
await page.fill('#capture-input', 'Call the doctor back about the referral');
await shotPhone('state-capture-open');
await page.click('button:text-is("Save to inbox")');
await page.waitForTimeout(300);
await shot('state-toast');
await page.locator('.item input[type="checkbox"]').first().click();
await page.waitForTimeout(300);
await shotPhone('state-toast-undo');
await page.click('.toast button:text-is("Undo")');
await page.waitForTimeout(300);

/* --- a form that did not work: the notice sits above Save ------------------- */
await goTo('money', 'soon');
await page.click('button:text-is("Add a subscription"):visible');
await page.waitForSelector('#sub-name');
await page.fill('#sub-name', 'Gym');
await page.fill('#sub-amount', 'twelve');
await page.click('form.card button[type="submit"]:text-is("Save")');
await page.waitForTimeout(600);
// Where the phone actually is after Save: scrolled to the notice above the Save row.
await page.screenshot({ path: `${OUT}/state-form-error.png` });
count += 1;
await page.click('form.card button:text-is("Cancel")');
await page.waitForTimeout(200);

/* --- a low day, on each of Today's zones ------------------------------------ */
for (const [tag, opts] of [
  ['lowday-calm-1.0', { theme: 'calm' }],
  ['lowday-calm-1.6', { theme: 'calm', textScale: 1.6 }],
]) {
  await appearance({ ...opts, lowDay: day(0) });
  for (const zone of ZONES.today) {
    await goTo('today', zone);
    await shot(`${tag}-today-${zone}`);
  }
}

/*
  --- the Debt page ------------------------------------------------------------
  Its own folder: empty and seeded, zone by zone, with its folds open, the form
  new and with More details and saved, the plan's form with a suggestion, and
  Money and Today with the payments on them. Calm and Midnight at both ends of
  the text scale, and Synthwave.
*/
const DEBT_OUT = process.env.DEBT_SCREENSHOT_DIR ?? 'e2e/screenshots-debt';
mkdirSync(DEBT_OUT, { recursive: true });
const debtShot = async (name) => {
  await page.waitForTimeout(220);
  await pinNav();
  await page.screenshot({ path: `${DEBT_OUT}/${name}.png`, fullPage: true });
  await page.evaluate(() => document.getElementById('shot-css')?.remove());
  count += 1;
};
/** Opens a folded section on the Debt page, if it is not open already. */
const openFold = async (title) => {
  const button = page.locator(`section[aria-label="${title}"] > .fold-heading > .fold-btn`);
  if ((await button.count()) && (await button.getAttribute('aria-expanded')) === 'false') await button.click();
};

for (const [tag, opts] of [
  ['calm-1.0', { theme: 'calm' }],
  ['calm-1.6', { theme: 'calm', textScale: 1.6 }],
  ['midnight-1.0', { theme: 'midnight' }],
  ['midnight-1.6', { theme: 'midnight', textScale: 1.6 }],
  ['synthwave-1.0', { theme: 'synthwave' }],
]) {
  await setDebts();
  await appearance(opts);
  for (const zone of ZONES.debt) {
    await goTo('debt', zone);
    await debtShot(`${tag}-debt-empty-${zone}`);
  }

  await setDebts({ debts: debtSeed(), plan: true, paidOff: true });
  await appearance(opts);
  for (const zone of ZONES.debt) {
    await goTo('debt', zone);
    await debtShot(`${tag}-debt-${zone}`);
  }
  await goTo('debt', 'plan');
  await openFold('How this works');
  await debtShot(`${tag}-debt-plan-folds-open`);
  await goTo('debt', 'debts');
  await openFold('Paid off');
  await page.locator('section[aria-label="Your debts"] .details-btn').first().click();
  await debtShot(`${tag}-debt-debts-folds-open`);

  await goTo('debt', 'paychecks');
  await page.locator('section[aria-label="This paycheck"] button:text-is("Change the amount")').click();
  await page.waitForSelector('#plan-untracked');
  await debtShot(`${tag}-plan-editor`);
  await page.click('form.card button:text-is("Cancel")');

  await page.click('button:text-is("Add a debt"):visible');
  await page.waitForSelector('#debt-name');
  await page.fill('#debt-name', 'Visa card');
  await page.fill('#debt-balance', '2480.00');
  await page.fill('#debt-apr', '24.99');
  await page.fill('#debt-due', day(9));
  await debtShot(`${tag}-editor-new`);
  await page.click('form.card button:has-text("More details")');
  await debtShot(`${tag}-editor-more`);
  await page.click('form.card button[type="submit"]:text-is("Save")');
  await page.waitForTimeout(400);
  await debtShot(`${tag}-editor-saved`);
  await page.click('button:text-is("Done")');

  await goTo('money', 'paychecks');
  await debtShot(`${tag}-money-paychecks`);
  await goTo('money', 'soon');
  await debtShot(`${tag}-money-soon`);
  await goTo('today', 'money');
  await debtShot(`${tag}-today-money`);
  await goTo('today', 'day');
  await debtShot(`${tag}-today-day`);
}
// Back to the seed every other shot below was taken with.
await setDebts({ debts: debtSeed() });

/*
  --- the zone bar on every page, at both ends of the text scale ---------------
  Up to four labelled slots. This is the case the --zone-label cap and the
  reserved bold width exist for, proven by measurement as well as by eye: each
  slot's width, and whether any label is clipped.
*/
for (const [tag, opts] of [
  ['zones-calm-1.0', { theme: 'calm' }],
  ['zones-calm-1.6', { theme: 'calm', textScale: 1.6 }],
  ['zones-dark-1.6', { theme: 'dark', textScale: 1.6 }],
  ['zones-synthwave-1.0', { theme: 'synthwave' }],
]) {
  await appearance(opts);
  for (const width of [412, 360]) {
    await page.setViewportSize({ width, height: 915 });
    for (const pageId of Object.keys(ZONES)) {
      await goTo(pageId);
      const box = await page.locator('.zones').boundingBox();
      await page.screenshot({
        path: `${OUT}/${tag}-${width}-${pageId}.png`,
        clip: { x: box.x, y: box.y - 8, width: box.width, height: box.height + 8 },
      });
      count += 1;
      const slots = await page.evaluate(() =>
        [...document.querySelectorAll('.zones [role="tab"]')].map((b) => ({
          label: b.textContent.trim(),
          width: Math.round(b.getBoundingClientRect().width),
          clipped: b.scrollWidth > b.clientWidth + 1,
          size: getComputedStyle(b).fontSize,
        })),
      );
      console.log(
        `  ${tag} ${width}px ${pageId}: ${slots.map((s) => `${s.label} ${s.width}px${s.clipped ? ' CLIPPED' : ''}`).join(', ')} (labels ${slots[0].size})`,
      );
    }
  }
  await page.setViewportSize({ width: 412, height: 915 });
}

/*
  --- the Menu, open over Backlog ----------------------------------------------
  At both ends of the text scale, on a 412px and a 360px phone, in the
  everyday themes, High contrast and Synthwave.
*/
for (const [theme, textScale] of [
  ['calm', 1],
  ['calm', 1.6],
  ['midnight', 1],
  ['midnight', 1.6],
  ['dark', 1],
  ['dark', 1.6],
  ['contrast', 1],
  ['contrast', 1.6],
  ['synthwave', 1],
  ['synthwave', 1.6],
]) {
  await appearance({ theme, textScale });
  for (const width of [412, 360]) {
    await page.setViewportSize({ width, height: 915 });
    await goTo('backlog');
    await openMenu();
    // Past the slide-in, so the picture is the drawer at rest.
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/menu-${theme}-${textScale === 1 ? '1.0' : '1.6'}-${width}.png` });
    count += 1;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  await page.setViewportSize({ width: 412, height: 915 });
}

/*
  --- the header with a lock set ------------------------------------------------
  Hide now joins Menu at the top. At large text Menu and Hide now share the
  first row and the page's name has the second; at everyday sizes it is one
  row. The PIN is set up the real way, through Settings, and typed on the pad
  after each reload.
*/
const PIN = '2468';
const typePin = async (pin, scope) => {
  for (const digit of pin) await page.click(`${scope} .pin-pad button:text-is("${digit}")`);
};
const submitPad = (scope) => page.click(`${scope} .pin-pad button.btn-primary`);
const LOCK_GROUP = 'section[aria-label="App lock"]';
/** Changes some settings and keeps the rest - the lock included. */
const patchSettings = (changes) =>
  page.evaluate(
    (patch) =>
      new Promise((resolve) => {
        const req = indexedDB.open('steady');
        req.onsuccess = () => {
          const tx = req.result.transaction('settings', 'readwrite');
          const store = tx.objectStore('settings');
          const get = store.get('settings');
          get.onsuccess = () => store.put({ ...(get.result ?? { id: 'settings' }), ...patch });
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
        };
      }),
    changes,
  );

await appearance({ theme: 'calm' });
await goTo('settings');
await page.click(`${LOCK_GROUP} > .fold-heading > .fold-btn`);
await page.click(`${LOCK_GROUP} button:text-is("Set a PIN")`);
await typePin(PIN, LOCK_GROUP);
await submitPad(LOCK_GROUP);
await typePin(PIN, LOCK_GROUP);
await submitPad(LOCK_GROUP);
await page.waitForSelector('ol.phrase-words li');
await page.click(`${LOCK_GROUP} label.check`);
await page.click(`${LOCK_GROUP} button:text-is("Turn the lock on")`);
await page.waitForSelector('.toast:has-text("The lock is on")', { timeout: 10_000 });

for (const [theme, textScale] of [
  ['calm', 1],
  ['calm', 1.6],
  ['midnight', 1.6],
]) {
  await patchSettings({ theme, textScale });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('main.lock');
  await typePin(PIN, 'main.lock');
  await submitPad('main.lock');
  await page.waitForSelector('.main', { timeout: 10_000 });
  const size = textScale === 1 ? '1.0' : '1.6';
  for (const width of [412, 360]) {
    await page.setViewportSize({ width, height: 915 });
    for (const pageId of ['today', 'money']) {
      await goTo(pageId);
      const box = await page.locator('.header').boundingBox();
      await page.screenshot({
        path: `${OUT}/header-lock-${theme}-${size}-${width}-${pageId}.png`,
        clip: { x: 0, y: 0, width, height: box.y + box.height + 8 },
      });
      count += 1;
    }
    await goTo('money');
    await shotPhone(`phone-header-lock-${theme}-${size}-${width}-money`);
  }
  await page.setViewportSize({ width: 412, height: 915 });
  await goTo('today');
}
// Writing the whole record again takes the lock away, for anything after this.
await appearance({ theme: 'calm' });

/* --- the pages with no zone bar, as the phone shows them --------------------- */
for (const [tag, opts] of [
  ['calm-1.0', { theme: 'calm' }],
  ['calm-1.6', { theme: 'calm', textScale: 1.6 }],
  ['midnight-1.0', { theme: 'midnight' }],
]) {
  await appearance(opts);
  for (const pageId of ['settings', 'about']) {
    await goTo(pageId);
    await shotPhone(`nobar-${tag}-${pageId}`);
  }
}

await browser.close();
stopServer();
console.log(`\n${count} screenshots in ${OUT}/`);
