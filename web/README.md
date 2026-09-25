# COURTSIDE — the badminton match-intelligence web app

Static Next.js dashboard for the badminton CV project. Replaces the Streamlit app for
presentation: coach analytics (overview, points, court maps, patterns, film room) plus
an **AI Lab** that shows every CV pipeline stage working, with measured validation numbers.
Each match renders from two data sources — **GROUND TRUTH** (ShuttleSet labels) and
**AI VISION** (the fully label-free chain) — switchable from the top bar.

## Routes

- `/`: landing page. One pre-selected rally autoplaying with the CV overlays baked in
  (`public/hero/rally.mp4`, a trimmed re-compression of the annotated clip for
  all_england_2022_sf set 2 rally 6), the held-out validation numbers beside it, and the
  stack summary plus GitHub links below the fold.
- `/matches/`: the match picker (this used to be `/`).
- `/players/`: player profiles across observed singles matches; `?player=Lakshya+Sen&source=ai` selects an exact roster identity and one data source.
- `/m/<id>/<labels|ai>/<view>/`: singles dashboard. `/d/<id>/<view>/`: doubles.

To replace the hero clip, trim any file under `public/clips/` and re-encode, e.g.
`ffmpeg -ss <t> -t 12.5 -i <clip> -c:v libx264 -crf 30 -preset veryslow -an -movflags +faststart
public/hero/rally.mp4`, then refresh the poster with `-ss 4 -frames:v 1 -q:v 6 public/hero/rally.jpg`.
Note the root `.gitignore` un-ignores `web/public/hero/*.mp4`.

## How it works

- Pure static export (`output: 'export'`) — no server, no Python at runtime.
- All data is precomputed JSON in `public/data/` by
  `PYTHONPATH=src python -m badminton.export_web` (run from the repo root; re-run after
  re-parsing matches). Per-rally replay payloads are lazy-loaded.
- Film room synchronizes annotated local MP4 clips with court tracks using the native
  video clock. Clip filenames encode the padded source-frame origin. Contact stepping,
  playback speed, and exchange loops share that clock. Raw YouTube fallback keeps a
  separate court replay and states that limitation.
- No chart library — every visual is a bespoke SVG/canvas component (`components/`).

## Develop

```bash
cd web
nvm use             # Node 22; Next.js does not support Node 19
npm install
npm run dev          # http://localhost:3000
npm run build        # static site in out/
```

## Checks

`node tests/data-loader.cjs` checks caching and failure recovery;
`node tests/court-accessibility.cjs` checks keyboard evidence links. Both use existing
dependencies and run in CI alongside the production build. `node tests/sequences.cjs`,
`node tests/playback.cjs`, and `node tests/profiles.cjs` verify sequence boundaries,
clip timing, and weighted aggregation/source isolation.

For local playback and browser integration, run `python3 scripts/serve_web.py` from
the repository root (localhost:8080). It serves `web/out/` with HTTP byte ranges so
Chrome can seek MP4 clips; plain `python -m http.server` does not support seeking. Run
`PLAYWRIGHT_MODULE=/path/to/playwright-core node tests/browser-smoke.cjs` using an
existing Playwright installation. `CHROME_BIN` and `BASE_URL` can override the browser
and server. The check exercises query history, filters, failed and delayed replay
loads, source switching, keyboard links, and desktop/mobile layouts; screenshots
are saved to the system temporary directory. Run `tests/coaching-features.cjs` with the
same environment to check real video seeking/loops, sequence search, player profiles,
source history, and failed-profile recovery.

Film room selections and filters are shareable query parameters. Switching between
AI and labeled data clears those parameters because rally numbers may describe
different broadcast moments in the two sources. Sequence search uses up to six exact
shot display names (`?sequence=smash,block&starter=A`), anywhere within a rally.
`contact` and `through` identify an occurrence's stroke numbers in a selected `r`.
Winner, final-shot, set, and length filters combine with the sequence. Invalid
sequence links show no results and a reset action.

Profiles sum shot counts before calculating shares; movement speed divides total
distance by total tracked time. Missing movement, unknown winners, and unrated
endings are disclosed. A failed match fetch hides aggregate totals until retry
succeeds. The small observed sample is not presented as a career record.

## Accuracy review

Open **Review** in a singles match, or use the links from Film room and Validation.
The queue prioritizes label disagreements and confidence below 65%. Reference pairing
uses calibrated contact timing, one-to-one within six frames; ambiguous pairs are
left unpaired. `meta.contactFrameOffset` converts label player-track timing into
contact timing (currently −7 frames, or −9 for Denmark). Original data is preserved.

Confirm predictions or edit shot/hitter; winner/ending fields appear only at final
contacts. Records live in `courtside-reviews-v1` local storage and can be exported/imported
as JSON. Import conflicts and failed writes preserve the existing store. Native Web
Locks coordinate tabs. Session drafts recover unfinished edits after Back/Forward;
stale predictions require explicit review again. Browser storage is local to this
origin, so export the records before moving browsers or clearing site data.

Evaluate a later candidate export against a frozen review file:

```bash
PYTHONPATH=src .venv/bin/python -m badminton.review_eval \
  --reviews reviews.json --candidate-dir web/public/data \
  --held-out-match india_open_2022_final \
  --training-match all_england_2022_sf \
  --training-match all_england_2022_ws_final \
  --training-match denmark_open_2022_sf --json
```

Declare the actual training matches for the candidate; use `--no-training` only when
no training was performed. Training/held-out overlap is rejected. The report shows
frozen-original versus candidate results against reviewed values, matching coverage,
and percentage-point differences. Missing contacts count against accuracy; outcome
metrics require known reviewed endings. This is a selected review sample, not a
whole-match accuracy estimate. The tool does not verify training provenance or train
models. Saving corrections alone does not improve published model accuracy.

Checks: `node web/tests/review.cjs`, `node web/tests/review-storage.cjs`, and
`PYTHONPATH=src .venv/bin/python tests/test_review_eval.py` from the repository root.
`PLAYWRIGHT_MODULE=/path/to/playwright-core node web/tests/review-browser.cjs` verifies
playback, persistence, conflicts, malformed imports, stale records, failed writes,
reference retry, draft history recovery and responsive layout in isolated browser
contexts. Its generated reviews are synthetic regression data, not human annotations.

## Deploy to Vercel (custom domain)

1. Push the repo to GitHub.
2. In Vercel: **Add New Project** → import the repo → set **Root Directory = `web`**.
   Framework auto-detects as Next.js; no env vars, no build settings needed.
3. Add your domain under Project → Settings → Domains.

CLI alternative: `cd web && npx vercel --prod`.

Any other static host works too — upload `web/out/` as-is.
