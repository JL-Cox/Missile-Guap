import { describe, expect, it } from 'vitest';
import { fitsLowDay, isLowDay, isStaleLowDay } from '../src/lib/lowday';
import type { Task } from '../src/types';

function task(partial: Partial<Task> = {}): Task {
  return { id: 't', title: 'Something', notes: '', steps: [], tags: [], createdAt: 0, updatedAt: 0, ...partial };
}

const today = '2026-09-23';

describe('isLowDay', () => {
  it('is a low day only on the day it was turned on', () => {
    expect(isLowDay({ lowDay: today }, today)).toBe(true);
  });

  // No timer ends it: the date stops matching at midnight, and that is all.
  it('has ended by itself by the next day', () => {
    expect(isLowDay({ lowDay: '2026-09-22' }, today)).toBe(false);
  });

  it('is off when it was never turned on', () => {
    expect(isLowDay({}, today)).toBe(false);
  });
});

describe('isStaleLowDay', () => {
  it('flags one left from an earlier day, so it can be deleted', () => {
    expect(isStaleLowDay({ lowDay: '2026-09-22' }, today)).toBe(true);
    expect(isStaleLowDay({ lowDay: '2025-01-01' }, today)).toBe(true);
  });

  it("leaves today's alone, and has nothing to say when there is none", () => {
    expect(isStaleLowDay({ lowDay: today }, today)).toBe(false);
    expect(isStaleLowDay({}, today)).toBe(false);
  });
});

describe('fitsLowDay', () => {
  it('keeps anything today with a set time', () => {
    expect(fitsLowDay(task({ date: today, startTime: '14:00' }), today)).toBe(true);
  });

  it('does not keep a time on another day - that is not happening today', () => {
    expect(fitsLowDay(task({ date: '2026-09-20', startTime: '14:00' }), today)).toBe(false);
  });

  it('keeps anything marked Critical, wherever it is', () => {
    expect(fitsLowDay(task({ priority: 'critical' }), today)).toBe(true);
    expect(fitsLowDay(task({ date: '2026-09-20', priority: 'critical' }), today)).toBe(true);
  });

  it('keeps what you said you can do even on a low day', () => {
    expect(fitsLowDay(task({ energy: 'low' }), today)).toBe(true);
  });

  it('folds away the rest, including High, which is not Critical', () => {
    expect(fitsLowDay(task({ date: today }), today)).toBe(false);
    expect(fitsLowDay(task({ priority: 'high' }), today)).toBe(false);
    expect(fitsLowDay(task({ energy: 'medium' }), today)).toBe(false);
    expect(fitsLowDay(task({ energy: 'high', date: today }), today)).toBe(false);
  });
});
