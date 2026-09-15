import { describe, expect, it } from 'vitest';
import {
  MAX_SUGGESTIONS,
  MIN_NOTES_PER_TAG,
  MIN_TAGGED_NOTES,
  suggestTags,
  tokenize,
  train,
  type CorpusNote,
} from '../src/lib/classify';

/** A corpus big enough to clear the cold-start floor, with two clear themes. */
function healthAndMoneyCorpus(): CorpusNote[] {
  return [
    { text: 'Dentist appointment booked for Tuesday', tags: ['health'] },
    { text: 'Prescription ready to collect from the pharmacy', tags: ['health'] },
    { text: 'Dentist said to book a hygienist appointment too', tags: ['health'] },
    { text: 'Invoice from the plumber needs paying', tags: ['money'] },
    { text: 'Refund for the invoice finally came through', tags: ['money'] },
    { text: 'Paid the invoice, got a refund on the overcharge', tags: ['money'] },
  ];
}

describe('tokenize', () => {
  it('lowercases and splits on punctuation', () => {
    expect(tokenize('Dentist, appointment!')).toEqual(['dentist', 'appointment']);
  });

  it('drops words too short to carry meaning', () => {
    expect(tokenize('go to my GP')).not.toContain('go');
    expect(tokenize('go to my GP')).not.toContain('gp');
  });

  it('drops stopwords', () => {
    expect(tokenize('this is about the thing')).toEqual(['thing']);
  });

  it('keeps numbers, which carry meaning in reference numbers', () => {
    expect(tokenize('account 12345')).toContain('12345');
  });

  it('survives empty and punctuation-only input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('!!! ... ???')).toEqual([]);
  });
});

describe('cold start - says nothing until it has learned from you', () => {
  it('suggests nothing with no notes at all', () => {
    expect(suggestTags(train([]), 'dentist appointment')).toEqual([]);
  });

  it('suggests nothing below the corpus floor', () => {
    const few = healthAndMoneyCorpus().slice(0, MIN_TAGGED_NOTES - 1);
    expect(suggestTags(train(few), 'dentist appointment')).toEqual([]);
  });

  it('ignores untagged notes when counting the corpus', () => {
    // Plenty of notes, but none of them tagged, so there is nothing to learn.
    const untagged = Array.from({ length: 20 }, (_, i) => ({ text: `note ${i} dentist`, tags: [] }));
    expect(suggestTags(train(untagged), 'dentist appointment')).toEqual([]);
  });
});

describe('a tag has to be a pattern, not a one-off', () => {
  it('never suggests a tag used only once or twice', () => {
    const corpus = [
      ...healthAndMoneyCorpus(),
      { text: 'Boiler service due at the flat', tags: ['house'] },
      { text: 'Boiler service engineer coming Thursday', tags: ['house'] },
    ];
    const suggestions = suggestTags(train(corpus), 'Boiler service reminder');
    expect(suggestions.map((s) => s.tag)).not.toContain('house');
  });

  it('becomes eligible once it reaches the threshold', () => {
    const corpus = [
      ...healthAndMoneyCorpus(),
      ...Array.from({ length: MIN_NOTES_PER_TAG }, (_, i) => ({
        text: `Boiler service visit number ${i}`,
        tags: ['house'],
      })),
    ];
    const suggestions = suggestTags(train(corpus), 'Boiler service booked again');
    expect(suggestions.map((s) => s.tag)).toContain('house');
  });
});

describe('it learns the vocabulary you actually use', () => {
  const model = train(healthAndMoneyCorpus());

  it('suggests the right tag for a new note on a known theme', () => {
    const suggestions = suggestTags(model, 'Need to ring the dentist about that appointment');
    expect(suggestions[0].tag).toBe('health');
    expect(suggestions.map((s) => s.tag)).not.toContain('money');
  });

  it('separates the other theme just as cleanly', () => {
    const suggestions = suggestTags(model, 'Chase the refund on that invoice');
    expect(suggestions[0].tag).toBe('money');
    expect(suggestions.map((s) => s.tag)).not.toContain('health');
  });

  it('can suggest more than one tag when a note genuinely spans both', () => {
    const suggestions = suggestTags(model, 'Invoice from the dentist, need a refund for the appointment');
    expect(suggestions.map((s) => s.tag).sort()).toEqual(['health', 'money']);
  });
});

