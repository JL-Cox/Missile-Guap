import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PAGES,
  PAGE_IDS,
  ZONES,
  firstZone,
  hasZones,
  isPageId,
  isZoneOf,
  remembersZone,
  withZone,
  zoneFor,
  type ZonedPage,
} from '../src/lib/zones';
import { DEVICE_SETTINGS, withoutDeviceSettings } from '../src/lib/backup';

/**
 * The page and zone registry is the one place the Menu's order and each
 * bottom bar's zones live, and the zone a page was left on is a preference on
 * somebody's phone. These hold both to the rules that make them safe: fixed
 * words, a bar that fits a small phone at large text, every zone really drawn
 * by its page, and a saved map that never grows past what differs from the
 * start.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** Every source file except the registry itself, read once. */
const sources: { path: string; text: string }[] = (() => {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name) && !path.endsWith(join('lib', 'zones.ts'))) {
        out.push({ path, text: readFileSync(path, 'utf8') });
      }
    }
  };
  walk(SRC);
  return out;
})();

const ZONED = Object.keys(ZONES) as ZonedPage[];

/** The view file that draws a page. Debt's is DebtScreen in Debt.tsx. */
const viewOf = (page: ZonedPage) => {
  const file = sources.find((s) => s.path.endsWith(join('views', `${page[0].toUpperCase()}${page.slice(1)}.tsx`)));
  if (!file) throw new Error(`no view file for ${page}`);
  return file.text;
};

describe('the Menu', () => {
  it('lists nine pages in a fixed order', () => {
    expect(PAGE_IDS.join(' ')).toBe('today inbox tasks backlog notes debt money settings about');
    expect(PAGES.map((p) => p.title).join(' ')).toBe('Today Inbox Tasks Backlog Notes Debt Money Settings About');
  });

  it('in three groups: the lists, the money pages, and the app\'s own pages', () => {
    expect(PAGES.map((p) => p.group).join('')).toBe('000001122');
  });

  it('keeps the old nav glyphs on the working pages, and none on Settings and About', () => {
    expect(PAGES.map((p) => p.glyph).join(' ')).toBe('◎ ↓ ✓ ◇ ≡ ◔ $  ');
  });

  it('knows its own pages and no others', () => {
    for (const id of PAGE_IDS) expect(isPageId(id)).toBe(true);
    expect(isPageId('lock')).toBe(false);
    expect(isPageId('toString')).toBe(false);
  });
});

describe('the zones', () => {
  it('belong to the seven working pages, and not to Settings or About', () => {
    expect(ZONED.join(' ')).toBe('today inbox tasks backlog notes debt money');
    expect(hasZones('settings')).toBe(false);
    expect(hasZones('about')).toBe(false);
    expect(hasZones('__proto__')).toBe(false);
    expect(hasZones('toString')).toBe(false);
  });

  it('are two to four a page, so the bar fits a 360px phone at large text', () => {
    for (const page of ZONED) {
      expect(ZONES[page].length, page).toBeGreaterThanOrEqual(2);
      expect(ZONES[page].length, page).toBeLessThanOrEqual(4);
    }
  });

  it('have ids that are plain lowercase words, each once per page', () => {
    for (const page of ZONED) {
      const ids = ZONES[page].map((z) => z.id);
      expect(new Set(ids).size, page).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z]+$/);
    }
  });

  it('have labels of 13 characters or fewer, each once per page', () => {
    for (const page of ZONED) {
      const labels = ZONES[page].map((z) => z.label);
      expect(new Set(labels).size, page).toBe(labels.length);
      for (const label of labels) expect(label.length, label).toBeLessThanOrEqual(13);
    }
  });

  it('are each drawn exactly once by their own page, as <Zone id="...">', () => {
    for (const page of ZONED) {
      const text = viewOf(page);
      for (const { id } of ZONES[page]) {
        const uses = text.match(new RegExp(`<Zone id="${id}"`, 'g')) ?? [];
        expect(uses.length, `${page} draws zone "${id}" ${uses.length} times`).toBe(1);
      }
      const drawn = [...text.matchAll(/<Zone id="([a-z]+)"/g)].map((m) => m[1]);
      expect(drawn.sort(), page).toEqual(ZONES[page].map((z) => z.id).sort());
    }
  });

  it('start each page on its first zone', () => {
    expect(firstZone('today')).toBe('day');
    expect(firstZone('money')).toBe('soon');
    expect(firstZone('debt')).toBe('paychecks');
    for (const page of ZONED) expect(firstZone(page)).toBe(ZONES[page][0].id);
  });

  it("knows a page's own zones and no others", () => {
    expect(isZoneOf('money', 'subscriptions')).toBe(true);
    expect(isZoneOf('money', 'plan')).toBe(false);
    expect(isZoneOf('debt', 'plan')).toBe(true);
    expect(isZoneOf('money', undefined)).toBe(false);
    expect(isZoneOf('money', 3)).toBe(false);
  });
});

