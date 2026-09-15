import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { suggestTags, train, type Model, type Suggestion } from '../lib/classify';
import type { Note } from '../types';

/**
 * Tag suggestions, offered as chips you tap. Never applied for you.
 *
 * The chips look and behave like the category chips on the Money screen, so
 * this reads as part of the app rather than something bolted on.
 */

/**
 * Trains on your own tagged notes, recomputing only when the notes actually
 * change.
 *
 * The model is deliberately not stored anywhere. Training is one pass over a
 * few hundred short notes - fast enough to disappear into a render - whereas
 * persisting it would mean a database migration, changes to backup and restore,
 * and a cache that can quietly go stale and start suggesting from notes you
 * deleted months ago. Recomputing is both simpler and more honest.
 */
export function useTagModel(): Model | null {
  const notes = useLiveQuery(() => db.notes.toArray(), [], undefined);
  return useMemo(() => {
    if (!notes) return null;
    return train(notes.map((n: Note) => ({ text: `${n.title}\n${n.body}`, tags: n.tags })));
  }, [notes]);
}

export function useSuggestions(model: Model | null, text: string, existing: string[]): Suggestion[] {
  return useMemo(() => {
    if (!model) return [];
    return suggestTags(model, text, existing);
  }, [model, text, existing.join(',')]);
}

/**
 * Renders nothing at all when there is nothing to suggest - no empty row, no
 * "no suggestions yet" placeholder. A screen that keeps the same shape whether
 * or not the classifier has an opinion is one less thing to interpret.
 */
export default function TagSuggestions({
  suggestions,
  onAdd,
  label = 'Suggested tags',
}: {
  suggestions: Suggestion[];
  onAdd: (tag: string) => void;
  label?: string;
}) {
  if (suggestions.length === 0) return null;

  return (
    <div className="stack-sm">
      <span className="faint">{label} - tap to add, or ignore them</span>
      <div className="btn-row">
        {suggestions.map((s) => (
          <button key={s.tag} type="button" className="btn btn-sm" onClick={() => onAdd(s.tag)}>
            + {s.tag}
          </button>
        ))}
      </div>
      {/* Saying why makes the suggestion checkable instead of something to take on faith. */}
      {suggestions[0].because.length > 0 && (
        <span className="faint">
          Because you have used {suggestions.map((s) => `"${s.tag}"`).join(' and ')} on notes mentioning{' '}
          {[...new Set(suggestions.flatMap((s) => s.because))].slice(0, 4).join(', ')}.
        </span>
      )}
    </div>
  );
}
