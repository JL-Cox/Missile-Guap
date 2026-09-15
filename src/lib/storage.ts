/**
 * Where the data lives, and whether the browser promises to keep it.
 *
 * IndexedDB comes in two flavours the user never sees:
 *
 *   "best-effort" (the default) - the browser is allowed to throw your data
 *   away when the device runs low on storage. No warning, no recovery.
 *
 *   "persisted" - the browser will not evict it. Only a deliberate clear of
 *   site data removes it.
 *
 * For an app whose whole premise is that you can put everything in it and stop
 * carrying it in your head, best-effort is not good enough. So we ask for
 * persistence, and we show the honest answer in Settings either way.
 */

export interface StorageStatus {
  /** False on browsers with no Storage API at all. */
  supported: boolean;
  /** True when the browser has promised not to evict this data. */
  persisted: boolean;
  /** Everything this origin stores, the app's own cached files included. */
  usageBytes?: number;
  /**
   * Just the database your notes are in. Chrome reports this separately; where
   * it doesn't, we say nothing rather than present the total as if it were
   * your data - one note is not a megabyte, and claiming so invites the
   * reasonable conclusion that the app is lying about something.
   */
  databaseBytes?: number;
  quotaBytes?: number;
}

export async function storageStatus(): Promise<StorageStatus> {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return { supported: false, persisted: false };
  }
  let persisted = false;
  try {
    persisted = (await navigator.storage.persisted?.()) ?? false;
  } catch {
    // Some browsers throw in private mode; treat that as "not persisted".
  }
  let usageBytes: number | undefined;
  let databaseBytes: number | undefined;
  let quotaBytes: number | undefined;
  try {
    const estimate = await navigator.storage.estimate?.();
    usageBytes = estimate?.usage;
    quotaBytes = estimate?.quota;
    // Non-standard, but Chrome (and so Android) breaks the total down.
    const details = (estimate as { usageDetails?: Record<string, number> } | undefined)?.usageDetails;
    databaseBytes = details?.indexedDB;
  } catch {
    // Estimates are a nicety; their absence is not an error.
  }
  return { supported: true, persisted, usageBytes, databaseBytes, quotaBytes };
}

/**
 * Ask the browser to stop treating this data as disposable.
 *
 * Chrome decides silently from heuristics - being installed to the home screen
 * is the big one, which is why the app asks on every start rather than once.
 * Firefox shows a prompt. Either way it is safe to call repeatedly: once
 * granted, it returns true without asking again.
 */
export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** The origin this app's storage is filed under, shown in Settings. */
export function storageOrigin(): string {
  try {
    return window.location.origin;
  } catch {
    return 'this site';
  }
}
