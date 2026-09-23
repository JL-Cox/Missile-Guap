import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ACCENTS,
  ACCENT_IDS,
  CONTRAST_PAIRS,
  DEFAULT_CUSTOM,
  GROUNDS,
  GROUND_IDS,
  GROUND_THEMES,
  THEME_TOKENS,
  contrastRatio,
  relativeLuminance,
  resolveCustom,
} from '../src/lib/theme';
import { BUILT_IN_THEMES } from '../src/types';

/**
 * Colour is the one part of this design that cannot be checked by looking at it.
 * A palette that "reads fine" to whoever picked it is exactly how apps end up
 * with 3.8:1 metadata that disappears in sunlight, so every theme is held to the
 * numbers here instead.
 *
 * The stylesheet is the source of truth and this test reads it directly. That is
 * deliberate: a second copy of the palettes in TypeScript would drift from the CSS
 * the moment someone tweaked one and not the other, and the test would go on
 * passing while the app got worse.
 */
const CSS = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

/**
 * `[data-theme='name'] { ... }` blocks, which hold nothing but declarations.
 *
 * A theme may be written as more than one block - `contrast` has a second one
 * for the elevation tokens it switches off - so declarations accumulate the way
 * the cascade would apply them. Selectors like `[data-theme='contrast'] .card`
 * are skipped, because the pattern requires the brace to follow the attribute.
 */
function themeBlocks(): Map<string, Record<string, string>> {
  const blocks = new Map<string, Record<string, string>>();
  const blockRe = /\[data-theme='([a-z]+)'\]\s*\{([^}]*)\}/g;
  for (const [, name, body] of CSS.matchAll(blockRe)) {
    blocks.set(name, { ...blocks.get(name), ...declarations(body) });
  }
  return blocks;
}

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, prop, value] of body.matchAll(/(--[a-z0-9-]+|color-scheme)\s*:\s*([^;]+);/g)) {
    out[prop.replace(/^--/, '')] = value.trim();
  }
  return out;
}

const BLOCKS = themeBlocks();

describe('the theme list and the stylesheet agree', () => {
  it('ships a token block for every theme that can be saved', () => {
    for (const theme of BUILT_IN_THEMES) {
      expect(BLOCKS.has(theme), `styles.css has no :root[data-theme='${theme}'] block`).toBe(true);
    }
  });

  it('has no token block for a theme nobody can choose', () => {
    for (const name of BLOCKS.keys()) {
      expect(
        (BUILT_IN_THEMES as readonly string[]).includes(name),
        `styles.css defines '${name}', which is not in BUILT_IN_THEMES`,
      ).toBe(true);
    }
  });

  it('found every one of them, rather than silently matching nothing', () => {
    // Guards the regex itself. A parser that quietly returns an empty map would
    // make every assertion below vacuously true.
    expect(BLOCKS.size).toBe(BUILT_IN_THEMES.length);
  });

  it.each([...BUILT_IN_THEMES])('%s defines every colour token', (theme) => {
    const tokens = BLOCKS.get(theme)!;
    for (const token of THEME_TOKENS) {
      expect(tokens[token], `${theme} is missing --${token}`).toBeTruthy();
    }
  });

  it.each([...BUILT_IN_THEMES])('%s declares a colour-scheme so native controls follow', (theme) => {
    // Without this the phone draws its own select arrows, date pickers and
    // scrollbars in the wrong polarity - white widgets on a near-black page.
    expect(BLOCKS.get(theme)!['color-scheme']).toMatch(/^(light|dark)$/);
  });
});

describe('every shipped theme passes AA', () => {
  it.each([...BUILT_IN_THEMES])('%s', (theme) => {
    const tokens = BLOCKS.get(theme)!;
    const failures: string[] = [];
    for (const [fg, bg, min] of CONTRAST_PAIRS) {
      const ratio = contrastRatio(tokens[fg], tokens[bg]);
      if (ratio < min) {
        failures.push(`--${fg} (${tokens[fg]}) on --${bg} (${tokens[bg]}) is ${ratio.toFixed(2)}:1, needs ${min}:1`);
      }
    }
    expect(failures, `${theme}:\n${failures.join('\n')}`).toEqual([]);
  });
});

describe('the first-paint shim', () => {
  /**
   * Settings load asynchronously out of IndexedDB, so the very first paint happens
   * before the saved theme is known. On a phone set to dark that used to be a
   * flash of cream at 2am. A `prefers-color-scheme` block covers those few frames,
   * but it is a copy of some of the dark theme's values, and a copy can drift.
   */
  const shim = declarations(/:root:not\(\[data-theme\]\)\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '');

  it('exists at all', () => {
    expect(Object.keys(shim).length).toBeGreaterThan(0);
  });

  it('matches the dark theme exactly, for every token it copies', () => {
    const dark = BLOCKS.get('dark')!;
    for (const [token, value] of Object.entries(shim)) {
      expect(value, `first-paint --${token} has drifted from the dark theme`).toBe(dark[token]);
    }
  });

  /*
    The light half of the same problem, and the one that shows more often.

    The default palette is declared on `html`, and `[data-theme='calm']` is a
    second copy of it. Only the `[data-theme]` blocks are contrast-checked above,
    so the `html` copy is not - yet it is what paints on every cold launch, because
    `data-theme` is deliberately not set until settings load. Left unguarded, a
    tweak to one copy and not the other would put an unverified palette on the
    screen every time the app opens, with this suite still green.
  */
  const defaults = declarations(/\nhtml\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '');

  it('read the default palette at all, rather than silently matching nothing', () => {
    // Without this, every assertion below would pass by comparing nothing.
    expect(Object.keys(defaults).length).toBeGreaterThan(0);
  });

  it('paints the light default from the same values as Calm', () => {
    const calm = BLOCKS.get('calm')!;
    expect(Object.keys(calm).length).toBeGreaterThan(0);
    for (const [token, value] of Object.entries(calm)) {
      expect(defaults[token], `default --${token} on html has drifted from the calm theme`).toBe(value);
    }
  });
});

