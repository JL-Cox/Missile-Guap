import { useState } from 'react';
import type { Task } from '../types';
import { completeTask, stepProgress, toggleStep, uncompleteTask } from '../lib/tasks';
import { describeDate, describeDuration } from '../lib/time';
import { describeRecurrence } from '../lib/recurrence';
import { TagList } from './ui';
import AddToCalendar from './AddToCalendar';
import { calendarForTask, icsFilename } from '../lib/ics';

/**
 * A row shows everything true about the task without needing a tap: when it is,
 * how long it might take, how many steps are left. Nothing is hidden behind a
 * long-press or a swipe, because a hidden gesture is a thing to remember.
 */
export default function TaskRow({
  task,
  onEdit,
  showDate = false,
}: {
  task: Task;
  onEdit: (task: Task) => void;
  showDate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const progress = stepProgress(task);
  const done = Boolean(task.doneAt);

  return (
    <div className={`item${done ? ' item-done' : ''}`}>
      {/* Styled in styles.css rather than inline: an inline accent-color wins
          over the stylesheet, which meant a finished task could never take the
          --done colour. */}
      <input
        type="checkbox"
        className="item-check"
        checked={done}
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        onChange={() => void (done ? uncompleteTask(task) : completeTask(task))}
      />

      <div className="grow stack-sm">
        <button
          type="button"
          className="item-title"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}
        >
          {task.title}
        </button>

        <div className="row-tight faint">
          {task.startTime && <span>{task.startTime}</span>}
          {showDate && task.date && <span>{describeDate(task.date)}</span>}
          {task.durationMin && <span>{describeDuration(task.durationMin)}</span>}
          {task.recurrence && <span>{describeRecurrence(task.recurrence)}</span>}
          {task.energy && <span>{task.energy} energy</span>}
          {progress.total > 0 && (
            <span>
              {progress.done} of {progress.total} steps
            </span>
          )}
        </div>

        <TagList tags={task.tags} />

        {open && (
          <div className="stack-sm">
            {task.notes.trim() && <p className="note-body">{task.notes}</p>}
            {task.steps.map((step) => (
              <label key={step.id} className="check">
                <input type="checkbox" checked={step.done} onChange={() => void toggleStep(task, step.id)} />
                <span style={step.done ? { color: 'var(--text-faint)', textDecoration: 'line-through' } : undefined}>
                  {step.text}
                </span>
              </label>
            ))}
            <div className="btn-row">
              <button type="button" className="btn btn-sm" onClick={() => onEdit(task)}>
                Edit
              </button>
            </div>
            {task.date && (
              <AddToCalendar
                build={() => calendarForTask(task)}
                filename={icsFilename(task.title)}
                nothingToAdd="Give this a day first, then it can go in your calendar."
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
