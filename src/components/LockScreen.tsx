import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppLock } from '../types';
import { PHRASE_WORDS, PAUSE_MS, checkPhrase, missPause, verifyPhrase, verifyPin } from '../lib/lock';
import PinPad from './PinPad';
import { FormError } from './ui';

/**
 * The lock screen. When Steady is locked this is the ONLY thing rendered - App
 * does not mount the header, the nav, any tab, a toast or the missed-reminders
 * card behind it - so there is nothing in the page to read, whatever anyone
 * does to the styles.
 *
 * Plain on purpose: the name of the app, a number pad, and a way in for when
 * the PIN has gone. No date, no counts, nothing that says what is inside.
 */
export default function LockScreen({
  lock,
  onUnlock,
  onRecovered,
}: {
  lock: AppLock;
  onUnlock: () => void;
  /** The recovery phrase was right: App turns the lock off and says so. */
  onRecovered: () => void | Promise<void>;
}) {
  return (
    <main className="lock" aria-labelledby="lock-title">
      <h1 id="lock-title">Steady is locked</h1>
      <LockCheck
        lock={lock}
        idPrefix="lock"
        intro="Enter your PIN to open it."
        pinLabel="Unlock"
        switchLabel="Forgot the PIN? Use the recovery phrase"
        phraseLabel="Open with the phrase"
        phraseHint="The six words you were shown when you set the PIN. They open Steady and turn the lock off, so you can choose a new PIN in Settings."
        phraseAfter={
          <p className="faint">
            Lost those too? Everything you wrote is still on this phone: the lock hides it, it does not scramble it.
            Someone comfortable with Chrome's developer tools on a computer can take the lock off without touching
            anything else.
          </p>
        }
        onPin={onUnlock}
        onPhrase={onRecovered}
        clearWhenHidden
      />
    </main>
  );
}

/**
 * "Prove it is you": the PIN on a number pad, or the recovery phrase instead.
 * The lock screen uses it to unlock, and Settings uses it before changing or
 * removing the lock.
 *
 * Wrong answers get a plain sentence, never a count. Every fifth one in a row
 * rests the keys for two seconds, and that is all - no growing delay, no
 * lockout, and nothing written down anywhere (see missPause).
 */
export function LockCheck({
  lock,
  idPrefix,
  intro,
  pinLabel,
  switchLabel,
  phraseLabel,
  phraseHint,
  phraseAfter,
  onPin,
  onPhrase,
  onCancel,
  clearWhenHidden = false,
}: {
  lock: AppLock;
  idPrefix: string;
  intro: string;
  pinLabel: string;
  switchLabel: string;
  phraseLabel: string;
  /** Under the phrase box: what the phrase is. */
  phraseHint: string;
  /** Below the buttons, which stay next to the box so the keyboard never covers them. */
  phraseAfter?: ReactNode;
  onPin: () => void;
  onPhrase: () => void | Promise<void>;
  onCancel?: () => void;
  /** Forget half-typed digits when the app goes out of sight. */
  clearWhenHidden?: boolean;
}) {
  const [mode, setMode] = useState<'pin' | 'phrase'>('pin');
  const [pin, setPin] = useState('');
  const [phrase, setPhrase] = useState('');
  const [checking, setChecking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [wrong, setWrong] = useState<'' | 'pin' | 'phrase'>('');
  const [hint, setHint] = useState('');
  /** Misses in a row, in memory only. Gone on reload, never saved. */
  const misses = useRef(0);

  useEffect(() => {
    if (!paused) return;
    const timer = window.setTimeout(() => setPaused(false), PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [paused]);

  useEffect(() => {
    if (!clearWhenHidden) return;
    // Someone else may be the next to see this screen. Two dots left over from
    // the owner's last try would tell them something.
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      setPin('');
      setPhrase('');
      setWrong('');
      setHint('');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [clearWhenHidden]);

  const miss = (what: 'pin' | 'phrase') => {
    misses.current += 1;
    setWrong(what);
    if (missPause(misses.current) > 0) setPaused(true);
  };

  const tryPin = async () => {
    if (checking || paused) return;
    setChecking(true);
    setWrong('');
    try {
      if (await verifyPin(lock, pin)) {
        misses.current = 0;
        onPin();
        return;
      }
      setPin('');
      miss('pin');
    } finally {
      setChecking(false);
    }
  };

  const tryPhrase = async () => {
    if (checking || paused) return;
    setWrong('');
    // Help with the shape before spending a guess: these say nothing secret.
    const { words, unknown } = checkPhrase(phrase);
    if (words.length === 0) return setHint(`Type the ${PHRASE_WORDS} words you wrote down.`);
    if (unknown.length > 0) {
      const named = unknown.map((w) => `"${w}"`).join(' and ');
      return setHint(
        `${named} ${unknown.length === 1 ? "isn't one of the words" : "aren't among the words"} Steady uses. Check the spelling against what you wrote down.`,
      );
    }
    if (words.length !== PHRASE_WORDS) {
      return setHint(`The phrase is ${PHRASE_WORDS} words, and this has ${words.length}.`);
    }
    setHint('');
    setChecking(true);
    try {
      if (await verifyPhrase(lock, phrase)) {
        misses.current = 0;
        await onPhrase();
        return;
      }
      miss('phrase');
    } finally {
      setChecking(false);
    }
  };

  const wrongText =
    wrong === 'pin'
      ? `That isn't the PIN. ${paused ? 'The keys will be back in a couple of seconds.' : 'Try again.'}`
      : wrong === 'phrase'
        ? `Those words don't match the phrase. ${paused ? 'You can try again in a couple of seconds.' : 'Check them against what you wrote down.'}`
        : '';

  const switchTo = (next: 'pin' | 'phrase') => {
    setMode(next);
    setWrong('');
    setHint('');
    setPin('');
  };

  if (mode === 'phrase') {
    return (
      <div className="stack">
        <div className="field">
          <label htmlFor={`${idPrefix}-phrase`}>Recovery phrase</label>
          <input
            autoComplete="off"
            id={`${idPrefix}-phrase`}
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby={`${idPrefix}-phrase-hint`}
            value={phrase}
            disabled={checking}
            onChange={(e) => setPhrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void tryPhrase();
            }}
          />
          <p id={`${idPrefix}-phrase-hint`} className="faint">
            {phraseHint}
          </p>
        </div>
        {checking && (
          <p className="faint" role="status">
            Checking…
          </p>
        )}
        <FormError message={hint || wrongText} />
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={checking || paused || !phrase.trim()}
            onClick={() => void tryPhrase()}
          >
            {phraseLabel}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => switchTo('pin')}>
            Use the PIN instead
          </button>
          {onCancel && (
            <button type="button" className="btn btn-quiet" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
        {phraseAfter}
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="small">{intro}</p>
      <PinPad
        value={pin}
        onChange={(next) => {
          setPin(next);
          if (next) setWrong('');
        }}
        onSubmit={() => void tryPin()}
        submitLabel={pinLabel}
        disabled={checking || paused}
        label="PIN"
      />
      {/* Below the pad, so a message appearing never moves a key under a finger. */}
      {checking && (
        <p className="faint" role="status">
          Checking…
        </p>
      )}
      <FormError message={wrongText} />
      <div className="btn-row">
        <button type="button" className="btn btn-quiet" onClick={() => switchTo('phrase')}>
          {switchLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
