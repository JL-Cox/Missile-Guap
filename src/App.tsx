import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, forgetSettings, getSettings, saveLock, saveSettings } from './db';
import { DEFAULT_SETTINGS, type Note, type Settings as SettingsType, type Task } from './types';
import { startScheduler } from './lib/notify';
import { requestPersistence } from './lib/storage';
import { THEME_TOKENS, resolveCustom } from './lib/theme';
import { APP_VERSION, updateNotice, versionLabel } from './lib/version';
import { CHANGES } from './lib/changelog';
import { shortDateTime, todayKey } from './lib/time';
import { isStaleLowDay } from './lib/lowday';
import { isOpen as savedOpen, withFold, type FoldId } from './lib/sections';
import {
  PAGE_IDS,
  firstZone,
  hasZones,
  isPageId,
  pageTitle,
  remembersZone,
  withZone,
  zoneFor,
  type PageId,
  type ZonedPage,
  type ZoneOf,
} from './lib/zones';
import { lockAvailable, readLock, shouldLock } from './lib/lock';
import CaptureBar from './components/CaptureBar';
import LockScreen from './components/LockScreen';
import Menu from './components/Menu';
import {
  FoldContext,
  LayerContext,
  NavigateContext,
  Toast,
  ToastContext,
  ZoneBar,
  ZoneContext,
  useLatest,
  type Folds,
  type Navigate,
  type ToastAction,
  type ToastState,
  type ZoneState,
} from './components/ui';
import Today from './views/Today';
import Inbox from './views/Inbox';
import Tasks from './views/Tasks';
import Backlog from './views/Backlog';
import Notes from './views/Notes';
import Money from './views/Money';
import Debt from './views/Debt';
import Settings from './views/Settings';
import About from './views/About';

/** The seven working pages, which have zones and can each hold an open editor. */
const ZONED_PAGES = PAGE_IDS.filter(hasZones);

/**
 * Android home-screen shortcuts (long-press the icon) open the app with
 * `?view=inbox`, or `?view=money&add=subscription` to go straight to the form.
 * Reading them here is what makes those shortcuts real rather than decorative.
 * Any page's name works, `?view=debt` and `?view=settings` included, and it
 * lands on that page's first zone.
 */
function startingPoint(): { page: PageId; add?: 'subscription' } {
  try {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get('view');
    const page = wanted && isPageId(wanted) ? wanted : 'today';
    return { page, add: page === 'money' && params.get('add') === 'subscription' ? 'subscription' : undefined };
  } catch {
    // A malformed URL is not a reason to fail to open.
    return { page: 'today' };
  }
}

/** How many history entries this app has stacked above its first one. */
function historyDepth(): number {
  const depth = (window.history.state as { steady?: unknown } | null)?.steady;
  return typeof depth === 'number' && depth > 0 ? depth : 0;
}

/**
 * The one extra line the update notice says for a version that changed how
 * you get around, read from that version's entry in the changelog. Most
 * versions have none, and then the notice says only what it always has.
 */
function noticeLine(): string | undefined {
  const entry: { notice?: unknown } | undefined = CHANGES.find((c) => c.version === APP_VERSION);
  return typeof entry?.notice === 'string' && entry.notice.trim() ? entry.notice : undefined;
}

/**
 * When a background save of folds or zones finishes, take everything it
 * stored except that one setting, which the screen already shows newer.
 *
 * Each tap shows at once and queues its save. Without this, a save queued by
 * an earlier tap would land after a later tap and put the screen back to the
 * earlier choice for a moment - Income, then Coming out, then Income again,
 * then Coming out. The stored record still ends up right, because the queue
 * runs in order; this only stops the screen going backwards meanwhile.
 */
function keepShown<K extends 'sections' | 'zones'>(saved: SettingsType, key: K) {
  return (shown: SettingsType): SettingsType => {
    const next = { ...saved };
    if (shown[key] === undefined) delete next[key];
    else next[key] = shown[key];
    return next;
  };
}

/** Ids for the two things focus is sent to after a move. */
const HEADING_ID = 'page-title';
const MENU_BUTTON_ID = 'menu-button';

