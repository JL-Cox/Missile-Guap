import type { AppLock, LockAfter } from '../types';
import { WORDS } from './wordlist';

/**
 * THE APP LOCK, and exactly what it is for.
 *
 * It hides Steady's screen from someone holding your phone while the phone is
 * unlocked - a relative, a colleague you handed it to for a photo. That is the
 * whole job.
 *
 * It does NOT encrypt anything. Your notes stay in IndexedDB as they always
 * have, readable by anyone who can open this browser's developer tools and by
 * anyone who has a backup file. Encrypting them would mean a forgotten PIN
 * destroys everything you wrote, and this app will not make that trade for
 * someone whose memory is the reason they use it.
 *
 * So what is the hash for, if the data beside it is readable anyway? The PIN
 * itself. People reuse PINs - the phone's, the bank card's - and a PIN stored
 * as typed would be one more place to lift it from. A salted, slow hash means
 * what is stored is not the PIN. It is not a vault either: a PIN is at most
 * eight digits, and anyone holding the hash and a graphics card can try every
 * one of them in hours at most. Nothing in the app claims otherwise.
 *
 * All of it is WebCrypto: PBKDF2 with SHA-256, random salts from
 * crypto.getRandomValues, and no cryptography written by hand. Everything in
 * this file is pure apart from those calls, so test/lock.test.ts can hold it
 * to its word.
 */

export const PIN_MIN = 4;
export const PIN_MAX = 8;
export const PHRASE_WORDS = 6;

/**
 * PBKDF2 rounds for every lock set from now on. 600,000 is OWASP's current
 * figure for PBKDF2 with SHA-256; a desktop does it in about a quarter of a
 * second, and a recent phone with SHA-256 in hardware should be quicker still.
 * It is paid on every unlock, so if it ever feels slow on the phone, lower it -
 * never below MIN_ITERATIONS. Each lock stores its own count, so changing this
 * breaks no lock already set.
 */
export const LOCK_ITERATIONS = 600_000;

/** The floor. A stored lock claiming fewer rounds is treated as damaged. */
export const MIN_ITERATIONS = 210_000;

/**
 * The ceiling, for the same reason in reverse: a damaged count in the billions
 * would leave the lock screen "checking" forever with no way in.
 */
const MAX_ITERATIONS = 10_000_000;

const SALT_BYTES = 16;
const HASH_BYTES = 32;

export const LOCK_AFTER_CHOICES: readonly LockAfter[] = [0, 1, 5, 15];

/**
 * One minute, not "immediately": locking clears anything half-typed, and a
 * trip to another app to copy a phone number should not cost you the task you
 * were writing it into.
 */
export const DEFAULT_LOCK_AFTER: LockAfter = 1;

