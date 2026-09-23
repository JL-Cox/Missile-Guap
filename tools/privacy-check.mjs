/**
 * The privacy gate. Runs after `npm run build` and before anything is
 * published, and fails the deploy if the build could send your data anywhere.
 *
 *     npm run build && npm run privacy
 *
 * The browser already enforces most of this: the page's Content Security
 * Policy says `connect-src 'none'`, so fetch, XHR, WebSocket and beacons are
 * refused at runtime. This check is the second lock. It reads the files that
 * are about to be published and refuses them if:
 *
 *   - the CSP is not exactly the one this app ships with, or any directive has
 *     been loosened;
 *   - index.html has an inline script, or loads anything from another address;
 *   - any shipped file contains code that could reach the network or open
 *     another site (fetch is allowed only in the service worker, once);
 *   - any shipped file mentions a web address that is not on the short list of
 *     inert strings below;
 *   - the service worker has grown a push or sync handler, or could delete a
 *     cache that is not its own;
 *   - the source uses the share sheet or file downloads anywhere other than
 *     the one place each is used today.
 *
 * Plain Node, no dependencies, so there is nothing to install and nothing that
 * could itself talk to the network.
 *
 * `--dist <dir>` and `--src <dir>` point it elsewhere, which is how
 * test/privacy-check.test.ts proves each rule really fires.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DIST = arg('--dist', 'dist');
const SRC = arg('--src', 'src');

/** The policy index.html ships with, character for character. */
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "font-src 'self'; connect-src 'none'; manifest-src 'self'; worker-src 'self'; form-action 'none'; " +
  "base-uri 'self'; object-src 'none'";

/**
 * Things that reach the network, run strings as code, or leave for another
 * site. `fetch(` is here too; the service worker is the one exception, checked
 * separately below.
 */
