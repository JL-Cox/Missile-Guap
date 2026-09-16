import { useEffect, useRef, useState } from 'react';
import { db, getSettings, saveSettings } from '../db';
import type { Settings as SettingsType, ThemeName } from '../types';
import { BackupError, backupFilename, downloadFile, exportBackup, importBackup, parseBackup, type ImportMode } from '../lib/backup';
import { buildCalendar } from '../lib/ics';
import { formatMoney } from '../lib/money';
import { notificationSupport, requestPermission, type PermissionState } from '../lib/notify';
import { formatBytes, requestPersistence, storageOrigin, storageStatus, type StorageStatus } from '../lib/storage';
import { ConfirmButton, Section } from '../components/ui';

const THEMES: { id: ThemeName; label: string; hint: string }[] = [
  { id: 'calm', label: 'Calm', hint: 'Warm off-white. The default.' },
  { id: 'dark', label: 'Dark', hint: 'Warm dark, not black. Easier at night.' },
  { id: 'contrast', label: 'High contrast', hint: 'Black on white, heavier borders.' },
];

export default function Settings({
  settings,
  onChange,
  onToast,
}: {
  settings: SettingsType;
  onChange: (settings: SettingsType) => void;
  onToast: (message: string) => void;
}) {
  const [permission, setPermission] = useState<PermissionState>(notificationSupport());
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [importError, setImportError] = useState('');
  const [counts, setCounts] = useState({ captures: 0, tasks: 0, notes: 0, subscriptions: 0 });
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  /** Subscriptions saved under a different currency than the one now set. */
  const [mismatched, setMismatched] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      setCounts({
        captures: await db.captures.count(),
        tasks: await db.tasks.count(),
        notes: await db.notes.count(),
        subscriptions: await db.subscriptions.count(),
      });
      setStorage(await storageStatus());
      const subs = await db.subscriptions.toArray();
      setMismatched(subs.filter((s) => s.currency !== settings.currency).length);
    })();
  }, [settings.rev, settings.currency]);

  /**
   * Relabels every subscription with the current currency.
   *
   * Deliberately does not convert: there is no exchange-rate source here and
   * there never will be, since fetching one would mean a network call. This is
   * for the case where the figures were always in your own currency and only
   * the label was wrong.
   */
  const retagCurrency = async () => {
    const subs = await db.subscriptions.toArray();
    await db.subscriptions.bulkPut(subs.map((s) => ({ ...s, currency: settings.currency })));
    onChange(await saveSettings({ rev: settings.rev + 1 }));
    onToast(`All subscriptions now shown in ${settings.currency}.`);
  };

  const patch = async (changes: Partial<SettingsType>) => onChange(await saveSettings(changes));

  const doExport = async () => {
    const backup = await exportBackup();
    downloadFile(backupFilename(), JSON.stringify(backup, null, 2), 'application/json');
    onToast('Backup saved to your downloads.');
  };

  const doCalendar = async () => {
    const [tasks, subscriptions] = await Promise.all([db.tasks.toArray(), db.subscriptions.toArray()]);
    const ics = buildCalendar({
      tasks,
      subscriptions,
      formatAmount: (sub) => formatMoney(sub.amountMinor, sub.currency),
    });
    downloadFile('steady.ics', ics, 'text/calendar');
    onToast('Calendar file saved. Open it to add everything to your phone calendar.');
  };

  const doImport = async (file: File) => {
    setImportError('');
    try {
      const backup = parseBackup(await file.text());
      const result = await importBackup(backup, importMode);
      onChange(await getSettings());
      onToast(
        `Restored ${result.tasks} tasks, ${result.notes} notes, ${result.subscriptions} subscriptions, ${result.captures} inbox items.`,
      );
    } catch (err) {
      setImportError(err instanceof BackupError ? err.message : 'That file could not be read. Nothing has changed.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const wipe = async () => {
    await Promise.all([db.captures.clear(), db.tasks.clear(), db.notes.clear(), db.subscriptions.clear()]);
    onChange(await saveSettings({ rev: settings.rev + 1 }));
    onToast('Everything has been deleted from this device.');
  };

  return (
    <>
      <Section title="How it looks">
        <div className="field">
          <label>Theme</label>
          <div className="btn-row">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={settings.theme === t.id}
                className={`btn btn-sm${settings.theme === t.id ? ' btn-primary' : ''}`}
                onClick={() => void patch({ theme: t.id })}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="faint">{THEMES.find((t) => t.id === settings.theme)?.hint}</p>
        </div>

        <div className="field">
          <label htmlFor="text-scale">Text size ({Math.round(settings.textScale * 100)}%)</label>
          <input
            id="text-scale"
            type="range"
            min={0.9}
            max={1.6}
            step={0.05}
            value={settings.textScale}
            onChange={(e) => void patch({ textScale: Number(e.target.value) })}
            style={{ width: '100%' }}
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

        <div className="field">
          <label htmlFor="lookahead">Show money leaving in the next {settings.lookaheadDays} days</label>
          <input
            id="lookahead"
            type="range"
            min={3}
            max={60}
            step={1}
            value={settings.lookaheadDays}
            onChange={(e) => void patch({ lookaheadDays: Number(e.target.value) })}
            style={{ width: '100%' }}
          />
        </div>

        <div className="field">
          <label htmlFor="currency">Currency</label>
          <input
            id="currency"
            type="text"
            value={settings.currency}
            onChange={(e) => void patch({ currency: e.target.value.toUpperCase().slice(0, 3) })}
          />
          <p className="faint">
            Used for new subscriptions. Each one also stores its own, so changing this does not touch anything
            already saved - the button below does that.
          </p>
          {mismatched > 0 && (
            <div className="stack-sm" style={{ marginTop: 8 }}>
              <ConfirmButton
                label={`Change ${mismatched} subscription${mismatched === 1 ? '' : 's'} to ${settings.currency}`}
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
      </Section>

      <Section title="Reminders">
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

        {permission === 'unsupported' && <p className="pill pill-warn">This browser has no notification support.</p>}
        {permission === 'granted' && <p className="pill">Notifications are on.</p>}
        {permission === 'denied' && (
          <p className="pill pill-warn">
            Notifications are blocked for this site. Turn them back on in your browser's site settings.
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

        <button type="button" className="btn" onClick={() => void doCalendar()}>
          Export everything to my calendar (.ics)
        </button>
        <p className="faint">
          Makes one file with every dated task and every subscription renewal, including repeats and warnings.
          Open it and your calendar app takes over the reminding.
        </p>
      </Section>

      <Section title="Your data">
        <div className="card stack-sm">
          <p className="small">
            On this device: {counts.tasks} tasks, {counts.notes} notes, {counts.subscriptions} subscriptions,{' '}
            {counts.captures} inbox items.
          </p>
          <p className="faint">
            All of it lives in this browser's storage on this phone. It has never been sent anywhere, because this
            app cannot send anything anywhere - see below.
          </p>
        </div>

        <div className="card card-quiet stack-sm">
          <h3>Where exactly it lives</h3>
          <p className="small">
            In your browser's own database, filed under <code>{storageOrigin()}</code>, inside Chrome's private
            storage on this phone. No other app can read it. Neither can any other website. Neither can GitHub,
            who only ever sent your phone the app's files.
          </p>
          {storage?.databaseBytes !== undefined ? (
            <p className="faint">
              Your notes, tasks and subscriptions take up {formatBytes(storage.databaseBytes)}.
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

        <button type="button" className="btn btn-primary" onClick={() => void doExport()}>
          Save a backup file
        </button>
        <p className="faint">
          Do this now and then. If you clear your browser data or lose the phone, the backup file is the only copy.
          Put it somewhere you trust.
        </p>

        <hr className="divider" />

        <div className="field">
          <label>Restoring a backup</label>
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
              : 'Deletes everything on this device first, then restores the file exactly. Use this on a new phone.'}
          </p>
        </div>

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
        {importError && <p className="pill pill-warn">{importError}</p>}

        <hr className="divider" />

        <ConfirmButton
          label="Delete everything on this device"
          confirmLabel="Yes, delete all of it"
          className="btn"
          onConfirm={() => void wipe()}
        />
        <p className="faint">Save a backup first. This cannot be undone and there is no copy anywhere else.</p>
      </Section>

      <Section title="What this app does with your data">
        <div className="card stack-sm">
          <p className="small">
            <strong>Nothing leaves this device.</strong> Not to us, not to anyone. There is no account, no login, no
            server, no analytics, no crash reporting, no ads and no third-party code loaded from anywhere.
          </p>
          <p className="small">
            You do not have to take that on trust. The page ships with a Content Security Policy of{' '}
            <code>connect-src 'none'</code>, which means the browser itself refuses to let this page open a network
            connection. If any code ever tried to send your notes somewhere, the browser would block it and log the
            attempt to the console.
          </p>
          <p className="small">
            The only network request in the whole app is your browser fetching the app's own files, and the service
            worker caches those so it works with no signal at all. You can put the phone in aeroplane mode and use
            every feature.
          </p>
          <p className="faint">
            The trade-off, stated plainly: no sync between devices, and no recovery if you lose the phone without a
            backup. That is the cost of there being nowhere else for your data to be.
          </p>
        </div>
      </Section>
    </>
  );
}
