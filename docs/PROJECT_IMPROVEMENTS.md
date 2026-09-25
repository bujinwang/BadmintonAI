# COURTSIDE improvement pass — 2026-09-07

Three agents explored accuracy, data reliability and dashboard behavior; the parent
integrated the work, reviewed failure cases and checked the actual static site.
Existing uncommitted work was preserved. No commits, branches or deployment were made.

## Measured improvements

- **Doubles roles:** 16.481 seconds → 0.141 seconds (~117× faster), with exact equality
  over all 176,260 output rows from 405,155 saved tracks.
- **Singles shot recovery:** 2,728 → 2,749 correct out of 3,907 labeled strokes
  (69.82% → 70.36%). Joint hitter-plus-shot recovery rises 68.29% → 68.77%.
  All England SF gains 1.38 percentage points; Denmark and WS regress slightly
  (0.30 and 0.13 points), within the acceptance gate fixed before the experiment.
- **Correct evaluation:** All England SF's existing hitter agreement was 96.09%,
  previously reported as 77.81% because evaluation ignored the deciding-set end change.
  This correction is separate from the prediction improvements above.
- **Doubles score:** regenerated from saved tracking and cached OCR, now exactly
  17–21 / 21–16 / 27–25, with 127 legal one-point transitions. Reconstructed points
  are visibly distinct and never link to an unrelated rally.

Details, measurement denominators, backups and the recovered staging incident are in
[ACCURACY_IMPROVEMENTS.md](ACCURACY_IMPROVEMENTS.md) and
[RELIABILITY_IMPROVEMENTS.md](RELIABILITY_IMPROVEMENTS.md).

## User-facing changes

Film room rally selection and filters live in the URL, supporting sharing and browser
back/forward. Previous/next controls and set/rally identifiers make review faster.
The mobile list is shorter so footage is easier to reach. Empty results have a reset.

Single and doubles loaders share a small transport helper. Pending replay requests
clear previous tracking immediately; failed HTTP, network or JSON requests can retry.
Switching data source clears source-specific selections because AI and labeled rally
numbers do not necessarily refer to the same broadcast moment.

Playback controls, speed choices, sliders and evidence charts have keyboard controls
and descriptive labels. The Validation view shows per-set missing/extra rally windows,
unknown winners, per-class recovery including missed contacts, and full stroke accuracy.
Matched-only accuracy is identified as such. The landing and explanation pages derive
current benchmark numbers from the exported data and describe the current classifier.

## Data safety and refreshes

Eight replacement paths now use DuckDB transactions. Failed conversion or inserts roll
back; sparse frame validation only replaces successfully read frames, preserving the
rest of continuous tracking. Trackers reject unreadable and prematurely truncated chunks.
JSON files and forced clip refreshes replace completed temporary outputs atomically.
A single-match export preserves the rest of the match picker. Inclusive frame overlap
also restores clip selection for nine one-contact rallies whose start and end frame match.

The four singles models were regenerated against a database copy and evaluated before
promotion. All set finals remain exact, and all labels, doubles strokes, tracks, shuttle
rows and match metadata were preserved. Both source bundles, replays and validation
payloads were regenerated through the canonical exporter. Annotated clips are refreshed
from durable data, without video re-tracking or model inference.

All **338 singles clips** were refreshed and decoded for verification: **143,866 frames**,
approximately **247 MB**, exact frame counts/durations, H.264, 540p, 30fps. The **51 obsolete
clips** were moved to the retained backup instead of deleted. Served clip folders now
match the current snapshots exactly. Rendering and decode verification took about 5m25s
with at most two render processes.

## Verification

- **85 Python checks**: score 19, doubles 51, accuracy 5, storage 5, export 4, clip refresh 1.
  All pass with imports of torch/OpenCV/sklearn/scipy/ultralytics deliberately blocked.
- Web checks cover request deduplication/caching/failure recovery and placement-map keys.
- The production static build passes with Node 22. The existing Google Fonts fetch requires
  network access during the build.
- The saved `web/tests/browser-smoke.cjs` verifies Film room history/filter resets,
  source switching, delayed and failed replay loads, keyboard evidence navigation,
  doubles history and desktop/mobile overflow. It uses an already-installed Playwright
  runtime; no project dependency was added.
- An independent sweep checked all **57 generated routes** at 390×844 after their
  JSON loaded: no JavaScript page errors, local HTTP errors, or document overflow.

CI now runs the new Python and web checks and the production build. Local browser
screenshots are saved under the system temporary directory.

## Further work identified, deliberately kept separate

The classifier still has a training/inference geometry inconsistency when BST changes
the hitter side; fixing that requires another controlled evaluation. Doubles raw OCR
set resets need temporal confirmation, and OCR cache keys omit template/calibration
revisions. Named doubles player metrics still depend on validated slot identity.
These are documented follow-ups, not claimed as fixed.
