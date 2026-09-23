import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LOCK_AFTER,
  LOCK_AFTER_CHOICES,
  LOCK_ITERATIONS,
  MIN_ITERATIONS,
  PAUSE_MS,
  PHRASE_WORDS,
  checkPhrase,
  createLock,
  fromBase64,
  isValidPin,
  lockAfterLabel,
  lockAvailable,
  makePhrase,
  missPause,
  normalisePhrase,
  randomIndex,
  readLock,
  shouldLock,
  timingSafeEqual,
  toBase64,
  verifyPhrase,
  verifyPin,
  withNewPhrase,
  withNewPin,
  type RandomFill,
} from '../src/lib/lock';
import { WORDS } from '../src/lib/wordlist';

/**
 * The app lock hides the screen; it does not encrypt anything. What these
 * tests hold it to is the part that has to be exactly right anyway: that the
 * PIN is never stored, that a right answer opens and a wrong one does not,
 * that a forgotten PIN has a way back, and that the timing does what the
 * setting says.
 *
 * Most tests hash with the minimum round count rather than the shipped one,
 * because the answer is the same and the suite should stay quick. One test
 * uses the real count, so the shipped setting is exercised too.
 */

const PIN = '2468';
const PHRASE = 'otter bagel lantern maple quilt robin';
const MINUTE = 60_000;

/** A lock made quickly, for tests about behaviour rather than cost. */
const quickLock = (pin = PIN, phrase = PHRASE) => createLock(pin, phrase, DEFAULT_LOCK_AFTER, MIN_ITERATIONS);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a PIN', () => {
  it('is 4 to 8 digits', () => {
    for (const pin of ['0000', '1234', '24680', '123456', '1234567', '12345678']) expect(isValidPin(pin), pin).toBe(true);
  });

  it('is nothing else', () => {
    for (const pin of ['', '123', '123456789', '12a4', ' 1234', '1234 ', '12.34', '-1234', '١٢٣٤', '１２３４']) {
      expect(isValidPin(pin), JSON.stringify(pin)).toBe(false);
    }
  });
});

describe('what is stored', () => {
  it('is exactly the six fields the lock needs, and never the PIN or the phrase', async () => {
    const lock = await quickLock();
    expect(Object.keys(lock).sort()).toEqual(
      ['afterMinutes', 'iterations', 'phraseHash', 'phraseSalt', 'pinHash', 'pinSalt'].sort(),
    );
    const stored = JSON.stringify(lock);
    expect(stored).not.toContain(PIN);
    for (const word of PHRASE.split(' ')) expect(stored).not.toContain(word);
  });

  it('uses 16-byte salts and 32-byte hashes', async () => {
    const lock = await quickLock();
    expect(fromBase64(lock.pinSalt)).toHaveLength(16);
    expect(fromBase64(lock.phraseSalt)).toHaveLength(16);
    expect(fromBase64(lock.pinHash)).toHaveLength(32);
    expect(fromBase64(lock.phraseHash)).toHaveLength(32);
  });

  it('ships with at least 210,000 rounds, and records the count it used', async () => {
    expect(MIN_ITERATIONS).toBeGreaterThanOrEqual(210_000);
    expect(LOCK_ITERATIONS).toBeGreaterThanOrEqual(MIN_ITERATIONS);
    const lock = await createLock(PIN, PHRASE);
    expect(lock.iterations).toBe(LOCK_ITERATIONS);
    expect(await verifyPin(lock, PIN)).toBe(true);
  });

  it('is PBKDF2-SHA256 of the PIN with the stored salt - checked independently of the app code', async () => {
    const lock = await quickLock();
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(PIN), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(lock.pinSalt)!, iterations: lock.iterations },
      key,
      256,
    );
    expect(toBase64(new Uint8Array(bits))).toBe(lock.pinHash);
  });

  it('gets a new salt every time, so the same PIN never stores the same way twice', async () => {
    const [a, b] = await Promise.all([quickLock(), quickLock()]);
    expect(a.pinSalt).not.toBe(b.pinSalt);
    expect(a.pinHash).not.toBe(b.pinHash);
    expect(a.phraseSalt).not.toBe(b.phraseSalt);
    expect(a.phraseHash).not.toBe(b.phraseHash);
    // And the PIN and the phrase never share one.
    expect(a.pinSalt).not.toBe(a.phraseSalt);
  });

  it('refuses to make a lock from a PIN that is not one, or an empty phrase', async () => {
    await expect(createLock('123', PHRASE, 1, MIN_ITERATIONS)).rejects.toThrow(RangeError);
    await expect(createLock(PIN, '  ,, ', 1, MIN_ITERATIONS)).rejects.toThrow(RangeError);
  });
});

