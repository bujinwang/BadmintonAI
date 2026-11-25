"""Pose + person-tracking backends, so the doubles tracker is not welded to Ultralytics.

`track.py` needs exactly three things per player per frame: a persistent track id, a
person box, and 17 COCO keypoints. Everything downstream (ground_point, the homography,
SlotAssigner, roles) works on court metres and does not care which model produced them.
This module is the seam: every backend returns `list[PoseDet]`, and the geometry code is
shared verbatim, so a swap changes only detection quality and speed.

Three backends, and the two axes they separate:

  ultralytics      YOLO11-pose + the ByteTrack that ships inside `ultralytics`.
                   AGPL-3.0 — this is what the published numbers were produced with, and
                   it is the baseline everything is measured against.
  ultralytics-iou  YOLO11-pose + this repo's IoU tracker. Same model as the baseline,
                   different tracker: isolates "the tracker got simpler" from "the model
                   got worse" so neither is blamed for the other.
  rtmlib           YOLOX detector + RTMPose (ONNX Runtime) + this repo's IoU tracker.
                   Apache-2.0 detector, Apache-2.0 pose, MIT tracker — the licence-clean
                   stack to ship in a closed product.

`device="mps"` maps to the CoreML execution provider for rtmlib, `cpu` to plain ONNX
Runtime; Ultralytics takes the torch device name directly.

Why the rtmlib backend drives YOLOX/RTMPose by hand instead of using rtmlib's `Body`
helper: `Body.__call__` returns keypoints and nothing else, discarding the person boxes.
`detect.ground_point` blends the ankle midpoint toward the BBOX BOTTOM (FOOT_BLEND=0.65,
tuned against ShuttleSet), so the box is load-bearing for court position — a box derived
from the keypoints themselves would sit on the ankles and quietly add a depth bias. Using
the two models directly keeps the real detected box, which is what makes the comparison
apples-to-apples.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class PoseDet:
    """One person in one frame, in IMAGE PIXELS (court metres are derived later).

    box is (cx, cy, w, h) to match Ultralytics' boxes.xywh, which is what
    detect.ground_point expects. kxy/kcf are 17 COCO keypoints in the same order for every
    backend — 15/16 are the ankles ground_point actually reads. `tid` is -1 until a
    tracker assigns one.
    """

    tid: int
    box: np.ndarray
    kxy: np.ndarray
    kcf: np.ndarray


class UltralyticsPose:
    """YOLO11-pose, detection+pose only, tracked externally (AGPL-3.0)."""

    name = "ultralytics-pose"

    def __init__(self, model: str = "yolo11x-pose.pt", device: str = "mps",
                 imgsz: int = 1280, conf: float = 0.25) -> None:
        from ultralytics import YOLO

        self.model = YOLO(model)
        self.device = device
        self.imgsz = imgsz
        self.conf = conf

    def __call__(self, frame: np.ndarray) -> list[PoseDet]:
        res = self.model.predict(frame, imgsz=self.imgsz, conf=self.conf,
                                 device=self.device, verbose=False)[0]
        return _from_results(res)


class UltralyticsByteTrackPose:
    """YOLO11-pose + the Ultralytics ByteTrack — the published baseline (AGPL-3.0)."""

    name = "ultralytics"

    def __init__(self, model: str = "yolo11x-pose.pt", device: str = "mps",
                 imgsz: int = 1280, conf: float = 0.25) -> None:
        from ultralytics import YOLO

        self.model = YOLO(model)
        self.device = device
        self.imgsz = imgsz
        self.conf = conf

    def __call__(self, frame: np.ndarray) -> list[PoseDet]:
        res = self.model.track(frame, persist=True, tracker="bytetrack.yaml",
                               imgsz=self.imgsz, conf=self.conf, device=self.device,
                               verbose=False)[0]
        return _from_results(res)


def _from_results(res) -> list[PoseDet]:
    """Ultralytics Results -> PoseDet.

    `boxes.id` is only populated by `model.track()`; `model.predict()` leaves it None and
    the id is supplied afterwards by the external tracker, hence -1 rather than dropping
    the detection (an id-less detection is still a person)."""
    if res.keypoints is None or res.boxes is None:
        return []
    kxy = res.keypoints.xy.cpu().numpy()
    kcf = res.keypoints.conf.cpu().numpy()
    boxes = res.boxes.xywh.cpu().numpy()
    n = len(boxes)
    tids = (res.boxes.id.cpu().numpy().astype(int) if res.boxes.id is not None
            else np.full(n, -1, dtype=int))
    return [PoseDet(int(tids[i]), boxes[i], kxy[i], kcf[i]) for i in range(n)]


class RtmlibPose:
    """YOLOX + RTMPose on ONNX Runtime, tracked externally. All permissive licences.

    RTMPose consumes one bbox at a time, so pose cost scales LINEARLY with people per
    frame, unlike YOLO11-pose's single batched pass. A broadcast frame with spectators
    yields ~25 person boxes, which would mean 25 sequential pose inferences for four
    players — so the detector output is pre-filtered to the court region when a
    `court_roi=(H, margin)` is supplied. Those boxes are rejected downstream anyway by
    `track._detections`' `in_court` test; this just refuses to pay for their keypoints.

    The prefilter is deliberately GENEROUS (ROI_SLACK_M extra metres, and it tests the
    box bottom rather than the blended ground point) so it can only drop people who are
    clearly still off court — a lunging far player is never sacrificed to save time.
    """

    name = "rtmlib"

    MODES = {
        "lightweight": ((416, 416), (192, 256)),
        "balanced": ((640, 640), (192, 256)),
        "performance": ((640, 640), (288, 384)),
    }
    ROI_SLACK_M = 2.0   # generous: taller than any plausible depth mis-projection

    def __init__(self, mode: str = "balanced", device: str = "cpu",
                 pose_device: str | None = None,
                 court_roi: tuple | None = None) -> None:
        if mode not in self.MODES:
            raise ValueError(f"rtmpose mode must be one of {sorted(self.MODES)}")
        from rtmlib import RTMPose, YOLOX
        from rtmlib.tools.solution.body import Body

        det_size, pose_size = self.MODES[mode]
        # CoreML cannot run the YOLOX export at all: its NMS-embedded ONNX declares a
        # static output whose rank disagrees with the inferred graph
        # ("{1,1,1,8400,8400}" vs "{1,8400}") and the CoreML EP aborts the session. RTMPose
        # converts cleanly and is ~2.5x faster there (3.5 vs 8.9 ms per box, measured), so
        # an mps request is routed per model rather than rejected: detector on CPU, pose on
        # CoreML. `pose_device` overrides the pose half explicitly.
        if device not in ("cpu", "mps"):
            raise ValueError(f"rtmlib device must be 'cpu' or 'mps', got {device!r}")
        det_device = "cpu" if device == "mps" else device
        pose_device = pose_device or device
        # Reuse rtmlib's pinned model URLs so the weights match its own mode tables.
        self.det = YOLOX(Body.MODE[mode]["det"], model_input_size=det_size,
                         backend="onnxruntime", device=det_device)
        self.pose = RTMPose(Body.MODE[mode]["pose"], model_input_size=pose_size,
                            backend="onnxruntime", device=pose_device)
        self.device, self.pose_device = det_device, pose_device
        self.court_roi = court_roi

    def _in_roi(self, boxes: np.ndarray) -> np.ndarray:
        """Boolean mask of boxes whose bottom-centre lands near the court."""
        if self.court_roi is None:
            return np.ones(len(boxes), dtype=bool)
        from .. import court

        H, margin = self.court_roi
        feet = np.stack([(boxes[:, 0] + boxes[:, 2]) / 2, boxes[:, 3]], axis=1)
        cxy = court.image_to_court(feet, H)
        return np.array([court.in_court(p, margin=margin + self.ROI_SLACK_M) for p in cxy])

    def __call__(self, frame: np.ndarray) -> list[PoseDet]:
        bboxes = np.asarray(self.det(frame), dtype=float)
        if len(bboxes) == 0:
            return []
        bboxes = bboxes[self._in_roi(bboxes)]
        if len(bboxes) == 0:
            return []
        kxy, kcf = self.pose(frame, bboxes=bboxes)
        out: list[PoseDet] = []
        for i, (x1, y1, x2, y2) in enumerate(bboxes):
            box = np.array([(x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1])
            out.append(PoseDet(-1, box, kxy[i], kcf[i]))
        return out


class _Tracked:
    """Composes a detector-only backend with this repo's IoU tracker."""

    def __init__(self, detector, **tracker_kwargs) -> None:
        from .tracking import IouTracker

        self.detector = detector
        self.tracker = IouTracker(**tracker_kwargs)

    def __call__(self, frame: np.ndarray) -> list[PoseDet]:
        return self.tracker.update(self.detector(frame))


