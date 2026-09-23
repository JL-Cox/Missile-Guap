import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, forgetSettings, getSettings, saveLock, saveSettings } from './db';
import { DEFAULT_SETTINGS, type Note, type Settings as SettingsType, type Task } from './types';
import { startScheduler } from './lib/notify';
import { requestPersistence } from './lib/storage';
import { THEME_TOKENS, resolveCustom } from './lib/theme';
import { updateNotice, versionLabel } from './lib/version';
import { shortDateTime, todayKey } from './lib/time';
import { isStaleLowDay } from './lib/lowday';
import { lockAvailable, readLock, shouldLock } from './lib/lock';
import CaptureBar from './components/CaptureBar';
import LockScreen from './components/LockScreen';
import {
  LayerContext,
  NavigateContext,
  Toast,
  ToastContext,
  useLatest,
  type Navigate,
  type ToastAction,
  type ToastState,
} from './components/ui';
import Today from './views/Today';
import Inbox from './views/Inbox';
import Tasks from './views/Tasks';
import Backlog from './views/Backlog';
import Notes from './views/Notes';
import Money from './views/Money';
import Settings from './views/Settings';
import About from './views/About';

type ViewId = 'today' | 'inbox' | 'tasks' | 'backlog' | 'notes' | 'money' | 'settings';

/** Fixed order, fixed labels, every time. The nav never reorders itself. */
const NAV: { id: ViewId; label: string; glyph: string }[] = [
  { id: 'today', label: 'Today', glyph: '◎' },
  { id: 'inbox', label: 'Inbox', glyph: '↓' },
  { id: 'tasks', label: 'Tasks', glyph: '✓' },
  { id: 'backlog', label: 'Backlog', glyph: '◇' },
  { id: 'notes', label: 'Notes', glyph: '≡' },
  { id: 'money', label: 'Money', glyph: '$' },
];

const TITLES: Record<ViewId, string> = {
  today: 'Today',
  inbox: 'Inbox',
  tasks: 'Tasks',
  backlog: 'Backlog',
  notes: 'Notes',
  money: 'Money',
  settings: 'Settings',
};

/** The six tabs, which can each hold an open editor. Settings is not one. */
type TabId = Exclude<ViewId, 'settings'>;
const TABS: TabId[] = NAV.map((n) => n.id as TabId);

/**
 * Android home-screen shortcuts (long-press the icon) open the app with
 * `?view=inbox`, or `?view=money&add=subscription` to go straight to the form.
 * Reading them here is what makes those shortcuts real rather than decorative.
 */
function startingPoint(): { view: ViewId; add?: 'subscription' } {
  try {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get('view');
    const view = wanted && wanted in TITLES ? (wanted as ViewId) : 'today';
    return { view, add: view === 'money' && params.get('add') === 'subscription' ? 'subscription' : undefined };
  } catch {
    // A malformed URL is not a reason to fail to open.
    return { view: 'today' };
  }
}

/** How many history entries this app has stacked above its first one. */
function historyDepth(): number {
  const depth = (window.history.state as { steady?: unknown } | null)?.steady;
  return typeof depth === 'number' && depth > 0 ? depth : 0;
}