describe('checking a PIN', () => {
  it('opens with the right one', async () => {
    expect(await verifyPin(await quickLock(), PIN)).toBe(true);
  });

  it('stays shut for a wrong one, however close', async () => {
    const lock = await quickLock();
    for (const wrong of ['2469', '8642', '246', '24680', '0000', '', 'abcd']) {
      expect(await verifyPin(lock, wrong), wrong).toBe(false);
    }
  });

  it('says no to a damaged record rather than throwing', async () => {
    const lock = await quickLock();
    expect(await verifyPin({ ...lock, pinSalt: '%%%' }, PIN)).toBe(false);
    expect(await verifyPin({ ...lock, pinHash: toBase64(new Uint8Array(32)) }, PIN)).toBe(false);
  });
});

describe('the recovery phrase', () => {
  it('opens with the right words', async () => {
    expect(await verifyPhrase(await quickLock(), PHRASE)).toBe(true);
  });

  it('forgives capitals, extra spaces, commas, line breaks, numbering and order', async () => {
    const lock = await quickLock();
    for (const typed of [
      'OTTER BAGEL LANTERN MAPLE QUILT ROBIN',
      '  otter   bagel\tlantern\nmaple  quilt robin  ',
      'Otter, Bagel, Lantern, Maple, Quilt, Robin.',
      '1. otter 2. bagel 3. lantern 4. maple 5. quilt 6. robin',
      'robin quilt maple lantern bagel otter',
    ]) {
      expect(await verifyPhrase(lock, typed), typed).toBe(true);
    }
  });

  it('stays shut for the wrong words', async () => {
    const lock = await quickLock();
    for (const wrong of ['otter bagel lantern maple quilt raven', 'otter bagel lantern maple quilt', '', PIN]) {
      expect(await verifyPhrase(lock, wrong), wrong).toBe(false);
    }
  });

  it('normalises to lowercase words, one space apart, in a fixed order', () => {
    expect(normalisePhrase('  Otter,  BAGEL\n\n2. lantern ')).toBe('bagel lantern otter');
    expect(normalisePhrase('')).toBe('');
    expect(normalisePhrase(' 1. 2. , ')).toBe('');
  });

  it('points at a word that is not on the list, before spending a guess on it', () => {
    expect(checkPhrase('otter bagle lantern maple quilt robin')).toEqual({
      words: ['otter', 'bagle', 'lantern', 'maple', 'quilt', 'robin'],
      unknown: ['bagle'],
    });
    expect(checkPhrase(PHRASE).unknown).toEqual([]);
    expect(checkPhrase('otter bagel').words).toHaveLength(2);
  });

  it('is six different words from the list', () => {
    for (let i = 0; i < 50; i++) {
      const words = makePhrase();
      expect(words).toHaveLength(PHRASE_WORDS);
      expect(new Set(words).size).toBe(PHRASE_WORDS);
      for (const word of words) expect(WORDS).toContain(word);
    }
  });

  it('comes from the random source it is given', () => {
    const zeros: RandomFill = (array) => array.fill(0);
    // Always the first word left in the pool, so the first six of the list.
    expect(makePhrase(PHRASE_WORDS, WORDS, zeros)).toEqual(WORDS.slice(0, PHRASE_WORDS));
  });
});

describe('changing the lock', () => {
  it('a new PIN keeps the phrase, and the old PIN stops working', async () => {
    const before = await quickLock();
    const after = await withNewPin(before, '97531');
    expect(after.phraseHash).toBe(before.phraseHash);
    expect(after.phraseSalt).toBe(before.phraseSalt);
    expect(after.pinSalt).not.toBe(before.pinSalt);
    expect(await verifyPin(after, '97531')).toBe(true);
    expect(await verifyPin(after, PIN)).toBe(false);
    expect(await verifyPhrase(after, PHRASE)).toBe(true);
    await expect(withNewPin(before, '12')).rejects.toThrow(RangeError);
  });

  it('a new phrase keeps the PIN, and the old phrase stops working', async () => {
    const before = await quickLock();
    const fresh = makePhrase().join(' ');
    const after = await withNewPhrase(before, fresh);
    expect(after.pinHash).toBe(before.pinHash);
    expect(await verifyPin(after, PIN)).toBe(true);
    expect(await verifyPhrase(after, fresh)).toBe(true);
    expect(await verifyPhrase(after, PHRASE)).toBe(false);
  });

  it('keeps using the round count the lock was made with', async () => {
    const before = await quickLock();
    const after = await withNewPin(before, '1357');
    expect(after.iterations).toBe(MIN_ITERATIONS);
    expect(await verifyPin(after, '1357')).toBe(true);
  });
});

