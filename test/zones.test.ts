import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HUB, PAGES, PAGE_IDS, ZONES, firstZone, hasZones, isPageId, isZoneOf, zoneLabel, type ZonedPage } from '../src/lib/zones';

/**
 * The page and zone registry is the one place the Menu's order and each
 * page's zones live. These hold it to the rules that make it safe: fixed
 * words, a page's cards that fit two rows, and every zone really drawn by
 * its page, with the page's overview drawn once.
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
  it('lists ten pages in a fixed order, Home first', () => {
    expect(PAGE_IDS.join(' ')).toBe('home today inbox tasks backlog notes debt money settings about');
    expect(PAGES.map((p) => p.title).join(' ')).toBe('Home Today Inbox Tasks Backlog Notes Debt Money Settings About');
  });

  it("in four groups: Home, the lists, the money pages, and the app's own pages", () => {
    expect(PAGES.map((p) => p.group).join('')).toBe('0111112233');
  });

  it('keeps the old nav glyphs on the working pages, and none on Settings and About', () => {
    expect(PAGES.map((p) => p.glyph).join(' ')).toBe('⊞ ◎ ↓ ✓ ◇ ≡ ◔ $  ');
  });

  it('knows its own pages and no others', () => {
    for (const id of PAGE_IDS) expect(isPageId(id)).toBe(true);
    expect(isPageId('lock')).toBe(false);
    expect(isPageId('toString')).toBe(false);
  });
});

describe('the zones', () => {
  it('belong to the seven working pages, and not to Home, Settings or About', () => {
    expect(ZONED.join(' ')).toBe('today inbox tasks backlog notes debt money');
    expect(hasZones('home')).toBe(false);
    expect(hasZones('settings')).toBe(false);
    expect(hasZones('about')).toBe(false);
    expect(hasZones('__proto__')).toBe(false);
    expect(hasZones('toString')).toBe(false);
  });

  it('are two to four a page, so a page\'s cards are at most two rows', () => {
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

  it('never use the overview\'s id', () => {
    for (const page of ZONED) expect(isZoneOf(page, HUB), page).toBe(false);
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

  it('have a first, which each page lists first', () => {
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

describe("each page's overview", () => {
  it('is drawn exactly once by its page, as <Hub', () => {
    for (const page of ZONED) {
      const uses = viewOf(page).match(/<Hub\b/g) ?? [];
      expect(uses.length, page).toBe(1);
    }
  });

  it('gives each card its zone\'s own name', () => {
    expect(zoneLabel('money', 'soon')).toBe('Coming out');
    expect(zoneLabel('debt', 'plan')).toBe('Plan');
    expect(zoneLabel('money', HUB)).toBe('Money');
  });
});

describe('where you are is never saved', () => {
  it('has no code left that writes a zone to the settings', () => {
    for (const { path, text } of sources) {
      expect(/saveSettings\(\{\s*zones/.test(text), path).toBe(false);
    }
  });
});
