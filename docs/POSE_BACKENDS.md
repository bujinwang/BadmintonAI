# Pose backends (AGPL → Apache-2.0 swap)

`docs/DESIGN.md` has always said "YOLO11-Pose → **RTMPose** (Apache-2.0) before
productizing", and `requirements.txt` carries the same note next to `ultralytics`. This is
that migration, measured.

The trigger is licensing, not accuracy: Ultralytics is **AGPL-3.0**, so any closed-source
app or SaaS that ships it inherits a source-disclosure obligation. RTMPose (and the YOLOX
detector that feeds it) are **Apache-2.0**, which has no such condition.

## The seam

`doubles/pose.py` is the only place a model is named. `track.py` asks it for
`list[PoseDet]` — a track id, a person box, 17 COCO keypoints — and everything downstream
(`detect.ground_point`, the homography, `SlotAssigner`, `roles`) is shared verbatim. That
is what makes this a swap rather than a rewrite, and what makes the numbers below a
controlled comparison: the same frames, the same court calibration, the same slot
assignment.

| backend | detector | pose | tracker | licence |
|---|---|---|---|---|
| `ultralytics` (default) | YOLO11x-pose @1280 | bundled | Ultralytics ByteTrack | AGPL-3.0 |
| `ultralytics-iou` | YOLO11x-pose @1280 | bundled | `doubles/tracking.py` | AGPL-3.0 (pose only) |
| `rtmlib` | YOLOX-m @640 | RTMPose-m 256×192 | `doubles/tracking.py` | Apache-2.0 / MIT |

`ultralytics-iou` exists so the two changes can be judged separately. Replacing ByteTrack
is unavoidable — Ultralytics' ByteTrack lives inside the AGPL package, and `supervision`
dropped its own ByteTrack implementation. `doubles/tracking.py` is the in-repo
replacement (greedy IoU association with a damped constant-velocity prediction, ~110
lines); it is *not* a ByteTrack reimplementation, because ByteTrack's whole point is the
second association stage that recovers occluded players from low-score detections.

## Measured — 420 frames, M4 Pro

`scripts/bench_pose_backends.py hkwd_2026_wd_f --start-frame 1020 --max-frames 420`
(14 s of the Hong Kong Open women's doubles final, 1280×720 @30 fps, four players in a
continuous wide shot). Throughput includes pose and tracking, excludes video decode.

| backend | fps | detect4 | coverage | teleports | conf |
|---|---|---|---|---|---|
| `ultralytics` | 8.44 | 94.3% | 92.1% | 7 | 0.15 |
| `ultralytics-iou` | 8.59 | 95.5% | 92.9% | 6 | 0.15 |
| `rtmlib` | **10.57** | 92.6% | **92.6%** | **4** | n/a |
| `ultralytics` | 7.90 | 94.0% | 92.1% | 10 | 0.25 |
| `ultralytics-iou` | 8.53 | 95.2% | 92.9% | 7 | 0.25 |
| `rtmlib` | **10.89** | 92.6% | 92.6% | **4** | n/a |

- **detect4** — share of frames with ≥4 in-court people detected *before* tracking. This
  is the fairest single measure of "did the pose model get worse", because no tracker is
  involved.
- **coverage** — share of frames with all four slots filled, same definition as
  `doubles/validate.py`. ⚠️ **Not comparable to the 96.8% quoted in `DOUBLES.md`**: that
  number is rally-scoped via `segment.rally_windows`, this one counts every frame of the
  window including dead time. Compare rows within this table only.
- **teleports** — per-frame court jumps >1.5 m summed over the four slots; the ID-swap
  failure mode `validate.py` tracks.

**Position agreement** (`rtmlib` vs `ultralytics`, frames both slotted): median offset
**0.02 m near / 0.03 m near2 / 0.06 m far / 0.03 m far2**; p90 worst case 0.36 m on the
far slot. Ground points land within centimetres of the YOLO11x baseline, so downstream
distance, coverage and formation numbers do not shift. (`ultralytics-iou` vs
`ultralytics` is 0.00–0.01 m, as it must be — same model, same geometry; that is the
control that proves the harness itself is not introducing a difference.)

