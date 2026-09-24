import { useState } from 'react';
import { saveLock } from '../db';
import type { LockAfter, Settings as SettingsType } from '../types';
import {
  LOCK_AFTER_CHOICES,
  createLock,
  lockAfterLabel,
  lockAvailable,
  makePhrase,
  readLock,
  withNewPhrase,
  withNewPin,
} from '../lib/lock';
import { LockCheck } from './LockScreen';
import PinPad from './PinPad';
import { FormError, Section, useToast } from './ui';

/**
 * Where a change to the lock has got to. Nothing is saved until the last step,
 * so leaving part-way - Cancel, Back, another tab - changes nothing.
 */
type Flow =
  | { step: 'idle' }
  /** The current PIN or phrase, before changing or removing anything. */
  | { step: 'check'; then: 'pin' | 'phrase' | 'off' }
  /** A new PIN, typed twice. `first` holds the first go until the second. */
  | { step: 'pin'; purpose: 'setup' | 'change'; first: string | null; mismatch: boolean }
  /** A recovery phrase, shown this once. */
  | { step: 'phrase'; purpose: 'setup' | 'renew'; words: string[]; pin: string | null };

const CHECK_TITLES = { pin: 'Change the PIN', phrase: 'Make a new recovery phrase', off: 'Turn the lock off' };

/** "as soon as it goes out of sight", "after 5 minutes out of sight". */
function whenItLocks(minutes: LockAfter): string {
  return minutes === 0 ? 'as soon as it goes out of sight' : `after ${lockAfterLabel(minutes)} out of sight`;
}

/**
 * The app lock's section of Settings: set it up, change it, turn it off, and a
 * plain account of what it does and does not do.
 */
