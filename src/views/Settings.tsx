import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { countAll, db, forgetSettings, getSettings, saveSettings, wipeAll } from '../db';
import type { CustomTheme, ReminderContent, Settings as SettingsType, ThemeName } from '../types';
import {
  ACCENTS,
  ACCENT_IDS,
  DEFAULT_CUSTOM,
  GROUNDS,
  GROUND_IDS,
  resolveCustom,
} from '../lib/theme';
import {
  BackupError,
  backupDate,
  backupFilename,
  countBackup,
  describeCounts,
  exportBackup,
  importBackup,
  parseBackup,
  totalRecords,
  type Backup,
  type ImportMode,
} from '../lib/backup';
import { buildCalendar, CALENDAR_CAUTION, calendarContents } from '../lib/ics';
import { formatMoney } from '../lib/money';
import { notificationSupport, requestPermission, type PermissionState } from '../lib/notify';
import { formatBytes, requestPersistence, storageOrigin, storageStatus, type StorageStatus } from '../lib/storage';
import { shareOrDownload } from '../lib/share';
import { versionLabel } from '../lib/version';
import { lockAfterLabel, lockAvailable, readLock } from '../lib/lock';
import { ConfirmButton, FormError, Section, useToast } from '../components/ui';
import LockSettings from '../components/LockSettings';

/**
 * Each theme says what it is FOR, not what colour it is. "Warm off-white" tells
 * you nothing about when to reach for it; "easier at night" does.
 */
interface ThemeChoice {
  id: ThemeName;
  label: string;
  hint: string;
}

const THEMES: ThemeChoice[] = [
  { id: 'calm', label: 'Calm', hint: 'Warm off-white. The default, and the one for most days.' },
  { id: 'amber', label: 'Amber', hint: 'Warm and low in blue light, for winding down without going dark.' },
  { id: 'overcast', label: 'Overcast', hint: 'Flat daylight with no warmth, if the off-white reads yellow to you.' },
  { id: 'dark', label: 'Dark', hint: 'Warm dark, not black. Easier at night.' },
  { id: 'midnight', label: 'Midnight', hint: 'Nearly black, so the screen gives off as little light as it can.' },
  { id: 'contrast', label: 'High contrast', hint: 'Black on white, heavier borders. For when nothing else is clear enough.' },
];

/** Opt-in, and still held to every contrast pair the others are. */
const FUN_THEMES: ThemeChoice[] = [
  { id: 'synthwave', label: 'Synthwave', hint: 'Neon on deep violet. For the good days.' },
  { id: 'bubblegum', label: 'Bubblegum', hint: 'Pink paper, violet ink. Bright, and still easy to read.' },
  { id: 'aurora', label: 'Aurora', hint: 'Deep teal night, electric mint, a violet shimmer.' },
];

const CUSTOM_THEME: ThemeChoice = {
  id: 'custom',
  label: 'Custom',
  hint: 'Your own paper and your own color. Set them just below.',
};

const ALL_THEMES = [...THEMES, ...FUN_THEMES, CUSTOM_THEME];

/**
 * What a reminder shows on the lock screen. The default names the task and the
 * time and nothing more; notes are opt-in, because a lock screen and a watch
 * face can be read by whoever is nearby.
 */
const REMINDER_CHOICES: { id: ReminderContent; label: string }[] = [
  { id: 'titleTime', label: 'Title and time' },
  { id: 'generic', label: 'Just "You have a reminder"' },
  { id: 'titleNotes', label: 'Title and notes' },
];

/**
 * The swatch reuses the `.swatch` rule in styles.css by handing it the same
 * token names that rule reads. Built-in themes get theirs from the stylesheet
 * via data-theme; these are for the custom pickers, where the values only exist
 * in JavaScript. Either way there is no second copy of a palette.
 */
function swatchStyle(tokens: Record<string, string>): CSSProperties {
  return {
    '--bg': tokens.bg,
    '--surface': tokens.surface,
    '--border': tokens.border,
    '--border-strong': tokens['border-strong'],
    '--accent': tokens.accent,
  } as CSSProperties;
}

