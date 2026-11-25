"""Compare pose backends on identical frames, with identical geometry and slot logic.

The point is to answer one question with numbers: can the licence-clean stack (YOLOX +
RTMPose + this repo's IoU tracker) replace YOLO11-pose + Ultralytics ByteTrack without
degrading the doubles output? So every backend sees the SAME decoded frames, the SAME
homography, the SAME ground_point and the SAME SlotAssigner — only the model differs.

Metrics reported per backend:

  detect4     share of frames where >=4 in-court people were detected BEFORE tracking.
              This is the detector/pose recall, independent of any tracker, which is why
              it is the fairest single number for "did the pose model get worse".
  coverage    share of frames where all four SLOTS were filled (the pipeline's own claim,
              matching badminton.doubles.validate's definition)
  recall      per-slot presence across the run (far pair is small/occluded, so it lags)
  medStepCm   median per-frame court displacement per slot — the jitter measure
  teleports   per-frame court jumps >1.5 m: the ID-swap failure mode
  fps         wall-clock throughput including decode

Plus agreement against the baseline: for frames both backends slotted, the median
distance IN COURT METRES between their slot positions. That is the number that says
whether downstream stats (distance, coverage, formation) would shift.

No database writes: this runs the pipeline in memory and prints a table, so comparing
backends cannot clobber the tracks of a real run.

CLI: PYTHONPATH=src python scripts/bench_pose_backends.py hkwd_2026_wd_f \
        --start-frame 1020 --max-frames 420 \
        --backends ultralytics,ultralytics-iou,rtmlib --rtmlib-device cpu
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from badminton import config, court            # noqa: E402
from badminton.doubles import pose             # noqa: E402
from badminton.doubles.track import (          # noqa: E402
    SLOTS, SlotAssigner, _detections)

TELEPORT_M = 1.5
TELEPORT_MAXGAP = 5


def _slot_stats(per_frame: dict[int, dict[str, tuple[float, float]]], n_frames: int) -> dict:
    """Coverage / recall / jitter / teleports from {frame: {slot: (x, y)}}."""
    all4 = sum(1 for f in per_frame.values() if len(f) == 4)
    slots = []
    for slot in (s for h in SLOTS for s in SLOTS[h]):
        pts = [(f, *per_frame[f][slot]) for f in sorted(per_frame) if slot in per_frame[f]]
        rec = 100 * len(pts) / n_frames if n_frames else 0.0
        med_step, teleports = None, 0
        if len(pts) >= 2:
            arr = np.asarray(pts, dtype=float)
            d = np.hypot(np.diff(arr[:, 1]), np.diff(arr[:, 2]))
            gaps = np.diff(arr[:, 0])
            per = d / gaps
            med_step = float(np.median(per)) * 100
            teleports = int(np.sum((d > TELEPORT_M) & (gaps <= TELEPORT_MAXGAP)))
        slots.append({"slot": slot, "recallPct": round(rec, 1),
                      "medStepCm": round(med_step, 1) if med_step is not None else None,
                      "teleports": teleports})
    return {
        "coveragePct": round(100 * all4 / n_frames, 1) if n_frames else 0.0,
        "all4Frames": all4,
        "slots": slots,
    }


def _agreement(a: dict[int, dict], b: dict[int, dict]) -> dict:
    """Median court-metre offset per slot between two backends' slot positions."""
    out = {}
    for slot in (s for h in SLOTS for s in SLOTS[h]):
        diffs = [np.hypot(a[f][slot][0] - b[f][slot][0], a[f][slot][1] - b[f][slot][1])
                 for f in a.keys() & b.keys() if slot in a[f] and slot in b[f]]
        if diffs:
            out[slot] = {"n": len(diffs), "medM": round(float(np.median(diffs)), 2),
                         "p90M": round(float(np.percentile(diffs, 90)), 2)}
    return out