const BANNED = [
  ['XMLHttpRequest', /XMLHttpRequest/],
  ['sendBeacon', /sendBeacon/],
  ['WebSocket', /WebSocket/],
  ['EventSource', /EventSource/],
  ['RTCPeerConnection', /RTCPeerConnection/],
  ['importScripts', /importScripts/],
  ['new Function', /new\s+Function\b/],
  ['eval(', /\beval\s*\(/],
  ['window.open', /window\.open\b/],
  ['location.assign / location.replace', /location\.(assign|replace)\b/],
  // Not a local variable that happens to be called `location`.
  ['assigning location', /(?<!\b(?:const|let|var)\s+)\blocation(?:\.href)?\s*=(?!=)/],
  ['fetch(', /\bfetch\s*\(/],
];

/**
 * Web addresses that appear in the bundle but are never visited. Each was
 * checked by hand: XML namespace names React uses to create SVG and MathML
 * elements, and links inside React's and Dexie's own error messages. None is
 * ever requested - and if one were, the CSP would refuse it.
 */
const INERT_URLS = new Set([
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/XML/1998/namespace',
  'https://reactjs.org/docs/error-decoder.html?invariant=',
  'http://bit.ly/2kdckMn',
  'https://tinyurl.com/y2uuvskb',
]);

/** Where each outward door is allowed to be, and nowhere else. */
const ONLY_IN = [
  ['navigator.share', /navigator\.share\s*\(/, ['lib/share.ts']],
  ['URL.createObjectURL', /createObjectURL\s*\(/, ['lib/backup.ts']],
];

const problems = [];
let checks = 0;
const check = (label, ok, detail = '') => {
  checks++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
  if (!ok) problems.push(label);
};

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const rel = (root, path) => relative(root, path).split(sep).join('/');

/** HTML comments explain things; they never run. */
const withoutHtmlComments = (text) => text.replace(/<!--[\s\S]*?-->/g, '');

// --- index.html ------------------------------------------------------------
const indexPath = join(DIST, 'index.html');
if (!existsSync(indexPath)) {
  console.error(`No ${indexPath}. Run \`npm run build\` first.`);
  process.exit(1);
}
const index = withoutHtmlComments(readFileSync(indexPath, 'utf8'));

const cspTag = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(index);
check('index.html carries the Content Security Policy', Boolean(cspTag));
check(
  "the policy is exactly the shipped one, connect-src 'none' included",
  cspTag?.[1] === CSP,
  `got: ${cspTag?.[1] ?? '(none)'}`,
);
check(
  'there is only one policy tag, so none can loosen it',
  (index.match(/http-equiv="Content-Security-Policy"/gi) ?? []).length === 1,
);

const scripts = [...index.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
check('index.html loads at least one script', scripts.length > 0);
check(
  'no inline script: every <script> has a src',
  scripts.every((tag) => /\ssrc="/i.test(tag)),
  scripts.filter((tag) => !/\ssrc="/i.test(tag)).join(' '),
);

// The base the app was built for, read off its own module script, so this
// works for a root build and a /Missile-Guap/ build alike.
const moduleSrc = /<script\b[^>]*type="module"[^>]*\ssrc="([^"]+)"/i.exec(index)?.[1] ?? '';
const base = moduleSrc.includes('assets/') ? moduleSrc.slice(0, moduleSrc.indexOf('assets/')) : '';
check('the app script is served from the app itself', /^\/([\w.-]+\/)*$/.test(base), `script src: ${moduleSrc}`);

const links = [...index.matchAll(/\s(?:src|href)="([^"]*)"/gi)].map((m) => m[1]);
const foreign = links.filter((url) => /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//') || (url.startsWith('/') && !url.startsWith(base)));
check('every src and href in index.html stays on this app', foreign.length === 0, foreign.join(' '));

// --- every shipped file ----------------------------------------------------
const shipped = walk(DIST).filter((p) => /\.(js|css|html|webmanifest)$/.test(p) && !p.endsWith('.map'));
check('found the built files to check', shipped.some((p) => p.endsWith('.js')));

for (const path of shipped) {
  const name = rel(DIST, path);
  const raw = readFileSync(path, 'utf8');
  const text = name.endsWith('.html') ? withoutHtmlComments(raw) : raw;
  const isWorker = name === 'sw.js';
  const hits = BANNED.filter(([label, re]) => !(isWorker && label === 'fetch(') && re.test(text)).map(([l]) => l);
  check(`${name}: no network or navigation code`, hits.length === 0, hits.join(', '));

  const urls = [...text.matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)].map((m) => m[0]);
  const unknown = [...new Set(urls.filter((u) => !INERT_URLS.has(u)))];
  check(`${name}: no web address outside the inert list`, unknown.length === 0, unknown.join(' '));
}

// --- the service worker ----------------------------------------------------
const swPath = join(DIST, 'sw.js');
check('the service worker was built', existsSync(swPath));
if (existsSync(swPath)) {
  const sw = readFileSync(swPath, 'utf8');
  check('sw.js calls fetch exactly once', (sw.match(/\bfetch\s*\(/g) ?? []).length === 1);
  check(
    'sw.js has no push or background-sync handler',
    !/addEventListener\(\s*['"](push|sync|periodicsync|backgroundfetch\w*)['"]/.test(sw) &&
      !/\bon(push|sync|periodicsync)\s*=/.test(sw),
  );
  const deletes = sw.split('\n').filter((line) => line.includes('caches.delete'));
  check(
    "sw.js only ever deletes caches named steady-*",
    /const OURS = 'steady-';/.test(sw) && deletes.length > 0 && deletes.every((l) => l.includes('startsWith(OURS)')),
    deletes.join('\n        '),
  );
  const opens = [...sw.matchAll(/openWindow\(([^)]*)\)/g)].map((m) => m[1].trim());
  check('sw.js only ever opens the app itself', opens.every((a) => a === 'BASE'), opens.join(', '));
}

// --- the source ------------------------------------------------------------
const sources = walk(SRC).filter((p) => /\.(ts|tsx|js|mjs)$/.test(p));
check('found the source to check', sources.length > 0);
for (const path of sources) {
  const name = rel(SRC, path);
  const text = readFileSync(path, 'utf8');
  const hits = BANNED.filter(([, re]) => re.test(text)).map(([l]) => l);
  if (/\bimport\s*\(/.test(text)) hits.push('dynamic import()');
  if (/href=["'{`]*https?:/.test(text)) hits.push('a link to another site');
  if (/\.action\s*=(?!=)|formAction=/.test(text)) hits.push('a form action');
  check(`src/${name}: no network or navigation code`, hits.length === 0, hits.join(', '));
  for (const [label, re, allowed] of ONLY_IN) {
    if (re.test(text)) check(`src/${name}: ${label} only where it is used today`, allowed.includes(name), `allowed in: ${allowed.join(', ')}`);
  }
}

console.log(`\n${checks} checks.`);
if (problems.length) {
  console.error(`${problems.length} privacy check(s) failed. Nothing should be published until they pass.`);
  process.exit(1);
}
console.log('Privacy checks passed.');