export default function App() {
  const [start] = useState(startingPoint);
  const [view, setView] = useState<ViewId>(start.view);
  /** Where Settings was opened from, so Done and Back return there. */
  const [beforeSettings, setBeforeSettings] = useState<TabId>('today');
  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastId = useRef(0);
  const [missed, setMissed] = useState<Task[]>([]);
  const [updated, setUpdated] = useState(false);
  /** Whether Settings is showing its About page. */
  const [about, setAbout] = useState(false);
  /** Whether the saved settings have arrived. See the appearance effect below. */
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  /** A search handed to the Tasks screen from Notes. */
  const [taskQuery, setTaskQuery] = useState('');
  /** A note handed to the Notes screen from a task row, to open in the editor. */
  const [noteToOpen, setNoteToOpen] = useState<Note | null>(null);

  /*
    THE APP LOCK. See src/lib/lock.ts for what it is and is not.

    `locked` starts true and is settled in the same render that first shows
    anything, so there is never a frame where the app is up and the lock has
    not been decided. It only matters while a lock is set: with none, it is
    ignored. A lock that is damaged, or a browser that cannot check one, counts
    as no lock - failing open, because failing closed would leave no way in.
  */
  const lock = useMemo(() => (lockAvailable() ? readLock(settings.lock) : null), [settings.lock]);
  const [locked, setLocked] = useState(true);
  const showLock = lock !== null && locked;
  /** When the app went out of sight. Memory only: nothing about it is saved. */
  const hiddenAt = useRef<number | null>(null);
  /** Opened with the recovery phrase, so the lock came off. Said once, here. */
  const [recovered, setRecovered] = useState(false);

  /*
    Something open on top of a tab - an editor, a confirmation - registers how
    to close it. Kept per tab, and a tab with something open stays mounted
    (hidden) when you switch away, so a half-written task is still there when
    you come back rather than silently thrown away.
  */
  const closers = useRef<Partial<Record<TabId, () => void>>>({});
  const [openLayers, setOpenLayers] = useState<TabId[]>([]);
  const registrars = useMemo(
    () =>
      Object.fromEntries(
        TABS.map((tab) => [
          tab,
          (close: (() => void) | null) => {
            if (close) closers.current[tab] = close;
            else delete closers.current[tab];
            setOpenLayers((prev) => {
              const has = prev.includes(tab);
              if (close && !has) return [...prev, tab];
              if (!close && has) return prev.filter((t) => t !== tab);
              return prev;
            });
          },
        ]),
      ) as Record<TabId, (close: (() => void) | null) => void>,
    [],
  );

  const goTo = useCallback(
    (next: ViewId) => {
      if (next === 'settings' && view !== 'settings') setBeforeSettings(view as TabId);
      if (next !== 'settings') setAbout(false);
      // Opening Notes from the nav is opening Notes, not reopening the last
      // note a task row sent you to.
      setNoteToOpen(null);
      setView(next);
    },
    [view],
  );

  /*
    THE BACK BUTTON.

    Android's Back used to leave the app from any screen, because the app never
    made a history entry. Now the history holds, at most, one entry for each of
    these, bottom to top:

      the Today screen  (always the first entry - Back from here leaves)
      the tab you are on, if it is not Today
      Settings, if it is open
      About, if it is open on top of Settings
      an editor or confirmation, if one is open on the tab you are looking at

    Back takes the top one away. That is the pattern Android's own apps use for
    a bottom nav: Back goes home, then out - never through every tab you
    happened to visit. The entries are only counters; what Back does is decided
    from the app's own state, so the two cannot disagree about where you are.
  */
  const tab: TabId = view === 'settings' ? beforeSettings : view;
  const visibleLayer = view !== 'settings' && openLayers.includes(view);
  // The lock screen sits at the bottom with nothing above it, so Back from it
  // leaves the app - as it would from the phone's own lock screen - rather
  // than quietly changing tabs behind it.
  const depth = showLock
    ? 0
    : (tab !== 'today' ? 1 : 0) + (view === 'settings' ? (about ? 2 : 1) : 0) + (visibleLayer ? 1 : 0);
  const depthRef = useRef(historyDepth());
  const ignorePops = useRef(0);

  useEffect(() => {
    // The first entry drops any shortcut's ?view=, so a reload lands on Today
    // like any other launch rather than reopening a form.
    if (window.location.search) {
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    const current = depthRef.current;
    if (depth > current) {
      for (let d = current + 1; d <= depth; d++) window.history.pushState({ steady: d }, '');
    } else if (depth < current) {
      // Something was closed by a button rather than by Back: take its entry
      // away too, or the next Back press would appear to do nothing.
      ignorePops.current += 1;
      window.history.go(depth - current);
    }
    depthRef.current = depth;
  }, [depth]);

  const back = useLatest(() => {
    const close = view !== 'settings' ? closers.current[view] : undefined;
    if (close) close();
    else if (view === 'settings' && about) setAbout(false);
    else if (view === 'settings') setView(beforeSettings);
    else if (view !== 'today') setView('today');
  });

  useEffect(() => {
    const onPop = () => {
      if (ignorePops.current > 0) {
        ignorePops.current -= 1;
        depthRef.current = historyDepth();
        return;
      }
      depthRef.current = historyDepth();
      back();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [back]);

  const showToast = useCallback((message: string, action?: ToastAction) => {
    toastId.current += 1;
    setToast({ id: toastId.current, message, action });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  const navigate = useCallback<Navigate>((next, options) => {
    setTaskQuery(options?.query ?? '');
    setNoteToOpen(options?.note ?? null);
    setView(next);
  }, []);

  useEffect(() => {
    void (async () => {
      let loaded = await getSettings();
      // A low day ends at midnight. One left from an earlier day is deleted
      // here rather than kept, so no past low day is ever stored.
      if (isStaleLowDay(loaded, todayKey())) loaded = await forgetSettings('lowDay');
      setSettings(loaded);
      // Record the build straight away, whether or not we say anything. The
      // notice is then guaranteed to appear at most once, even if the user
      // never taps Dismiss.
      const notice = updateNotice(loaded.lastSeenBuild);
      if (loaded.lastSeenBuild !== notice.next) {
        setSettings(await saveSettings({ lastSeenBuild: notice.next }));
      }
      setUpdated(notice.show);
      // In the same batch as settingsLoaded, so the first thing drawn is
      // already either the lock or the app - never the app, then the lock.
      setLocked(readLock(loaded.lock) !== null);
      setSettingsLoaded(true);
    })();
    // Ask the browser not to treat this data as disposable. Chrome decides
    // silently from heuristics (being installed is the big one), so asking on
    // every start costs nothing and catches the moment it becomes grantable.
    void requestPersistence();
  }, []);

  /*
    Appearance is applied to <html> so it covers everything, including the
    browser's own form controls via color-scheme.

    Nothing is set until the saved settings have actually arrived. Settings live
    in IndexedDB, which is asynchronous, so writing the default theme first and
    correcting it a moment later meant a flash of the light theme on every
    single launch - at 2am, for someone who chose Midnight, that is the opposite
    of what this app is for. While `settingsLoaded` is false the stylesheet's
    `prefers-color-scheme` block carries the first paint instead, which is the
    only route left: the CSP forbids the inline bootstrap script that would
    normally do this, and rightly so.
  */
  useEffect(() => {
    if (!settingsLoaded) return;
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.dataset.reduceMotion = String(settings.reduceMotion);
    root.style.setProperty('--text-scale', String(settings.textScale));

    /*
      A custom theme is the same token mechanism, just written from JavaScript:
      the identical custom-property names, set inline on the same element, so
      every rule in styles.css applies unchanged. Switching away removes them
      again rather than leaving a half-applied palette behind.
    */
    if (settings.theme === 'custom') {
      const { tokens, dark } = resolveCustom(settings.customTheme);
      for (const token of THEME_TOKENS) root.style.setProperty(`--${token}`, tokens[token]);
      root.style.setProperty('color-scheme', dark ? 'dark' : 'light');
    } else {
      for (const token of THEME_TOKENS) root.style.removeProperty(`--${token}`);
      root.style.removeProperty('color-scheme');
    }

    // The Android status bar and task-switcher card take their colour from this
    // tag. Left static it stayed cream behind a near-black app.
    setThemeColour(getComputedStyle(root).getPropertyValue('--bg').trim());
  }, [
    settingsLoaded,
    settings.theme,
    settings.customTheme?.ground,
    settings.customTheme?.accent,
    settings.reduceMotion,
    settings.textScale,
  ]);

  /*
    Locking when the app goes out of sight.

    Going out of sight - another app, the home screen, the screen turning off -
    fires visibilitychange, and on some routes only pagehide. Either one notes
    the time and veils the page at once (html.veiled in styles.css blanks it),
    so that if Android snapshots the screen for its Recents view after this
    runs, the snapshot is blank. Whether Android takes that snapshot before or
    after a web page gets to react has not been tested on the phone.

    Coming back compares the clock with the lock's timing (shouldLock). If it is
    time, the lock is put up synchronously - flushSync - BEFORE the veil comes
    off, so the page underneath is never painted on the way. "Immediately" locks
    straight away on hiding, so while it is in the background the page holds the
    lock screen and nothing else.
  */
  // Keyed on the timing alone: settings are re-read as a new object on every
  // save, and re-wiring these listeners on each one could drop the veil while
  // the app is out of sight.
  const lockAfter = lock?.afterMinutes ?? null;
  useEffect(() => {
    if (lockAfter === null) return;
    const root = document.documentElement;
    const lockUp = () =>
      flushSync(() => {
        setLocked(true);
        setToast(null);
      });
    const hide = () => {
      if (hiddenAt.current === null) hiddenAt.current = Date.now();
      root.classList.add('veiled');
      if (shouldLock(hiddenAt.current, Date.now(), lockAfter)) lockUp();
    };
    const show = () => {
      const since = hiddenAt.current;
      hiddenAt.current = null;
      if (since !== null && shouldLock(since, Date.now(), lockAfter)) lockUp();
      root.classList.remove('veiled');
    };
    const onVisibility = () => (document.visibilityState === 'hidden' ? hide() : show());
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
      root.classList.remove('veiled');
    };
  }, [lockAfter]);

  /** The header's "Hide now": lock straight away, whatever the timing. */
  const hideNow = useCallback(() => {
    setLocked(true);
    setToast(null);
  }, []);

  /** The recovery phrase opened the app: the lock comes off, and we say so. */
  const recoverWithPhrase = useCallback(async () => {
    setSettings(await saveLock(null));
    setLocked(false);
    setRecovered(true);
  }, []);

  /*
    A new day while the app sat in the background. Everything that says "today"
    - the header date, the Today screen, a low day - reads the date as it
    renders, so all it needs is a render. Coming back into view gives it one
    when the date has moved on; nothing is cleared on a timer.
  */
  const [, setDay] = useState(todayKey);
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'visible') setDay(todayKey());
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);

  useEffect(() => {
    return startScheduler((tick) => {
      if (tick.missed.length) setMissed((prev) => [...prev, ...tick.missed]);
      if (tick.fired.length === 1) showToast(`Reminder: ${tick.fired[0].title}`);
      else if (tick.fired.length > 1) showToast(`${tick.fired.length} reminders just came due.`);
    });
  }, [showToast]);

  const openCount = useLiveQuery(
    () => db.captures.filter((c) => !c.clearedAt).count(),
    [settings.rev],
    0,
  ) ?? 0;

  const renderTab = (id: TabId): ReactNode => {
    switch (id) {
      case 'today':
        return <Today settings={settings} onChange={setSettings} />;
      case 'inbox':
        return <Inbox settings={settings} />;
      case 'tasks':
        return <Tasks settings={settings} initialQuery={taskQuery} />;
      case 'backlog':
        return <Backlog settings={settings} onChange={setSettings} />;
      case 'notes':
        return <Notes settings={settings} openNote={noteToOpen} />;
      case 'money':
        return <Money settings={settings} startAdding={start.add === 'subscription'} />;
    }
  };

  /*
    Until the saved settings arrive there is no way to know whether a lock is
    set, so nothing of the app is drawn at all - just the page colour, for the
    few milliseconds IndexedDB takes. Then it is the lock or the app, never the
    app first. When locked, the lock screen is the whole page: no header, nav,
    tab, toast or missed-reminders card is mounted behind it, not even hidden.
  */
  if (!settingsLoaded) return <div className="app-blank" aria-busy="true" />;
  if (showLock) return <LockScreen lock={lock} onUnlock={() => setLocked(false)} onRecovered={recoverWithPhrase} />;

  return (
    <ToastContext.Provider value={showToast}>
      <NavigateContext.Provider value={navigate}>
        <div className="app">
          <header className="header">
            <div className="header-inner">
              <div>
                <h1>{view === 'settings' && about ? 'About' : TITLES[view]}</h1>
                {view === 'today' && <p className="faint">{longDate()}</p>}
              </div>
              <div className="header-actions">
                {lock && (
                  <button type="button" className="btn btn-quiet btn-sm" onClick={hideNow}>
                    Hide now
                  </button>
                )}
                <button
                  type="button"
                  className={view === 'settings' ? 'btn btn-sm' : 'btn btn-quiet btn-sm'}
                  onClick={() => (view === 'settings' ? goTo(beforeSettings) : goTo('settings'))}
                >
                  {view === 'settings' ? 'Done' : 'Settings'}
                </button>
              </div>
            </div>
          </header>

          <main className="main">
            {/* The capture box is on every screen except Settings, always first. */}
            {view !== 'settings' && <CaptureBar onSaved={() => showToast('Saved to your inbox.')} />}

            {recovered && (
              <div className="card stack-sm" role="status">
                <p>
                  <strong>The lock is off.</strong> You opened Steady with your recovery phrase, so the PIN has been
                  removed. Everything you wrote is here, as it was.
                </p>
                <p className="small">You can set a new PIN in Settings, under App lock.</p>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setRecovered(false);
                      goTo('settings');
                    }}
                  >
                    Open Settings
                  </button>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => setRecovered(false)}>
                    Got it
                  </button>
                </div>
              </div>
            )}

            {updated && (
              <div className="card stack-sm" role="status">
                <p>
                  <strong>Steady updated to {versionLabel().toLowerCase()}.</strong> Your notes, tasks and
                  subscriptions are untouched.
                </p>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setUpdated(false);
                      goTo('settings');
                      setAbout(true);
                    }}
                  >
                    What's new
                  </button>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => setUpdated(false)}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {missed.length > 0 && (
              <div className="card stack-sm" role="status">
                <h2>While the app was closed</h2>
                <p className="small">
                  {missed.length === 1 ? 'This reminder' : 'These reminders'} came due while Steady was not running,
                  so {missed.length === 1 ? 'it was not' : 'they were not'} shown at the time.
                </p>
                <ul className="stack-sm plain-list">
                  {missed.map((task) => (
                    <li key={task.id}>
                      {task.title}
                      {task.remindAt && <span className="faint"> · {shortDateTime(task.remindAt)}</span>}
                    </li>
                  ))}
                </ul>
                <div className="btn-row">
                  <button type="button" className="btn btn-sm" onClick={() => setMissed([])}>
                    Got it
                  </button>
                </div>
              </div>
            )}

            {TABS.filter((id) => id === view || openLayers.includes(id)).map((id) => (
              <div key={id} className="view" hidden={id !== view}>
                <LayerContext.Provider value={registrars[id]}>{renderTab(id)}</LayerContext.Provider>
              </div>
            ))}
            {view === 'settings' &&
              (about ? (
                <About onBack={() => setAbout(false)} />
              ) : (
                <Settings settings={settings} onChange={setSettings} onAbout={() => setAbout(true)} />
              ))}
          </main>

          <nav className="nav" aria-label="Main">
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                className="nav-btn"
                aria-current={view === item.id ? 'page' : undefined}
                onClick={() => goTo(item.id)}
              >
                <span className="nav-glyph" aria-hidden="true">
                  {item.glyph}
                </span>
                <span>{item.label}</span>
                {item.id === 'inbox' && openCount > 0 && <span className="nav-count">{openCount}</span>}
              </button>
            ))}
          </nav>

          {toast && <Toast toast={toast} onDismiss={dismissToast} />}
        </div>
      </NavigateContext.Provider>
    </ToastContext.Provider>
  );
}

function longDate(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * Replaces every theme-color tag with a single unconditional one.
 *
 * index.html ships a pair of them behind prefers-color-scheme so the status bar
 * is right before any JavaScript runs. A media-scoped tag outranks a plain one,
 * so those have to go rather than be added to, or a phone set to dark would
 * keep showing the dark bar over the Amber theme.
 */
function setThemeColour(colour: string): void {
  if (!colour) return;
  document.querySelectorAll('meta[name="theme-color"]').forEach((tag) => tag.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = colour;
  document.head.appendChild(meta);
}