def build(name: str = "ultralytics", **kwargs):
    """Instantiate a backend by name; unknown names list the valid ones.

    `court_roi=(H, margin)` is accepted by every name and only used by rtmlib, so callers
    can hand it over without branching on the backend."""
    court_roi = kwargs.pop("court_roi", None)
    if name == "ultralytics":
        return UltralyticsByteTrackPose(
            model=kwargs.pop("model", "yolo11x-pose.pt"),
            device=kwargs.pop("device", "mps"),
            imgsz=kwargs.pop("imgsz", 1280),
            conf=kwargs.pop("conf", 0.25))
    if name == "ultralytics-iou":
        return _Tracked(UltralyticsPose(
            model=kwargs.pop("model", "yolo11x-pose.pt"),
            device=kwargs.pop("device", "mps"),
            imgsz=kwargs.pop("imgsz", 1280),
            conf=kwargs.pop("conf", 0.25)))
    if name == "rtmlib":
        return _Tracked(RtmlibPose(mode=kwargs.pop("mode", "balanced"),
                                   device=kwargs.pop("device", "cpu"),
                                   pose_device=kwargs.pop("pose_device", None),
                                   court_roi=court_roi))
    raise ValueError(f"unknown pose backend {name!r}; "
                     f"choose from ('ultralytics', 'ultralytics-iou', 'rtmlib')")
