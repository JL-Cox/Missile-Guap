import { describe, expect, it } from 'vitest';
import { categoryChoices, COMMON_CATEGORIES, findPreset, SERVICE_PRESETS } from '../src/lib/subscriptions';

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
