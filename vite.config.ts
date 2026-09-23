import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readBuildInfo } from './tools/build-info';

/**
 * The shipped app declares `connect-src 'none'` so the browser itself refuses
 * to let this page talk to the network. Vite's dev server needs a websocket
 * for hot-reload, so we relax exactly that one directive while developing.
 * The production build is never touched.
 */
function relaxCspInDev(): Plugin {
  return {
    name: 'steady:relax-csp-in-dev',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace("connect-src 'none'", "connect-src 'self' ws: wss:");
    },
  };
}

/**
 * Writes the real hashed filenames into the service worker so the very first
 * visit caches everything the app needs. Without this the shell is cached but
 * the JavaScript is not, and going offline after one visit yields a blank page.
 */
/**
 * Where the app will be served from. GitHub Pages puts a project repo at
 * `/<repo-name>/`, not at the domain root, so every absolute path in the app
 * has to know about it. Netlify, Cloudflare Pages and a plain web root all use
 * the default '/'.
 */
function resolveBase(): string {
  const raw = process.env.VITE_BASE?.trim();
  if (!raw || raw === '/') return '/';
  return `/${raw.replace(/^\/+|\/+$/g, '')}/`;
}

const BASE = resolveBase();

/**
 * One build identity, shared by the app bundle and the service worker's cache
 * name, so "which version is on my phone" has a single answer. In CI that is
 * the commit; locally it is the clock, which is enough to make each `npm run
 * build` distinct.
 */
const BUILD_ID = process.env.GITHUB_SHA?.slice(0, 7) ?? `dev-${Date.now().toString(36)}`;

/** The version number and recent changes the About screen shows. See tools/build-info.ts. */
const BUILD_INFO = readBuildInfo();

/**
 * The web manifest lives in public/ and is copied verbatim, so Vite cannot
 * rewrite the paths inside it. Without this, an app served from a subpath
 * installs with a start_url of '/' and opens someone else's website.
 */
function rewriteManifest(): Plugin {
  return {
    name: 'steady:manifest-base',
    apply: 'build',
    writeBundle(options) {
      const dir = options.dir ?? 'dist';
      const path = join(dir, 'manifest.webmanifest');
      const manifest = JSON.parse(readFileSync(path, 'utf8'));
      manifest.start_url = BASE;
      manifest.scope = BASE;
      manifest.icons = manifest.icons.map((icon: { src: string }) => ({
        ...icon,
        src: `${BASE}${icon.src.replace(/^\//, '')}`,
      }));
      if (Array.isArray(manifest.shortcuts)) {
        manifest.shortcuts = manifest.shortcuts.map((s: { url: string }) => ({
          ...s,
          url: `${BASE}${s.url.replace(/^\//, '')}`,
        }));
      }
      writeFileSync(path, JSON.stringify(manifest, null, 2));
    },
  };
}

function precacheServiceWorker(): Plugin {
  return {
    name: 'steady:precache-sw',
    apply: 'build',
    writeBundle(options, bundle) {
      const dir = options.dir ?? 'dist';
      const assets = Object.keys(bundle)
        .filter((name) => !name.endsWith('.map'))
        .map((name) => `${BASE}${name}`);
      const urls = [
        BASE,
        `${BASE}index.html`,
        `${BASE}manifest.webmanifest`,
        `${BASE}icon-192.png`,
        `${BASE}icon-512.png`,
        `${BASE}icon-maskable-512.png`,
        ...assets,
      ];
      const swPath = join(dir, 'sw.js');
      const body = readFileSync(swPath, 'utf8');
      // The cache is named after the build, so a new version never serves stale
      // files and the cache name says which commit produced it.
      const header =
        `self.__BASE__ = ${JSON.stringify(BASE)};\n` +
        `self.__BUILD__ = ${JSON.stringify(BUILD_ID)};\n` +
        `self.__PRECACHE__ = ${JSON.stringify([...new Set(urls)])};\n\n`;
      writeFileSync(swPath, header + body);
    },
  };
}

// No analytics, no CDN, no external anything. Everything ships in the bundle.
export default defineConfig({
  base: BASE,
  define: {
    // Lets the running app recognise that it is a different build than the one
    // it last showed the user. See src/lib/version.ts.
    __APP_BUILD__: JSON.stringify(BUILD_ID),
    __APP_VERSION__: JSON.stringify(BUILD_INFO.version),
    __APP_COMMITS__: JSON.stringify(BUILD_INFO.commits),
  },
  plugins: [react(), relaxCspInDev(), rewriteManifest(), precacheServiceWorker()],
  build: {
    target: 'es2020',
    // Vite's preload helper polyfill carries a fetch() call. The page's CSP
    // would block it anyway, but the app bundle should contain no network
    // code at all, so tools/privacy-check.mjs can refuse any that appears.
    modulePreload: { polyfill: false },
    // Keep the output auditable for anyone who wants to check the claims above.
    sourcemap: true,
  },
});
