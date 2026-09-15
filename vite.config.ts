import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

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
function precacheServiceWorker(): Plugin {
  return {
    name: 'steady:precache-sw',
    apply: 'build',
    writeBundle(options, bundle) {
      const dir = options.dir ?? 'dist';
      const assets = Object.keys(bundle)
        .filter((name) => !name.endsWith('.map'))
        .map((name) => `/${name}`);
      const urls = [
        '/',
        '/index.html',
        '/manifest.webmanifest',
        '/icon-192.png',
        '/icon-512.png',
        '/icon-maskable-512.png',
        ...assets,
      ];
      const swPath = join(dir, 'sw.js');
      const body = readFileSync(swPath, 'utf8');
      // A content hash in the cache name means a new build never serves stale files.
      const build = createHash('sha256').update(urls.join('|')).digest('hex').slice(0, 12);
      const header = `self.__BUILD__ = ${JSON.stringify(build)};\nself.__PRECACHE__ = ${JSON.stringify([...new Set(urls)])};\n\n`;
      writeFileSync(swPath, header + body);
    },
  };
}

// No analytics, no CDN, no external anything. Everything ships in the bundle.
export default defineConfig({
  plugins: [react(), relaxCspInDev(), precacheServiceWorker()],
  build: {
    target: 'es2020',
    // Keep the output auditable for anyone who wants to check the claims above.
    sourcemap: true,
  },
});
