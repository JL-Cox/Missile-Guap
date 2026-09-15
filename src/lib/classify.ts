/**
 * Tag suggestions that never leave the device.
 *
 * This is a small Naive Bayes classifier trained on your own already-tagged
 * notes. It is not a language model and it has not read anyone else's writing -
 * which is the point. The corpus is one person's notes in their own vocabulary,
 * so "ring the surgery" comes to mean *health* because that is what it means to
 * you, not because a general-purpose model guessed.
 *
 * It also means the app's central promise survives intact: there is no network
 * call here, and there is nothing to call. The page's `connect-src 'none'`
 * policy stays literally true.
 *
 * Everything in this file is a pure function. No storage, no React, no Dexie -
 * so the behaviour that matters can be tested directly.
 */

/** A tag must appear on at least this many notes before it is ever suggested. */
export const MIN_NOTES_PER_TAG = 3;

/** Nothing is suggested at all until the corpus is at least this big. */
export const MIN_TAGGED_NOTES = 5;

/**
 * How much more likely a tag must be than not-that-tag before we say anything,
 * in nats. Roughly "about three times more likely". Deliberately shy: a wrong
 * suggestion costs more than a missing one, because the whole feature is only
 * worth having if you can stop checking its work.
 */
export const SCORE_MARGIN = 1;

/** Never show more than this many at once. A wall of chips is its own problem. */
export const MAX_SUGGESTIONS = 3;

/**
 * Words too common to carry meaning. Deliberately short - an aggressive list
 * would strip the domain words that make personal notes distinctive.
 */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'was', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'his', 'she',
  'him', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'how', 'its', 'new', 'now', 'old', 'see',
  'two', 'way', 'who', 'did', 'yes', 'this', 'that', 'with', 'have', 'from', 'they', 'been', 'were',
  'them', 'then', 'than', 'will', 'would', 'there', 'their', 'what', 'when', 'your', 'about', 'into',
  'just', 'like', 'some', 'only', 'also', 'back', 'much', 'more', 'over', 'such', 'very', 'need',
]);

export interface CorpusNote {
  text: string;
  tags: string[];
}

export interface Model {
  /** How many notes carry each tag. */
  tagNotes: Record<string, number>;
  /** tag -> token -> how many notes with that tag contained the token. */
  tagTokens: Record<string, Record<string, number>>;
  /** Total token occurrences counted for each tag. */
  tagTotals: Record<string, number>;
  /** The same two, for every note *without* the tag (the one-vs-rest side). */
  restTokens: Record<string, Record<string, number>>;
  restTotals: Record<string, number>;
  /** Distinct tokens across the whole corpus, for smoothing. */
  vocabulary: number;
  /** Notes that carry at least one tag - the only ones that teach us anything. */
  taggedNotes: number;
}

export interface Suggestion {
  tag: string;
  /** Log-odds of the tag against everything else. Higher is more confident. */
  score: number;
  /** The words that actually drove this, so the suggestion can explain itself. */
  because: string[];
}

/**
 * Lowercase, split on anything that isn't a letter or digit, drop very short
 * words and stopwords.
 *
 * No stemming on purpose. The corpus is small, personal and repetitive, so
 * stemming buys little accuracy - and it would wreck the explanation, which is
 * the part that makes a suggestion trustworthy. "dentist" tells you why;
 * a stem does not.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Unique tokens per note rather than raw counts.
 *
 * Repeating a word five times in one note does not make it five times more
 * indicative, and counting it that way lets one rambling note dominate a tag.
 * For short documents this "binarised" form is both simpler and more accurate.
 */
function uniqueTokens(text: string): string[] {
  return [...new Set(tokenize(text))];
}