export default function Settings({
  settings,
  onChange,
  onAbout,
  focus = null,
}: {
  settings: SettingsType;
  onChange: (settings: SettingsType) => void;
  /** Opens the About page: version, what's new, recent updates. */
  onAbout: () => void;
  /** A group to open on arrival, for a button elsewhere that sends you to it. */
  focus?: 'lock' | null;
}) {
  const onToast = useToast();
  const [permission, setPermission] = useState<PermissionState>(notificationSupport());
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [importError, setImportError] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  /**
   * A backup file that has been read but not yet restored. Replacing wipes the
   * phone, so the file is opened and described first, and nothing is touched
   * until you have seen what is in it and said yes.
   */
  const [pending, setPending] = useState<Backup | null>(null);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  /**
   * Subscriptions and debts saved under a different currency than the one now
   * set. A debt in another currency is left out of the plan, so it matters.
   */
  const [mismatched, setMismatched] = useState({ subs: 0, debts: 0 });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      setCounts(await countAll());
      setStorage(await storageStatus());
      const [subs, debts] = await Promise.all([db.subscriptions.toArray(), db.debts.toArray()]);
      setMismatched({
        subs: subs.filter((s) => s.currency !== settings.currency).length,
        debts: debts.filter((d) => d.currency !== settings.currency).length,
      });
    })();
  }, [settings.rev, settings.currency]);

  /**
   * Relabels every subscription and debt with the current currency.
   *
   * Deliberately does not convert: there is no exchange-rate source here and
   * there never will be, since fetching one would mean a network call. This is
   * for the case where the figures were always in your own currency and only
   * the label was wrong.
   */
  const retagCurrency = async () => {
    const [subs, debts] = await Promise.all([db.subscriptions.toArray(), db.debts.toArray()]);
    await db.transaction('rw', db.subscriptions, db.debts, async () => {
      await db.subscriptions.bulkPut(subs.map((s) => ({ ...s, currency: settings.currency })));
      await db.debts.bulkPut(debts.map((d) => ({ ...d, currency: settings.currency })));
    });
    onChange(await saveSettings({ rev: settings.rev + 1 }));
    onToast(`All subscriptions and debts now shown in ${settings.currency}.`);
  };
  const mismatchedWords = [
    mismatched.subs > 0 ? `${mismatched.subs} subscription${mismatched.subs === 1 ? '' : 's'}` : '',
    mismatched.debts > 0 ? `${mismatched.debts} debt${mismatched.debts === 1 ? '' : 's'}` : '',
  ]
    .filter(Boolean)
    .join(' and ');

  const patch = async (changes: Partial<SettingsType>) => onChange(await saveSettings(changes));

  /*
    Both files go the same way "Add to my calendar" does: the phone's share
    sheet where it has one, so you choose where the file goes, and a plain
    download where it does not. Neither is a network call.
  */
  const doExport = async () => {
    const backup = await exportBackup();
    const outcome = await shareOrDownload(backupFilename(), JSON.stringify(backup, null, 2), 'application/json');
    if (outcome === 'shared') onToast('Backup sent to where you picked.');
    else if (outcome === 'downloaded') onToast('Backup saved to your downloads.');
  };

  const doCalendar = async () => {
    const [tasks, subscriptions, incomes] = await Promise.all([
      db.tasks.toArray(),
      db.subscriptions.toArray(),
      db.incomes.toArray(),
    ]);
    const ics = buildCalendar({
      tasks,
      subscriptions,
      incomes,
      formatAmount: (sub) => formatMoney(sub.amountMinor, sub.currency),
      formatPay: (src) => formatMoney(src.netMinor, src.currency),
      includeNotes: settings.calendarIncludeNotes,
    });
    const outcome = await shareOrDownload('steady.ics', ics, 'text/calendar');
    if (outcome === 'shared') onToast('Calendar file sent. Your calendar app takes it from here.');
    else if (outcome === 'downloaded') onToast('Calendar file saved. Open it to add everything to your phone calendar.');
  };

  const restore = async (backup: Backup, mode: ImportMode) => {
    const result = await importBackup(backup, mode);
    onChange(await getSettings());
    onToast(
      mode === 'merge' && totalRecords(result) === 0
        ? 'Nothing new - everything in this file is already here.'
        : `Restored ${describeCounts(result)}.`,
    );
  };

  const doImport = async (file: File) => {
    setImportError('');
    setPending(null);
    try {
      const backup = parseBackup(await file.text());
      // Adding what's missing cannot delete anything, so it just runs. Wiping
      // waits for a yes, below, with the file's contents in front of you.
      if (importMode === 'replace') setPending(backup);
      else await restore(backup, 'merge');
    } catch (err) {
      setImportError(err instanceof BackupError ? err.message : 'That file could not be read. Nothing has changed.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const confirmReplace = async () => {
    if (!pending) return;
    const backup = pending;
    setPending(null);
    try {
      await restore(backup, 'replace');
    } catch {
      // The restore runs in one transaction, so a failure leaves the phone as it was.
      setImportError('That file could not be restored. Nothing has changed.');
    }
  };

  const wipe = async () => {
    await wipeAll();
    onChange(await saveSettings({ rev: settings.rev + 1 }));
    onToast('Everything has been deleted from this device.');
  };

  /*
    "Put every section back the way it started". Every fold you changed is
    forgotten at once, and Undo brings back exactly the ones you had.
  */
  const resetSections = async () => {
    const before = settings.sections;
    if (!before || Object.keys(before).length === 0) {
      onToast('Every section is already the way it started.');
      return;
    }
    onChange(await forgetSettings('sections'));
    onToast('Every section is back the way it started.', {
      label: 'Undo',
      run: async () => {
        onChange(await saveSettings({ sections: before }));
        onToast('Put back as you had them.');
      },
    });
  };

  const lock = readLock(settings.lock);
  const themeLabel = ALL_THEMES.find((t) => t.id === settings.theme)?.label ?? 'Custom';

  /*
    One line under each group's heading, saying where it stands now, so most
    visits need no tap at all. Settings opens with every group closed, every
    time, so the page looks the same whenever you come to it.
  */
  const lookSummary = [
    themeLabel,
    `text ${Math.round(settings.textScale * 100)}%`,
    ...(settings.reduceMotion ? ['animation off'] : []),
    ...(settings.blurAmounts ? ['amounts blurred'] : []),
  ].join(' · ');
  const remindersSummary = {
    granted: 'Notifications on',
    default: 'Notifications not allowed yet',
    denied: "Notifications turned off in Chrome's settings",
    unsupported: "This browser can't show notifications",
  }[permission];
  const lockSummary = !lockAvailable()
    ? "Can't be used in this browser"
    : lock
      ? `On · ${lock.afterMinutes === 0 ? 'immediately' : `after ${lockAfterLabel(lock.afterMinutes)}`}`
      : 'Off';
  const dataSummary = storage?.supported
    ? storage.persisted
      ? 'Protected from clearing'
      : 'Not yet protected from clearing'
    : 'In this browser, on this phone';

  return (
    <>
      {/* The groups sit closer together than sections elsewhere, so that
          closed they read as one list of headings. */}
      <div className="stack fold-list">
        <Section title="How it looks" collapsible="settings.look" summary={lookSummary}>
          <fieldset className="field">
            <legend>Theme</legend>
            <ThemeButtons themes={THEMES} settings={settings} onPick={(t) => void patch(t)} />
            <p className="faint group-note">Just for fun</p>
            <ThemeButtons themes={FUN_THEMES} settings={settings} onPick={(t) => void patch(t)} />
            <div className="group-note">
              <ThemeButtons themes={[CUSTOM_THEME]} settings={settings} onPick={(t) => void patch(t)} />
            </div>
            <p className="faint">{ALL_THEMES.find((t) => t.id === settings.theme)?.hint}</p>
          </fieldset>

          {settings.theme === 'custom' && (
            <CustomThemeEditor
              custom={settings.customTheme ?? DEFAULT_CUSTOM}
              onChange={(customTheme) => void patch({ customTheme })}
            />
          )}

          <div className="field">
            <label htmlFor="text-scale">Text size ({Math.round(settings.textScale * 100)}%)</label>
            <input
              autoComplete="off"
              id="text-scale"
              type="range"
              min={0.9}
              max={1.6}
              step={0.05}
              value={settings.textScale}
              onChange={(e) => void patch({ textScale: Number(e.target.value) })}
            />
          </div>

          <label className="check">
            <input
              type="checkbox"
              checked={settings.reduceMotion}
              onChange={(e) => void patch({ reduceMotion: e.target.checked })}
            />
            <span>Turn off all animation</span>
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={settings.blurAmounts}
              onChange={(e) => void patch({ blurAmounts: e.target.checked })}
            />
            <span>Blur money amounts until I tap them</span>
          </label>

          <div className="stack-sm">
            <div className="btn-row">
              <button type="button" className="btn btn-sm" onClick={() => void resetSections()}>
                Put every section back the way it started
              </button>
            </div>
            <p className="faint">
              Opens or folds each section the way it was when you first used Steady. Nothing else changes.
            </p>
          </div>
        </Section>

        <Section
          title="Money"
          collapsible="settings.money"
          summary={`${settings.currency} · ${settings.lookaheadDays} days ahead`}
        >
          <div className="field">
            <label htmlFor="currency">Currency</label>
            <input
              autoComplete="off"
              id="currency"
              type="text"
              value={settings.currency}
              onChange={(e) => void patch({ currency: e.target.value.toUpperCase().slice(0, 3) })}
            />
            <p className="faint">
              Used for new subscriptions and debts, and for the debt plan, which only adds up debts in this currency.
              Each subscription and debt also stores its own, so changing this does not touch anything already saved
              - the button below does that.
            </p>
            {mismatchedWords && (
              <div className="stack-sm">
                <ConfirmButton
                  label={`Change ${mismatchedWords} to ${settings.currency}`}
                  confirmLabel={`Yes, use ${settings.currency} for all of them`}
                  className="btn btn-sm"
                  onConfirm={() => void retagCurrency()}
                />
                <p className="faint">
                  This relabels the amounts. It does not convert them - {settings.currency} 10 stays 10, so only do
                  this if the figures you typed were always in {settings.currency}.
                </p>
              </div>
            )}
          </div>

          <div className="field">
            <label htmlFor="lookahead">Show money leaving in the next {settings.lookaheadDays} days</label>
            <input
              autoComplete="off"
              id="lookahead"
              type="range"
              min={3}
              max={60}
              step={1}
              value={settings.lookaheadDays}
              onChange={(e) => void patch({ lookaheadDays: Number(e.target.value) })}
            />
            <p className="faint">How far ahead "Money leaving soon" on Today looks.</p>
          </div>
        </Section>

        <Section
          title="Notes"
          collapsible="settings.notes"
          summary={settings.suggestTags ? 'Tag suggestions on' : 'Tag suggestions off'}
        >
          <label className="check">
            <input
              type="checkbox"
              checked={settings.suggestTags}
              onChange={(e) => void patch({ suggestTags: e.target.checked })}
            />
            <span>Suggest tags for my notes</span>
          </label>
          <p className="faint">
            Learned from the tags you have already used, on this phone. It only ever suggests tags you invented
            yourself, it never files anything for you, and nothing is sent anywhere to work it out.
          </p>
        </Section>

        <Section title="Reminders and calendar" collapsible="settings.reminders" summary={remindersSummary}>
          {/* Where things stand comes first, said as a plain line - not a
              coloured pill, which read as a button on one side and as a
              warning on the other. */}
          {permission === 'unsupported' && <p className="small">This browser can't show notifications.</p>}
          {permission === 'granted' && <p className="small">Notifications are on.</p>}
          {permission === 'denied' && (
            <p className="small">
              Notifications are blocked for Steady on this phone. Turn them back on in Chrome's settings for this
              site.
            </p>
          )}
          {permission === 'default' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                const next = await requestPermission();
                setPermission(next);
                await patch({ notificationsAsked: true });
              }}
            >
              Allow notifications
            </button>
          )}

          <fieldset className="field">
            <legend>What a reminder shows</legend>
            <div className="btn-row">
              {REMINDER_CHOICES.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  aria-pressed={settings.reminderContent === choice.id}
                  className={`btn btn-sm${settings.reminderContent === choice.id ? ' btn-primary' : ''}`}
                  onClick={() => void patch({ reminderContent: choice.id })}
                >
                  {choice.label}
                </button>
              ))}
            </div>
            <p className="faint">
              Reminders can show on your lock screen and on a paired watch, where anyone nearby can read them.
            </p>
          </fieldset>

          <p className="small">
            Steady can show a notification when a task's reminder time arrives, but only while it is running.
            Android is allowed to stop a backgrounded web app, and there is no push server behind this app to wake
            it up, because a push server would mean sending your reminders to someone else's computer.
          </p>
          <p className="small">
            Anything that came due while Steady was closed is shown the moment you open it, rather than being
            dropped. For anything that genuinely cannot be missed, use the calendar export below - your phone's own
            alarms do not depend on this app at all.
          </p>

          <h3>Your phone's calendar</h3>
          <button type="button" className="btn" onClick={() => void doCalendar()}>
            Export everything to my calendar (.ics)
          </button>
          <p className="faint">
            Makes one file with every dated task, subscription renewal and payday, including repeats and warnings.
            Open it and your calendar app takes over the reminding.
          </p>
          <p className="faint">
            Debt payments are not in it. A lender's name and an amount say more than a streaming bill does, so each
            debt has its own "Add to my calendar" button on the Debt tab, and goes in only if you choose it.
          </p>
          <p className="faint">
            {calendarContents('all', settings.calendarIncludeNotes)} {CALENDAR_CAUTION}
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.calendarIncludeNotes}
              onChange={(e) => void patch({ calendarIncludeNotes: e.target.checked })}
            />
            <span>Put notes, steps and how to cancel into calendar entries</span>
          </label>
          <p className="faint">
            Off unless you turn it on. How to cancel can hold a login, and a calendar is easy to share by accident.
            This applies to every "Add to my calendar" button too.
          </p>
        </Section>

        <LockSettings settings={settings} onChange={onChange} summary={lockSummary} forceOpen={focus === 'lock'} />

        <Section title="Backup and restore" collapsible="settings.backup" summary="A copy of everything, as a file">
          <button type="button" className="btn btn-primary" onClick={() => void doExport()}>
            Save a backup file
          </button>
          <p className="faint">
            Do this now and then. If you clear your browser data or lose the phone, the backup file is the only copy.
          </p>
          <p className="faint">
            The file holds everything - every task, note, subscription, income, debt, your debt plan and inbox item,
            and your settings - as plain readable text. Anyone who opens it can read all of it, so put it somewhere you trust. Two
            things stay on this phone: the app lock, and a low day, which is never kept.
            Deleting something in the app does not delete it from backup files you saved earlier, or from calendar
            entries you added.
          </p>

          <hr className="divider" />

          <fieldset className="field">
            <legend>Restoring a backup</legend>
            <div className="btn-row">
              <button
                type="button"
                aria-pressed={importMode === 'merge'}
                className={`btn btn-sm${importMode === 'merge' ? ' btn-primary' : ''}`}
                onClick={() => setImportMode('merge')}
              >
                Add what's missing
              </button>
              <button
                type="button"
                aria-pressed={importMode === 'replace'}
                className={`btn btn-sm${importMode === 'replace' ? ' btn-primary' : ''}`}
                onClick={() => setImportMode('replace')}
              >
                Wipe and replace
              </button>
            </div>
            <p className="faint">
              {importMode === 'merge'
                ? 'Keeps everything already here and only adds records it has not seen before. Safe to run twice.'
                : 'Shows you what the file holds first. Only when you say yes does it delete everything on this device and restore the file exactly. Use this on a new phone.'}
            </p>
          </fieldset>

          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            aria-label="Choose a backup file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void doImport(file);
            }}
          />
          <FormError message={importError} />
          {pending && (
            <div className="card stack-sm" role="status">
              <p className="small">
                {backupDate(pending) ? `From ${backupDate(pending)}: ` : 'This file holds: '}
                {describeCounts(countBackup(pending))}.
              </p>
              <p className="small">
                Replace everything on this phone with it? What is here now ({describeCounts(counts)}) will be
                deleted.
              </p>
              <div className="btn-row">
                <ConfirmButton
                  label="Replace everything with this file"
                  confirmLabel="Yes, replace everything"
                  className="btn btn-sm"
                  onConfirm={() => void confirmReplace()}
                />
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => setPending(null)}>
                  Don't restore it
                </button>
              </div>
            </div>
          )}
        </Section>

        <Section title="Your data on this phone" collapsible="settings.data" summary={dataSummary}>
          <div className="card stack-sm">
            <p className="small">On this device: {describeCounts(counts)}.</p>
            <p className="faint">
              All of it lives in this browser's storage on this phone. It has not been sent anywhere unless you sent
              it yourself - as a backup file, or as entries added to your calendar. The app cannot send anything by
              itself - see below.
            </p>
          </div>

          <div className="card card-quiet stack-sm">
            <h3>Where exactly it lives</h3>
            <p className="small">
              In your browser's own database, filed under <code>{storageOrigin()}</code>, inside Chrome's private
              storage on this phone. Other apps on the phone cannot read it, and neither can websites at other
              addresses. GitHub only ever sent your phone the app's files; it never receives what you write.
            </p>
            <p className="small">
              One exception, stated plainly: browser storage belongs to the whole address, not to this app. Any
              other page published at <code>{storageOrigin()}</code> could read it.{' '}
              {storageOrigin().endsWith('.github.io')
                ? 'Every GitHub Pages site from the same GitHub account is published at that address, so do not publish any other Pages site from that account.'
                : 'So do not publish anything else at that address.'}
            </p>
            <p className="small">
              If the Steady icon on your home screen has a small briefcase badge, it is in your work profile, which
              your employer manages and can wipe. Install it from Chrome in your personal profile instead.
            </p>
            {storage?.databaseBytes !== undefined ? (
              <p className="faint">
                Everything you have written takes up {formatBytes(storage.databaseBytes)}.
                {storage.usageBytes !== undefined &&
                  ` The app's own offline copy of itself takes another ${formatBytes(Math.max(0, storage.usageBytes - storage.databaseBytes))}.`}
              </p>
            ) : (
              storage?.usageBytes !== undefined && (
                <p className="faint">
                  This site is using {formatBytes(storage.usageBytes)} in total. That covers the app's offline copy
                  of itself as well as what you have written, which this browser won't separate out.
                </p>
              )
            )}
            {storage && !storage.supported && (
              <p className="faint">
                This browser won't say whether it protects the data from being cleared automatically. Keep backups.
              </p>
            )}
            {storage?.supported && storage.persisted && (
              <p className="small">
                <strong>The browser has promised not to delete it</strong> to free up space. Only you clearing this
                site's data removes it.
              </p>
            )}
            {storage?.supported && !storage.persisted && (
              <>
                <p className="small">
                  <strong>Not yet protected from automatic clearing.</strong> If the phone runs very low on storage,
                  the browser is allowed to delete this to make room. Installing the app to your home screen usually
                  earns the protection; you can also ask for it directly.
                </p>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={async () => {
                    await requestPersistence();
                    setStorage(await storageStatus());
                  }}
                >
                  Ask the browser to protect it
                </button>
              </>
            )}
          </div>

          <hr className="divider" />

          <ConfirmButton
            label="Delete everything on this device"
            confirmLabel="Yes, delete all of it"
            className="btn"
            onConfirm={() => void wipe()}
          />
          <p className="faint">
            Save a backup first if you might want any of it back - this cannot be undone. It does not touch backup
            files you saved earlier or entries you added to your calendar; delete those separately if you want them
            gone.
          </p>
          <p className="faint">
            {lock
              ? 'Your settings stay as they are, and so does the app lock: Steady will still ask for your PIN. To remove the lock as well, turn it off under App lock above.'
              : 'Your settings stay as they are.'}
          </p>
        </Section>

        <Section
          title="What Steady does with your data"
          collapsible="settings.privacy"
          summary="Nothing leaves unless you send it"
        >
          <div className="card stack-sm">
            <p className="small">
              <strong>Nothing leaves this device unless you send it.</strong> Not to us, not to anyone. The only ways
              out are the buttons that say so: saving a backup file, and adding things to your calendar. There is no
              account, no login, no server, no analytics, no crash reporting, no ads and no third-party code loaded
              from anywhere.
            </p>
            <p className="small">
              You do not have to take that on trust. The page ships with a Content Security Policy of{' '}
              <code>connect-src 'none'</code>, which means the browser itself refuses to let this page's code open a
              network connection. If any code tried to send your notes somewhere that way, the browser would block
              it and log the attempt to the console. Before every release, a check also refuses to publish a build
              that contains code for sending anything or for opening another site.
            </p>
            <p className="small">
              The only network request in the whole app is your browser fetching the app's own files, and the
              service worker caches those so it works with no signal at all. You can put the phone in airplane mode
              and use every feature.
            </p>
            <p className="faint">
              The trade-off, stated plainly: no sync between devices, and no recovery if you lose the phone without a
              backup. That is the cost of there being nowhere else for your data to be.
            </p>
          </div>
        </Section>
      </div>

      <Section title="About">
        <div className="card stack-sm">
          <p>Steady, {versionLabel().toLowerCase()}</p>
          <div className="btn-row">
            <button type="button" className="btn btn-sm" onClick={onAbout}>
              About and what's new
            </button>
          </div>
        </div>
      </Section>
    </>
  );
}

