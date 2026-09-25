"""Forced web clip refresh preserves old clips if rendering fails.

Run: PYTHONPATH=src .venv/bin/python tests/test_clip_refresh.py
"""
import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location(
    "render_web_clips", Path(__file__).resolve().parents[1] / "scripts/render_web_clips.py")
clips = importlib.util.module_from_spec(spec)
with patch.dict("sys.modules", {"badminton.render_overlay": SimpleNamespace(render=Mock())}):
    spec.loader.exec_module(clips)


def test_atomic_force_refresh():
    with TemporaryDirectory() as directory:
        root = Path(directory)
        snapshot = root / "snapshot.json"
        snapshot.write_text(json.dumps({"rallies": [{"f0": 100, "f1": 200}]}))
        output = root / "test" / "f64-242.mp4"
        output.parent.mkdir()
        output.write_bytes(b"old complete clip")

        def render(match, start, end, path, **kwargs):
            assert output.read_bytes() == b"old complete clip"
            assert path.parent != output.parent and (start, end) == (64, 242)
            path.write_bytes(b"new complete clip")

        with patch.object(clips, "OUT", root), \
                patch.object(clips.labelfree, "snapshot_path", return_value=snapshot):
            with patch.object(clips.render_overlay, "render", side_effect=render) as mocked:
                clips.render_match("test")
                mocked.assert_not_called()
                clips.render_match("test", force=True)
                assert output.read_bytes() == b"new complete clip"
            output.write_bytes(b"old complete clip")

            def fail(*args, **kwargs):
                render(*args, **kwargs)
                raise RuntimeError("encoder interrupted")

            with patch.object(clips.render_overlay, "render", side_effect=fail):
                try:
                    clips.render_match("test", force=True)
                except RuntimeError:
                    pass
                else:
                    raise AssertionError("render failure must propagate")
            assert output.read_bytes() == b"old complete clip"
            assert list(output.parent.iterdir()) == [output]


if __name__ == "__main__":
    test_atomic_force_refresh()
    print("1/1 passed")