describe('picking words without bias', () => {
  /** A random source that hands out these values in turn, and counts them. */
  function scripted(values: number[]): RandomFill & { used: number } {
    const fill = ((array: Uint32Array) => {
      array[0] = values[fill.used++];
      return array;
    }) as RandomFill & { used: number };
    fill.used = 0;
    return fill;
  }

  it('throws away a draw from the uneven top of the range and draws again', () => {
    // 2^32 is not a multiple of 3: the largest multiple is 4294967295, and a
    // draw at or above it would make 0 a shade more likely than 1 or 2.
    const fill = scripted([4294967295, 4294967294]);
    expect(randomIndex(3, fill)).toBe(4294967294 % 3);
    expect(fill.used).toBe(2);
  });

  it('keeps every draw below the cut-off', () => {
    // For 6 the cut-off is 4294967292: the four values above it are refused.
    const fill = scripted([4294967292, 4294967293, 4294967294, 4294967295, 4294967291]);
    expect(randomIndex(6, fill)).toBe(4294967291 % 6);
    expect(fill.used).toBe(5);
  });

  it('never needs to throw anything away for 256 words', () => {
    const fill = scripted([0xffffffff]);
    expect(randomIndex(256, fill)).toBe(255);
    expect(fill.used).toBe(1);
  });

  it('comes out even over many real draws', () => {
    const counts = new Array(6).fill(0);
    const draws = 60_000;
    for (let i = 0; i < draws; i++) counts[randomIndex(6)] += 1;
    // 10,000 each expected; the bound is more than 5 standard deviations wide.
    for (const n of counts) expect(Math.abs(n - draws / 6)).toBeLessThan(500);
  });

  it('gives up on a random source that never produces a usable value, rather than hanging', () => {
    expect(() => randomIndex(3, (array) => array.fill(0xffffffff))).toThrow(/not working/);
  });

  it('refuses a range that makes no sense', () => {
    expect(() => randomIndex(0)).toThrow(RangeError);
    expect(() => randomIndex(2.5)).toThrow(RangeError);
  });
});

describe('the word list', () => {
  it('has exactly 256 words, all different', () => {
    expect(WORDS).toHaveLength(256);
    expect(new Set(WORDS).size).toBe(256);
  });

  it('is plain lowercase words of 3 to 7 letters, in alphabetical order', () => {
    for (const word of WORDS) expect(word).toMatch(/^[a-z]{3,7}$/);
    expect([...WORDS].sort()).toEqual([...WORDS]);
  });

  it('has no word that is the start of another', () => {
    const clashes = WORDS.flatMap((a) => WORDS.filter((b) => a !== b && b.startsWith(a)).map((b) => `${a}/${b}`));
    expect(clashes).toEqual([]);
  });

  it('leaves out words that sound like other words, so none can be written down wrong', () => {
    const soundAlikes = ['bear', 'bare', 'pear', 'pair', 'flour', 'flower', 'beach', 'beech', 'creek', 'creak',
      'carrot', 'carat', 'hole', 'whole', 'night', 'knight', 'tail', 'tale', 'sail', 'sale', 'rain', 'reign',
      'rose', 'rows', 'deer', 'dear', 'coral', 'canvas', 'pigeon', 'whale', 'horse', 'toad', 'wood'];
    expect(WORDS.filter((w) => soundAlikes.includes(w))).toEqual([]);
  });
});

describe('when to lock', () => {
  const hidden = new Date(2026, 8, 23, 9, 0).getTime();

  it('offers immediately, 1, 5 and 15 minutes, and starts at 1', () => {
    expect([...LOCK_AFTER_CHOICES]).toEqual([0, 1, 5, 15]);
    expect(DEFAULT_LOCK_AFTER).toBe(1);
  });

  it('immediately means the moment it goes out of sight', () => {
    expect(shouldLock(hidden, hidden, 0)).toBe(true);
    expect(shouldLock(hidden, hidden + 1, 0)).toBe(true);
  });

  it('waits the whole of the chosen time, and not a moment longer', () => {
    for (const minutes of [1, 5, 15]) {
      expect(shouldLock(hidden, hidden + minutes * MINUTE - 1, minutes), `${minutes} min, just before`).toBe(false);
      expect(shouldLock(hidden, hidden + minutes * MINUTE, minutes), `${minutes} min, exactly`).toBe(true);
      expect(shouldLock(hidden, hidden + 3 * 60 * MINUTE, minutes), `${minutes} min, hours later`).toBe(true);
    }
  });

  it('a quick trip to another app does not lock', () => {
    expect(shouldLock(hidden, hidden + 20_000, 1)).toBe(false);
  });

  it('locks if the clock has gone backwards or makes no sense', () => {
    expect(shouldLock(hidden, hidden - MINUTE, 15)).toBe(true);
    expect(shouldLock(Number.NaN, hidden, 15)).toBe(true);
    expect(shouldLock(hidden, Number.POSITIVE_INFINITY, 15)).toBe(true);
  });

  it('says the timing in words', () => {
    expect(lockAfterLabel(0)).toBe('immediately');
    expect(lockAfterLabel(1)).toBe('1 minute');
    expect(lockAfterLabel(15)).toBe('15 minutes');
  });
});

