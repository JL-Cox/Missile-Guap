import { describe, expect, it } from 'vitest';
import {
  BILLING_DAY_CHOICES,
  categoryChoices,
  COMMON_CATEGORIES,
  cycleUnit,
  CYCLE_PRESETS,
  findCyclePreset,
  findPreset,
  matchPresets,
  SERVICE_PRESETS,
} from '../src/lib/subscriptions';
import { FREQUENCY_LABELS } from '../src/lib/pay';

describe('findPreset', () => {
  it('matches regardless of case or stray spaces', () => {
    expect(findPreset('Netflix')?.category).toBe('TV & film');
    expect(findPreset('netflix')?.category).toBe('TV & film');
    expect(findPreset('  NETFLIX ')?.category).toBe('TV & film');
  });

  it('returns nothing for something it does not know, rather than guessing', () => {
    expect(findPreset('My local window cleaner')).toBeUndefined();
    expect(findPreset('')).toBeUndefined();
    expect(findPreset('   ')).toBeUndefined();
  });

  it('never carries a price, because a wrong one is worse than none', () => {
    for (const preset of SERVICE_PRESETS) {
      expect(preset).not.toHaveProperty('amountMinor');
      expect(preset).not.toHaveProperty('price');
    }
  });

  it('only suggests categories that are offered as buttons', () => {
    for (const preset of SERVICE_PRESETS) {
      expect(COMMON_CATEGORIES).toContain(preset.category);
    }
  });
});

describe('categoryChoices', () => {
  it('offers the common ones when nothing is in use yet', () => {
    expect(categoryChoices([])).toEqual([...COMMON_CATEGORIES]);
  });

  it('adds categories you invented, after the common ones', () => {
    const choices = categoryChoices(['Window cleaner', undefined, 'Music']);
    expect(choices.slice(0, COMMON_CATEGORIES.length)).toEqual([...COMMON_CATEGORIES]);
    expect(choices).toContain('Window cleaner');
  });

  it('does not repeat a common category that is already in use', () => {
    const choices = categoryChoices(['Music', 'music', ' Music ']);
    expect(choices.filter((c) => c.toLowerCase().trim() === 'music')).toHaveLength(1);
  });

  it('lists an invented category once however many use it', () => {
    const choices = categoryChoices(['Window cleaner', 'Window cleaner']);
    expect(choices.filter((c) => c === 'Window cleaner')).toHaveLength(1);
  });

  it('ignores blanks', () => {
    expect(categoryChoices([undefined, '', '   '])).toEqual([...COMMON_CATEGORIES]);
  });
});


