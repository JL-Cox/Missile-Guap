import { execFileSync } from 'node:child_process';

/**
 * What the About screen knows about the app itself: a version number and the
 * last few changes. Read from git once, when the app is built, and written into
 * the bundle as plain text - so opening About never asks anything of anyone.
 *
 * The version is the number of commits in the history. That counts every build
 * that ever shipped, including the ones from before About existed, and it only
 * ever goes up. A shallow clone would count only the commits it fetched, so a
 * shallow history gives no number at all rather than a wrong one - which is why
 * the deploy workflow checks out the full history.
 *
 * Only the date and the one-line subject of each commit are taken. Nothing from
 * the body, and no author names or email addresses. The repository is public, so
 * none of this is new information, but the bundle has no reason to carry it.
 *
 * Commit subjects end up in the published files, and the privacy gate reads
 * those files as they are. A subject that mentions a banned call like `fetch(`
 * will stop a deploy, which is the gate working, not a bug to route around.
 */

export interface CommitLine {
  /** YYYY-MM-DD, the day the commit was made. */
  date: string;
  subject: string;
}

export interface BuildInfo {
  /** Commits in the history, or null when it could not be counted honestly. */
  version: number | null;
  commits: CommitLine[];
}

/** Separates date from subject in the git log output. Cannot appear in a subject line. */
const SEP = '\x1f';

/**
 * Keeps a commit subject to what the About screen needs: words.
 *
 * Web addresses and email addresses are taken out, so the bundle never gains a
 * URL the privacy gate would have to be told about. Long subjects are cut at a
 * word, because this is a list to glance at.
 */
export function cleanSubject(subject: string, max = 100): string {
  let out = subject
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '')
    .replace(/\S+@\S+\.\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (out.length > max) {
    const cut = out.slice(0, max);
    const space = cut.lastIndexOf(' ');
    out = `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`;
  }
  return out;
}

/** Turns `git log --format=%cs<SEP>%s` output into commit lines, skipping anything malformed. */
export function parseLog(text: string, limit = 10): CommitLine[] {
  const commits: CommitLine[] = [];
  for (const line of text.split('\n')) {
    const at = line.indexOf(SEP);
    if (at < 0) continue;
    const date = line.slice(0, at).trim();
    const subject = cleanSubject(line.slice(at + 1));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !subject) continue;
    commits.push({ date, subject });
    if (commits.length >= limit) break;
  }
  return commits;
}

/** A positive whole number from `git rev-list --count`, or null. */
export function parseCount(text: string): number | null {
  const n = Number(text.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Asks git. Any failure - no git installed, not a repository, a tarball build -
 * gives an About screen with no number and no list, never a failed build.
 */
export function readBuildInfo(cwd: string = process.cwd()): BuildInfo {
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  let version: number | null = null;
  let commits: CommitLine[] = [];
  try {
    const shallow = git('rev-parse', '--is-shallow-repository').trim() === 'true';
    version = shallow ? null : parseCount(git('rev-list', '--count', 'HEAD'));
  } catch {
    version = null;
  }
  try {
    commits = parseLog(git('log', '-10', `--format=%cs${SEP}%s`));
  } catch {
    commits = [];
  }
  return { version, commits };
}
