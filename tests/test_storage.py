"""Durable replacements survive failures. No video, models, or production DB required.

Run: PYTHONPATH=src .venv/bin/python tests/test_storage.py
"""
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

import duckdb
import pandas as pd

from badminton import db, detect, pipeline, shuttle, shuttleset
from badminton.doubles import strokes, track


@contextmanager
def database():
    with TemporaryDirectory() as directory:
        path = Path(directory) / "test.duckdb"
        db.init_db(path)
        with db.transaction(path) as con:
            con.execute("INSERT INTO matches (match_id) VALUES ('test'), ('other')")
            con.execute("INSERT INTO tracks (match_id, frame_num, player_id, court_x) "
                        "VALUES ('test', 10, 'near', 1), ('test', 11, 'near', 2), "
                        "('test', 12, 'near', 3), ('other', 11, 'near', 4)")
            con.execute("INSERT INTO strokes (stroke_id, match_id, source) "
                        "VALUES (1, 'test', 'pipeline'), (2, 'test', 'shuttleset')")
            con.execute("INSERT INTO shuttle (match_id, frame_num, img_x) "
                        "VALUES ('test', 10, 42)")
        original_connect = db.connect
        with patch.object(db, "connect", side_effect=lambda *a, **kw: original_connect(path, **kw)):
            yield Path(directory)


def rows(table):
    with db.connect(read_only=True) as con:
        return con.execute(f"SELECT * FROM {table} ORDER BY ALL").fetchall()


def raises(error, call):
    try:
        call()
    except error:
        return
    raise AssertionError(f"expected {error}")


def test_failed_replacements_rollback():
    with database() as directory:
        before = rows("strokes")
        # Row conversion fails after DELETE; both pipeline entry points must roll back.
        malformed = pd.DataFrame([{"set_no": "invalid"}])
        for write in (pipeline.write_strokes, strokes.write):
            raises(ValueError, lambda: write("test", malformed))
            assert rows("strokes") == before
        # executemany inserts one row, then fails its primary key constraint.
        csv = directory / "shuttle.csv"
        csv.write_text("Frame,X,Y,Visibility\n10,1,2,1\n10,3,4,1\n")
        before = rows("shuttle")
        raises(duckdb.ConstraintException, lambda: shuttle.import_csv("test", csv))
        assert rows("shuttle") == before


def test_label_import_rolls_back_and_rejects_empty_input():
    with database() as directory:
        folder = directory / "data" / "shuttleset" / "test"
        folder.mkdir(parents=True)
        (folder / "set1.csv").write_text("unused\n")
        before = rows("strokes")
        duplicate = {"stroke_id": 1, "match_id": "test", "source": "shuttleset"}
        with patch.object(shuttleset, "REPO_ROOT", directory), \
                patch.object(shuttleset.config, "get_match", return_value={}):
            with patch.object(shuttleset, "_rows", return_value=[duplicate]):
                raises(duckdb.ConstraintException, lambda: shuttleset.import_match("test"))
            with patch.object(shuttleset, "_rows", return_value=[]):
                raises(ValueError, lambda: shuttleset.import_match("test"))
        assert rows("strokes") == before


@contextmanager
def video(available=(), total=100, opened=True):
    class Capture:
        def __init__(self, *args):
            self.frame = 0

        def isOpened(self):
            return opened

        def set(self, prop, value):
            self.frame = int(value)

        def get(self, prop):
            return total

        def read(self):
            ok = self.frame in available
            self.frame += 1
            return ok, None

        def grab(self):
            ok = self.frame in available
            self.frame += 1
            return ok

        def release(self):
            pass

    no_people = lambda *a, **kw: [SimpleNamespace(keypoints=None, boxes=None)]
    model = SimpleNamespace(track=no_people, predict=no_people)
    cv2 = SimpleNamespace(VideoCapture=Capture, CAP_PROP_POS_FRAMES=1, CAP_PROP_FRAME_COUNT=2)
    match = {"homography": [1, 0, 0, 0, 1, 0, 0, 0, 1], "video_path": "test.mp4"}
    with patch.dict("sys.modules", {"cv2": cv2, "ultralytics": SimpleNamespace(YOLO=lambda _: model)}), \
            patch.object(detect.config, "get_match", return_value=match):
        yield


def test_tracking_preserves_data_on_unreadable_or_truncated_video():
    with database():
        before = rows("tracks")
        for process in (detect.process_video, track.process_video):
            for options in ({"opened": False}, {}, {"available": (10,)}):
                with video(**options):
                    raises(OSError, lambda: process("test", start_frame=10, max_frames=3))
                assert rows("tracks") == before
            with video(available=(10,)):
                raises(OSError, lambda: process("test", start_frame=10))
            assert rows("tracks") == before


def test_tracking_allows_real_end_of_video_with_stride():
    for process in (detect.process_video, track.process_video):
        with database(), video(available=(10, 11, 12), total=13):
            assert process("test", start_frame=10, max_frames=10, stride=2) == 0
            remaining = rows("tracks")
            assert len(remaining) == 1 and remaining[0][0] == "other"


def test_sparse_detection_preserves_other_frames_and_failed_reads():
    with database():
        before = rows("tracks")
        with video(available=(11,)):
            assert detect.process_frames("test", [12, 11, 11]) == 0
        assert rows("tracks") == [r for r in before if not (r[0] == "test" and r[1] == 11)]
        before = rows("tracks")
        with video():
            raises(OSError, lambda: detect.process_frames("test", [10]))
        assert rows("tracks") == before


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for test in tests:
        test()
        print(f"PASS {test.__name__}")
    print(f"{len(tests)}/{len(tests)} passed")
