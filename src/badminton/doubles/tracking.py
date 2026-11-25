"""A dependency-light IoU tracker, so the doubles pipeline owns its tracking code.

Why this exists: the obvious licence-clean swap is "keep ByteTrack, replace only the pose
model" — but Ultralytics' ByteTrack ships inside the AGPL-3.0 `ultralytics` package, so
importing it defeats the purpose, and `supervision` removed its ByteTrack implementation
from recent releases. This is the small replacement: IoU association with a constant-
velocity prediction, which is the same core idea ByteTrack applies to its high-score pool.

It is deliberately NOT a ByteTrack reimplementation. ByteTrack's reason for existing is the
second association stage that recovers occluded players from LOW-score detections; this
tracker associates once. That difference is measurable, which is why the benchmark in
scripts/bench_pose_backends.py also runs the Ultralytics pose model through THIS tracker
(`ultralytics-iou`): it isolates "the tracker got simpler" from "the model got worse"
instead of blaming one for the other.

Greedy association rather than Hungarian: at most ~8 people per frame, so the O(n^2)
greedy pass is both cheaper than an optimal solver and impossible to get wrong. The
rigorous matching in this codebase belongs to SlotAssigner (stably assigning 4 slots),
which is a different problem from frame-to-frame identity.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .pose import PoseDet

IOU_MATCH = 0.30        # min IoU for a detection to continue a track
MAX_AGE = 30            # frames a track survives without a detection (ByteTrack's buffer)
VELOCITY_DAMPING = 0.8  # fraction of last frame-to-frame motion applied to the prediction


def _iou(a: np.ndarray, b: np.ndarray) -> float:
    """IoU of two boxes in (cx, cy, w, h) form."""
    ax1, ay1 = a[0] - a[2] / 2, a[1] - a[3] / 2
    ax2, ay2 = a[0] + a[2] / 2, a[1] + a[3] / 2
    bx1, by1 = b[0] - b[2] / 2, b[1] - b[3] / 2
    bx2, by2 = b[0] + b[2] / 2, b[1] + b[3] / 2
    ix = max(0.0, min(ax2, bx2) - max(ax1, bx1))
    iy = max(0.0, min(ay2, by2) - max(ay1, by1))
    inter = ix * iy
    if inter <= 0.0:
        return 0.0
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


@dataclass
class _Track:
    tid: int
    box: np.ndarray                    # last observed (cx, cy, w, h), pixels
    vel: np.ndarray = field(default_factory=lambda: np.zeros(2))
    missed: int = 0

    def predict(self) -> np.ndarray:
        """Box shifted by the damped last motion — a lunging player moves ~20 px/frame."""
        b = self.box.copy()
        b[0] += self.vel[0] * VELOCITY_DAMPING
        b[1] += self.vel[1] * VELOCITY_DAMPING
        return b


class IouTracker:
    """Frame-to-frame identity by greedy IoU matching. Stateful; one per tracking run."""

    def __init__(self, iou_match: float = IOU_MATCH, max_age: int = MAX_AGE) -> None:
        self.iou_match = iou_match
        self.max_age = max_age
        self.tracks: dict[int, _Track] = {}
        self._next_id = 1

    def update(self, dets: list[PoseDet]) -> list[PoseDet]:
        """Assign a stable tid to each detection; returns the same list, ids filled in."""
        for t in self.tracks.values():
            t.missed += 1

        pairs: list[tuple[float, int, int]] = []
        for di, d in enumerate(dets):
            for tid, t in self.tracks.items():
                iou = _iou(d.box, t.predict())
                if iou >= self.iou_match:
                    pairs.append((iou, di, tid))
        pairs.sort(reverse=True)

        claimed_dets: set[int] = set()
        claimed_tracks: set[int] = set()
        for _, di, tid in pairs:
            if di in claimed_dets or tid in claimed_tracks:
                continue
            claimed_dets.add(di)
            claimed_tracks.add(tid)
            t = self.tracks[tid]
            centre = np.array([dets[di].box[0], dets[di].box[1]])
            prev = np.array([t.box[0], t.box[1]])
            t.vel = centre - prev
            t.box = dets[di].box.copy()
            t.missed = 0
            dets[di].tid = tid

        for di, d in enumerate(dets):
            if di not in claimed_dets:
                d.tid = self._next_id
                self.tracks[d.tid] = _Track(d.tid, d.box.copy())
                self._next_id += 1

        # retire stale tracks — ByteTrack's track_buffer equivalent, and the reason ids
        # are never reused (a recycled id would inherit a stale half in SlotAssigner)
        for tid in [t.tid for t in self.tracks.values() if t.missed > self.max_age]:
            del self.tracks[tid]

        return dets