## Reading the result

The licence-clean stack is **~1.25–1.4× faster** and lands within 3 cm of the baseline's
court positions. It is slightly *worse* at detection recall (92.6% vs 94.3% detect4) and
slightly *better* on identity stability (4 teleports vs 7).

Four caveats, because the headline flatters RTMPose in two places and shortchanges it in
one:

1. **The speed gap is partly an ROI crop, not a faster model.** Broadcast frames yield
   ~25 person boxes (spectators, officials). RTMPose consumes bboxes one at a time, so the
   rtmlib backend pre-filters to the court region before posing (`court_roi`, 2 m slack)
   and poses ~6 people instead of ~25. Ultralytics batches all ~25 in one pass at 1280.
   Applying the same crop to the Ultralytics path would narrow the gap — the 1.25× is "as
   configured end-to-end", not "RTMPose is 1.25× faster than YOLO11x-pose".
2. **YOLOX's detection threshold is not tunable here.** Its NMS-embedded ONNX export
   hard-codes `score > 0.3`, ignoring rtmlib's `score_thr`. That is why `rtmlib` shows the
   same 92.6% at both conf settings while the Ultralytics rows move. A product that needs
   far-side recall at 0.15 would have to re-export the detector (or use RTMDet) — this is
   the main open item before shipping.
3. **Fixed 640×640 detector input.** The YOLOX ONNX declares static `[1,3,640,640]`, so
   the rtmlib path cannot match the baseline's 1280 inference. Given how close the ground
   points land, that resolution gap is absorbed by RTMPose's per-person crop, but it is
   the reason detection recall sits ~1.7 points lower.
4. **CoreML cannot run YOLOX at all.** Its static output shape (`{1,1,1,8400,8400}`)
   disagrees in rank with the inferred graph (`{1,8400}`). An `mps` request is therefore
   routed per model: detector on CPU, RTMPose on CoreML (3.5 vs 8.9 ms per box, measured).

## Running it

```bash
# the licence-clean stack, writing tracks as usual
PYTHONPATH=src .venv/bin/python -m badminton.doubles.track <match_id> \
    --pose-backend rtmlib --start-frame 1020 --max-frames 420 --device mps

# sanity-check a backend without touching the DuckDB (decode + pose + slots only)
PYTHONPATH=src .venv/bin/python -m badminton.doubles.track <match_id> \
    --pose-backend rtmlib --max-frames 20 --dry-run

# the comparison table above
PYTHONPATH=src .venv/bin/python scripts/bench_pose_backends.py <match_id> \
    --start-frame 1020 --max-frames 420 \
    --backends ultralytics,ultralytics-iou,rtmlib --out bench.json
```

`ultralytics` stays the default: it is what the published validation numbers were
produced with, and it is still the most accurate detector of the three. Switching the
default to `rtmlib` is a licensing decision, not a technical one — the pipeline above
shows it costs ~1.7 points of detection recall and buys ~1.3× throughput.

## Licences

YOLOX and RTMPose: Apache-2.0 (OpenMMLab / mmpose). `rtmlib`: Apache-2.0. `onnxruntime`:
MIT. `doubles/tracking.py` and `doubles/pose.py`: this repo's MIT.

**No AGPL code is imported on the `rtmlib` path, verified at runtime** — after
`pose.build("rtmlib")`, both `'ultralytics' in sys.modules` and `'torch' in sys.modules`
are `False`. `ultralytics` is imported only inside the two `Ultralytics*` constructors, and
`detect.py` (the shared `ground_point` helper) pulls in `config`/`court`/`db` only. That
matters because "we don't call the AGPL model" is not the same as "the AGPL package is not
in the delivered process"; on this path it genuinely is not loaded.