describe('it stays quiet rather than guessing', () => {
  const model = train(healthAndMoneyCorpus());

  it('says nothing about a note with no familiar words', () => {
    expect(suggestTags(model, 'Kayaking route along the estuary')).toEqual([]);
  });

  it('says nothing about empty text', () => {
    expect(suggestTags(model, '')).toEqual([]);
    expect(suggestTags(model, '   ')).toEqual([]);
  });

  it('is not fired by a single incidental word', () => {
    // Skipping unseen words (so mixed notes work) makes the model more willing
    // to speak, so this guards the other side: one familiar word in passing is
    // not enough evidence on its own.
    expect(suggestTags(model, 'Booked the campsite for August')).toEqual([]);
  });

  it('never repeats a tag the note already carries', () => {
    const suggestions = suggestTags(model, 'Dentist appointment on Tuesday', ['health']);
    expect(suggestions.map((s) => s.tag)).not.toContain('health');
  });

  it('matches existing tags case-insensitively, as the tag input normalises them', () => {
    const suggestions = suggestTags(model, 'Dentist appointment on Tuesday', ['HEALTH']);
    expect(suggestions.map((s) => s.tag)).not.toContain('health');
  });
});

describe('suggestions explain themselves', () => {
  const model = train(healthAndMoneyCorpus());

  it('names words that are actually in the note', () => {
    const [top] = suggestTags(model, 'Ring the dentist about the appointment');
    expect(top.because.length).toBeGreaterThan(0);
    for (const word of top.because) {
      expect(tokenize('Ring the dentist about the appointment')).toContain(word);
    }
  });

  it('picks the distinctive word over the incidental one', () => {
    const [top] = suggestTags(model, 'Ring the dentist about the appointment');
    expect(top.because).toContain('dentist');
  });

  it('never claims more than three reasons', () => {
    const [top] = suggestTags(model, 'dentist appointment prescription pharmacy hygienist booked');
    expect(top.because.length).toBeLessThanOrEqual(3);
  });
});

describe('it never floods the screen', () => {
  it(`caps at ${MAX_SUGGESTIONS} suggestions`, () => {
    // Five themes, all of which the note mentions by name.
    const themes = ['health', 'money', 'house', 'work', 'family'];
    const corpus: CorpusNote[] = themes.flatMap((tag) =>
      Array.from({ length: MIN_NOTES_PER_TAG }, (_, i) => ({
        text: `${tag}word ${tag}word ${tag}thing number ${i}`,
        tags: [tag],
      })),
    );
    const text = themes.map((t) => `${t}word ${t}thing`).join(' ');
    expect(suggestTags(train(corpus), text).length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
  });

  it('returns the most confident first', () => {
    const suggestions = suggestTags(
      train(healthAndMoneyCorpus()),
      'Invoice from the dentist, need a refund for the appointment',
    );
    for (let i = 1; i < suggestions.length; i++) {
      expect(suggestions[i - 1].score).toBeGreaterThanOrEqual(suggestions[i].score);
    }
  });
});

describe('train', () => {
  it('counts only tagged notes towards the corpus', () => {
    const model = train([...healthAndMoneyCorpus(), { text: 'Something untagged', tags: [] }]);
    expect(model.taggedNotes).toBe(healthAndMoneyCorpus().length);
  });

  it('records how many notes carry each tag', () => {
    const model = train(healthAndMoneyCorpus());
    expect(model.tagNotes.health).toBe(3);
    expect(model.tagNotes.money).toBe(3);
  });

  it('handles a corpus where every note carries the same single tag', () => {
    // There is nothing to contrast against, so it must not crash or suggest.
    const corpus = Array.from({ length: 10 }, (_, i) => ({ text: `dentist visit ${i}`, tags: ['health'] }));
    expect(() => train(corpus)).not.toThrow();
    expect(suggestTags(train(corpus), 'dentist visit')).toEqual([]);
  });
});
