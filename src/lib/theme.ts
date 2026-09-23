/**
 * The custom theme, and the contrast maths that proves every theme is readable.
 *
 * The built-in themes live in `src/styles.css` and nowhere else - that file is the
 * single source of truth for them, and `test/theme.test.ts` reads it directly so
 * the two can never drift. This module exists for the one thing CSS cannot do:
 * let someone assemble their own theme at runtime.
 *
 * The shape of that choice is deliberate. There is no colour wheel here, and no
 * "this may be hard to read" warning, because both hand the decision back to
 * someone who very likely opened Settings *because* they were having a bad day.
 * Instead a custom theme is two named picks:
 *
 *   ground - a complete, pre-verified neutral ramp (page, card, borders, all three
 *            text weights). This is where readability actually lives, and it is
 *            not adjustable. You pick which one, not what is in it.
 *   accent - the single colour the app is allowed to use, in a version already
 *            matched to light grounds or to dark ones.
 *
 * Five grounds times eight accents is forty combinations, and the test checks the
 * whole cross product against the same contrast matrix as the shipped themes. So
 * there is no unreadable combination to warn about: it cannot be expressed.
 */

import type { AccentId, CustomTheme, GroundId } from '../types';

/** Every colour token a theme has to define. The test holds each one to a ratio. */
export const THEME_TOKENS = [
  'bg', 'surface', 'surface-sunk', 'surface-alt', 'surface-disabled',
  'border', 'border-strong',
  'text', 'text-soft', 'text-faint', 'text-disabled',
  'accent', 'accent-soft', 'accent-text', 'accent-on',
  'warn-soft', 'warn-text', 'done', 'bar-fill',
  'prio-critical-bg', 'prio-critical-text', 'prio-high-text',
  'prio-medium-text', 'prio-low-text',
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];
type Tokens = Record<ThemeToken, string>;

/**
 * The pairs every theme must clear, and why each threshold is what it is.
 *
 * 4.5:1 is WCAG AA for body text. 3:1 is AA for the boundary of a control you
 * have to be able to find (1.4.11) - a plain button's border is the only thing
 * saying it is a button, so it is held to that, not to "looks like a line".
 */
export const CONTRAST_PAIRS: [ThemeToken, ThemeToken, number][] = [
  // Text, at every ground it is ever set on.
  ['text', 'bg', 4.5], ['text', 'surface', 4.5], ['text', 'surface-sunk', 4.5], ['text', 'surface-alt', 4.5],
  ['text-soft', 'bg', 4.5], ['text-soft', 'surface', 4.5], ['text-soft', 'surface-alt', 4.5],
  ['text-faint', 'bg', 4.5], ['text-faint', 'surface', 4.5], ['text-faint', 'surface-sunk', 4.5],
  ['text-faint', 'surface-alt', 4.5], ['text-soft', 'surface-sunk', 4.5],
  ['accent-text', 'surface-alt', 4.5],
  // The accent, as text and as a ground for text.
  ['accent-text', 'surface', 4.5], ['accent-text', 'bg', 4.5], ['accent-text', 'accent-soft', 4.5],
  ['accent-on', 'accent', 4.5],
  // Things you have to be able to see the edge of.
  ['accent', 'surface', 3], ['accent', 'bg', 3], ['accent', 'surface-alt', 3],
  ['border-strong', 'surface', 3], ['border-strong', 'bg', 3],
  // surface-alt is where inputs sit, and on a dark theme it is the *lightest*
  // surface, so it is the hardest case for a border - not the easiest.
  ['border-strong', 'surface-alt', 3],
  // The capture box's edge. It sits on the accent tint, where --border-strong
  // fell to 2.3:1 in some themes, so it is drawn in --text-faint instead - and
  // that is the pair held here.
  ['text-faint', 'accent-soft', 3],
  // The quiet attention register. Never alarm, still legible.
  ['warn-text', 'warn-soft', 4.5], ['warn-text', 'surface', 4.5],
  // Graphics that carry meaning.
  ['done', 'surface', 3], ['done', 'bg', 3], ['bar-fill', 'surface-sunk', 3],
  // Priority, for the Backlog screen. Badges carry words too, never colour alone.
  ['prio-critical-text', 'prio-critical-bg', 4.5],
  // High is an outline badge on the card itself, so its only ground is the card.
  ['prio-high-text', 'surface', 4.5],
  ['prio-medium-text', 'surface', 4.5], ['prio-low-text', 'surface', 4.5],
  // Disabled is exempt from WCAG. Held to 3:1 anyway, because "you cannot press
  // this" is information, and an unreadable control is just a broken-looking one.
  ['text-disabled', 'surface-disabled', 3],
];

/* ---------- contrast maths (WCAG 2.1 relative luminance) ---------- */

