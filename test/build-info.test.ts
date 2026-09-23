import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { cleanSubject, parseCount, parseLog, readBuildInfo } from '../tools/build-info';
import { CHANGES } from '../src/lib/changelog';
import { versionLabel } from '../src/lib/version';

const SEP = '\x1f';

describe('reading the git log for the About screen', () => {
  it('takes the date and subject of each line', () => {
    const log = `2026-09-23${SEP}Add an About page\n2026-09-20${SEP}Fix the thing\n`;
    expect(parseLog(log)).toEqual([
      { date: '2026-09-23', subject: 'Add an About page' },
      { date: '2026-09-20', subject: 'Fix the thing' },
    ]);
  });

  it('stops at ten', () => {
    const log = Array.from({ length: 15 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}${SEP}Change ${i}`).join('\n');
    expect(parseLog(log)).toHaveLength(10);
  });

  it('skips lines that are not a dated commit, rather than showing junk', () => {
    const log = `not a commit\nyesterday${SEP}Bad date\n2026-09-23${SEP}   \n2026-09-23${SEP}Good`;
    expect(parseLog(log)).toEqual([{ date: '2026-09-23', subject: 'Good' }]);
  });

  it('never carries a web address or an email address into the app', () => {
    expect(cleanSubject('See https://example.com/x for why')).toBe('See for why');
    expect(cleanSubject('Thanks to someone@example.com for this')).toBe('Thanks to for this');
    expect(cleanSubject('Read www.example.org first')).toBe('Read first');
  });

  it('cuts a long subject at a word, with an ellipsis', () => {
    const long = 'word '.repeat(40).trim();
    const out = cleanSubject(long);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out.endsWith('word…')).toBe(true);
  });

  it('counts only a real positive number', () => {
    expect(parseCount('21\n')).toBe(21);
    expect(parseCount('0')).toBeNull();
    expect(parseCount('')).toBeNull();
    expect(parseCount('fatal: not a git repository')).toBeNull();
  });

  it('gives an empty answer, not a failed build, outside a repository', () => {
    expect(readBuildInfo('/')).toEqual({ version: null, commits: [] });
  });

  it('agrees with git in this repository', () => {
    const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim() === 'true';
    const info = readBuildInfo();
    if (shallow) {
      expect(info.version).toBeNull();
    } else {
      const count = Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim());
      expect(info.version).toBe(count);
    }
    expect(info.commits.length).toBeGreaterThan(0);
    expect(info.commits.length).toBeLessThanOrEqual(10);
  });
});

describe("what's new", () => {
  it('is newest first, one entry per version', () => {
    const versions = CHANGES.map((c) => c.version);
    expect(versions).toEqual([...versions].sort((a, b) => b - a));
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('stays brief: a few short bullets per version', () => {
    for (const entry of CHANGES) {
      expect(entry.items.length, `version ${entry.version}`).toBeGreaterThan(0);
      expect(entry.items.length, `version ${entry.version}`).toBeLessThanOrEqual(8);
      for (const item of entry.items) {
        expect(item.length, item).toBeLessThanOrEqual(90);
        expect(item.trim()).toBe(item);
      }
    }
  });

  it('never mentions a web address', () => {
    for (const item of CHANGES.flatMap((c) => c.items)) {
      expect(item).not.toMatch(/https?:|www\./i);
    }
  });
});

describe('the version label', () => {
  it('names the number, or says plainly there is none', () => {
    expect(versionLabel(21)).toBe('Version 21');
    expect(versionLabel(null)).toBe('Development version');
  });
});