/** One row of theme buttons, each with a slice of that theme beside its name. */
function ThemeButtons({
  themes,
  settings,
  onPick,
}: {
  themes: ThemeChoice[];
  settings: SettingsType;
  onPick: (changes: Partial<SettingsType>) => void;
}) {
  return (
    <div className="btn-row">
      {themes.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={settings.theme === t.id}
          className={`btn btn-sm theme-btn${settings.theme === t.id ? ' btn-primary' : ''}`}
          onClick={() =>
            onPick(
              // Choosing Custom for the first time needs something to show,
              // so it starts on the Calm pair rather than on nothing.
              t.id === 'custom'
                ? { theme: 'custom', customTheme: settings.customTheme ?? DEFAULT_CUSTOM }
                : { theme: t.id },
            )
          }
        >
          {/* A slice of the theme, next to its name - never instead of it. */}
          <span
            className="swatch"
            aria-hidden="true"
            {...(t.id === 'custom'
              ? { style: swatchStyle(resolveCustom(settings.customTheme).tokens) }
              : { 'data-theme': t.id })}
          />
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The custom theme: two picks, and deliberately not a colour wheel.
 *
 * The paper carries the whole neutral ramp - page, card, borders, and all three
 * weights of text - and it is not adjustable, because that is the part that
 * decides whether anything is readable. The colour is the one hue the app is
 * allowed to use, and it comes in a light cut and a dark cut so it never has to
 * work on a ground it was not drawn for.
 *
 * Every one of the forty combinations is contrast-checked in test/theme.test.ts.
 * That is why there is no warning here and nothing to dismiss: a combination
 * that came out hard to read would be a failing test, not a caution message
 * handed to someone who is already having a difficult day.
 */
function CustomThemeEditor({
  custom,
  onChange,
}: {
  custom: CustomTheme;
  onChange: (custom: CustomTheme) => void;
}) {
  const ground = GROUNDS[custom.ground];

  return (
    <div className="card stack">
      <fieldset className="field">
        <legend>Paper</legend>
        <div className="btn-row">
          {GROUND_IDS.map((id) => {
            const option = GROUNDS[id];
            const accent = option.dark ? ACCENTS[custom.accent].onDark : ACCENTS[custom.accent].onLight;
            const on = custom.ground === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                className={`btn btn-sm theme-btn${on ? ' btn-primary' : ''}`}
                onClick={() => onChange({ ...custom, ground: id })}
              >
                <span className="swatch" aria-hidden="true" style={swatchStyle({ ...option.tokens, ...accent })} />
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="faint">{ground.hint}</p>
      </fieldset>

      <fieldset className="field">
        <legend>One color</legend>
        <div className="btn-row">
          {ACCENT_IDS.map((id) => {
            const accent = ground.dark ? ACCENTS[id].onDark : ACCENTS[id].onLight;
            const on = custom.accent === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                className={`btn btn-sm theme-btn${on ? ' btn-primary' : ''}`}
                onClick={() => onChange({ ...custom, accent: id })}
              >
                <span
                  className="swatch swatch-accent"
                  aria-hidden="true"
                  style={swatchStyle({ ...ground.tokens, ...accent })}
                />
                {ACCENTS[id].label}
              </button>
            );
          })}
        </div>
        <p className="faint">
          Used for the tab you are on and the button you are about to press. Nothing else in the app is colored,
          which is what keeps it quiet.
        </p>
      </fieldset>

      <p className="faint">
        Every pair on this screen has been checked for readability, so there is no combination here that comes out
        hard to read. That is why it offers paper and a color rather than a color wheel.
      </p>
    </div>
  );
}
