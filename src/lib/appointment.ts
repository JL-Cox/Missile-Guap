import type { DateKey, Note, Step, Task } from '../types';
import { daysBetween, shortDate } from './time';

/**
 * Getting ready for an appointment, and writing down what was said after it.
 *
 * An appointment is an ordinary dated task. The editor offers to add the
 * things people usually need - it never adds them by itself, and never decides
 * from a title that something is an appointment. Afterwards the row offers a
 * note for what was said, because that is the part that is gone by the time
 * you get home.
 */

/** The usual steps, in the order you would do them. */
export const PREP_STEPS = [
  'Write down the questions to ask',
  'Insurance card',
  'Medication list',
  'Photo ID',
  'Work out when to leave',
];

export const QUESTIONS_HEADING = 'Questions to ask:';

/** A place to put the questions and what to bring, ready to type into. */
export const PREP_NOTES = `${QUESTIONS_HEADING}\n- \n\nTo bring:\n- `;

export interface Prepared {
  task: Task;
  /** The steps that were not there already, as added. */
  addedSteps: string[];
  /** Whether the questions list went into the notes. */
  addedNotes: boolean;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The task with the usual steps and a questions list added - only the ones it
 * does not already have, so pressing it twice, or after writing "insurance
 * card" yourself, never leaves two of anything. Existing steps keep their
 * place; the new ones go after them.
 *
 * The notes get the questions list if they are empty, or have it added at the
 * end if they are not - unless it is already there, in any case.
 */
export function withAppointmentPrep(task: Task, makeId: () => string): Prepared {
  const addedSteps = PREP_STEPS.filter((text) => !task.steps.some((s) => same(s.text, text)));
  const steps: Step[] = [...task.steps, ...addedSteps.map((text) => ({ id: makeId(), text, done: false }))];

  const hasQuestions = task.notes.toLowerCase().includes(QUESTIONS_HEADING.toLowerCase());
  const notes = hasQuestions
    ? task.notes
    : task.notes.trim()
      ? `${task.notes.replace(/\s+$/, '')}\n\n${PREP_NOTES}`
      : PREP_NOTES;

  return { task: { ...task, steps, notes, appointment: true }, addedSteps, addedNotes: !hasQuestions };
}

/** What the toast says it added. */
export function prepMessage({ addedSteps, addedNotes }: Pick<Prepared, 'addedSteps' | 'addedNotes'>): string {
  const n = addedSteps.length;
  const steps = `${n} ${n === 1 ? 'step' : 'steps'}`;
  if (n && addedNotes) return `Added ${steps} and a questions list to the notes.`;
  if (n) return `Added ${steps}.`;
  if (addedNotes) return 'Added a questions list to the notes.';
  return 'It already has all of those. Nothing was added.';
}

/** Whether the row should offer to write down what was said: from the day onward. */
export function offersFollowUp(task: Pick<Task, 'appointment' | 'date'>, today: DateKey): boolean {
  return Boolean(task.appointment && task.date && daysBetween(task.date, today) >= 0);
}

/** A bullet with nothing after it - the skeleton's "- ", not a question. */
const emptyBullet = (line: string) => /^\s*[-*•]\s*$/.test(line);
/** "To bring:" and the like: a line of its own ending in a colon, not a bullet. */
const isHeading = (line: string) => /:\s*$/.test(line) && !/^\s*[-*•]/.test(line);

/**
 * The questions written under "Questions to ask:" in a task's notes, as
 * written - bullets and all - stopping at the next heading. Empty bullets are
 * left behind.
 */
export function questionsFrom(notes: string): string[] {
  const lines = notes.split('\n');
  const start = lines.findIndex((line) => same(line, QUESTIONS_HEADING));
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (isHeading(line)) break;
    if (!line.trim() || emptyBullet(line)) continue;
    out.push(line.trimEnd());
  }
  return out;
}

/**
 * The note for what was said: "Dentist — Sep 30: what was said", tagged like
 * the task plus "appointment", starting with the questions you meant to ask so
 * the answers can go next to them. The date is written the way the rest of
 * the app writes a date, and gains its year only when it is not this year.
 */
export function followUpNote(
  task: Pick<Task, 'title' | 'date' | 'notes' | 'tags'>,
  today: DateKey,
): Pick<Note, 'title' | 'body' | 'tags'> {
  const when = task.date ? ` — ${shortDate(task.date, today)}` : '';
  const questions = questionsFrom(task.notes);
  const said = 'What was said:\n- ';
  return {
    title: `${task.title.trim()}${when}: what was said`,
    body: questions.length ? `${QUESTIONS_HEADING}\n${questions.join('\n')}\n\n${said}` : said,
    tags: [...new Set([...task.tags, 'appointment'])],
  };
}