export function train(notes: CorpusNote[]): Model {
  const model: Model = {
    tagNotes: {},
    tagTokens: {},
    tagTotals: {},
    restTokens: {},
    restTotals: {},
    vocabulary: 0,
    taggedNotes: 0,
  };

  const tagged = notes.filter((n) => n.tags.length > 0);
  model.taggedNotes = tagged.length;
  if (tagged.length === 0) return model;

  const vocabulary = new Set<string>();
  const prepared = tagged.map((note) => {
    const tokens = uniqueTokens(note.text);
    for (const token of tokens) vocabulary.add(token);
    return { tokens, tags: new Set(note.tags) };
  });
  model.vocabulary = vocabulary.size;

  const allTags = new Set(tagged.flatMap((n) => n.tags));
  for (const tag of allTags) {
    model.tagNotes[tag] = 0;
    model.tagTokens[tag] = {};
    model.tagTotals[tag] = 0;
    model.restTokens[tag] = {};
    model.restTotals[tag] = 0;
  }

  for (const { tokens, tags } of prepared) {
    for (const tag of allTags) {
      const hasTag = tags.has(tag);
      if (hasTag) model.tagNotes[tag] += 1;
      const bucket = hasTag ? model.tagTokens[tag] : model.restTokens[tag];
      for (const token of tokens) bucket[token] = (bucket[token] ?? 0) + 1;
      if (hasTag) model.tagTotals[tag] += tokens.length;
      else model.restTotals[tag] += tokens.length;
    }
  }

  return model;
}

/** Laplace add-one smoothing, so one unseen word cannot veto a whole tag. */
function logProb(count: number, total: number, vocabulary: number): number {
  return Math.log((count + 1) / (total + vocabulary + 1));
}

/**
 * Tags worth suggesting for this text, best first.
 *
 * Returns an empty list far more readily than a doubtful guess: below the
 * corpus floor, for tags with too few examples, and whenever the evidence does
 * not clear `SCORE_MARGIN`. Silence is a valid and common answer.
 */
export function suggestTags(model: Model, text: string, existing: string[] = []): Suggestion[] {
  if (model.taggedNotes < MIN_TAGGED_NOTES) return [];

  const tokens = uniqueTokens(text);
  if (tokens.length === 0) return [];

  const already = new Set(existing.map((t) => t.trim().toLowerCase()));
  const out: Suggestion[] = [];

  for (const tag of Object.keys(model.tagNotes)) {
    if (already.has(tag)) continue;
    // One or two uses is a one-off, not a pattern worth learning from.
    if (model.tagNotes[tag] < MIN_NOTES_PER_TAG) continue;

    const withTag = model.tagNotes[tag];
    const withoutTag = model.taggedNotes - withTag;
    if (withoutTag === 0) continue; // nothing to contrast against

    // Start from the prior: a rare tag has to work harder to be suggested.
    let score = Math.log(withTag / model.taggedNotes) - Math.log(withoutTag / model.taggedNotes);

    const contributions: { token: string; weight: number }[] = [];
    for (const token of tokens) {
      /*
        Words this tag has never seen are skipped rather than counted against
        it. Textbook one-vs-rest would penalise them, but on a small personal
        corpus the themes barely overlap, so every money word would count as
        evidence *against* health - and "invoice from the dentist, need a refund
        for the appointment" would end up suggesting nothing at all, which is
        exactly backwards. Absence of evidence is not evidence of absence here.

        Words the tag *has* seen are still weighed against the rest of the
        corpus, so a word common to every note earns close to nothing.
      */
      const seen = model.tagTokens[tag][token] ?? 0;
      if (seen === 0) continue;

      const weight =
        logProb(seen, model.tagTotals[tag], model.vocabulary) -
        logProb(model.restTokens[tag][token] ?? 0, model.restTotals[tag], model.vocabulary);
      score += weight;
      contributions.push({ token, weight });
    }

    if (score <= SCORE_MARGIN) continue;

    const because = contributions
      .filter((c) => c.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map((c) => c.token);

    out.push({ tag, score, because });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, MAX_SUGGESTIONS);
}
