/**
 * What changed, in as few words as possible. Shown on the About screen.
 *
 * Written by hand, because a commit message is written for whoever reads the
 * code and this is written for whoever uses the app. Each entry's version is
 * the number that build shows (the commit count - see tools/build-info.ts), so
 * when adding one, it is the current count plus one. Newest first.
 *
 * Starts at version 19. Earlier builds are counted in the number but not
 * described here.
 */
export interface ChangeEntry {
  version: number;
  /** Short bullets. Kept under 90 characters each by test/build-info.test.ts. */
  items: string[];
}

export const CHANGES: ChangeEntry[] = [
  {
    version: 22,
    items: [
      '"Today is a low day": shows only what has a time, what is Critical, and easy tasks.',
      'Appointment prep adds the usual steps and a list of questions to ask.',
      'After an appointment, "Write down what was said" starts a linked note.',
      '"Reuse these steps each time": ticking a routine unticks its steps for next time.',
      'Optional app lock with a PIN and a recovery phrase. It hides the screen, not encryption.',
    ],
  },
  {
    version: 21,
    items: [
      'New About page in Settings: version number, what changed, and the last 10 updates.',
      'The "Steady updated" line now has a "What\'s new" button.',
    ],
  },
  {
    version: 20,
    items: [
      'Every move, delete or tick says what happened, with Undo.',
      'Every row has a Details button.',
      'Today, Tomorrow and In a week buttons when picking a date.',
      'Repeats every N days or weeks.',
      'Money shows two big numbers: due before payday, and left from this paycheck.',
      'Back closes an editor, then goes to Today, instead of leaving the app.',
      'Three fun themes: Synthwave, Bubblegum and Aurora.',
    ],
  },
  {
    version: 19,
    items: [
      'Delete everything now deletes income too.',
      'Reminders show the title and time, not your notes.',
      'Calendar exports leave notes out unless you switch them on.',
      'Restoring a backup asks before wiping anything.',
      'Reminders follow a task when its day or time changes.',
      'Monthly income is paid once a month.',
    ],
  },
];
