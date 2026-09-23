import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every box you type into says autocomplete="off".
 *
 * Without it, Chrome offers whatever it has remembered from other sites under
 * a field - and, the other way round, it may remember what you typed here and
 * offer it somewhere else. A note about a diagnosis should not turn up as a
 * suggestion in a shop's search box.
 *
 * Checkboxes, radio buttons and file pickers are left out: nothing is typed
 * into them, and the HTML spec does not allow the attribute on them.
 */

const EXEMPT_TYPES = new Set(['checkbox', 'radio', 'file']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

/** Each `<input ...>` / `<textarea ...>` JSX tag in a file, as its raw text. */
function tags(source: string): string[] {
  const out: string[] = [];
  const opener = /<(input|textarea)\b/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source))) {
    // Walk to the tag's own closing '>', skipping any inside {braces}.
    let depth = 0;
    let i = match.index + match[0].length;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0 && source[i - 1] !== '=') break;
    }
    out.push(source.slice(match.index, i + 1));
  }
  return out;
}

describe('text boxes', () => {
  const files = sourceFiles(join(__dirname, '..', 'src'));
  const all = files.flatMap((file) =>
    tags(readFileSync(file, 'utf8')).map((tag) => ({ file: file.slice(file.indexOf('src')), tag })),
  );

  it('finds the boxes it is meant to be checking', () => {
    // Guards the scanner itself: a regex that matched nothing would pass forever.
    expect(all.length).toBeGreaterThan(20);
  });

  it('every one turns autocomplete off', () => {
    const missing = all
      .filter(({ tag }) => !EXEMPT_TYPES.has(/type="([a-z]+)"/.exec(tag)?.[1] ?? 'text'))
      .filter(({ tag }) => !/autoComplete="off"/.test(tag))
      .map(({ file, tag }) => `${file}: ${tag.split('\n')[0].trim()} ${/id="([^"]+)"/.exec(tag)?.[1] ?? ''}`);
    expect(missing).toEqual([]);
  });
});
