# AccessLens — Website Accessibility Auditor

Paste a URL, get an accessibility report. AccessLens checks a page for
**color contrast issues**, **missing alt text**, and **keyboard navigation
problems** — and gives a concrete fix for every issue it finds.

Everything runs locally: the server fetches the page once, parses the HTML and
all of its CSS, runs the checks, and returns a scored report. Nothing is stored,
no external services are called.

## Quick start

```bash
npm install
npm start
# → http://localhost:3000
```

Paste a URL (e.g. `example.com`) and hit **Scan page**. There is also a
**"a page full of planted issues"** sample button that audits a local fixture
page (`public/fixtures/messy-page.html`) with deliberately broken markup — handy
to see the report in action.

## What it checks

| Category | Checks | WCAG |
|---|---|---|
| **Color contrast** | Text vs. background ratio for every element with a declared text color, incl. large-text (3:1) vs. normal (4.5:1) thresholds, alpha compositing, CSS variables, gradients, `@media` blocks. Suggests a replacement color that passes. | 1.4.3 |
| **Images & alt text** | Missing/empty/filename/generic alt text, image links with no accessible name, image buttons & image-map areas, unlabeled inline SVGs, `role="img"` without a label, generic link text. | 1.1.1, 2.4.4 |
| **Keyboard access** | Positive `tabindex`, `onclick` on non-interactive elements with no keyboard path, anchors without `href`, `outline: none` on focus without a replacement, missing skip link, zoom-blocking viewport meta, mouse-only hover handlers, `aria-hidden` over focusable content. | 2.1.1, 2.4.3, 2.4.7, 2.4.1, 1.4.4 |
| **Structure & semantics** | Missing `lang` / `<title>`, unlabeled form fields, heading hierarchy, empty buttons, duplicate IDs, untitled iframes. | 1.3.1, 2.4.2, 3.1.1, 3.3.2, 4.1.1, 4.1.2 |

Each issue carries: severity (critical / warning / info), the CSS rule or
element path where it occurs, the offending snippet, the WCAG success criterion
with a link, and a **How to fix** suggestion (contrast issues include a computed
replacement color, e.g. "darken to `#757575` — 4.61:1").

## The report

- **Score 0–100** — weighted penalty per issue (capped so one repeated mistake
  can't zero out a page). It's a summary, not a certification.
- **Filterable** by category and severity; issues of the same kind are grouped
  with an affected-element count.
- **Passed checks** panel for everything that was tested and found healthy.
- **Copy report** (Markdown) and **Download JSON** for further processing.

## API

```
POST /api/audit   { "url": "https://example.com" }
→ 200 { score, summary, categories[], passed[], stats, ... }
→ 400/502 { error }
```

```bash
curl -s -X POST http://localhost:3000/api/audit \
  -H "Content-Type: application/json" \
  -d '{"url":"example.com"}'
```

`PORT=8080 npm start` to change the port.

## Hosting

The app reads `PORT` from the environment and serves `/api/health`, so it runs
on any platform that hosts a long-running Node service. Deploy files included:

- `render.yaml` — Render blueprint (free plan, health check wired up)
- `Procfile` — for Railway / Heroku-style platforms
- `Dockerfile` — for anything that runs containers (Fly.io, Cloud Run, a VPS…)

Typical paths:

- **Vercel (free):** the repo is Vercel-ready — `public/` is served statically
  and `api/audit.js` runs as a serverless function at the same `/api/audit`
  path the frontend already calls. Deploy with the CLI (`npm i -g vercel`,
  then `vercel` from this folder) or import the GitHub repo at vercel.com.
  Cold starts after idle add ~1–2 s to the first audit; Hobby allows up to
  300 s per audit.
- **Render (free):** push this folder to a GitHub repo → render.com →
  New → Web Service → connect the repo. The blueprint sets everything else.
  Free services sleep after 15 minutes idle and wake in ~30–60 s.
- **Railway / Fly.io (CLI, no GitHub needed):** `railway up` or `flyctl launch`
  from this folder.
- **Google Cloud Run:** `gcloud run deploy --source .` (uses the Dockerfile).
- **Local network:** `npm start` and open `http://<your-lan-ip>:3000` from any
  device on the same Wi-Fi.

Note: Vercel works via the thin adapter in `api/audit.js` (static frontend +
one serverless function). Other serverless platforms (Netlify, Cloudflare
Workers) would need a similar adapter or a rewrite — Workers can't run jsdom
at all.

## Project structure

```
server.js              Express server + /api/audit endpoint (local use)
api/audit.js           Vercel serverless adapter for the same endpoint
lib/
  audit.js             Orchestrates fetch → parse → checks → scored report
  fetcher.js           Timeout/size-capped fetching (page + stylesheets)
  css-tools.js         CSS parser, selector helpers, color/contrast math
  contrast.js          WCAG contrast check (effective color/background cascade)
  alt-text.js          Images, links, buttons, SVGs (non-text content)
  keyboard.js          Tab order, focus visibility, keyboard operability
  structure.js         Language, labels, headings, names & roles
public/
  index.html           Single-page UI (no frameworks, no build step)
  styles.css           Slate/blue/amber/red palette — no purple, no green
  app.js               Report rendering, filters, Markdown/JSON export
  fixtures/messy-page.html   Test page with planted accessibility issues
```

## How the analysis works (and its limits)

The auditor is **static**: it fetches the HTML, parses it with jsdom, downloads
every stylesheet (including `@import`, one level), and models the cascade just
enough to find each element's effective `color`, `background`, `font-size` and
`font-weight`. Rules that only apply in transient states (`:hover`, `:active`,
`:visited`, `:focus`, `:disabled`) or alternate color schemes
(`prefers-color-scheme`) are excluded from resting-state contrast.

That means:

- Contrast findings are based on **declared CSS** — `!important` user styles,
  runtime-injected styles, and images-of-text aren't evaluated.
- Keyboard analysis is structural — it can't detect focus *traps* or test real
  tabbing. For that, use a real browser (e.g. axe DevTools) and manual testing.
- Automated tooling catches only part of WCAG. Treat the report as a fast
  first pass, not an audit sign-off.

## Ideas for extending

- Headless-browser mode (Puppeteer/Playwright) for computed-style contrast,
  real Tab-key focus tracking and screenshots of offenders.
- Export to PDF / HTML report file.
- Crawl sitemaps and audit whole sites.
