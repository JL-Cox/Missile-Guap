import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { blankTask, db } from '../db';
import type { Settings, Task } from '../types';
import { todayKey } from '../lib/time';
import { groupTasks, taskMatches } from '../lib/tasklist';
import TaskRow from '../components/TaskRow';
import TaskEditor from '../components/TaskEditor';
import { useTaskActions } from '../components/taskActions';
import { Empty, Section, useBackLayer } from '../components/ui';

type Filter = 'open' | 'today' | 'someday' | 'done';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'Everything open' },
  { id: 'today', label: 'Has a date' },
  { id: 'someday', label: 'No date yet' },
  { id: 'done', label: 'Finished' },
];

export default function Tasks({ settings, initialQuery = '' }: { settings: Settings; initialQuery?: string }) {
  const [filter, setFilter] = useState<Filter>('open');
  const [query, setQuery] = useState(initialQuery);
  const [editing, setEditing] = useState<Task | null>(null);
  const { remove } = useTaskActions();
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

  const visible = tasks.filter((t) => byFilter(t) && taskMatches(t, query));
  // Today first, then what is coming, then earlier days, then no date - see groupTasks.
  const groups = groupTasks(visible, todayKey(), filter === 'done');

  const emptyText = query.trim()
    ? `Nothing matches "${query.trim()}". Try a shorter word - search looks in titles, notes, steps and tags.`
    : tasks.length === 0
      ? 'Everything with a day on it, and everything without. Add one here or from the Inbox.'
      : filter === 'done'
        ? 'Things you tick off are kept here.'
        : 'Nothing in this list right now.';

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
          autoComplete="off"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks, notes, steps and tags"
          aria-label="Search tasks"
        />
        <div className="btn-row" role="group" aria-label="Show">
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

      {groups.length === 0 ? (
        <Empty>{emptyText}</Empty>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="stack-sm" aria-label={group.label}>
            <h3>{group.label}</h3>
            {group.tasks.map((task) => (
              <TaskRow key={task.id} task={task} onEdit={setEditing} showDate={group.showDate} />
            ))}
          </section>
        ))
      )}
    </>
  );
}
