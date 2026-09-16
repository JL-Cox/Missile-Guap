import { describe, expect, it } from 'vitest';
import {
  groupLabel,
  PRIORITIES,
  PRIORITY_LABELS,
  priorityClass,
  priorityRank,
  SORTS,
  sortTasks,
} from '../src/lib/priority';
import type { Priority, Task } from '../src/types';

let clock = 1_000;
function task(partial: Partial<Task> = {}): Task {
  const ts = (clock += 1_000);
  return {
    id: Math.random().toString(36).slice(2),
    title: 'Something',
    notes: '',
    steps: [],
    tags: [],
    createdAt: ts,
    updatedAt: ts,
    ...partial,
  };
}

describe('ranking', () => {
  it('puts the levels in the order the words imply', () => {
    expect(priorityRank('critical')).toBeLessThan(priorityRank('high'));
    expect(priorityRank('high')).toBeLessThan(priorityRank('medium'));
    expect(priorityRank('medium')).toBeLessThan(priorityRank('low'));
  });

  it('ranks an unset priority after every set one', () => {
    // Undecided is not the same as unimportant. Something you have thought about
    // outranks something you have not - and, more importantly, an unset priority
    // must never float to the top of the list by accident.
    for (const p of PRIORITIES) {
      expect(priorityRank(undefined)).toBeGreaterThan(priorityRank(p));
    }
  });

  it('gives every level a label and a distinct rank', () => {
    expect(new Set(PRIORITIES.map(priorityRank)).size).toBe(PRIORITIES.length);
    for (const p of PRIORITIES) expect(PRIORITY_LABELS[p]).toBeTruthy();
  });
});

describe('how a priority is shown', () => {
  it('fills Critical and outlines High, so they differ without hue', () => {
    // A screen-reader user, a colour-blind user and a sunlit screen all get the
    // same distinction, because it is weight and a word rather than a colour.
    expect(priorityClass('critical')).toContain('badge-critical');
    expect(priorityClass('high')).toContain('badge-high');
  });

  it('leaves Medium and Low as quiet text with no chrome', () => {
    // Most things are medium. A list where every row wears a badge has no
    // hierarchy left in it.
    expect(priorityClass('medium')).not.toContain('badge');
    expect(priorityClass('low')).not.toContain('badge');
    expect(priorityClass('low')).toContain('prio-text-low');
  });

  it('never returns an empty class, which would render an unstyled span', () => {
    for (const p of PRIORITIES) expect(priorityClass(p).trim()).not.toBe('');
  });
});

describe('sortTasks, whichever order is chosen', () => {
  const sample = () => [
    task({ title: 'Zebra crossing form', priority: 'low' }),
    task({ title: 'book dentist', priority: 'critical' }),
    task({ title: 'Order printer ink' }),
    task({ title: 'Ask about the referral', priority: 'high' }),
    task({ title: 'Cancel the gym', priority: 'critical' }),
  ];

  it('never mutates the array it was given', () => {
    // Tasks.tsx sorts a grouped array in place during render; that works by luck.
    // Sorting one list here must never reorder somebody else's.
    for (const { id } of SORTS) {
      const input = sample();
      const before = input.map((t) => t.id);
      sortTasks(input, id);
      expect(input.map((t) => t.id)).toEqual(before);
    }
  });

  it('never drops or duplicates a task', () => {
    for (const { id } of SORTS) {
      const input = sample();
      const out = sortTasks(input, id);
      expect(out).toHaveLength(input.length);
      expect(new Set(out.map((t) => t.id))).toEqual(new Set(input.map((t) => t.id)));
    }
  });

  it('handles an empty list and a single item without special-casing', () => {
    for (const { id } of SORTS) {
      expect(sortTasks([], id)).toEqual([]);
      expect(sortTasks([task({ title: 'Only one' })], id)).toHaveLength(1);
    }
  });
});

describe('the priority order', () => {
  it('leads with Critical and ends with the undecided', () => {
    const out = sortTasks(
      [
        task({ title: 'no priority' }),
        task({ title: 'low', priority: 'low' }),
        task({ title: 'critical', priority: 'critical' }),
        task({ title: 'medium', priority: 'medium' }),
        task({ title: 'high', priority: 'high' }),
      ],
      'priority',
    );
    expect(out.map((t) => t.title)).toEqual(['critical', 'high', 'medium', 'low', 'no priority']);
  });

  it('puts the oldest first within a level, so nothing sinks', () => {
    const older = task({ title: 'waiting since March', priority: 'high' });
    const newer = task({ title: 'added today', priority: 'high' });
    expect(sortTasks([newer, older], 'priority').map((t) => t.title)).toEqual([
      'waiting since March',
      'added today',
    ]);
  });
});

describe('the date orders', () => {
  it('are exact reverses of each other', () => {
    const items = [task({ title: 'first' }), task({ title: 'second' }), task({ title: 'third' })];
    const oldest = sortTasks(items, 'oldest').map((t) => t.title);
    const newest = sortTasks(items, 'newest').map((t) => t.title);
    expect(oldest).toEqual(['first', 'second', 'third']);
    expect(newest).toEqual([...oldest].reverse());
  });

  it('ignore priority entirely, which is the point of offering them', () => {
    const old = task({ title: 'old and low', priority: 'low' });
    const recent = task({ title: 'new and critical', priority: 'critical' });
    expect(sortTasks([recent, old], 'oldest')[0].title).toBe('old and low');
  });
});

describe('A to Z', () => {
  it('ignores case, so one alphabet rather than two', () => {
    const out = sortTasks(
      [task({ title: 'apple' }), task({ title: 'Banana' }), task({ title: 'Cherry' })],
      'az',
    );
    expect(out.map((t) => t.title)).toEqual(['apple', 'Banana', 'Cherry']);
  });

  it('breaks a tie by age rather than leaving it to the engine', () => {
    const first = task({ title: 'Same name' });
    const second = task({ title: 'same name' });
    expect(sortTasks([second, first], 'az').map((t) => t.id)).toEqual([first.id, second.id]);
  });
});

describe('the sort list itself', () => {
  it('offers the four orders, each with a distinct id and a label', () => {
    expect(SORTS).toHaveLength(4);
    expect(new Set(SORTS.map((s) => s.id)).size).toBe(4);
    for (const s of SORTS) expect(s.label.trim()).not.toBe('');
  });

  it('defaults to the most pressing first', () => {
    expect(SORTS[0].id).toBe('priority');
  });
});

describe('groupLabel', () => {
  it('names each level, and names the undecided pile rather than leaving it blank', () => {
    for (const p of PRIORITIES) expect(groupLabel(p)).toBe(PRIORITY_LABELS[p]);
    expect(groupLabel(undefined)).toBe('No priority yet');
  });

  it('never says anything that reads as a telling-off', () => {
    const labels = [...PRIORITIES.map(groupLabel), groupLabel(undefined)].join(' ').toLowerCase();
    for (const word of ['overdue', 'late', 'failed', 'urgent!', 'behind']) {
      expect(labels).not.toContain(word);
    }
  });
});

describe('a task saved before priority existed', () => {
  it('sorts, groups and renders without one', () => {
    const legacy = task({ title: 'Written last year' }) as Task & { priority?: Priority };
    expect(legacy.priority).toBeUndefined();
    expect(() => sortTasks([legacy], 'priority')).not.toThrow();
    expect(groupLabel(legacy.priority)).toBe('No priority yet');
  });
});
