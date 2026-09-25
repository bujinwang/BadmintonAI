# Reliability improvements — 2026-09-07

The audit found two ways a routine validation or refresh could destroy durable tracking:
sparse validation deleted every track for a match, and replacement writers committed their
DELETE before inserting replacement rows. Both are fixed without re-tracking any match.

## Durable writes

- `db.transaction()` commits each replacement atomically and rolls back on errors or
  interruption. Singles/doubles tracking, singles/doubles strokes, shuttle CSV import,
  ShuttleSet import and doubles gap-fill use it.
- `detect.process_frames()` refreshes only successfully decoded requested frames, keeping
  continuous tracks elsewhere and preserving frames that could not be read.
- Both video trackers reject missing videos, zero decoded frames and incomplete chunks
  before writing. Expected counts account for stride and a legitimate final chunk at the
  video's reported end. Replacement ranges stop at the frames actually processed.
- Empty ShuttleSet imports fail before touching existing labels.

`PYTHONPATH=src .venv/bin/python tests/test_storage.py`: **5/5 passed**. The tests create
temporary DuckDB databases and inject row-conversion, duplicate-key and video-decoding
failures; they verify the previous data survives. They also cover sparse frame selection,
other-match preservation and a final chunk with stride 2. Production DuckDB was not mutated.

## Doubles score and timing correctness

- A partial game, such as 3–1, no longer counts as a game won. `points.build()` uses the
  shared scoring rule to require a completed game before assigning its winner.
- Fragment merging uses the match's configured FPS. A three-second gap in 60fps footage
  now merges correctly, instead of being mistaken for six seconds at the old 30fps default.

`PYTHONPATH=src .venv/bin/python tests/test_doubles.py`: **51/51 passed**, including both
scoreboard team orientations, partial/completed games and configured-FPS merging.
Reconstructed score points have no rally window; `shots.rally_server()` now skips those
keys while preserving the previous winner, fixing a canonical export crash (`int(None)`).

## Refreshed doubles dashboard

The canonical exporter regenerated `web/public/data/wtf_2024_md_sf/` from existing
DuckDB tracks/shuttle/strokes and cached OCR. Existing output was backed up under `/tmp`.
Eleven changed candidate windows needed scoreboard-presence samples; only two rally score
windows needed fresh OCR. No video tracking or stroke inference was run.

| Validation | Before | After |
| --- | --- | --- |
| Game finals, team A–B | 17–20 / 20–16 / 26–25 | **17–21 / 21–16 / 27–25** |
| Detected rally windows | 101 | 101 |
| All-four in-rally coverage | 92.6% | 92.7% |

All **127 points** now form legal single-point transitions. **81 points** have detected
rally windows; reconstructed points remain explicitly marked and are excluded from rally
duration statistics. The three finals match the configured official result. Every persisted
stroke remains inside its current rally window, all replay bounds match the rally table,
and serve/receive aggregates reconcile with the regenerated winner/server maps.

## Faster role computation

`roles.roles_df()` now joins each pair by frame and computes roles with NumPy/Pandas arrays.
It preserves original front/back and left/right tie handling, missing-player behavior,
NaN handling and output order. It adds no persistent cache or dependency.

On the existing full doubles match (405,155 input tracks; 176,260 role rows), one measured
read-only run went from **16.481 seconds to 0.141 seconds**, approximately **117× faster**.
The entire old and new DataFrames passed `assert_frame_equal(check_exact=True)`.
The regression suite also compares synthetic ties, missing slots, NaNs, unordered frames
and empty input against the original pair helper. Existing exported values remain identical.

## Refreshed singles video annotations

`scripts/render_web_clips.py --force` now refreshes existing filenames, rendering into a
temporary directory on the same filesystem and replacing the served clip only after a
successful encode. Failed or interrupted rendering preserves the old clip and cleans up
partial output. `tests/test_clip_refresh.py` verifies skip, successful replacement and
failure preservation using a mocked renderer, without requiring OpenCV in CI.

After the updated pipeline strokes were promoted, all **338 singles clips** were freshly
rendered: India 84, Denmark 75, All England SF 108 and All England WS final 71. The renderers
used existing tracks, shuttle positions and durable pipeline shot labels; no tracking or
model inference ran. At most two render processes ran concurrently.

`ffprobe -count_frames` decoded all **143,866 frames**, confirming exact expected frame
counts and durations, H.264, 540p and 30fps for every clip. Output totals approximately
**247 MB**. Rendering plus full verification took **325 seconds** on this machine.
The existing clips were backed up to `/tmp/courtside-singles-clips-before-ffll5e8p`;
**51 obsolete filenames** were moved into its `obsolete/` directory after verification.
The public clip folders now contain exactly the current snapshot windows, preventing
obsolete clips from winning the exporter's overlap-based selection.
The canonical all-singles `export_web --skip-slow` then refreshed every source bundle and
the four-match index, retaining current slow validation results. Every non-null clip URL
was checked against the expected current filename set and verified to exist on disk.

## Remaining findings

- Doubles set-boundary detection consumes raw score totals: a transient low OCR reading
  after a high total can invent a set. It needs temporal confirmation before changing ends.
- Doubles OCR cache keys include frame windows, but not sample count, templates or score-box
  calibration. Changing those inputs can retain stale readings.
- Named doubles player metrics still depend on slot stability. Team and formation metrics
  are more robust; extending named identity across games needs validated anchors.
These findings were left separate from the bounded storage, scoring and performance fixes.
