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
| **Money** | Subscriptions, with the next charge date, the real monthly and yearly cost, a breakdown by category, and — the useful bit — *how to actually cancel it*, written down while you still know. |
| **Settings** | Appearance, notifications, backup and restore, calendar export, and a plain-English account of what happens to your data. |

There are four buckets, not five: **a reminder is a property of a task**, not a
separate kind of thing, so there is never a moment of "is this a task or a
reminder?".

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

Your data lives in this browser's IndexedDB storage, on this device.

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

To put it on your phone, see [DEPLOY.md](DEPLOY.md). The short version: it is a
folder of static files, and installing it is "open the URL in Chrome, tap
*Add to Home screen*".

### Tests

```bash
npm test
```

65 unit tests cover the parts where a quiet wrong answer would make the app
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

It drives a real browser through capture → task → subscription → note, verifies
the privacy claim by attempting to exfiltrate data, then **kills the server** and
reloads to prove the app still works with nothing behind it.

## Layout

```
src/
  types.ts            The four buckets and the settings shape
  db.ts               Dexie/IndexedDB tables and constructors
  lib/
    time.ts           Local-time date maths (never UTC - it shifts the day)
    recurrence.ts     Repeats, and billing dates anchored to the first charge
    money.ts          Minor units only; cost normalised to a year
    ics.ts            Calendar export, the reliable reminder channel
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