function channels(hex: string): [number, number, number] {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function relativeLuminance(hex: string): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = channels(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(a: string, b: string): number {
  const x = relativeLuminance(a);
  const y = relativeLuminance(b);
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------- grounds: the neutral ramps, which you cannot break ---------- */

/**
 * Everything except the four accent tokens, which the accent supplies.
 *
 * Each ground is a copy of a built-in theme's neutrals - see GROUND_THEMES -
 * and test/theme.test.ts fails if a copy drifts from the stylesheet.
 */
type GroundTokens = Omit<Tokens, 'accent' | 'accent-soft' | 'accent-text' | 'accent-on'>;

interface Ground {
  /** Shown on the button. Labelled in words, never a swatch on its own. */
  label: string;
  /** One line under the row, saying what this one is for. */
  hint: string;
  dark: boolean;
  tokens: GroundTokens;
}

export const GROUNDS: Record<GroundId, Ground> = {
  warmWhite: {
    label: 'Warm white',
    hint: 'Off-white with a little warmth in it, like paper.',
    dark: false,
    tokens: {
      bg: '#f4f1ea', surface: '#fffdf8', 'surface-sunk': '#e9e5db', 'surface-alt': '#eeeae0',
      'surface-disabled': '#eeeae0', border: '#e0dacd', 'border-strong': '#8d8676',
      text: '#2b2823', 'text-soft': '#5c5649', 'text-faint': '#696251', 'text-disabled': '#8b8474',
      'warn-soft': '#f5eeda', 'warn-text': '#655423', done: '#4a7159', 'bar-fill': '#6c8377',
      'prio-critical-bg': '#ddd5c2', 'prio-critical-text': '#453e2c',
      'prio-high-text': '#554c38',
      'prio-medium-text': '#5c5649', 'prio-low-text': '#696251',
    },
  },
  coolWhite: {
    label: 'Cool white',
    hint: 'Flat daylight, no warmth. Good if the warm one reads yellow.',
    dark: false,
    tokens: {
      bg: '#f0f1f3', surface: '#fbfcfd', 'surface-sunk': '#e3e5ea', 'surface-alt': '#e9ebef',
      'surface-disabled': '#e9ebef', border: '#dcdfe4', 'border-strong': '#80858e',
      text: '#23262b', 'text-soft': '#51565e', 'text-faint': '#5e636c', 'text-disabled': '#7d828c',
      'warn-soft': '#eee7d6', 'warn-text': '#5c5029', done: '#3d6b52', 'bar-fill': '#717f91',
      'prio-critical-bg': '#d3d7de', 'prio-critical-text': '#33373e',
      'prio-high-text': '#454a53',
      'prio-medium-text': '#51565e', 'prio-low-text': '#5e636c',
    },
  },
  sepia: {
    label: 'Sepia',
    hint: 'Warm and low in blue light, for later in the evening.',
    dark: false,
    tokens: {
      bg: '#f6ecd9', surface: '#fdf6e8', 'surface-sunk': '#ebdfc7', 'surface-alt': '#f1e7d2',
      'surface-disabled': '#f1e7d2', border: '#e5d8bc', 'border-strong': '#8f8160',
      text: '#33291a', 'text-soft': '#5f5134', 'text-faint': '#6f6040', 'text-disabled': '#8d7e5c',
      'warn-soft': '#f2e2c0', 'warn-text': '#66511d', done: '#4f6b34', 'bar-fill': '#887a54',
      'prio-critical-bg': '#e0d0ad', 'prio-critical-text': '#453820',
      'prio-high-text': '#564726',
      'prio-medium-text': '#5f5134', 'prio-low-text': '#6f6040',
    },
  },
  warmNight: {
    label: 'Warm night',
    hint: 'Dim and warm rather than black. Easiest on tired eyes.',
    dark: true,
    tokens: {
      bg: '#1b1a18', surface: '#242220', 'surface-sunk': '#2e2b28', 'surface-alt': '#322f2b',
      'surface-disabled': '#2a2825', border: '#3a3733', 'border-strong': '#807c74',
      text: '#ece7de', 'text-soft': '#bdb6aa', 'text-faint': '#a09889', 'text-disabled': '#7c776d',
      'warn-soft': '#3a3320', 'warn-text': '#dcc68d', done: '#7fa98d', 'bar-fill': '#6e8578',
      'prio-critical-bg': '#453f37', 'prio-critical-text': '#ece2cf',
      'prio-high-text': '#d6cbb9',
      'prio-medium-text': '#bdb6aa', 'prio-low-text': '#a09889',
    },
  },
  trueBlack: {
    label: 'True black',
    hint: 'Nearly no light at all, for the middle of the night.',
    dark: true,
    tokens: {
      bg: '#07080a', surface: '#101216', 'surface-sunk': '#171a1f', 'surface-alt': '#1b1e24',
      'surface-disabled': '#15181d', border: '#23272e', 'border-strong': '#686d76',
      text: '#c9c7c2', 'text-soft': '#a0a0a7', 'text-faint': '#8a8a92', 'text-disabled': '#6a6a73',
      'warn-soft': '#2a2418', 'warn-text': '#c9b587', done: '#6f9a80', 'bar-fill': '#5d7288',
      'prio-critical-bg': '#2d323b', 'prio-critical-text': '#d2d5da',
      'prio-high-text': '#b4b7bd',
      'prio-medium-text': '#a0a0a7', 'prio-low-text': '#8a8a92',
    },
  },
};

/** Which built-in theme each ground was copied from. */
export const GROUND_THEMES: Record<GroundId, string> = {
  warmWhite: 'calm',
  coolWhite: 'overcast',
  sepia: 'amber',
  warmNight: 'dark',
  trueBlack: 'midnight',
};

/* ---------- accents: the one colour, in a light and a dark cut ---------- */

type AccentTokens = Pick<Tokens, 'accent' | 'accent-soft' | 'accent-text' | 'accent-on'>;

interface Accent {
  label: string;
  onLight: AccentTokens;
  onDark: AccentTokens;
}

/**
 * Two cuts of each accent rather than one. A colour that reads as a confident
 * mid-tone on paper turns to mud on a near-black page, so the dark cut is lifted
 * and desaturated instead of being the same hex on a different background.
 */
export const ACCENTS: Record<AccentId, Accent> = {
  sage: {
    label: 'Sage',
    onLight: { accent: '#46685a', 'accent-soft': '#e2eae4', 'accent-text': '#2e4a3d', 'accent-on': '#ffffff' },
    onDark: { accent: '#8fb3a1', 'accent-soft': '#2c3a33', 'accent-text': '#b0d0be', 'accent-on': '#16201a' },
  },
  teal: {
    label: 'Teal',
    onLight: { accent: '#2f6b6b', 'accent-soft': '#dceaea', 'accent-text': '#1f5050', 'accent-on': '#ffffff' },
    onDark: { accent: '#7fb4b4', 'accent-soft': '#1f3434', 'accent-text': '#a2cfcf', 'accent-on': '#0d1e1e' },
  },
  slate: {
    label: 'Slate',
    onLight: { accent: '#3f5a72', 'accent-soft': '#e1e7ed', 'accent-text': '#2b4256', 'accent-on': '#ffffff' },
    onDark: { accent: '#8aa8c4', 'accent-soft': '#1e2a36', 'accent-text': '#aac4dc', 'accent-on': '#0c151d' },
  },
  indigo: {
    label: 'Indigo',
    onLight: { accent: '#4d4f86', 'accent-soft': '#e5e5f0', 'accent-text': '#373a66', 'accent-on': '#ffffff' },
    onDark: { accent: '#9a9ed6', 'accent-soft': '#24263c', 'accent-text': '#b7bae6', 'accent-on': '#101228' },
  },
  plum: {
    label: 'Plum',
    onLight: { accent: '#6d4260', 'accent-soft': '#efe2ec', 'accent-text': '#52304a', 'accent-on': '#ffffff' },
    onDark: { accent: '#c093b4', 'accent-soft': '#332531', 'accent-text': '#d6b0cb', 'accent-on': '#1e1019' },
  },
  clay: {
    label: 'Clay',
    onLight: { accent: '#8a4b34', 'accent-soft': '#f2e3dc', 'accent-text': '#6a3827', 'accent-on': '#ffffff' },
    onDark: { accent: '#cc8f75', 'accent-soft': '#3a2820', 'accent-text': '#e0ab94', 'accent-on': '#221109' },
  },
  ochre: {
    label: 'Ochre',
    onLight: { accent: '#7a5a2a', 'accent-soft': '#f0e5cf', 'accent-text': '#5c4420', 'accent-on': '#ffffff' },
    onDark: { accent: '#c4a063', 'accent-soft': '#362c18', 'accent-text': '#d9bb85', 'accent-on': '#201704' },
  },
  ink: {
    label: 'Ink',
    onLight: { accent: '#45464a', 'accent-soft': '#e7e7e9', 'accent-text': '#34353a', 'accent-on': '#ffffff' },
    onDark: { accent: '#a8a9ad', 'accent-soft': '#2c2d31', 'accent-text': '#c2c3c7', 'accent-on': '#131418' },
  },
};

export const GROUND_IDS = Object.keys(GROUNDS) as GroundId[];
export const ACCENT_IDS = Object.keys(ACCENTS) as AccentId[];

/** What someone gets before they have chosen anything: the Calm theme's own pair. */
export const DEFAULT_CUSTOM: CustomTheme = { ground: 'warmWhite', accent: 'sage' };

/**
 * Turns a saved pick into the same tokens the CSS themes define.
 *
 * Both ids are validated rather than trusted. A restored backup, or a settings
 * record written by a newer build, can carry a ground that no longer exists - and
 * the honest failure there is the default theme, not a page with no colours.
 */
export function resolveCustom(
  custom: { ground?: string; accent?: string } | undefined,
): { tokens: Tokens; dark: boolean } {
  const groundId = (custom?.ground && custom.ground in GROUNDS ? custom.ground : DEFAULT_CUSTOM.ground) as GroundId;
  const accentId = (custom?.accent && custom.accent in ACCENTS ? custom.accent : DEFAULT_CUSTOM.accent) as AccentId;
  const ground = GROUNDS[groundId];
  const accent = ACCENTS[accentId];
  return {
    tokens: { ...ground.tokens, ...(ground.dark ? accent.onDark : accent.onLight) },
    dark: ground.dark,
  };
}
