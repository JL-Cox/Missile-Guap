import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { blankTask, db } from '../db';
import type { Settings, Task } from '../types';
import { deleteTask } from '../lib/tasks';
import { describeDate, todayKey } from '../lib/time';
import TaskRow from '../components/TaskRow';
import TaskEditor from '../components/TaskEditor';
import { Empty, Section } from '../components/ui';

type Filter = 'open' | 'today' | 'someday' | 'done';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'Everything open' },
  { id: 'today', label: 'Has a date' },
  { id: 'someday', label: 'No date yet' },
  { id: 'done', label: 'Finished' },
];

export default function Tasks({ settings }: { settings: Settings }) {
  const [filter, setFilter] = useState<Filter>('open');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Task | null>(null);

  const tasks = useLiveQuery(() => db.tasks.toArray(), [settings.rev], [] as Task[]) ?? [];

  if (editing) {
    return (
      <TaskEditor
        task={editing}
        onSaved={() => setEditing(null)}
        onCancel={() => setEditing(null)}
        onDelete={async (t) => {
          await deleteTask(t);
          setEditing(null);
        }}
      />
    );
  }

  const needle = query.trim().toLowerCase();
  const matches = (t: Task) =>
    !needle ||
    t.title.toLowerCase().includes(needle) ||
    t.notes.toLowerCase().includes(needle) ||
    t.tags.some((tag) => tag.includes(needle)) ||
    t.steps.some((s) => s.text.toLowerCase().includes(needle));

  const byFilter = (t: Task) => {
    switch (filter) {
      case 'open':
        return !t.doneAt;
      case 'today':
        return !t.doneAt && Boolean(t.date);
      case 'someday':
        return !t.doneAt && !t.date;
      case 'done':
        return Boolean(t.doneAt);
    }
  };

  const visible = tasks.filter((t) => byFilter(t) && matches(t));

  // Group by day so the list reads as a sequence rather than one long wall.
  const groups = new Map<string, Task[]>();
  for (const task of visible) {
    const key = filter === 'done' ? 'Finished' : task.date ?? 'No date yet';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(task);
  }
  const orderedKeys = [...groups.keys()].sort((a, b) => {
    if (a === 'No date yet') return 1;
    if (b === 'No date yet') return -1;
    return a.localeCompare(b);
  });

  return (
    <>
      <Section
        title="Tasks"
        aside={
          <button type="button" className="btn btn-sm" onClick={() => setEditing(blankTask())}>
            New task
          </button>
        }
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks, notes, steps and tags"
          aria-label="Search tasks"
        />
        <div className="btn-row" role="group" aria-label="Filter tasks">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              className={`btn btn-sm${filter === f.id ? ' btn-primary' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Section>

      {visible.length === 0 ? (
        <Empty>
          {needle
            ? `Nothing matches "${query}". Try a shorter word - search looks in titles, notes, steps and tags.`
            : 'Nothing in this list right now.'}
        </Empty>
      ) : (
        orderedKeys.map((key) => (
          <section key={key} className="stack-sm" aria-label={key}>
            <h3 className="muted">
              {key === 'No date yet' || key === 'Finished' ? key : describeDate(key, todayKey())}
            </h3>
            {groups.get(key)!
              .sort((a, b) => (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99'))
              .map((task) => (
                <TaskRow key={task.id} task={task} onEdit={setEditing} />
              ))}
          </section>
        ))
      )}
    </>
  );
}
