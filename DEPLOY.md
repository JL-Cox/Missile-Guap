# Getting Steady onto your phone

## First, the thing that confuses everyone

**There is no `dist/` folder in this repo, and there shouldn't be.**

`dist/` is *build output* — the finished app, generated from the source code in
`src/`. It only exists after something runs `npm run build`. Committing it would
mean it goes stale the moment anyone edits the source, so it's in `.gitignore`
on purpose.

You do not need to build it yourself. **GitHub will build it for you** every time
you push, using `.github/workflows/deploy.yml`. Your job is to turn that on once.

---

## Step 0: the one decision

Your repo is **private**, and that matters:

| | Works with a private repo? | Cost |
| --- | --- | --- |
| **GitHub Pages** | Only with GitHub Pro | ~$4/month |
| **GitHub Pages**, repo made public | Yes | Free |
| **Cloudflare Pages** | Yes | Free |
| **Netlify** | Yes | Free |

**Making the repo public does not expose your data.** The repo contains the
app's *source code* — the same code you can read in `src/`. Your notes, tasks
and subscriptions live in your phone's browser storage and are never uploaded
anywhere, by anyone, including you. There is no database in this project to
leak. Someone reading the repo learns how the app works, not what you wrote in
it.

That said, if a public repo feels wrong, **Cloudflare Pages is free, works with
private repos, and takes about the same number of clicks.** Jump to
[Option B](#option-b-cloudflare-pages-free-keeps-the-repo-private).

---

## Option A: GitHub Pages

### 1. Make the repo public *(skip if you have GitHub Pro)*

1. Go to **https://github.com/JL-Cox/Missile-Guap/settings**
2. Scroll to the very bottom, to the red **Danger Zone** box
3. Click **Change visibility** → **Change to public**
4. It asks you to type the repo name to confirm. Type `JL-Cox/Missile-Guap`

### 2. Turn on Pages

**This one has to be done by hand, and cannot be automated.** The `GITHUB_TOKEN`
a workflow runs with is not permitted to create a Pages site, so a workflow that
tries fails with the thoroughly unhelpful `Resource not accessible by
integration`. Ten seconds of clicking, once, and never again.

1. Go to **https://github.com/JL-Cox/Missile-Guap/settings/pages**
2. Under **Build and deployment**, find the **Source** dropdown
3. Change it from *Deploy from a branch* to **GitHub Actions**
4. That's it — there is no Save button on this page, it saves as you change it

> **The dropdown matters.** If you leave it on "Deploy from a branch", GitHub
> looks for finished HTML files in your repo, finds only source code, and
> publishes a broken page. "GitHub Actions" tells it to run the build first.
>
> **If you see an upgrade prompt instead of a Source dropdown**, the repository
> is still private. Do step 1 first — the dropdown does not exist until then.

### 3. Run the build

The workflow runs automatically on every push, but it hasn't run since you
enabled Pages, so kick it off by hand once:

1. Go to **https://github.com/JL-Cox/Missile-Guap/actions**
2. Click **Deploy to GitHub Pages** in the left sidebar
3. Click the **Run workflow** dropdown on the right → **Run workflow**
4. Wait about two minutes. Refresh. You want a green tick ✅

If it goes red ❌, click into it and read the failed step. A failure at
**Configure Pages** means step 2 hasn't taken effect — the workflow prints the
exact page to visit and what to set.

### 4. Get the address

Go to **Settings → Pages**. At the top there's now a box saying
*"Your site is live at…"* with a link:

```
https://jl-cox.github.io/Missile-Guap/
```

**The trailing slash matters.** Without it some browsers will 404.

### 5. Install it on your phone

1. Open that URL in **Chrome on your Android phone** (not Samsung Internet or
   Firefox — Chrome handles installed web apps best)
2. Wait for it to fully load — you should see the Today screen
3. Tap the **⋮** menu, top right
4. Tap **Add to Home screen** (it may say **Install app**)
5. Confirm

You now have a Steady icon in your app drawer. Opening it launches full screen,
with no browser address bar. Long-press the icon for shortcuts straight to
*Write something down* or *Add a subscription*.

### 6. Turn on notifications

Open the app → **Settings** → **Allow notifications** → **Allow** when Android
asks.

Then, while you're there, tap **Export everything to my calendar** once. That
hands your reminders to your phone's own calendar, which is the only way to get
alarms that fire whether or not the app is running.

---

## Option B: Cloudflare Pages (free, keeps the repo private)

1. Sign up at **https://dash.cloudflare.com/sign-up** (free, no card needed)
2. In the sidebar: **Workers & Pages** → **Create** → **Pages** tab →
   **Connect to Git**
3. Authorise GitHub, and pick **JL-Cox/Missile-Guap**
4. On the build settings screen, enter exactly:
   - **Framework preset:** `Vite`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - Leave everything else alone. Do **not** set `VITE_BASE` — Cloudflare serves
     from the root, which is the default.
5. **Save and Deploy**, and wait a couple of minutes

You'll get a URL like `https://missile-guap.pages.dev`. Install it on your phone
exactly as in **Step 5** above.

Cloudflare rebuilds automatically every time you push, same as the GitHub
workflow.

### Response headers on Cloudflare or Netlify

`public/_headers` is already in this repo and both hosts read it automatically.
It adds the one security header a `<meta>` tag cannot express
(`frame-ancestors 'none'`), and sets sensible caching. GitHub Pages ignores it —
that costs you nothing beyond a slightly weaker clickjacking defence on a page
that has no login to hijack.

---

## Option C: entirely on your own machine

If you'd rather nothing touched a third party at all, serve `dist/` from a
machine on your home network and reach it over Tailscale or your LAN:

```bash
npm install
npm run build
npx serve dist
```

You need **HTTPS** for the service worker and notifications to work, so put it
behind Caddy (which gets certificates automatically) or use a Tailscale HTTPS
hostname. Plain `http://` over a LAN will load the app but silently disable
offline support and reminders.

---

## Things that will go wrong, and why

**`Resource not accessible by integration` in the Actions log.**
Pages is not switched on yet — step 2. A workflow genuinely cannot do this part
for you, whatever the `configure-pages` action's `enablement` option suggests.

**Blank white screen after installing.**
Almost always a base-path problem — the app built for the wrong folder. The
workflow handles this automatically; if you built by hand, use
`VITE_BASE=Missile-Guap npm run build` for GitHub Pages.

**"Add to Home screen" doesn't appear.**
Either the page isn't on HTTPS, or the service worker hasn't registered yet.
Reload once and wait for the page to finish loading.

**Notifications never fire.**
Expected, if the app has been closed a while — Android stops backgrounded web
apps and there's no push server behind this one, deliberately. Anything missed
is shown when you next open the app. Use the calendar export for anything that
genuinely can't be missed.

**The app doesn't update after you push.**
Check the Actions tab for a green tick, then fully close and reopen the app.
The service worker fetches the new version in the background and swaps it in on
the next launch.

---

## Backups — please read this one

There is **no copy of your data anywhere except that phone**. Clearing Chrome's
site data deletes everything. So does losing the phone.

Storage is shared per *origin*, not per folder. Everything you publish under
`jl-cox.github.io` shares one storage area, so another app you host there could
read Steady's database. Nobody else can - not other apps on the phone, not other
websites - but if that bothers you, put Steady on its own custom domain, or on
Cloudflare Pages where it gets its own hostname.

**Settings → Save a backup file** writes a plain JSON file you can open in any
text editor. Do it occasionally, and keep it somewhere you trust. Restoring
offers two modes:

- **Add what's missing** — keeps everything on the device, only adds records it
  hasn't seen. Safe to run twice; can't delete anything.
- **Wipe and replace** — deletes everything first, then restores the file
  exactly. This is the "new phone" option.

A file Steady didn't write is rejected with an explanation, and nothing changes.

---

## Regenerating the icons

The icons are generated by a script rather than committed as opaque binaries, so
you can check or change them:

```bash
python3 tools/make-icons.py
```

No image library needed.