/** "immediately", "1 minute", "15 minutes" - for a sentence, not a button. */
export function lockAfterLabel(minutes: LockAfter): string {
  if (minutes === 0) return 'immediately';
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/** After this many wrong tries in a row, the keys rest for a moment. */
export const PAUSE_AFTER_MISSES = 5;
export const PAUSE_MS = 2000;

/**
 * How long to wait after a wrong try, given how many there have been in a row.
 *
 * Deliberately flat: two seconds after every fifth miss, forever. There is no
 * growing delay and no lockout, because the person most likely to be typing
 * wrong PINs is the owner on a bad day, and a lock that shuts them out for an
 * hour is worse than useless to them. Nothing about misses is ever saved.
 */
export function missPause(misses: number): number {
  return misses > 0 && misses % PAUSE_AFTER_MISSES === 0 ? PAUSE_MS : 0;
}

/**
 * Whether the browser can do what the lock needs. WebCrypto's `subtle` only
 * exists in a secure context - https, or localhost - which GitHub Pages is. If
 * it is missing, Settings says the lock is unavailable rather than failing.
 */
export function lockAvailable(): boolean {
  return (
    typeof crypto !== 'undefined' &&
    typeof crypto.getRandomValues === 'function' &&
    typeof crypto.subtle?.deriveBits === 'function' &&
    typeof crypto.subtle?.importKey === 'function'
  );
}

/** 4 to 8 digits, 0-9 only. Nothing else is a PIN. */
export function isValidPin(pin: string): boolean {
  return new RegExp(`^[0-9]{${PIN_MIN},${PIN_MAX}}$`).test(pin);
}

/** The words in a typed phrase, lowercase, in the order typed. */
function phraseWords(input: string): string[] {
  const text = input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
  return text ? text.split(' ') : [];
}

/**
 * The phrase as it is hashed: lowercase words, in alphabetical order, one
 * space apart. What was written down is what should work, however it was
 * written:
 *
 *   - anything that is not a letter is a separator, so "Otter, Bagel", extra
 *     spaces, line breaks and a numbered list copied off paper ("1. otter
 *     2. bagel") all come out the same;
 *   - order does not matter, so six words copied down in a different order are
 *     still the same six words. That costs under 10 bits, and leaves far more
 *     than anyone could ever try by typing on a lock screen (see makePhrase).
 */
export function normalisePhrase(input: string): string {
  return phraseWords(input).sort().join(' ');
}

/**
 * A look at a typed phrase before anything is hashed, so a typo gets a helpful
 * answer ("'otr' isn't one of the words") rather than a flat "wrong". Saying
 * which words are real gives nothing away: the list ships inside the app.
 */
export function checkPhrase(input: string): { words: string[]; unknown: string[] } {
  const words = phraseWords(input);
  const known = new Set(WORDS);
  return { words, unknown: words.filter((w) => !known.has(w)) };
}

/** Fills a Uint32Array with random values. The default is the browser's CSPRNG. */
export type RandomFill = (array: Uint32Array) => Uint32Array;
const secureFill: RandomFill = (array) => crypto.getRandomValues(array);

/**
 * A uniformly random whole number from 0 to n - 1.
 *
 * `random % n` alone is biased whenever n does not divide 2^32 evenly: the
 * leftover values at the top of the range fold back onto the smallest answers
 * and make them slightly more likely. So draws at or above the largest multiple
 * of n are thrown away and drawn again (rejection sampling). With 256 words
 * nothing is ever thrown away; the rule is here so the list can change size
 * without anyone having to remember this.
 */
export function randomIndex(n: number, fill: RandomFill = secureFill): number {
  if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) throw new RangeError(`Cannot pick from ${n} things.`);
  const limit = Math.floor(2 ** 32 / n) * n;
  const box = new Uint32Array(1);
  // A real random source is rejected less than half the time, so reaching the
  // end of this loop means the source is broken, not unlucky.
  for (let tries = 0; tries < 1000; tries++) {
    fill(box);
    if (box[0] < limit) return box[0] % n;
  }
  throw new Error('The random number source is not working.');
}

/**
 * Six different words from the list. Different, because a repeated word on
 * paper looks like a mistake, and someone who thinks they copied it wrong may
 * "correct" it.
 *
 * Six different words in any order is one of about 370 billion possible sets
 * (256 choose 6), a little over 38 bits. Typing guesses on a lock screen would
 * take longer than anyone has.
 */
export function makePhrase(count = PHRASE_WORDS, words: readonly string[] = WORDS, fill?: RandomFill): string[] {
  const pool = [...words];
  const out: string[] = [];
  while (out.length < count && pool.length > 0) {
    out.push(pool.splice(randomIndex(pool.length, fill), 1)[0]);
  }
  return out;
}

/**
 * Compares two byte strings without stopping at the first difference, so the
 * time it takes says nothing about how close a guess was. A JavaScript engine
 * makes no hard promise about timing, and nobody is timing a phone's lock
 * screen from outside - but an early exit is the textbook mistake, and not
 * making it costs nothing. Lengths are not secret: every hash here is 32 bytes.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The bytes, or null if the text is not base64 at all. */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** PBKDF2-SHA256 of a secret: 32 bytes. */
export async function hashSecret(
  secret: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** A fresh salt and the hash made with it, both as base64. */
async function seal(secret: string, iterations: number): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await hashSecret(secret, salt, iterations);
  return { hash: toBase64(hash), salt: toBase64(salt) };
}

async function matches(secret: string, saltText: string, hashText: string, iterations: number): Promise<boolean> {
  const salt = fromBase64(saltText);
  const expected = fromBase64(hashText);
  if (!salt || !expected) return false;
  return timingSafeEqual(await hashSecret(secret, salt, iterations), expected);
}

/**
 * Everything the lock stores, made from a PIN and a phrase. The PIN and the
 * phrase each get their own salt, so the two hashes share nothing.
 */
