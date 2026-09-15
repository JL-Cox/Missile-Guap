import { downloadFile } from './backup';

/**
 * Hands a file to the phone rather than to the network.
 *
 * On Android, `navigator.share` with a file opens the system sheet, so an .ics
 * can go straight into Google Calendar in one tap. Where that is unavailable
 * (or the user dismisses it) we fall back to a normal download, which Android
 * still offers to open with a calendar app.
 *
 * Note this is not a network call: the file never leaves the device except to
 * whichever app the user picks. The page's `connect-src 'none'` policy is
 * untouched by it.
 */
export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

export async function shareOrDownload(filename: string, contents: string, mime: string): Promise<ShareOutcome> {
  const canShareFiles =
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    typeof navigator.share === 'function';

  if (canShareFiles) {
    try {
      const file = new File([contents], filename, { type: mime });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return 'shared';
      }
    } catch (err) {
      // AbortError means the user closed the share sheet on purpose; anything
      // else means sharing is not really available, so fall through and save.
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
    }
  }

  downloadFile(filename, contents, mime);
  return 'downloaded';
}