describe('billing rhythm presets', () => {
  it('offers every 2 weeks as weekly billed every second week', () => {
    const fortnightly = CYCLE_PRESETS.find((p) => p.id === 'fortnightly');
    expect(fortnightly).toEqual({ id: 'fortnightly', label: 'Every 2 weeks', cycle: 'weekly', every: 2 });
  });

  it('offers twice a month as its own cycle, not as an interval', () => {
    // 24 charges a year on set dates. Expressed as "weekly every 2" it would be
    // 26, and the two extra charges would never show up anywhere.
    const semimonthly = CYCLE_PRESETS.find((p) => p.id === 'semimonthly');
    expect(semimonthly).toEqual({ id: 'semimonthly', label: 'Twice a month', cycle: 'semimonthly', every: 1 });
  });

  it('labels it exactly as the income editor does', () => {
    // Same distinction, same words. Two names for one idea is one more thing to
    // decode on a screen whose job is to stop you second-guessing yourself.
    expect(CYCLE_PRESETS.find((p) => p.id === 'semimonthly')?.label).toBe(FREQUENCY_LABELS.semimonthly);
    expect(CYCLE_PRESETS.find((p) => p.id === 'fortnightly')?.label).toBe(FREQUENCY_LABELS.biweekly);
  });

  it('offers both of the usual twice-a-month date pairs, as the income editor does', () => {
    expect(BILLING_DAY_CHOICES.map((c) => c.days)).toEqual([[1, 15], [15, 31]]);
  });

  it('offers every 6 months as monthly billed every sixth month', () => {
    // Not a new cycle - the date maths already handles it, so this is only a
    // button for a rhythm you previously had to find under More options.
    const half = CYCLE_PRESETS.find((p) => p.id === 'halfYearly');
    expect(half).toEqual({ id: 'halfYearly', label: 'Every 6 months', cycle: 'monthly', every: 6 });
  });

  it('lights that button up for a subscription already saved as every 6 months', () => {
    expect(findCyclePreset('monthly', 6)?.id).toBe('halfYearly');
  });

  it('avoids labels that mean different things to different people', () => {
    // The whole reason this option exists is that "semi-weekly" is ambiguous.
    // A button that reintroduces the ambiguity would defeat the point.
    for (const preset of CYCLE_PRESETS) {
      expect(preset.label.toLowerCase()).not.toMatch(/semi|bi-?weekly|fortnight/);
    }
  });

  it('matches a saved subscription on both fields, not just the cycle', () => {
    expect(findCyclePreset('weekly', 1)?.id).toBe('weekly');
    expect(findCyclePreset('weekly', 2)?.id).toBe('fortnightly');
    expect(findCyclePreset('semimonthly', 1)?.id).toBe('semimonthly');
    expect(findCyclePreset('monthly', 1)?.id).toBe('monthly');
  });

  it('returns nothing for a rhythm no button covers', () => {
    // Every 2 months is legitimate but unlisted. Claiming a preset here would
    // let the form quietly rewrite it into monthly and change the charge dates.
    expect(findCyclePreset('monthly', 2)).toBeUndefined();
    expect(findCyclePreset('weekly', 3)).toBeUndefined();
  });

  it('gives every preset a distinct id and a distinct rhythm', () => {
    expect(new Set(CYCLE_PRESETS.map((p) => p.id)).size).toBe(CYCLE_PRESETS.length);
    expect(new Set(CYCLE_PRESETS.map((p) => `${p.cycle}x${p.every}`)).size).toBe(CYCLE_PRESETS.length);
  });

  it('uses only whole, positive intervals the date maths can step', () => {
    for (const preset of CYCLE_PRESETS) {
      expect(Number.isInteger(preset.every)).toBe(true);
      expect(preset.every).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('cycleUnit', () => {
  it('names the period in plain words', () => {
    expect(cycleUnit('weekly')).toBe('weeks');
    expect(cycleUnit('monthly')).toBe('months');
    expect(cycleUnit('quarterly')).toBe('quarters');
    expect(cycleUnit('yearly')).toBe('years');
  });
});


describe('matchPresets', () => {
  it('offers services whose name starts with what you typed', () => {
    expect(matchPresets('net').map((p) => p.name)).toContain('Netflix');
    expect(matchPresets('spo').map((p) => p.name)).toContain('Spotify');
  });

  it('ignores case and stray spaces', () => {
    expect(matchPresets('  NETF  ').map((p) => p.name)).toContain('Netflix');
  });

  it('also matches in the middle of a name', () => {
    expect(matchPresets('tube').map((p) => p.name)).toContain('YouTube Premium');
  });

  it('prefers matches that start with what you typed', () => {
    const names = matchPresets('a').map((p) => p.name);
    expect(names[0].toLowerCase().startsWith('a')).toBe(true);
  });

  it('offers nothing for an empty box, rather than a wall of every service', () => {
    expect(matchPresets('')).toEqual([]);
    expect(matchPresets('   ')).toEqual([]);
  });

  it('stops offering a name once it is typed out in full', () => {
    expect(matchPresets('Netflix').map((p) => p.name)).not.toContain('Netflix');
  });

  it('never returns more than it was asked for', () => {
    expect(matchPresets('e', 3).length).toBeLessThanOrEqual(3);
    expect(matchPresets('e').length).toBeLessThanOrEqual(4);
  });

  it('returns nothing for something it does not know', () => {
    expect(matchPresets('zzzzzz')).toEqual([]);
  });

  it('every suggestion carries a visible name to show on its button', () => {
    // The bug this replaced: a datalist rendered options with no label, so the
    // list was blank rows you had to pick from blind.
    for (const preset of matchPresets('e', 10)) {
      expect(preset.name.trim().length).toBeGreaterThan(0);
    }
  });
});
