# Putting Steady on your phone

Steady is a folder of static files. It needs no server-side code, no database
and no runtime — which is the same reason it cannot leak anything.

```bash
npm install
npm run build     # everything you need is now in dist/
```

Whatever you do next, one rule matters: **it must be served over HTTPS** (or
`localhost`). Service workers and notifications are both disabled on plain
`http://`, so without HTTPS you lose offline support and reminders.

---

## Option 1 — a static host (easiest)

Upload `dist/` to any static host: Netlify, Cloudflare Pages, GitHub Pages,
Vercel, or a folder on a web server you already run. Then open the URL in
Chrome on Android and tap **⋮ → Add to Home screen**. It then launches like any
other app, with no browser chrome.

This is safe despite being "in the cloud" — the host only ever serves the app's
own files to you. Because of `connect-src 'none'`, the running app cannot send
anything back to it, so the host learns nothing beyond the fact that a browser
downloaded some files.

### Response headers worth adding

The app carries its own Content Security Policy in a `<meta>` tag, which covers
everything except one directive that `<meta>` cannot express. If your host lets
you set headers, add:

```
Content-Security-Policy: frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

On Netlify or Cloudflare Pages, put this in `dist/_headers`:

```
/*
  Content-Security-Policy: frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
```

Do **not** add a `Cache-Control` rule that caches `/index.html` or `/sw.js` for a
long time. The hashed files under `/assets/` can be cached forever; those two
must not be, or you will be stuck on an old version.

## Option 2 — entirely on your own machine

If you would rather nothing at all touched a third party, serve `dist/` from a
machine on your home network and reach it over Tailscale, WireGuard or your
LAN. Any static file server will do:

```bash
npx serve dist        # or: python3 -m http.server --directory dist
```

You will need HTTPS for the service worker and notifications, so put it behind
Caddy (which gets certificates automatically) or use a Tailscale HTTPS hostname.

## Option 3 — not hosted at all

Once the app has been loaded once over HTTPS and the service worker has cached
it, it keeps working offline indefinitely, including after the server goes away
for good. `e2e/app-check.mjs` verifies exactly this by killing the server and
reloading the page.

---

## Backups

There is no copy of your data anywhere but this device. Clearing the browser's
site data deletes everything, and so does losing the phone.

**Settings → Save a backup file** writes a plain JSON file you can read in any
text editor. Do it occasionally, and keep the file wherever you keep things you
would hate to lose. Restoring offers two modes:

- **Add what's missing** — keeps everything already on the device and only adds
  records it has not seen before. Safe to run twice; cannot delete anything.
- **Wipe and replace** — deletes everything first, then restores the file
  exactly. This is the "new phone" option.

A file Steady did not write is rejected with an explanation, and nothing is
changed.

## Updating

Rebuild, re-upload `dist/`, and open the app. The service worker fetches the new
version in the background and it appears on the next launch. Your data is
untouched by updates — it lives in IndexedDB, not in the app files.

## Regenerating the icons

The icons are generated from a script rather than committed as opaque binaries,
so you can verify or change them:

```bash
python3 tools/make-icons.py
```

No image library required.
