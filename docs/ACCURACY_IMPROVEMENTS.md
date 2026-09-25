# Accuracy audit — 2026-09-07

All comparisons use the existing four tracked singles matches. No video re-tracking,
model fine-tuning, or changes to human labels were needed.

## Corrected measurement and training inputs

The deciding-game end change was already represented by `insights.rally_side_map`,
but five consumers still used a single side per set. The fix reuses the existing
rally map in hit validation, pipeline evaluation, BST label construction, geometry
training landing normalization, and exported agreement metrics.

All England SF had 286 incorrectly assigned label sides across 23 rallies. Its
**existing** pipeline hitter agreement is 96.09%, previously reported as 77.81%.
This is a corrected evaluation, not a change to those predictions. Existing
pipeline agreement for India stays 96.49%, Denmark changes 96.82% to 97.00%, and
WS stays 99.01%.

The export now distinguishes matched-shot accuracy, recovered labeled shots, and
joint side-and-shot recovery; it also includes detected-contact precision and
per-class recall including missed contacts. A completely missed class remains
visible with zero overall recall and unavailable conditional recall.

Stored bboxes are YOLO **center x/y, width/height**. The wrist fallback erroneously
added half the width/height to the center. Correcting it changes one unmatched
contact among 4,630 existing pipeline contacts; matched attribution does not regress
on any match. Only 56 of 26,997 nearby tracked player rows needed this fallback.

Baseline exported metrics after correcting side ground truth:

| Match | Contact coverage | Contact precision | Shot recovery | Joint side + shot recovery |
|---|---:|---:|---:|---:|
| India Open final | 87.68% | 79.11% | 66.57% | 64.99% |
| Denmark Open SF | 85.37% | 66.59% | 75.41% | 73.15% |
| All England SF | 87.36% | 71.74% | 69.64% | 67.76% |
| All England WS final | 89.20% | 77.51% | 69.85% | 69.60% |

These compare all saved pipeline contacts to human labels at ±6 frames. They differ
from the detector-only validation below, which searches within labeled rally windows.

## Wrist neighborhood experiment

The pose recovery pass stopped at the first visible shuttle sample, even if it
was too far away. It now chooses the closest valid sample across its existing
five-frame neighborhood. Thresholds are unchanged across every match.

| Match | Hit F1 before | Hit F1 after | Recall before | Recall after |
|---|---:|---:|---:|---:|
| India Open final | 88.55% | 88.80% | 89.92% | 91.04% |
| Denmark Open SF | 87.15% | 87.14% | 87.48% | 87.93% |
| All England SF | 86.49% | 86.76% | 88.60% | 89.69% |
| All England WS final | 88.07% | 88.13% | 91.33% | 92.34% |

Pooled: 38 additional true contacts and 33 additional false positives. Recall
89.33% → 90.30%, precision 85.73% → 85.18%, F1 87.49% → 87.66%.
This is a small recall improvement with an explicit precision cost. Baseline
label-free segmentation counts, matched rallies, F1, and boundary summaries were
identical before/after on all four matches. The change is covered by a synthetic
regression where the first visible shuttle is distant and a later sample is close.

## Cache safety and remaining classifier work

Deploy-style training caches now include a fingerprint of feature source,
match calibration/configuration, and pretrained weight metadata. YAML date values
are serialized safely. Previous cache files remain available; changed inputs
cannot silently reuse their old feature rows. Tracking or label data corrections
still require cache removal because data-content fingerprints are not included.

Correcting `bst_eval.build_inputs` changes side targets used by future BST
fine-tuning. It does **not** relabel the stacked classifier's canonical shot targets;
those were already matched directly to the human shot classes.

One remaining measured-design concern requires a separate controlled experiment:
`pipeline.classify` swaps raw hitter/receiver positions using BST but retains
geometry features created before that swap. Its contact height uses the BST side,
whereas stack-training contact height uses wrist attribution. Any remedy must
recompute training and inference features consistently and evaluate every held-out
match. A 32-contact BST inference benchmark took 0.15 seconds after a 3.74-second
import, so feature/cache regeneration is a minutes-scale job; no fine-tune is
necessary to test that correction.

## Checks

