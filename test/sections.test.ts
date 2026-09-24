import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FOLDS, FOLD_IDS, countOf, cutTitle, isFoldId, isOpen, nameList, withFold, type FoldId } from '../src/lib/sections';

/**
 * The fold registry is the one place a section's starting state lives, and
 * the saved map is a preference on somebody's phone. These hold both to the
 * rules that make them safe to keep: every id is real and used, a saved map
 * never grows past what differs from the start, and nothing a section is not
 * allowed to remember is ever remembered.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** Every source file except the registry itself, read once. */
const sources: { path: string; text: string }[] = (() => {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name) && !path.endsWith(join('lib', 'sections.ts'))) {
        out.push({ path, text: readFileSync(path, 'utf8') });
      }
    }
  };
  walk(SRC);
  return out;
})();

describe('the registry', () => {
  it('names each id once, as screen.section in plain lowercase words', () => {
    expect(new Set(FOLD_IDS).size).toBe(FOLD_IDS.length);
    for (const id of FOLD_IDS) expect(id).toMatch(/^[a-z]+\.[a-z][a-zA-Z]*$/);
  });

  it('gives every id a starting state and a kind of memory', () => {
    for (const id of FOLD_IDS) {
      expect(typeof FOLDS[id].open, id).toBe('boolean');
      expect(['remember', 'visit'], id).toContain(FOLDS[id].memory);
    }
  });

  it('starts every Settings group and About section closed, and forgets them on leaving', () => {
    const visits = FOLD_IDS.filter((id) => id.startsWith('settings.') || id.startsWith('about.'));
    expect(visits.length).toBeGreaterThan(0);
    for (const id of visits) expect(FOLDS[id], id).toEqual({ open: false, memory: 'visit' });
  });

  it('remembers the screens you glance at, keeping open what used to be open', () => {
    for (const id of ['today.waiting', 'today.bills', 'today.nextPayday', 'today.loose', 'backlog.routines'] as FoldId[]) {
      expect(FOLDS[id], id).toEqual({ open: true, memory: 'remember' });
    }
    // Behind a "Show" button before, so closed to start with now.
    for (const id of ['inbox.cleared', 'backlog.finished', 'money.averages'] as FoldId[]) {
      expect(FOLDS[id], id).toEqual({ open: false, memory: 'remember' });
    }
    // The Debt tab: the plan and the list open; looking back and the reference closed.
    for (const id of ['debt.plan', 'debt.list'] as FoldId[]) {
      expect(FOLDS[id], id).toEqual({ open: true, memory: 'remember' });
    }
    for (const id of ['debt.paidOff', 'debt.howItWorks'] as FoldId[]) {
      expect(FOLDS[id], id).toEqual({ open: false, memory: 'remember' });
    }
  });

  it('uses every id somewhere in the app, so none is left behind', () => {
    for (const id of FOLD_IDS) {
      const quoted = new RegExp(`['"\`]${id.replace('.', '\\.')}['"\`]`);
      expect(
        sources.some((file) => quoted.test(file.text)),
        `${id} is in the registry but no screen uses it`,
      ).toBe(true);
    }
  });

  it('gives each id to one section only', () => {
    for (const id of FOLD_IDS) {
      const uses = sources.flatMap((file) => file.text.match(new RegExp(`collapsible="${id.replace('.', '\\.')}"`, 'g')) ?? []);
      expect(uses.length, `${id} is the collapsible of ${uses.length} sections`).toBeLessThanOrEqual(1);
    }
  });

  it('knows its own ids and no others', () => {
    expect(isFoldId('today.waiting')).toBe(true);
    expect(isFoldId('today.nothing')).toBe(false);
    expect(isFoldId('toString')).toBe(false);
    expect(isFoldId('__proto__')).toBe(false);
  });
});