export default function LockSettings({
  settings,
  onChange,
  summary,
  forceOpen = false,
}: {
  settings: SettingsType;
  onChange: (settings: SettingsType) => void;
  /** The group's one line while closed: "Off", "On · after 5 minutes". */
  summary: string;
  /** Open on arrival, for the button that sends you here after a recovery phrase. */
  forceOpen?: boolean;
}) {
  const onToast = useToast();
  const available = lockAvailable();
  const lock = readLock(settings.lock);
  const [flow, setFlow] = useState<Flow>({ step: 'idle' });
  const [entry, setEntry] = useState('');
  const [written, setWritten] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /** Back to the start, forgetting every digit and word on the way. */
  const finish = () => {
    setFlow({ step: 'idle' });
    setEntry('');
    setWritten(false);
    setError('');
  };

  const showPhrase = (purpose: 'setup' | 'renew', pin: string | null) => {
    setWritten(false);
    setFlow({ step: 'phrase', purpose, words: makePhrase(), pin });
  };

  const afterCheck = async (then: 'pin' | 'phrase' | 'off') => {
    if (then === 'pin') setFlow({ step: 'pin', purpose: 'change', first: null, mismatch: false });
    else if (then === 'phrase') showPhrase('renew', null);
    else {
      onChange(await saveLock(null));
      finish();
      onToast('The lock is off.');
    }
  };

  const submitPin = async () => {
    if (flow.step !== 'pin') return;
    const typed = entry;
    setEntry('');
    if (flow.first === null) return setFlow({ ...flow, first: typed, mismatch: false });
    if (typed !== flow.first) return setFlow({ ...flow, first: null, mismatch: true });
    if (flow.purpose === 'setup') return showPhrase('setup', typed);
    if (!lock) return finish();
    setBusy(true);
    try {
      onChange(await saveLock(await withNewPin(lock, typed)));
      finish();
      onToast('PIN changed. Your recovery phrase is the same as before.');
    } catch {
      setError('That did not work, so nothing has changed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const savePhrase = async () => {
    if (flow.step !== 'phrase' || !written) return;
    const phrase = flow.words.join(' ');
    setBusy(true);
    try {
      if (flow.purpose === 'setup' && flow.pin) {
        const next = await saveLock(await createLock(flow.pin, phrase));
        onChange(next);
        finish();
        const after = readLock(next.lock)?.afterMinutes ?? 1;
        onToast(`The lock is on. It closes ${whenItLocks(after)}, or when you tap Hide now.`);
      } else if (lock) {
        onChange(await saveLock(await withNewPhrase(lock, phrase)));
        finish();
        onToast('New recovery phrase saved. The old one no longer works.');
      }
    } catch {
      setError('That did not work, so nothing has changed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const setAfter = async (afterMinutes: LockAfter) => {
    if (lock) onChange(await saveLock({ ...lock, afterMinutes }));
  };

  return (
    <Section title="App lock" collapsible="settings.lock" summary={summary} forceOpen={forceOpen}>
      {!available ? (
        <p className="small">
          The app lock can't be used in this browser. It needs the browser's built-in secure hashing, which isn't
          available here. Nothing else is affected.
        </p>
      ) : flow.step === 'check' && lock ? (
        <div className="card stack">
          <h3>{CHECK_TITLES[flow.then]}</h3>
          <LockCheck
            lock={lock}
            idPrefix="settings-lock"
            intro="First, enter the PIN you use now."
            pinLabel="Next"
            switchLabel="Use the recovery phrase instead"
            phraseLabel="Continue"
            phraseHint="The six words you were shown when you set the PIN."
            onPin={() => void afterCheck(flow.then)}
            onPhrase={() => afterCheck(flow.then)}
            onCancel={finish}
          />
        </div>
      ) : flow.step === 'pin' ? (
        <div className="card stack">
          <h3>{flow.purpose === 'setup' ? 'Set a PIN' : 'Change the PIN'}</h3>
          {flow.mismatch && (
            <p className="notice" role="alert">
              Those two didn't match, so nothing was saved. Choose the PIN again.
            </p>
          )}
          <p className="small">
            {flow.first === null
              ? `Choose a${flow.purpose === 'setup' ? '' : ' new'} PIN of 4 to 8 digits.`
              : 'Enter the same PIN again, to be sure.'}
          </p>
          <PinPad
            value={entry}
            onChange={setEntry}
            onSubmit={() => void submitPin()}
            submitLabel={flow.first !== null && flow.purpose === 'change' ? 'Save' : 'Next'}
            disabled={busy}
            label={flow.first === null ? 'New PIN' : 'New PIN again'}
          />
          <FormError message={error} />
          <div className="btn-row">
            <button type="button" className="btn btn-quiet" onClick={finish}>
              Cancel
            </button>
          </div>
        </div>
      ) : flow.step === 'phrase' ? (
        <div className="card stack">
          <h3>Your recovery phrase</h3>
          <p className="small">
            If you ever forget the PIN, these six words open Steady instead, and take the lock off.{' '}
            <strong>This is the only time they are shown.</strong>
          </p>
          <ol className="phrase-words" aria-label="Recovery phrase">
            {flow.words.map((word) => (
              <li key={word}>{word}</li>
            ))}
          </ol>
          <p className="small">
            Write them on paper and keep it somewhere other than this phone. The order doesn't matter, and neither
            do capital letters.
          </p>
          <label className="check">
            <input type="checkbox" checked={written} onChange={(e) => setWritten(e.target.checked)} />
            <span>I have written this down somewhere other than this phone</span>
          </label>
          <FormError message={error} />
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!written || busy}
              onClick={() => void savePhrase()}
            >
              {flow.purpose === 'setup' ? 'Turn the lock on' : 'Use this phrase'}
            </button>
            <button type="button" className="btn btn-quiet" onClick={finish}>
              Cancel
            </button>
          </div>
          <p className="faint">
            {busy
              ? 'Saving…'
              : flow.purpose === 'setup'
                ? 'Cancel and nothing changes: no lock is set.'
                : 'Cancel and nothing changes: the phrase you already have keeps working.'}
          </p>
        </div>
      ) : lock ? (
        <>
          <p className="small">
            On. Steady asks for the PIN {whenItLocks(lock.afterMinutes)}, and whenever you tap{' '}
            <strong>Hide now</strong> at the top of the screen.
          </p>
          <fieldset className="field">
            <legend>Lock it</legend>
            <div className="btn-row">
              {LOCK_AFTER_CHOICES.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  aria-pressed={lock.afterMinutes === minutes}
                  className={`btn btn-sm${lock.afterMinutes === minutes ? ' btn-primary' : ''}`}
                  onClick={() => void setAfter(minutes)}
                >
                  {minutes === 0 ? 'Immediately' : `After ${lockAfterLabel(minutes)}`}
                </button>
              ))}
            </div>
            <p className="faint">
              When it locks, anything you were halfway through typing is cleared. A longer wait gives you time to
              switch to another app and come back.
            </p>
          </fieldset>
          <div className="btn-row">
            <button type="button" className="btn btn-sm" onClick={() => setFlow({ step: 'check', then: 'pin' })}>
              Change the PIN
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setFlow({ step: 'check', then: 'phrase' })}>
              Make a new recovery phrase
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setFlow({ step: 'check', then: 'off' })}>
              Turn the lock off
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="small">
            Off. Set a PIN and Steady will ask for it when you come back to it after some time away.
          </p>
          <div className="btn-row">
            <button
              type="button"
              className="btn"
              onClick={() => setFlow({ step: 'pin', purpose: 'setup', first: null, mismatch: false })}
            >
              Set a PIN
            </button>
          </div>
        </>
      )}

      <div className="card card-quiet stack-sm">
        <h3>What the lock does, and what it doesn't</h3>
        <p className="small">
          <strong>It hides the screen. It does not encrypt your data.</strong> It stops someone who picks up your
          unlocked phone from reading Steady. Everything is still stored exactly as before, so anyone with a backup
          file, or who connects the phone to a computer and opens Chrome's developer tools, can still read all of
          it.
        </p>
        <p className="small">
          Reminders still appear on the phone's lock screen, as set under Reminders and calendar. To keep task
          titles off it, choose <strong>Just "You have a reminder"</strong> there.
        </p>
        <p className="small">
          A forgotten PIN never costs you your data. Setting a PIN gives you a recovery phrase of six words, and
          typing it on the lock screen opens Steady and turns the lock off.
        </p>
        <p className="faint">
          The PIN is never stored. What is kept is a one-way check value made from it, which can confirm a guess but
          does not contain the PIN. The lock belongs to this phone: it is left out of backup files, restoring a
          backup does not change it, and Delete everything leaves it in place.
        </p>
      </div>
    </Section>
  );
}
