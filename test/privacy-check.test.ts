import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The privacy gate is only worth anything if it fails when it should. A check
 * whose pattern quietly matches nothing passes forever, so each rule here is
 * shown a build that breaks it, and must refuse it.
 *
 * The builds are tiny hand-made stand-ins rather than the real dist/, because
 * `npm test` runs before `npm run build` in the deploy workflow.
 */

const TOOL = join(__dirname, '..', 'tools', 'privacy-check.mjs');

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "font-src 'self'; connect-src 'none'; manifest-src 'self'; worker-src 'self'; form-action 'none'; " +
  "base-uri 'self'; object-src 'none'";

const indexHtml = (csp = CSP, extra = '') => `<!doctype html><html><head>
<!-- no fetch, no XHR, no WebSocket: comments never run -->
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<link rel="manifest" href="/manifest.webmanifest" />
<script type="module" crossorigin src="/assets/index-abc.js"></script>
${extra}</head><body><div id="root"></div></body></html>`;

const SW = `const BASE = self.__BASE__ || '/';
const OURS = 'steady-';
const network = (request) => fetch(request);
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((names) =>
    Promise.all(names.filter((n) => n.startsWith(OURS) && n !== 'x').map((n) => caches.delete(n)))));
});
self.addEventListener('notificationclick', () => self.clients.openWindow(BASE));
`;

const CLEAN: Record<string, string> = {
  'dist/index.html': indexHtml(),
  'dist/assets/index-abc.js': 'const ns="http://www.w3.org/2000/svg";console.log(ns);',
  'dist/assets/index-abc.js.map': '{"note":"maps are not shipped code, fetch( here is fine"}',
  'dist/sw.js': SW,
  'dist/manifest.webmanifest': '{"start_url":"/"}',
  'src/lib/share.ts': 'export const go = () => navigator.share({ title: "x" });',
  'src/lib/backup.ts': 'export const u = (b: Blob) => URL.createObjectURL(b);',
  'src/App.tsx': 'export const view = new URLSearchParams(window.location.search).get("view");',
  // A local variable that happens to be called location is not navigation.
  'src/lib/where.ts': 'export const where = () => { const location = "kitchen"; return location === "kitchen"; };',
};

let root = '';
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

function run(changes: Record<string, string> = {}) {
  root = mkdtempSync(join(tmpdir(), 'steady-privacy-'));
  for (const [path, text] of Object.entries({ ...CLEAN, ...changes })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const out = spawnSync(process.execPath, [TOOL, '--dist', join(root, 'dist'), '--src', join(root, 'src')], {
    encoding: 'utf8',
  });
  return { code: out.status, text: `${out.stdout}${out.stderr}` };
}

const failed = (text: string) => text.split('\n').filter((l) => l.startsWith('FAIL')).join('\n');

describe('the privacy gate', () => {
  it('passes a clean build', () => {
    const result = run();
    expect(failed(result.text)).toBe('');
    expect(result.code).toBe(0);
  });

  const refuses: [string, Record<string, string>, RegExp][] = [
    ["a loosened connect-src", { 'dist/index.html': indexHtml(CSP.replace("connect-src 'none'", "connect-src 'self'")) }, /exactly the shipped one/],
    ['a second, looser policy tag', { 'dist/index.html': indexHtml(CSP, `<meta http-equiv="Content-Security-Policy" content="default-src *">`) }, /only one policy tag/],
    ['an inline script', { 'dist/index.html': indexHtml(CSP, '<script>alert(1)</script>') }, /no inline script/],
    ['a script from a CDN', { 'dist/index.html': indexHtml(CSP, '<script src="https://cdn.example.com/x.js"></script>') }, /stays on this app/],
    ['a stylesheet from another site', { 'dist/index.html': indexHtml(CSP, '<link rel="stylesheet" href="//fonts.example.com/a.css">') }, /stays on this app/],
    ['fetch in the app bundle', { 'dist/assets/index-abc.js': 'fetch("/x")' }, /index-abc\.js: no network/],
    ['XMLHttpRequest', { 'dist/assets/index-abc.js': 'new XMLHttpRequest()' }, /no network/],
    ['sendBeacon', { 'dist/assets/index-abc.js': 'navigator.sendBeacon("/x")' }, /no network/],
    ['a WebSocket', { 'dist/assets/index-abc.js': 'new WebSocket("wss://x")' }, /no network/],
    ['eval', { 'dist/assets/index-abc.js': 'eval("1")' }, /no network/],
    ['new Function', { 'dist/assets/index-abc.js': 'new Function("return 1")' }, /no network/],
    ['window.open', { 'dist/assets/index-abc.js': 'window.open("/")' }, /no network/],
    ['a navigation away', { 'dist/assets/index-abc.js': 'location.href = "/x"' }, /no network/],
    ['a minified navigation away', { 'dist/assets/index-abc.js': 'e.location="https://x"' }, /no network/],
    ['navigating from the source', { 'src/lib/go.ts': 'export const go = () => { window.location = "/x" as never; };' }, /no network/],
    ['an unknown web address', { 'dist/assets/index-abc.js': 'const u="https://collect.example.com/p"' }, /inert list/],
    ['an address in the manifest', { 'dist/manifest.webmanifest': '{"start_url":"https://example.com/"}' }, /inert list/],
    ['a second fetch in the service worker', { 'dist/sw.js': `${SW}\nfetch('/again');` }, /exactly once/],
    ['a push handler', { 'dist/sw.js': `${SW}\nself.addEventListener('push', () => {});` }, /push or background-sync/],
    ['a sync handler', { 'dist/sw.js': `${SW}\nself.addEventListener("sync", () => {});` }, /push or background-sync/],
    ['deleting every cache', { 'dist/sw.js': SW.replace('n.startsWith(OURS) && ', '') }, /steady-\*/],
    ['opening another site from a notification', { 'dist/sw.js': SW.replace('openWindow(BASE)', 'openWindow("https://x")') }, /opens the app itself/],
    ['fetch in the source', { 'src/lib/sync.ts': 'export const s = () => fetch("/x");' }, /src\/lib\/sync\.ts: no network/],
    ['a dynamic import', { 'src/lib/load.ts': 'export const l = () => import("./x");' }, /no network/],
    ['a link out of the app', { 'src/views/About.tsx': 'export const A = () => <a href="https://example.com">x</a>;' }, /no network/],
    ['the share sheet somewhere new', { 'src/views/Notes.tsx': 'export const s = () => navigator.share({ text: "note" });' }, /navigator\.share only where/],
    ['a download somewhere new', { 'src/views/Notes.tsx': 'export const d = (b: Blob) => URL.createObjectURL(b);' }, /createObjectURL only where/],
  ];

  for (const [what, change, message] of refuses) {
    it(`refuses ${what}`, () => {
      const result = run(change);
      expect(result.code).toBe(1);
      expect(failed(result.text)).toMatch(message);
    });
  }
});
