/**
 * Telling you when the app has changed under you.
 *
 * Steady updates itself silently: the service worker calls `skipWaiting()` and
 * takes over on the next launch. That is the right behaviour - an update that
 * sits unapplied for weeks is worse - but it means a screen can look different
 * one morning with no explanation, which is exactly the kind of thing this app
 * is supposed to protect you from.
 *
 * So the app records which build it last showed you, and says one quiet line the
 * first time it notices a new one.
 */

/** Substituted at build time by Vite (see `define` in vite.config.ts). */
declare const __APP_BUILD__: string;

/**
 * The build this bundle came from. Falls back for the test runner, which has no
 * Vite `define` step.
 */
export const BUILD_ID: string = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';

/** Substituted at build time from git (see tools/build-info.ts). */
declare const __APP_VERSION__: number | null;
declare const __APP_COMMITS__: { date: string; subject: string }[];

/**
 * The version number: how many changes the app has had, counting from the very
 * first. Null when the build could not count them, which About says plainly.
 */
export const APP_VERSION: number | null = typeof __APP_VERSION__ === 'number' ? __APP_VERSION__ : null;

/** The last ten changes, newest first: the day and the one-line description. */
export const RECENT_COMMITS: { date: string; subject: string }[] =
  typeof __APP_COMMITS__ !== 'undefined' && Array.isArray(__APP_COMMITS__) ? __APP_COMMITS__ : [];

/** "Version 21", or a plain word when there is no number. */
export function versionLabel(version: number | null = APP_VERSION): string {
  return version === null ? 'Development version' : `Version ${version}`;
}

export interface UpdateNotice {
  /** Whether to show the "this app just updated" line. */
  show: boolean;
  /** The build to record as seen, whether or not anything is shown. */
  next: string;
}

/**
 * Decide whether to mention an update.
 *
 * A first-ever launch has not updated *from* anything, so it says nothing and
 * quietly records where it started. Greeting someone opening the app for the
 * first time with "the app updated" would be both wrong and confusing.
 */
export function updateNotice(seen: string | undefined, current: string = BUILD_ID): UpdateNotice {
  if (!seen) return { show: false, next: current };
  if (seen === current) return { show: false, next: current };
  return { show: true, next: current };
}
