import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings, saveSettings } from './db';
import { DEFAULT_SETTINGS, type Settings as SettingsType, type Task } from './types';
import { startScheduler } from './lib/notify';
import { requestPersistence } from './lib/storage';
import { THEME_TOKENS, resolveCustom } from './lib/theme';
import { updateNotice } from './lib/version';
import CaptureBar from './components/CaptureBar';
import { Toast } from './components/ui';
import Today from './views/Today';
import Inbox from './views/Inbox';
import Tasks from './views/Tasks';
import Notes from './views/Notes';
import Money from './views/Money';
import Settings from './views/Settings';

type ViewId = 'today' | 'inbox' | 'tasks' | 'notes' | 'money' | 'settings';

/** Fixed order, fixed labels, every time. The nav never reorders itself. */
const NAV: { id: ViewId; label: string; glyph: string }[] = [
  { id: 'today', label: 'Today', glyph: '◎' },
  { id: 'inbox', label: 'Inbox', glyph: '↓' },
  { id: 'tasks', label: 'Tasks', glyph: '✓' },
  { id: 'notes', label: 'Notes', glyph: '≡' },
  { id: 'money', label: 'Money', glyph: '¤' },
];

const TITLES: Record<ViewId, string> = {
  today: 'Today',
  inbox: 'Inbox',
  tasks: 'Tasks',
  notes: 'Notes',
  money: 'Money',
  settings: 'Settings',
};

/**
 * Android home-screen shortcuts (long-press the icon) open the app with
 * `?view=inbox`. Reading it here is what makes those shortcuts real rather
 * than decorative.
 */
function startingView(): ViewId {
  try {
    const wanted = new URLSearchParams(window.location.search).get('view');
    if (wanted && wanted in TITLES) return wanted as ViewId;
  } catch {
    // A malformed URL is not a reason to fail to open.
  }
  return 'today';
}

export default function App() {
  const [view, setView] = useState<ViewId>(startingView);
  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS);
  const [toast, setToast] = useState<string | null>(null);
  const [missed, setMissed] = useState<Task[]>([]);
  const [updated, setUpdated] = useState(false);
  /** Whether the saved settings have arrived. See the appearance effect below. */
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const loaded = await getSettings();
      setSettings(loaded);
      // Record the build straight away, whether or not we say anything. The
      // notice is then guaranteed to appear at most once, even if the user
      // never taps Dismiss.
      const notice = updateNotice(loaded.lastSeenBuild);
      if (loaded.lastSeenBuild !== notice.next) {
        setSettings(await saveSettings({ lastSeenBuild: notice.next }));
      }
      setUpdated(notice.show);
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

  useEffect(() => {
    return startScheduler((tick) => {
      if (tick.missed.length) setMissed((prev) => [...prev, ...tick.missed]);
      if (tick.fired.length === 1) setToast(`Reminder: ${tick.fired[0].title}`);
      else if (tick.fired.length > 1) setToast(`${tick.fired.length} reminders just came due.`);
    });
  }, []);

  const openCount = useLiveQuery(
    () => db.captures.filter((c) => !c.clearedAt).count(),
    [settings.rev],
    0,
  ) ?? 0;

  const showToast = useCallback((message: string) => setToast(message), []);

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div>
            <h1>{TITLES[view]}</h1>
            {view === 'today' && <p className="faint">{longDate()}</p>}
          </div>
          <button
            type="button"
            className={`btn btn-quiet btn-sm${view === 'settings' ? ' btn-primary' : ''}`}
            aria-current={view === 'settings' ? 'page' : undefined}
            onClick={() => setView(view === 'settings' ? 'today' : 'settings')}
          >
            {view === 'settings' ? 'Done' : 'Settings'}
          </button>
        </div>
      </header>

      <main className="main">
        {/* The capture box is on every screen except Settings, always first. */}
        {view !== 'settings' && (
          <CaptureBar onSaved={() => showToast('Saved to your inbox.')} />
        )}

        {updated && (
          <div className="card stack-sm" role="status">
            <div className="spread">
              <span className="grow">
                <strong>Steady updated.</strong> Your notes, tasks and subscriptions are untouched.
              </span>
              <button type="button" className="btn btn-sm" onClick={() => setUpdated(false)}>
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
            <ul className="stack-sm" style={{ margin: 0, paddingLeft: 20 }}>
              {missed.map((task) => (
                <li key={task.id}>
                  {task.title}
                  {task.remindAt && (
                    <span className="faint">
                      {' '}
                      - {new Date(task.remindAt).toLocaleString(undefined, {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
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

        {view === 'today' && <Today settings={settings} />}
        {view === 'inbox' && <Inbox settings={settings} />}
        {view === 'tasks' && <Tasks settings={settings} />}
        {view === 'notes' && <Notes settings={settings} />}
        {view === 'money' && <Money settings={settings} />}
        {view === 'settings' && <Settings settings={settings} onChange={setSettings} onToast={showToast} />}
      </main>

      <nav className="nav" aria-label="Main">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className="nav-btn"
            aria-current={view === item.id ? 'page' : undefined}
            onClick={() => setView(item.id)}
          >
            <span className="nav-glyph" aria-hidden="true">
              {item.glyph}
            </span>
            <span>{item.label}</span>
            {item.id === 'inbox' && openCount > 0 && <span className="nav-count">{openCount}</span>}
          </button>
        ))}
      </nav>

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
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
