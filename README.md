# Steady

Notes, a day plan, reminders and a subscription tracker, in one app that runs
entirely on your own phone.

No account. No server. No sync. No analytics. Nothing to mine, because there is
nowhere for your data to go.

---

## Why this exists

Most planner apps are built on the assumption that you will remember to open
them, that you will happily sort each thought into the right bucket, and that
you will not mind them reading everything you write. This one assumes the
opposite on all three counts.

**The design rules, in order of importance:**

1. **Capture costs nothing.** There is one box, in the same place on every
   screen. Type the thing, press Enter, it is safe. No date, no category, no
   priority, no decision of any kind. Sorting is a separate job you can do
   later, or never.
2. **Nothing is hidden.** No swipe gestures, no long-press menus, no icon-only
   buttons. If an action exists, it is a labelled button you can see.
3. **Nothing shouts.** There is no red "OVERDUE", no streak counter, no guilt.
   Tasks whose day has passed are listed under *Still waiting*, because they are
   still here, not because you failed.
4. **The layout never changes.** Same sections, same order, every day,
   regardless of what is in them. An empty screen looks like a ready screen,
   not a broken one.
5. **Everything is optional.** A task with nothing but a title is a complete
   task. The form never demands an estimate or a due date, because being forced
   to decide is what stops the thought getting written down at all.
6. **Big things break into small ones.** Step lists sit in the main task form,
   not behind an "advanced" toggle, because "ring the dentist" is often really
   "find the letter, then ring at 9am".
7. **You can turn the volume down.** Calm / dark / high-contrast themes, a text
   size slider, motion off, and a switch that blurs every money amount until you
   tap it, for days when seeing the number is too much.

## What's in it

| Screen | What it holds |
| --- | --- |
| **Today** | What is planned today, what is still waiting, what money is about to leave, and anything with no date yet. |
| **Inbox** | Everything you typed into the capture box. Three buttons per item, always the same three: make it a task, keep it as a note, done with it. |
| **Tasks** | All tasks, grouped by day, searchable across titles, notes, steps and tags. Optional times, durations, reminders, repeats and an energy level. |
| **Notes** | Plain text you will want to look up again. Reference numbers, phone scripts, what the nurse actually said. Pin the important ones. |
| **Money** | Your income and your subscriptions, and what one leaves of the other. Subscriptions carry the next charge date, the real monthly and yearly cost, a breakdown by category, and — the useful bit — *how to actually cancel it*, written down while you still know. Adding one is a single journey that ends with the entry in your phone's calendar. |
| **Settings** | Appearance, notifications, backup and restore, calendar export, and a plain-English account of what happens to your data. |

There are four buckets, not five: **a reminder is a property of a task**, not a
separate kind of thing, so there is never a moment of "is this a task or a
reminder?".

### Adding a subscription

One button, three fields, done:

1. **Tap "Add a subscription"** — full width, top of the Money screen, never a
   thing you have to hunt for.
2. **Type the name.** Common services autocomplete and fill in the category and
   the usual billing cycle for you. Deliberately no prices: they change
   constantly, and a wrong number sitting quietly in your budget is worse than
   no number.
   **How often** is a row of buttons: Weekly, **Every 2 weeks**, Monthly, Every
   3 months, Yearly. They say exactly how often money moves — never
   "semi-weekly" or "bi-weekly", which mean opposite things to different people.
   Anything else (every 2 months, say) still goes under *More options*, and the
   app leaves it alone rather than rounding it to the nearest button.
3. **Amount, how often, next charge date.** Category is a row of buttons, not a
   text box — tapping one of nine is not a decision the way inventing one is.
   Everything else (how to cancel, notes, "every 2 months") is behind
   *More options*.

Saving lands on a confirmation that tells you what you just signed up to:
each charge, the next date, **what it works out at per month and per year**, and
the category. The yearly figure is there because it is the number that actually
changes your mind.

On that screen is one more button: **Add to my calendar.** It puts a repeating
entry on every future charge date, carrying the lead-time warning you chose and
the cancellation steps in the notes. On Android this opens the share sheet, so
Google Calendar is one tap away. From then on your phone's own alarms do the
reminding, whether or not Steady is open.

If you skipped it, every subscription card has the same button, and dated tasks
have it too. *Settings → Export everything to my calendar* still exports the lot
in one file.

### Tag suggestions, learned on this phone

Notes can suggest their own tags. The classifier is a small Naive Bayes model
trained on **your own already-tagged notes** — not a language model, and not
something that has read anyone else's writing. That is the point: the corpus is
one person's notes in their own vocabulary, so "ring the surgery" comes to mean
*health* because that is what it means to **you**.