`PYTHONPATH=src .venv/bin/python tests/test_accuracy.py` passes 5/5 checks without
video, model weights, or a match database. Real-data comparisons used read-only
DuckDB connections. Candidate pipeline regeneration was staged against a database
copy and snapshot copies before promotion. All four candidates used the stacked
classifier; no fallback classifier was silently accepted.


## Accepted deployment results

The acceptance gate was fixed before inspecting candidates: improve pooled shot
recovery, retain every exact set final, and allow no individual match to lose more
than 0.5 percentage points of shot recovery. All four passed. The same detector and
leave-one-match-out classifier procedure is deployed for every match.

| Match | Shot recovery before → after | Joint recovery before → after | Pipeline contacts after |
|---|---:|---:|---:|
| India Open final | 66.57% → 67.04% | 64.99% → 65.36% | 1,214 |
| Denmark Open SF | 75.41% → 75.11% | 73.15% → 72.85% | 857 |
| All England SF | 69.64% → 71.02% | 67.76% → 69.06% | 1,709 |
| All England WS final | 69.85% → 69.72% | 69.60% → 69.47% | 932 |

Across all 3,907 labeled strokes, correctly recovered shots increased **2,728 →
2,749** (69.823% → 70.361%). Correct side-and-shot recoveries increased **2,668 →
2,687** (68.288% → 68.774%). Denmark and WS have small measured regressions within
the stated gate; the table preserves these rather than presenting only gains.

All score finals remain exact. Rally counts and per-set missing/excess counts are
unchanged: India 84 (0/0), Denmark 75 (0/0), SF 108 (+2/−1/−2), WS 71 (+1/0).
Positive means missed points; negative means excess detected rallies.

Four-match inference refresh took 131 seconds with rebuilt feature caches and
four CPU threads. It ran these existing library operations on the staged database
for each match: `pipeline.evaluate(label_free=True, rescue=False)` →
`pipeline.write_strokes` → `labelfree.build`, then the same sequence with
`rescue=True`, followed by `labelfree.validate` and `export_web._agreement`.
The first pass is necessary: rebuilding directly from an already-rescued snapshot
with zero reported deficit can silently lose its previously rescued rallies.

Accepted pipeline rows were promoted in one DuckDB transaction after checking
stroke-ID collisions, then their matching snapshots were atomically replaced.
Production metrics exactly matched the staged candidates. The canonical dashboard
refresh command was:

```bash
OMP_NUM_THREADS=4 OPENBLAS_NUM_THREADS=4 LOKY_MAX_CPU_COUNT=4 \
  PYTHONPATH=src .venv/bin/python -u -m badminton.export_web
```

This refresh includes both labels and AI sources, replay payloads, and fresh hit /
segmentation validation. It uses durable tracks and shuttle rows without re-parsing.

## Backup and staging recovery evidence

Full database and snapshot backups were taken before any writes. The first staging
wrapper missed `db.transaction`'s bound default database argument, causing candidate
India and Denmark pipeline rows to reach production. The mismatch was detected
from staging metrics and the process was stopped. Only those pipeline rows were
restored transactionally from the backup; bidirectional `EXCEPT ALL` confirmed the
entire restored strokes table exactly matched its baseline.

Every durable table also matched its baseline `(count, BIT_XOR(HASH(row)))`:

- matches: `(5, 11966510462600845588)`
- shuttle: `(577540, 5268448347530081279)`
- strokes: `(9804, 8905882839529215696)`
- tracks: `(827569, 8119106564129958215)`

The corrected staging wrapper redirects both omitted and bound database defaults
and asserts the resolved `PRAGMA database_list` path on **every** connection before
use. A committed synthetic transaction sentinel appeared only on the candidate
copy, never on production. Production checksums were rechecked while staging ran.
The final promotion preserved all label/doubles/non-target stroke rows and all
matches/tracks/shuttle rows, verified by counts and checksums inside the transaction.

Retained local audit artifacts:

`/var/folders/_x/xd2ms3z958s6pfllwphw48vm0000gn/T/courtside-accuracy-dxtvkr1w/`

contains `original.duckdb`, `candidate.duckdb`, original and candidate snapshots,
`baseline-metrics.json`, `candidate-metrics.json`, and `PROMOTED.json`. These are
local recovery artifacts, not files to add to git.