describe('the custom theme cannot be made unreadable', () => {
  const combinations = GROUND_IDS.flatMap((ground) => ACCENT_IDS.map((accent) => [ground, accent] as const));

  it('offers a reasonable number of combinations', () => {
    expect(combinations.length).toBe(GROUND_IDS.length * ACCENT_IDS.length);
    expect(combinations.length).toBeGreaterThan(20);
  });

  it.each(combinations)('%s + %s passes AA', (ground, accent) => {
    const { tokens } = resolveCustom({ ground, accent });
    const failures: string[] = [];
    for (const [fg, bg, min] of CONTRAST_PAIRS) {
      const ratio = contrastRatio(tokens[fg], tokens[bg]);
      if (ratio < min) {
        failures.push(`--${fg} (${tokens[fg]}) on --${bg} (${tokens[bg]}) is ${ratio.toFixed(2)}:1, needs ${min}:1`);
      }
    }
    expect(failures, `${ground} + ${accent}:\n${failures.join('\n')}`).toEqual([]);
  });

  it.each(combinations)('%s + %s defines every token, so nothing falls back to a browser default', (ground, accent) => {
    const { tokens } = resolveCustom({ ground, accent });
    for (const token of THEME_TOKENS) {
      expect(tokens[token], `missing --${token}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('takes a dark accent on a dark ground and a light one on a light ground', () => {
    expect(resolveCustom({ ground: 'trueBlack', accent: 'sage' }).tokens.accent).toBe(ACCENTS.sage.onDark.accent);
    expect(resolveCustom({ ground: 'warmWhite', accent: 'sage' }).tokens.accent).toBe(ACCENTS.sage.onLight.accent);
  });

  it('reports which grounds are dark, so color-scheme can follow', () => {
    expect(resolveCustom({ ground: 'warmNight', accent: 'ink' }).dark).toBe(true);
    expect(resolveCustom({ ground: 'trueBlack', accent: 'ink' }).dark).toBe(true);
    expect(resolveCustom({ ground: 'sepia', accent: 'ink' }).dark).toBe(false);
  });
});

describe('each custom paper is an exact copy of a shipped theme', () => {
  /*
    The five grounds are the neutral halves of five built-in themes, typed out a
    second time because a custom theme has to be assembled in JavaScript. A
    copy is exactly what drifts: tweak Calm's faint text and "Warm white" would
    quietly keep the old value. Every token each ground defines has to match.
  */
  it.each(GROUND_IDS)('%s matches its theme', (ground) => {
    const theme = BLOCKS.get(GROUND_THEMES[ground])!;
    expect(theme, `no theme block for ${GROUND_THEMES[ground]}`).toBeTruthy();
    for (const [token, value] of Object.entries(GROUNDS[ground].tokens)) {
      expect(value, `${ground} --${token} has drifted from ${GROUND_THEMES[ground]}`).toBe(theme[token]);
    }
  });

  it('agrees about light and dark too', () => {
    for (const ground of GROUND_IDS) {
      expect(GROUNDS[ground].dark ? 'dark' : 'light').toBe(BLOCKS.get(GROUND_THEMES[ground])!['color-scheme']);
    }
  });
});

describe('a custom theme from an unexpected source still renders', () => {
  // A backup written by a newer build, or a hand-edited settings record, must not
  // be able to produce a page with no colours on it.
  const fallback = resolveCustom(DEFAULT_CUSTOM).tokens;

  it('falls back when nothing has been chosen', () => {
    expect(resolveCustom(undefined).tokens).toEqual(fallback);
  });

  it('falls back on a ground that no longer exists', () => {
    expect(resolveCustom({ ground: 'holographic', accent: 'sage' }).tokens).toEqual(fallback);
  });

  it('falls back on an accent that no longer exists', () => {
    expect(resolveCustom({ ground: 'warmWhite', accent: 'chartreuse' }).tokens).toEqual(fallback);
  });

  it('keeps the half it does recognise', () => {
    const { tokens, dark } = resolveCustom({ ground: 'trueBlack', accent: 'nonsense' });
    expect(dark).toBe(true);
    expect(tokens.bg).toBe(GROUNDS.trueBlack.tokens.bg);
    expect(tokens.accent).toBe(ACCENTS[DEFAULT_CUSTOM.accent].onDark.accent);
  });
});

describe('the contrast maths itself', () => {
  it('agrees with the WCAG extremes', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('does not care which way round the pair is given', () => {
    expect(contrastRatio('#2b2823', '#fffdf8')).toBeCloseTo(contrastRatio('#fffdf8', '#2b2823'), 10);
  });

  it('reads shorthand hex the same as longhand', () => {
    expect(relativeLuminance('#fff')).toBeCloseTo(relativeLuminance('#ffffff'), 10);
  });

  it('puts a known mid grey where WCAG says it is', () => {
    // #767676 on white is the canonical "just passes 4.5:1" grey.
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.54);
  });
});