export default function App() {
  const [start] = useState(startingPoint);
  const [page, setPage] = useState<PageId>(start.page);
  /**
   * Today's zone. Held here and never saved: Today opens on its first zone
   * every time you come to it, from the Menu, from Back and on launch.
   */
  const [todayZone, setTodayZone] = useState<ZoneOf<'today'>>(firstZone('today'));
  const [menuOpen, setMenuOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastId = useRef(0);
  const [missed, setMissed] = useState<Task[]>([]);
  const [updated, setUpdated] = useState(false);
  /**
   * A part of Settings to open straight away, for a button elsewhere that
   * sends you to one thing there. Settings otherwise opens with every group
   * closed.
   */
  const [settingsFocus, setSettingsFocus] = useState<'lock' | null>(null);
  /** Whether the saved settings have arrived. See the appearance effect below. */
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  /**
   * A search handed to the Tasks page from Notes. A new object each time, so
   * the same words twice still land in the box.
   */
  const [taskSearch, setTaskSearch] = useState<{ text: string } | null>(null);
  /** A note handed to the Notes page from a task row, to open in the editor. */
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
    Something open on top of a page - an editor, a confirmation - registers
    how to close it. Kept per page, and a page with something open stays
    mounted (hidden) when you go to another, so a half-written task is still
    there when you come back rather than silently thrown away.
  */
  const closers = useRef<Partial<Record<ZonedPage, () => void>>>({});
  const [openLayers, setOpenLayers] = useState<ZonedPage[]>([]);
  const registrars = useMemo(
    () =>
      Object.fromEntries(
        ZONED_PAGES.map((id) => [
          id,
          (close: (() => void) | null) => {
            if (close) closers.current[id] = close;
            else delete closers.current[id];
            setOpenLayers((prev) => {
              const has = prev.includes(id);
              if (close && !has) return [...prev, id];
              if (!close && has) return prev.filter((t) => t !== id);
              return prev;
            });
          },
        ]),
      ) as Record<ZonedPage, (close: (() => void) | null) => void>,
    [],
  );

  /*
    Zones. A page's zone shows at once and is saved behind it, one save at a
    time, the same way a fold is. Only zones that are not a page's first are
    kept - see src/lib/zones.ts - and none at all means the setting is taken
    away. Today's is held above and never saved.
  */
  const zoneOf = <P extends ZonedPage>(p: P): ZoneOf<P> =>
    (p === 'today' ? todayZone : zoneFor(p, settings.zones)) as ZoneOf<P>;
  const zoneSaves = useRef<Promise<void>>(Promise.resolve());
  const saveZone = useCallback((p: ZonedPage, zone: string) => {
    if (!remembersZone(p)) {
      setTodayZone(zone as ZoneOf<'today'>);
      return;
    }
    setSettings((s) => ({ ...s, zones: withZone(s.zones, p, zone) }));
    zoneSaves.current = zoneSaves.current.then(async () => {
      const zones = withZone((await getSettings()).zones, p, zone);
      setSettings(
        keepShown(Object.keys(zones).length > 0 ? await saveSettings({ zones }) : await forgetSettings('zones'), 'zones'),
      );
    });
  }, []);

  /*
    After a move, the page is shown from its top and focus goes where TalkBack
    should pick up: the new page's heading after a page change, the Menu
    button when the Menu closes with nothing changed, a zone's tab when a
    signpost on Today opens it. Done once the move has been drawn, so focus
    never lands on something that is about to go.
  */
  const afterMove = useRef<{ toTop: boolean; focus: string | null }>({ toTop: false, focus: null });
  const [moves, setMoves] = useState(0);
  const moved = useCallback((toTop: boolean, focus: string | null) => {
    afterMove.current = { toTop, focus };
    setMoves((n) => n + 1);
  }, []);

  /** Shows one of a page's zones, from its top. */
  const showZone = useCallback(
    (p: ZonedPage, zone: string, focusTab = false) => {
      saveZone(p, zone);
      moved(true, focusTab ? `tab-${p}-${zone}` : null);
    },
    [saveZone, moved],
  );

  /**
   * Changes page, closing the Menu if it is open. Every page change - the
   * Menu, Back, a link from another page - comes through here. Today always
   * opens on its first zone; every other page on the zone it was left on,
   * unless the link says which.
   */
  const showPage = useCallback(
    (next: PageId, options: { zone?: string; query?: string; note?: Note } = {}) => {
      setMenuOpen(false);
      setSettingsFocus(null);
      setTaskSearch(options.query ? { text: options.query } : null);
      // Opening Notes from the Menu is opening Notes, not reopening the last
      // note a task row sent you to.
      setNoteToOpen(options.note ?? null);
      if (hasZones(next)) {
        if (options.zone) saveZone(next, options.zone);
        else if (!remembersZone(next)) setTodayZone(firstZone('today'));
      }
      setPage(next);
      moved(true, HEADING_ID);
    },
    [saveZone, moved],
  );

  const openMenu = useCallback(() => setMenuOpen(true), []);
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    moved(false, MENU_BUTTON_ID);
  }, [moved]);
  const choosePage = useCallback(
    (next: PageId) => (next === page ? closeMenu() : showPage(next)),
    [page, closeMenu, showPage],
  );

  /*
    THE BACK BUTTON.

    Android's Back used to leave the app from any screen, because the app never
    made a history entry. Now the history holds, at most, one entry for each of
    these, bottom to top:

      Today, on its first zone  (always the first entry - Back from here leaves)
      the page you are on, if it is not Today
      the zone you are on, if it is not that page's first
      an editor or confirmation, if one is open on the page you are looking at
      the Menu, if it is open

    Back takes the top one away. That is the pattern Android's own apps use:
    Back goes home, then out - never through every page you happened to visit.
    Settings and About are pages like any other, so Back from either goes to
    Today. The entries are only counters; what Back does is decided from the
    app's own state, so the two cannot disagree about where you are.
  */
  const zoned = hasZones(page);
  // The lock screen sits at the bottom with nothing above it, so Back from it
  // leaves the app - as it would from the phone's own lock screen - rather
  // than quietly changing pages behind it.
  const depth = showLock
    ? 0
    : (page !== 'today' ? 1 : 0) +
      (zoned && zoneOf(page) !== firstZone(page) ? 1 : 0) +
      (zoned && openLayers.includes(page) ? 1 : 0) +
      (menuOpen ? 1 : 0);
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
    // Opening several things in one tap - a page chosen from the open Menu -
    // changes the depth once, so this makes one push or one go().
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
    if (menuOpen) return closeMenu();
    if (zoned) {
      const close = closers.current[page];
      if (close) return close();
      if (zoneOf(page) !== firstZone(page)) return showZone(page, firstZone(page));
    }
    if (page !== 'today') showPage('today');
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

  /*
    While the Menu is open, everything behind it is inert: not tappable, not
    focusable, and not read out, so TalkBack stays in the Menu. Set through
    the element rather than as a prop, which React 18 does not know. Before
    the effect below that moves focus, so focus can land back on the page.
  */
  const frameRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (frameRef.current) frameRef.current.inert = menuOpen;
  });

  useLayoutEffect(() => {
    const { toTop, focus } = afterMove.current;
    afterMove.current = { toTop: false, focus: null };
    if (toTop) window.scrollTo({ top: 0, behavior: 'instant' });
    if (focus) document.getElementById(focus)?.focus({ preventScroll: true });
  }, [moves]);

  const showToast = useCallback((message: string, action?: ToastAction) => {
    toastId.current += 1;
    setToast({ id: toastId.current, message, action });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  /*
    Folded sections. A fold you change shows at once and is saved behind it,
    one save at a time, so two quick taps on two headings cannot overwrite
    each other. Only differences from how each section starts are kept - see
    src/lib/sections.ts - and none at all means the setting is taken away.
  */
  const foldSaves = useRef<Promise<void>>(Promise.resolve());
  const folds = useMemo<Folds>(
    () => ({
      isOpen: (id: FoldId) => savedOpen(id, settings.sections),
      setOpen: (id: FoldId, open: boolean) => {
        setSettings((s) => ({ ...s, sections: withFold(s.sections, id, open) }));
        foldSaves.current = foldSaves.current.then(async () => {
          const sections = withFold((await getSettings()).sections, id, open);
          setSettings(
            keepShown(
              Object.keys(sections).length > 0 ? await saveSettings({ sections }) : await forgetSettings('sections'),
              'sections',
            ),
          );
        });
      },
    }),
    [settings.sections],
  );

  const navigate = useCallback<Navigate>((next, options) => showPage(next, options), [showPage]);

  useEffect(() => {
    void (async () => {
      let loaded = await getSettings();
      // A low day ends at midnight. One left from an earlier day is deleted
      // here rather than kept, so no past low day is ever stored.
      if (isStaleLowDay(loaded, todayKey())) loaded = await forgetSettings('lowDay');
      // A shortcut is a clear intent: `?view=money` opens Money on its first
      // zone, and that is where it is left. Saved before anything is drawn, so
      // the zone it was last left on never flashes up first.
      if (hasZones(start.page) && zoneFor(start.page, loaded.zones) !== firstZone(start.page)) {
        const zones = withZone(loaded.zones, start.page, firstZone(start.page));
        loaded = Object.keys(zones).length > 0 ? await saveSettings({ zones }) : await forgetSettings('zones');
      }
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
    // Once, on launch: `start` never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    Locking also closes the Menu, so it never reopens over the page after the
    lock comes off.
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
        setMenuOpen(false);
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
    setMenuOpen(false);
  }, []);

  /** The recovery phrase opened the app: the lock comes off, and we say so. */
  const recoverWithPhrase = useCallback(async () => {
    setSettings(await saveLock(null));
    setLocked(false);
    setRecovered(true);
  }, []);

  /*
    A new day while the app sat in the background. Everything that says "today"
    - the header date, the Today page, a low day - reads the date as it
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

  const renderPage = (id: ZonedPage): ReactNode => {
    switch (id) {
      case 'today':
        return <Today settings={settings} onChange={setSettings} />;
      case 'inbox':
        return <Inbox settings={settings} />;
      case 'tasks':
        return <Tasks settings={settings} search={taskSearch} />;
      case 'backlog':
        return <Backlog settings={settings} onChange={setSettings} />;
      case 'notes':
        return <Notes settings={settings} openNote={noteToOpen} />;
      case 'debt':
        return <Debt settings={settings} />;
      case 'money':
        return <Money settings={settings} startAdding={start.add === 'subscription'} />;
    }
  };

  /** What each page's zones are told: which one is showing, and how to show another. */
  const zoneState = (id: ZonedPage): ZoneState => ({
    page: id,
    zone: zoneOf(id),
    choose: (zone, focusTab) => showZone(id, zone, focusTab),
  });

  /*
    Until the saved settings arrive there is no way to know whether a lock is
    set, so nothing of the app is drawn at all - just the page colour, for the
    few milliseconds IndexedDB takes. Then it is the lock or the app, never the
    app first. When locked, the lock screen is the whole page: no header,
    Menu, zone bar, page, toast or missed-reminders card is mounted behind it,
    not even hidden.
  */
  if (!settingsLoaded) return <div className="app-blank" aria-busy="true" />;
  if (showLock) return <LockScreen lock={lock} onUnlock={() => setLocked(false)} onRecovered={recoverWithPhrase} />;

  const whatsNew = noticeLine();
  /** The bar steps aside while an editor or confirmation has the page. */
  const showBar = zoned && !openLayers.includes(page);

  return (
    <ToastContext.Provider value={showToast}>
      <NavigateContext.Provider value={navigate}>
        <FoldContext.Provider value={folds}>
          <div className="app-frame" ref={frameRef}>
            <header className="header">
              {/* The layout depends only on the text size, the screen's width
                  and whether a lock is set - never on which page you are on -
                  so the page under it does not jump when you change page. */}
              <div className={`header-inner${lock ? ' has-action' : ''}`}>
                {/* The count is read out as words in the name - "Menu, 3 in
                    your inbox" - and drawn as a number. Given whole as a label,
                    because Chrome puts a space before the comma when the name
                    is pieced together from a count pinned to the corner. */}
                <button
                  type="button"
                  id={MENU_BUTTON_ID}
                  className="btn btn-sm menu-btn"
                  aria-haspopup="dialog"
                  aria-label={openCount > 0 ? `Menu, ${openCount} in your inbox` : undefined}
                  onClick={openMenu}
                >
                  {/* Three drawn bars and the word, never the bars alone. */}
                  <span className="menu-bars" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  Menu
                  {openCount > 0 && (
                    <span className="menu-count" aria-hidden="true">
                      {openCount}
                    </span>
                  )}
                </button>
                <div className="header-title">
                  <h1 id={HEADING_ID} tabIndex={-1}>
                    {pageTitle(page)}
                  </h1>
                  {page === 'today' && <p className="faint">{longDate()}</p>}
                </div>
                {/* The one thing that has to be a single tap from any page,
                    for when someone walks up. */}
                {lock && (
                  <button type="button" className="btn btn-quiet btn-sm header-action" onClick={hideNow}>
                    Hide now
                  </button>
                )}
              </div>
            </header>

            <main className="main" data-page={page}>
              {/* The capture box is first on every zone of every working page,
                  in the same place, and on nowhere else. */}
              {zoned && <CaptureBar onSaved={() => showToast('Saved to your inbox.')} />}

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
                        showPage('settings');
                        setSettingsFocus('lock');
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
                  {whatsNew && <p className="small">{whatsNew}</p>}
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        setUpdated(false);
                        showPage('about');
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

              {ZONED_PAGES.filter((id) => id === page || openLayers.includes(id)).map((id) => (
                <div key={id} className="view" hidden={id !== page}>
                  <LayerContext.Provider value={registrars[id]}>
                    <ZoneContext.Provider value={zoneState(id)}>{renderPage(id)}</ZoneContext.Provider>
                  </LayerContext.Provider>
                </div>
              ))}
              {page === 'settings' && <Settings settings={settings} onChange={setSettings} focus={settingsFocus} />}
              {page === 'about' && <About />}
            </main>

            {showBar && (
              <ZoneBar
                page={page}
                zone={zoneOf(page)}
                // The zone you are on again takes you back to its top.
                onChoose={(zone) => showZone(page, zone)}
              />
            )}

            {toast && <Toast toast={toast} onDismiss={dismissToast} />}
          </div>
          {menuOpen && <Menu current={page} inboxCount={openCount} onChoose={choosePage} onClose={closeMenu} />}
        </FoldContext.Provider>
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