describe('zoneFor', () => {
  it('opens a page on its first zone when nothing is saved', () => {
    for (const page of ZONED) {
      expect(zoneFor(page), page).toBe(firstZone(page));
      expect(zoneFor(page, {}), page).toBe(firstZone(page));
    }
  });

  it('opens a page on the zone it was left on', () => {
    expect(zoneFor('money', { money: 'subscriptions' })).toBe('subscriptions');
    expect(zoneFor('debt', { money: 'subscriptions', debt: 'plan' })).toBe('plan');
  });

  it('always opens Today on today, whatever is saved', () => {
    expect(remembersZone('today')).toBe(false);
    expect(zoneFor('today', { today: 'waiting' })).toBe('day');
    for (const page of ZONED.filter((p) => p !== 'today')) expect(remembersZone(page), page).toBe(true);
  });

  it('falls back to the first zone for anything it does not know', () => {
    const messy = { money: 'plan', debt: 7, tasks: 'Search', notes: '__proto__' } as unknown as Record<string, string>;
    expect(zoneFor('money', messy)).toBe('soon');
    expect(zoneFor('debt', messy)).toBe('paychecks');
    expect(zoneFor('tasks', messy)).toBe('dated');
    expect(zoneFor('notes', messy)).toBe('all');
  });
});

describe('withZone', () => {
  it('stores a zone that is not the first', () => {
    expect(withZone(undefined, 'money', 'subscriptions')).toEqual({ money: 'subscriptions' });
  });

  it('never stores a first zone', () => {
    for (const page of ZONED) expect(withZone(undefined, page, firstZone(page)), page).toEqual({});
    expect(withZone({ money: 'income' }, 'money', 'soon')).toEqual({});
  });

  it("never stores Today's zone", () => {
    expect(withZone(undefined, 'today', 'waiting')).toEqual({});
    expect(withZone({ today: 'money' } as Record<string, string>, 'debt', 'plan')).toEqual({ debt: 'plan' });
  });

  it('keeps the other pages you left on another zone', () => {
    const one = withZone(undefined, 'money', 'income');
    const two = withZone(one, 'debt', 'debts');
    expect(two).toEqual({ money: 'income', debt: 'debts' });
    expect(withZone(two, 'money', 'soon')).toEqual({ debt: 'debts' });
  });

  it('drops unknown pages, unknown zones, first zones and anything that is not a word', () => {
    const messy = {
      lock: 'open',
      settings: 'look',
      money: 'plan',
      debt: 'paychecks',
      inbox: 3,
      notes: 'search',
    } as unknown as Record<string, string>;
    expect(withZone(messy, 'tasks', 'finished')).toEqual({ notes: 'search', tasks: 'finished' });
  });

  it('ignores a zone that is not the page\'s own', () => {
    expect(withZone({ money: 'income' }, 'money', 'plan')).toEqual({});
  });

  it('leaves the map it was given alone', () => {
    const stored = { money: 'income' };
    withZone(stored, 'money', 'soon');
    expect(stored).toEqual({ money: 'income' });
  });
});

describe('where the zones are kept', () => {
  it('is a preference that travels in backups, not a device-only setting', () => {
    expect([...DEVICE_SETTINGS]).not.toContain('zones');
    const zones = { money: 'subscriptions' };
    expect(withoutDeviceSettings({ theme: 'calm', zones }).zones).toEqual(zones);
  });
});