def run_backend(name: str, frames: list[np.ndarray], H: np.ndarray, fps_src: float,
                margin: float, kwargs: dict) -> tuple[dict, dict[int, dict]]:
    """Run one backend over pre-decoded frames; returns (stats, per-frame slot positions)."""
    detector = pose.build(name, **kwargs)
    assigner = SlotAssigner()          # fresh state per backend — no cross-contamination

    per_frame: dict[int, dict[str, tuple[float, float]]] = {}
    detect4 = 0
    raw_people = 0
    t0 = time.perf_counter()
    for i, frame in enumerate(frames):
        pdets = detector(frame)
        dets = _detections(pdets, H, margin)
        raw_people += len(dets)
        if len(dets) >= 4:
            detect4 += 1
        slotted = assigner.update(i, dets)
        if slotted:
            per_frame[i] = {s: (float(d.cxy[0]), float(d.cxy[1])) for s, d in slotted.items()}
    wall = time.perf_counter() - t0

    n = len(frames)
    stats = {
        "backend": name,
        "frames": n,
        "wallS": round(wall, 2),
        "fps": round(n / wall, 2) if wall > 0 else None,
        "realtimeRatio": round(n / wall / fps_src, 2) if wall > 0 else None,
        "detect4Pct": round(100 * detect4 / n, 1) if n else 0.0,
        "peoplePerFrame": round(raw_people / n, 2) if n else 0.0,
        **_slot_stats(per_frame, n),
    }
    return stats, per_frame


def main() -> None:
    ap = argparse.ArgumentParser(description="Compare doubles pose backends on identical frames")
    ap.add_argument("match_id")
    ap.add_argument("--start-frame", type=int, default=0)
    ap.add_argument("--max-frames", type=int, default=420)
    ap.add_argument("--backends", default="ultralytics,ultralytics-iou,rtmlib")
    ap.add_argument("--device", default="mps", help="Ultralytics device")
    ap.add_argument("--rtmlib-device", default="cpu",
                    help="ONNX Runtime device for the YOLOX detector: cpu (mps fails)")
    ap.add_argument("--rtmlib-pose-device", default="mps",
                    help="ONNX Runtime device for RTMPose: mps (CoreML) or cpu")
    ap.add_argument("--imgsz", type=int, default=1280)
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--margin", type=float, default=0.7)
    ap.add_argument("--model", default="yolo11x-pose.pt")
    ap.add_argument("--out", default=None, help="write JSON results here")
    args = ap.parse_args()

    import cv2

    m = config.get_match(args.match_id)
    H = np.array(m["homography"], dtype=np.float32).reshape(3, 3)
    video = config.REPO_ROOT / m["video_path"]
    fps_src = float(m.get("fps") or 30.0)

    # Decode ONCE so every backend sees byte-identical frames and decode cost is excluded
    # from the per-backend timing (otherwise the last backend would look slower).
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise SystemExit(f"cannot open {video}")
    cap.set(cv2.CAP_PROP_POS_FRAMES, args.start_frame)
    frames: list[np.ndarray] = []
    while len(frames) < args.max_frames:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(f)
    cap.release()
    print(f"{len(frames)} frames from {video.name} @ {args.start_frame}")

    results, positions = {}, {}
    for name in [b.strip() for b in args.backends.split(",") if b.strip()]:
        print(f"\n=== {name} ===")
        kwargs = {"device": args.device, "imgsz": args.imgsz, "conf": args.conf,
                  "model": args.model, "court_roi": (H, args.margin)}
        if name == "rtmlib":
            kwargs = {"device": args.rtmlib_device,
                      "pose_device": args.rtmlib_pose_device,
                      "court_roi": (H, args.margin)}
        stats, pos = run_backend(name, frames, H, fps_src, args.margin, kwargs)
        print(f"  {stats['fps']} fps ({stats['wallS']}s), detect4 {stats['detect4Pct']}%, "
              f"coverage {stats['coveragePct']}%")
        results[name], positions[name] = stats, pos

    base = next(iter(results))
    for name, stats in results.items():
        if name != base:
            stats["vsBaseline"] = {"baseline": base, "agreement": _agreement(positions[base],
                                                                             positions[name])}

    # Summary table
    print(f"\n{'backend':<18}{'fps':>7}{'xRT':>7}{'detect4':>9}{'cover':>8}"
          f"{'ppl/f':>7}{'tele':>6}")
    for name, s in results.items():
        tele = sum(x["teleports"] for x in s["slots"])
        print(f"{name:<18}{s['fps']:>7.2f}{s['realtimeRatio']:>7.2f}{s['detect4Pct']:>9.1f}"
              f"{s['coveragePct']:>8.1f}{s['peoplePerFrame']:>7.2f}{tele:>6}")
    for name, s in results.items():
        if "vsBaseline" in s:
            agr = s["vsBaseline"]["agreement"]
            txt = ", ".join(f"{k} {v['medM']}m (p90 {v['p90M']})" for k, v in agr.items())
            print(f"  position offset vs {s['vsBaseline']['baseline']}: {txt}")

    if args.out:
        Path(args.out).write_text(json.dumps(
            {"match": args.match_id, "startFrame": args.start_frame,
             "frames": len(frames), "results": results}, indent=2))
        print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
