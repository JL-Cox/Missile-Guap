import { describe, expect, it } from 'vitest';
import {
  PREP_NOTES,
  PREP_STEPS,
  followUpNote,
  offersFollowUp,
  prepMessage,
  questionsFrom,
  withAppointmentPrep,
} from '../src/lib/appointment';
import type { Task } from '../src/types';

function task(partial: Partial<Task> = {}): Task {
  return { id: 't', title: 'Dentist', notes: '', steps: [], tags: [], createdAt: 0, updatedAt: 0, ...partial };
}

/** Ids that say where they came from, so a test can tell old steps from new. */
function ids() {
  let n = 0;
  return () => `new-${++n}`;
}

describe('withAppointmentPrep', () => {
  it('adds every usual step to a task with none, in order', () => {
    const { task: t, addedSteps } = withAppointmentPrep(task({ date: '2026-09-30' }), ids());
    expect(t.steps.map((s) => s.text)).toEqual(PREP_STEPS);
    expect(addedSteps).toEqual(PREP_STEPS);
    expect(t.steps.every((s) => !s.done)).toBe(true);
  });

  it('uses "Work out when to leave", with no time maths', () => {
    expect(PREP_STEPS).toContain('Work out when to leave');
    expect(PREP_STEPS.some((s) => s.startsWith('Leave by'))).toBe(false);
  });

  it('adds only what is not there already, ignoring case and spaces', () => {
    const had = task({
      steps: [
        { id: 'mine', text: '  insurance CARD ', done: true },
        { id: 'also-mine', text: 'Park at the back', done: false },
      ],
    });
    const { task: t, addedSteps } = withAppointmentPrep(had, ids());
    expect(addedSteps).not.toContain('Insurance card');
    expect(addedSteps).toHaveLength(4);
    // Your own steps keep their place, their ids and whether they are ticked.
    expect(t.steps.slice(0, 2)).toEqual(had.steps);
    expect(t.steps.filter((s) => s.text.trim().toLowerCase() === 'insurance card')).toHaveLength(1);
  });

  it('adds nothing the second time', () => {
    const once = withAppointmentPrep(task(), ids()).task;
    const twice = withAppointmentPrep(once, ids());
    expect(twice.addedSteps).toEqual([]);
    expect(twice.addedNotes).toBe(false);
    expect(twice.task.steps).toEqual(once.steps);
    expect(twice.task.notes).toBe(once.notes);
  });

  it('puts the questions list into empty notes', () => {
    const { task: t, addedNotes } = withAppointmentPrep(task({ notes: '   ' }), ids());
    expect(t.notes).toBe('Questions to ask:\n- \n\nTo bring:\n- ');
    expect(t.notes).toBe(PREP_NOTES);
    expect(addedNotes).toBe(true);
  });

  it('adds it after notes you already wrote, once', () => {
    const { task: t } = withAppointmentPrep(task({ notes: 'Dr Hall, second floor.\n\n' }), ids());
    expect(t.notes).toBe(`Dr Hall, second floor.\n\n${PREP_NOTES}`);
    expect(withAppointmentPrep(t, ids()).task.notes).toBe(t.notes);
  });

  it('leaves the notes alone if they already have a questions list, in any case', () => {
    const notes = 'questions to ask:\n- Is it the same tooth?';
    const { task: t, addedNotes } = withAppointmentPrep(task({ notes }), ids());
    expect(t.notes).toBe(notes);
    expect(addedNotes).toBe(false);
  });

  it('marks it as an appointment and touches nothing else', () => {
    const before = task({ date: '2026-09-30', startTime: '10:00', tags: ['health'], priority: 'high' });
    const { task: t } = withAppointmentPrep(before, ids());
    expect(t.appointment).toBe(true);
    const { steps: _s, notes: _n, appointment: _a, ...rest } = t;
    const { steps: _s2, notes: _n2, ...restBefore } = before;
    expect(rest).toEqual(restBefore);
  });

  it('does not change the task it was given', () => {
    const before = task();
    withAppointmentPrep(before, ids());
    expect(before.steps).toEqual([]);
    expect(before.appointment).toBeUndefined();
  });
});