describe('isOpen', () => {
  it('starts every section the way the registry says', () => {
    for (const id of FOLD_IDS) expect(isOpen(id), id).toBe(FOLDS[id].open);
    for (const id of FOLD_IDS) expect(isOpen(id, {}), id).toBe(FOLDS[id].open);
  });

  it('follows what you chose for a remembered section', () => {
    expect(isOpen('today.waiting', { 'today.waiting': false })).toBe(false);
    expect(isOpen('inbox.cleared', { 'inbox.cleared': true })).toBe(true);
  });

  it('starts a Settings group closed whatever the saved map says', () => {
    expect(isOpen('settings.lock', { 'settings.lock': true })).toBe(false);
    expect(isOpen('about.updates', { 'about.updates': true })).toBe(false);
  });

  it('ignores ids it does not know and values that are not true or false', () => {
    const stored = { 'today.nothing': false, 'today.waiting': 'no' } as unknown as Record<string, boolean>;
    expect(isOpen('today.waiting', stored)).toBe(true);
  });
});

describe('withFold', () => {
  it('stores a change from how a section starts', () => {
    expect(withFold(undefined, 'today.waiting', false)).toEqual({ 'today.waiting': false });
    expect(withFold(undefined, 'money.averages', true)).toEqual({ 'money.averages': true });
  });

  it('never stores a section the way it starts', () => {
    expect(withFold(undefined, 'today.waiting', true)).toEqual({});
    expect(withFold(undefined, 'money.averages', false)).toEqual({});
    for (const id of FOLD_IDS) expect(withFold(undefined, id, FOLDS[id].open), id).toEqual({});
  });

  it('forgets a change once the section is put back', () => {
    const closed = withFold(undefined, 'today.bills', false);
    expect(withFold(closed, 'today.bills', true)).toEqual({});
  });

  it('keeps the other sections you changed', () => {
    const one = withFold(undefined, 'today.bills', false);
    const two = withFold(one, 'money.income', false);
    expect(two).toEqual({ 'today.bills': false, 'money.income': false });
    expect(withFold(two, 'today.bills', true)).toEqual({ 'money.income': false });
  });

  it('drops ids it does not know, defaults, and anything that is not true or false', () => {
    const messy = {
      'today.nothing': false,
      'today.waiting': true,
      'money.income': 'closed',
      'money.paychecks': false,
    } as unknown as Record<string, boolean>;
    expect(withFold(messy, 'inbox.cleared', true)).toEqual({ 'money.paychecks': false, 'inbox.cleared': true });
  });

  it('never stores a Settings group or About, which start closed on every visit', () => {
    expect(withFold(undefined, 'settings.lock', true)).toEqual({});
    expect(withFold({ 'settings.backup': true } as Record<string, boolean>, 'today.loose', false)).toEqual({
      'today.loose': false,
    });
  });

  it('leaves the map it was given alone', () => {
    const stored = { 'today.bills': false };
    withFold(stored, 'today.bills', true);
    expect(stored).toEqual({ 'today.bills': false });
  });
});

describe('words for a folded line', () => {
  it('keeps a short title as it is, tidied', () => {
    expect(cutTitle('  Leaving   the house ')).toBe('Leaving the house');
  });

  it('cuts a long title at a word, to about 32 characters, and says so', () => {
    const cut = cutTitle('Add a low day, appointment prep, reusable checklists and an optional app lock');
    expect(cut).toBe('Add a low day, appointment prep…');
    expect(cut.length).toBeLessThanOrEqual(33);
  });

  it('cuts a title with no break in reach mid-word rather than to almost nothing', () => {
    expect(cutTitle('Supercalifragilisticexpialidocious-and-then-some')).toBe('Supercalifragilisticexpialidocio…');
  });

  it('names one, two, or two and how many more', () => {
    expect(nameList([])).toBe('');
    expect(nameList(['Leaving the house'])).toBe('Leaving the house');
    expect(nameList(['Leaving the house', 'Weekly shop'])).toBe('Leaving the house and Weekly shop');
    expect(nameList(['Leaving the house', 'Weekly shop', 'Bedtime'])).toBe('Leaving the house, Weekly shop and 1 more');
    expect(nameList(['A', 'B', 'C', 'D', 'E'])).toBe('A, B and 3 more');
  });

  it('counts in the singular for one', () => {
    expect(countOf(1, 'task', 'tasks')).toBe('1 task');
    expect(countOf(2, 'task', 'tasks')).toBe('2 tasks');
    expect(countOf(0, 'task', 'tasks')).toBe('0 tasks');
  });
});