It is deliberately shy, because a wrong suggestion costs more than a missing one:

- **It starts knowing nothing.** No built-in categories. It says nothing at all
  until you have tagged five notes yourself, and only ever suggests tags you
  invented.
- **A tag has to be a pattern.** Used once or twice, it is never suggested.
- **Three at most**, and never one the note already carries.
- **It explains itself** — *"Because you have used "health" on notes mentioning
  dentist, appointment"* — so you can check its reasoning instead of trusting it.
- **It never files anything for you.** A suggestion is a chip you tap. Nothing
  is moved, renamed or re-tagged behind your back.

Suggestions appear in the note editor, on the Inbox panel after you file a
capture (filing stays one tap), and on *Notes → Tidy up untagged notes* for
catching up on old ones. Turn the whole thing off in Settings.

There is no network call in any of this, and nothing to call. `connect-src
'none'` is untouched — the browser check proves it by still failing to
exfiltrate data with the feature switched on.

### Income, from the paystub

Add a paycheque and the expense figures stop being half a picture.

**It does not calculate your tax.** Gross and net are typed straight off the
stub, so they are right by construction. Tax rates vary by state and filing
status and change every year; a confident wrong number in your budget is worse
than no number.

- **Every 2 weeks and twice a month are not the same thing** — 26 paycheques a
  year against 24, a difference of two whole paycheques. The app keeps them
  apart, and twice-a-month pays on real dates: "the 15th and the last day"
  lands on the 28th in February and the 30th in April by itself.
- **Deductions are lines you copy across** — federal, Social Security, Medicare,
  state, 401(k), health insurance — offered as one-tap chips. Whatever you
  haven't written down shows as *"not itemised"*, never as an error. A partial
  list is fine.
- **You see gross against net**: what you earn, what you keep, and the share
  taken before you ever see it — a number paystubs make oddly hard to read.
- **Take-home minus subscriptions** gives what's left. Stated honestly: this app
  only knows about subscriptions, so that remainder still has to cover rent,
  food and everything else.
- **Weekend paydays move the way yours actually do.** Per job: the Friday
  before (the usual US practice, and the default), the Monday after, or not at
  all. The shift applies to the date shown, never to the schedule itself — if a
  shifted Friday fed back into the cycle, an every-2-weeks job anchored on a
  Saturday would creep a day earlier every payday until it had drifted off the
  calendar.
- **Paydays appear on Today** and export to your calendar. A recurrence rule
  cannot express "the Friday before", so a shifted schedule exports two years of
  explicit dates instead of a rule that would be wrong a fifth of the time.
  **Holidays are accounted for too.** Each job carries its own list of days the
  employer is closed — New Year's Day, Good Friday, Memorial Day, Independence
  Day, Labor Day, Thanksgiving and the Friday after, Christmas — and a payday
  landing on one keeps stepping until it reaches a working day. A payday on the
  Saturday after Christmas ends up on Christmas Eve, not on Christmas.

  None of this is a lookup table. Every date is computed: three are fixed, three
  are "the nth weekday of a month", and Good Friday is two days before Easter
  via the Gregorian computus. Nothing to maintain, nothing to go stale. Fixed
  holidays falling on a weekend are taken the nearest weekday — which is why
  New Year's Day 2028 being a Saturday makes Friday 31 December 2027 a day off,
  and moves a payday that lands there.

## Privacy, stated precisely

The claim is not "we promise not to look". The claim is that **the app cannot
send your data anywhere, and your browser enforces that, not us.**

The page ships with this Content Security Policy:

```
connect-src 'none'
```

That single directive means the page is forbidden from opening a network
connection of any kind — no `fetch`, no `XMLHttpRequest`, no WebSocket, no
`navigator.sendBeacon`. If any code in this app ever tried to send your notes
somewhere, the browser would block the request and log the attempt to the
console. `e2e/app-check.mjs` tests exactly this, by trying to exfiltrate data
from inside the running page and asserting that it fails.

Everything else follows from that:

- **No account, no login, no server.** There is no backend to this project.
- **No analytics, no crash reporting, no ads, no third-party scripts.** Every
  dependency is bundled at build time; nothing is loaded from a CDN at runtime.
- **No push notifications**, because a push server would mean routing your
  reminders through someone else's computer. See *Reminders* below.
- **Works in aeroplane mode.** The service worker caches the app itself on first
  visit, so every feature works with no signal at all.

Your data lives in this browser's IndexedDB storage, on this device, in a
database called `steady`, filed under the origin the app is served from.

