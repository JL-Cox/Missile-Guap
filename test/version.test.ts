import { describe, expect, it } from 'vitest';
import { BUILD_ID, updateNotice } from '../src/lib/version';

describe('updateNotice', () => {
  it('says nothing on a first-ever launch', () => {
    // Nothing has been updated *from*, so there is nothing to announce - but we
    // still record where this install started, or the next release would look
    // like a first run all over again.
    expect(updateNotice(undefined, 'abc1234')).toEqual({ show: false, next: 'abc1234' });
  });

  it('treats an empty stored build as a first launch', () => {
    expect(updateNotice('', 'abc1234')).toEqual({ show: false, next: 'abc1234' });
  });

  it('says nothing when the build has not changed', () => {
    expect(updateNotice('abc1234', 'abc1234')).toEqual({ show: false, next: 'abc1234' });
  });

  it('speaks up when the build has changed', () => {
    expect(updateNotice('abc1234', 'def5678')).toEqual({ show: true, next: 'def5678' });
  });

  it('always reports the current build as the one to record', () => {
    // Whatever it decides to show, the caller must end up storing the build the
    // user is actually looking at - otherwise the notice repeats every launch.
    for (const seen of [undefined, '', 'old', 'new']) {
      expect(updateNotice(seen, 'new').next).toBe('new');
    }
  });

  it('does not repeat itself once the new build has been recorded', () => {
    const first = updateNotice('old', 'new');
    expect(first.show).toBe(true);
    expect(updateNotice(first.next, 'new').show).toBe(false);
  });

  it('defaults to this bundle\'s own build id', () => {
    expect(updateNotice(BUILD_ID).show).toBe(false);
    expect(updateNotice('something else').show).toBe(true);
  });
});

describe('BUILD_ID', () => {
  it('is always a non-empty string, even without Vite\'s define step', () => {
    expect(typeof BUILD_ID).toBe('string');
    expect(BUILD_ID.length).toBeGreaterThan(0);
  });
});