describe('wrong tries', () => {
  it('rest the keys for two seconds after every fifth miss in a row', () => {
    expect([1, 2, 3, 4].map(missPause)).toEqual([0, 0, 0, 0]);
    expect(missPause(5)).toBe(PAUSE_MS);
    expect(PAUSE_MS).toBe(2000);
    expect([6, 7, 8, 9].map(missPause)).toEqual([0, 0, 0, 0]);
    expect(missPause(10)).toBe(PAUSE_MS);
  });

  it('never escalate: the pause is the same two seconds however many misses there have been', () => {
    for (const misses of [5, 50, 500, 5000]) expect(missPause(misses)).toBe(2000);
    expect(missPause(0)).toBe(0);
  });
});

describe('comparing hashes', () => {
  const bytes = (...values: number[]) => new Uint8Array(values);

  it('says equal only for the same bytes', () => {
    expect(timingSafeEqual(bytes(1, 2, 3), bytes(1, 2, 3))).toBe(true);
    expect(timingSafeEqual(bytes(), bytes())).toBe(true);
    expect(timingSafeEqual(bytes(9, 2, 3), bytes(1, 2, 3))).toBe(false);
    expect(timingSafeEqual(bytes(1, 2, 3), bytes(1, 2, 4))).toBe(false);
    expect(timingSafeEqual(bytes(1, 2), bytes(1, 2, 3))).toBe(false);
  });

  it('reads every byte even when the very first one differs - no early exit', () => {
    let reads = 0;
    const counted = (array: Uint8Array) =>
      new Proxy(array, {
        get(target, key) {
          if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
          return Reflect.get(target, key);
        },
      });
    const a = new Uint8Array(32).fill(7);
    const b = new Uint8Array(32).fill(7);
    b[0] = 8;
    expect(timingSafeEqual(counted(a), counted(b))).toBe(false);
    expect(reads).toBe(64);
  });
});

describe('reading a stored lock', () => {
  it('passes a sound one through as it is', async () => {
    const lock = await quickLock();
    expect(readLock(lock)).toEqual(lock);
  });

  it('keeps only the six fields, whatever else is stored beside them', async () => {
    const lock = await quickLock();
    expect(readLock({ ...lock, pin: PIN })).toEqual(lock);
  });

  it('treats missing or damaged as no lock, so nobody is shut out for good', async () => {
    const lock = await quickLock();
    const damaged: unknown[] = [
      undefined,
      null,
      'lock',
      {},
      { ...lock, pinHash: undefined },
      { ...lock, phraseHash: 'not base64 at all!' },
      { ...lock, pinSalt: toBase64(new Uint8Array(8)) },
      { ...lock, iterations: MIN_ITERATIONS - 1 },
      { ...lock, iterations: 1e12 },
      { ...lock, iterations: 250_000.5 },
      { ...lock, iterations: '600000' },
    ];
    for (const value of damaged) expect(readLock(value), JSON.stringify(value)).toBeNull();
  });

  it('keeps the lock but uses the strictest timing when the timing is unreadable', async () => {
    const lock = await quickLock();
    expect(readLock({ ...lock, afterMinutes: 7 })?.afterMinutes).toBe(0);
    expect(readLock({ ...lock, afterMinutes: undefined })?.afterMinutes).toBe(0);
    expect(readLock({ ...lock, afterMinutes: 15 })?.afterMinutes).toBe(15);
  });
});

describe('where the lock can be offered', () => {
  it('is available where WebCrypto is', () => {
    expect(lockAvailable()).toBe(true);
  });

  it('is not offered where crypto.subtle is missing, as it is outside a secure context', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    expect(lockAvailable()).toBe(false);
  });
});

describe('base64', () => {
  it('round-trips every byte value', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(fromBase64(toBase64(all))).toEqual(all);
  });

  it('returns null for text that is not base64', () => {
    expect(fromBase64('***')).toBeNull();
  });
});