On first run the app asks the browser for **persistent storage**. Without that,
IndexedDB is "best-effort" and the browser is allowed to evict it when the
device runs short of space - no warning, no recovery, which is disqualifying for
an app you are meant to be able to stop carrying in your head. Settings shows
whether the promise was granted, how much space your own data uses, and offers
to ask again if it was not.

**The trade-off, stated honestly:** there is no sync between devices, and if you
lose the phone or clear your browser's site data without a backup, the data is
gone. That is the cost of there being nowhere else for it to be. Settings has a
one-tap backup; use it.

## Reminders, and their real limits

A web app cannot make promises about waking up. So Steady does not pretend to:

- **While Steady is open** (or backgrounded but not yet evicted), it checks every
  30 seconds and fires notifications itself. This is reliable day to day.
- **When it has been closed for a while**, Android may well have stopped it.
  Anything that came due meanwhile is shown as *"While the app was closed"* the
  moment you next open it, rather than being silently dropped or firing a pile
  of stale alerts at once.
- **For anything that genuinely cannot be missed**, use *Settings → Export
  everything to my calendar*. It writes one `.ics` file containing every dated
  task and every subscription renewal, with repeats and lead-time alarms. Open
  it and your phone's own calendar takes over the reminding — and your phone's
  alarms do not depend on this app running at all.

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production build into dist/
npm test             # unit tests
```

To put it on your phone, see **[DEPLOY.md](DEPLOY.md)** — a click-by-click
walkthrough. The short version: pushing to this repo makes GitHub build and
publish it, and installing is "open the URL in Chrome, tap *Add to Home
screen*".

There is deliberately no `dist/` folder in the repo. It is build output,
generated by `npm run build`, and committing it would guarantee it goes stale.
`.github/workflows/deploy.yml` builds and publishes it on every push.

The app works both at a domain root and at a subpath like
`https://you.github.io/Missile-Guap/`. Set `VITE_BASE` at build time for the
latter; the workflow works it out for you.

### Tests

```bash
npm test
```

241 unit tests cover the parts where a quiet wrong answer would make the app
untrustworthy: local-time date maths across DST and year boundaries, month-end
billing dates that must not drift (31 Jan → 28 Feb → **31** Mar, not 28 Mar),
cost normalisation between weekly/monthly/quarterly/yearly, `.ics` generation
including line folding and escaping, and backup files refusing to import
anything they did not write.

The browser-level check needs Playwright, which is not a project dependency:

```bash
npm run build
npm i --no-save playwright && npx playwright install chromium
node e2e/app-check.mjs
```

It drives a real browser through capture → task → subscription → note,
**downloads the generated .ics and checks its contents**, verifies the privacy
claim by attempting to exfiltrate data, then **kills the server** and reloads to
prove the app still works with nothing behind it.

## Layout

```
src/
  types.ts            The four buckets and the settings shape
  db.ts               Dexie/IndexedDB tables and constructors
  lib/
    time.ts           Local-time date maths (never UTC - it shifts the day)
    version.ts        Notices when the app has updated under you
    recurrence.ts     Repeats, and billing dates anchored to the first charge
    money.ts          Minor units only; cost and pay normalised to a year
    pay.ts            Pay schedules: intervals and fixed days of the month
    holidays.ts       Employer closures, computed - including Easter
    classify.ts       Naive Bayes tag suggestions, trained on your own notes
    subscriptions.ts  Billing rhythms, categories, name autocomplete (no lookups)
    share.ts          Hands a file to the phone's share sheet, not the network
    ics.ts            Calendar export, whole-app or one item at a time
    agenda.ts         Builds one ordered list for a day
    tasks.ts          Completion, rolling repeats forward, moving days
    notify.ts         The in-app scheduler, and its honest limits
    backup.ts         Export, and an import that cannot silently destroy
  components/         Capture bar, task editor, task row, shared bits
  views/              Today, Inbox, Tasks, Notes, Money, Settings
public/
  sw.js               Service worker: caches this app, talks to nothing else
  manifest.webmanifest
tools/make-icons.py   Regenerates the icons with no image library
```

## Making it yours

The whole point is that this fits one specific brain. Some starting points:

- **Wording** lives in the views; it is deliberately plain and non-judgemental.
  If a phrase grates, change it — that is not a cosmetic fix, it is the feature.
- **Colours** are CSS custom properties at the top of `src/styles.css`. Each
  theme redefines the same small set of tokens.
- **The capture box** is `src/components/CaptureBar.tsx`. If you want it to
  parse "tomorrow 3pm" out of what you type, that is where it goes.
- **A new bucket** means a table in `src/db.ts`, a type in `src/types.ts`, and a
  view. Think hard before adding one; four is already a decision per capture.