export async function createLock(
  pin: string,
  phrase: string,
  afterMinutes: LockAfter = DEFAULT_LOCK_AFTER,
  iterations: number = LOCK_ITERATIONS,
): Promise<AppLock> {
  if (!isValidPin(pin)) throw new RangeError('A PIN is 4 to 8 digits.');
  const words = normalisePhrase(phrase);
  if (!words) throw new RangeError('A recovery phrase needs words in it.');
  const [p, w] = await Promise.all([seal(pin, iterations), seal(words, iterations)]);
  return { pinHash: p.hash, pinSalt: p.salt, phraseHash: w.hash, phraseSalt: w.salt, iterations, afterMinutes };
}

/**
 * A new PIN on an existing lock. The phrase is untouched, and the PIN is
 * hashed with the lock's own round count, because the two share one - the
 * phrase cannot be re-hashed without knowing it.
 */
export async function withNewPin(lock: AppLock, pin: string): Promise<AppLock> {
  if (!isValidPin(pin)) throw new RangeError('A PIN is 4 to 8 digits.');
  const p = await seal(pin, lock.iterations);
  return { ...lock, pinHash: p.hash, pinSalt: p.salt };
}

/** A new recovery phrase on an existing lock. The old phrase stops working. */
export async function withNewPhrase(lock: AppLock, phrase: string): Promise<AppLock> {
  const words = normalisePhrase(phrase);
  if (!words) throw new RangeError('A recovery phrase needs words in it.');
  const w = await seal(words, lock.iterations);
  return { ...lock, phraseHash: w.hash, phraseSalt: w.salt };
}

export async function verifyPin(lock: AppLock, pin: string): Promise<boolean> {
  // Not a secret whether it has the right shape, so no need to hash to say no.
  if (!isValidPin(pin)) return false;
  return matches(pin, lock.pinSalt, lock.pinHash, lock.iterations);
}

export async function verifyPhrase(lock: AppLock, phrase: string): Promise<boolean> {
  const words = normalisePhrase(phrase);
  if (!words) return false;
  return matches(words, lock.phraseSalt, lock.phraseHash, lock.iterations);
}

/**
 * Whether Steady should be locked on coming back, given when it went out of
 * sight. "Immediately" is 0 minutes, so it is always true.
 *
 * Wall-clock time on purpose. `performance.now()` is steadier, but on Android
 * it can stop counting while the phone is asleep, and ten minutes asleep in a
 * pocket is exactly the time that must count.
 *
 * A clock that has gone backwards, or a reading that makes no sense, locks
 * rather than leaves the screen open: one extra PIN is a nuisance, a skipped
 * one is not what was asked for.
 */
export function shouldLock(hiddenAt: number, now: number, afterMinutes: number): boolean {
  const away = now - hiddenAt;
  if (!Number.isFinite(away) || away < 0) return true;
  return away >= afterMinutes * 60_000;
}

/**
 * The stored lock, checked over before anything trusts it. Returns null if it
 * is missing or damaged.
 *
 * Damaged means no lock, which is failing OPEN, and that is deliberate. A lock
 * that cannot be checked could never be opened again - the PIN would be useless
 * and so would the phrase - and a forgotten PIN must never cost anyone their
 * data. The only way to damage it is from the developer tools, and anyone there
 * can already read everything the lock was hiding.
 */
export function readLock(value: unknown): AppLock | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const bytes = (field: string, length: number) =>
    typeof v[field] === 'string' && fromBase64(v[field] as string)?.length === length;
  if (!bytes('pinHash', HASH_BYTES) || !bytes('phraseHash', HASH_BYTES)) return null;
  if (!bytes('pinSalt', SALT_BYTES) || !bytes('phraseSalt', SALT_BYTES)) return null;
  const iterations = v.iterations;
  if (typeof iterations !== 'number' || !Number.isInteger(iterations)) return null;
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) return null;
  // An unreadable timing is not a reason to drop the lock, just to use the
  // strictest one.
  const afterMinutes = LOCK_AFTER_CHOICES.includes(v.afterMinutes as LockAfter) ? (v.afterMinutes as LockAfter) : 0;
  return {
    pinHash: v.pinHash as string,
    pinSalt: v.pinSalt as string,
    phraseHash: v.phraseHash as string,
    phraseSalt: v.phraseSalt as string,
    iterations,
    afterMinutes,
  };
}