describe('prepMessage', () => {
  it('says what it added', () => {
    expect(prepMessage({ addedSteps: PREP_STEPS, addedNotes: true })).toBe(
      'Added 5 steps and a questions list to the notes.',
    );
    expect(prepMessage({ addedSteps: ['Photo ID'], addedNotes: false })).toBe('Added 1 step.');
    expect(prepMessage({ addedSteps: [], addedNotes: true })).toBe('Added a questions list to the notes.');
  });

  it('says so plainly when there was nothing to add', () => {
    expect(prepMessage({ addedSteps: [], addedNotes: false })).toBe('It already has all of those. Nothing was added.');
  });
});

describe('offersFollowUp', () => {
  const today = '2026-09-23';

  it('offers from the day of the appointment onward', () => {
    expect(offersFollowUp({ appointment: true, date: today }, today)).toBe(true);
    expect(offersFollowUp({ appointment: true, date: '2026-09-01' }, today)).toBe(true);
  });

  it('not before the day', () => {
    expect(offersFollowUp({ appointment: true, date: '2026-09-24' }, today)).toBe(false);
  });

  it('only on appointments, and only with a day', () => {
    expect(offersFollowUp({ date: today }, today)).toBe(false);
    expect(offersFollowUp({ appointment: true }, today)).toBe(false);
  });
});

describe('questionsFrom', () => {
  it('takes the questions and stops at the next heading', () => {
    const notes = 'Questions to ask:\n- Is it the same tooth?\n- Do I need a filling?\n\nTo bring:\n- Mouthguard';
    expect(questionsFrom(notes)).toEqual(['- Is it the same tooth?', '- Do I need a filling?']);
  });

  it('leaves the empty bullet from the skeleton behind', () => {
    expect(questionsFrom(PREP_NOTES)).toEqual([]);
  });

  it('keeps questions written without a bullet', () => {
    expect(questionsFrom('Questions to ask:\nWhy does it ache at night?')).toEqual(['Why does it ache at night?']);
  });

  it('finds the heading after other notes, in any case', () => {
    expect(questionsFrom('Second floor.\n\nQUESTIONS TO ASK:\n- Cost?')).toEqual(['- Cost?']);
  });

  it('has nothing to give when there is no questions list', () => {
    expect(questionsFrom('Just a reminder to bring the letter.')).toEqual([]);
  });
});

describe('followUpNote', () => {
  const today = '2026-09-23';
  const appt = task({
    title: 'Dentist check-up ',
    date: '2026-09-23',
    tags: ['health'],
    notes: 'Questions to ask:\n- Do I need a filling?\n\nTo bring:\n- ',
  });

  it('is titled with the task and the day, the way the app writes a date', () => {
    expect(followUpNote(appt, today).title).toBe('Dentist check-up — Sep 23: what was said');
  });

  it('says the year only when it is not this year', () => {
    expect(followUpNote({ ...appt, date: '2025-12-30' }, today).title).toBe(
      'Dentist check-up — Dec 30, 2025: what was said',
    );
  });

  it("carries the task's tags plus appointment, once", () => {
    expect(followUpNote(appt, today).tags).toEqual(['health', 'appointment']);
    expect(followUpNote({ ...appt, tags: ['appointment', 'health'] }, today).tags).toEqual(['appointment', 'health']);
  });

  it('starts with the questions you meant to ask, then room for the answers', () => {
    expect(followUpNote(appt, today).body).toBe(
      'Questions to ask:\n- Do I need a filling?\n\nWhat was said:\n- ',
    );
  });

  it('starts straight at what was said when there were no questions', () => {
    expect(followUpNote({ ...appt, notes: PREP_NOTES }, today).body).toBe('What was said:\n- ');
  });
});
