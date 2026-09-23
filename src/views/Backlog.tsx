import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { blankTask, db, saveSettings } from '../db';
import type { Priority, Settings, Task } from '../types';
import { finishedWithoutDate, unscheduled } from '../lib/agenda';
import { groupLabel, PRIORITIES, sortTasks, SORTS } from '../lib/priority';
import { todayKey } from '../lib/time';
import TaskRow from '../components/TaskRow';
import TaskEditor from '../components/TaskEditor';
import { useTaskActions } from '../components/taskActions';
import { Empty, Section, useBackLayer } from '../components/ui';

/**
 * Everything that needs doing and has no day on it.
 *
 * Booking the appointment, ordering the thing, chasing the letter - the jobs
 * that are not urgent enough to schedule and not small enough to forget, which
 * is exactly why they go missing. They are ordinary tasks; the only thing that
 * puts them here is that nobody has given them a date, so nothing new has to be
 * decided when you write one down.
 *
 * Giving one a day is how it leaves. Nothing here is late, nothing is counted,
 * and the list never tells you how long something has been sitting.
 */
export default function Backlog({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  const [editing, setEditing] = useState<Task | null>(null);
  const [showFinished, setShowFinished] = useState(false);
  const { move, remove } = useTaskActions();
  useBackLayer(editing !== null, () => setEditing(null));

  const tasks = useLiveQuery(() => db.tasks.toArray(), [settings.rev], [] as Task[]) ?? [];

  if (editing) {
    const saved = tasks.some((t) => t.id === editing.id);
    return (
      <TaskEditor
        task={editing}
        onSaved={() => setEditing(null)}
        onCancel={() => setEditing(null)}
        onDelete={
          saved
            ? async (t) => {
                setEditing(null);
                await remove(t);
              }
            : undefined
        }
      />
    );
  }

  const sort = settings.backlogSort;
  const open = sortTasks(unscheduled(tasks), sort);
  const finished = finishedWithoutDate(tasks);
  const today = todayKey();

  /*
    Under the default order the list carries a quiet heading per level, so you
    can see where Critical stops - and the rows under it do not say "Critical"
    a second time. The other three orders are one flat run, so there each row
    keeps its own priority.
  */
  const grouped: { key: string; items: Task[] }[] = [];
  if (sort === 'priority') {
    for (const level of [...PRIORITIES, undefined] as (Priority | undefined)[]) {
      const items = open.filter((t) => t.priority === level);
      if (items.length > 0) grouped.push({ key: groupLabel(level), items });
    }
  }

  const row = (task: Task) => (
    <TaskRow
      key={task.id}
      task={task}
      onEdit={setEditing}
      hidePriority={sort === 'priority'}
      // The one action that moves something along, with the same words as on Today.
      actions={
        <button type="button" className="btn btn-sm" onClick={() => void move(task, today)}>
          Do it today
        </button>
      }
    />
  );

  return (
    <>
      <Section
        title="Backlog"
        aside={
          <button type="button" className="btn btn-sm" onClick={() => setEditing(blankTask())}>
            Add something
          </button>
        }
      >
        <p className="faint">
          Things to get to when you can. Nothing here has a day on it, and nothing here is late.
        </p>
        <div className="btn-row" role="group" aria-label="Sort by">
          {SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={sort === s.id}
              className={`btn btn-sm${sort === s.id ? ' btn-primary' : ''}`}
              // Saved rather than held in the component, so the list opens the
              // way you left it rather than resetting every time you come back.
              onClick={() => void saveSettings({ backlogSort: s.id }).then(onChange)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Section>

      {open.length === 0 ? (
        <Empty>
          Nothing outstanding. Anything you write down without giving it a day turns up here.
        </Empty>
      ) : sort === 'priority' ? (
        grouped.map(({ key, items }) => (
          <section key={key} className="stack-sm" aria-label={key}>
            <h3>{key}</h3>
            {items.map(row)}
          </section>
        ))
      ) : (
        <div className="stack-sm">{open.map(row)}</div>
      )}

      {finished.length > 0 && (
        <Section title="Finished">
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              aria-expanded={showFinished}
              onClick={() => setShowFinished((v) => !v)}
            >
              {showFinished ? 'Hide what I have finished' : `Show what I have finished (${finished.length})`}
            </button>
          </div>
          {showFinished && (
            <div className="stack-sm">
              {finished.map((task) => (
                <TaskRow key={task.id} task={task} onEdit={setEditing} />
              ))}
            </div>
          )}
        </Section>
      )}
    </>
  );
}
