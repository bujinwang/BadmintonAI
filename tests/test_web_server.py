"""Run: PYTHONPATH=src .venv/bin/python tests/test_web_server.py"""
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.serve_web import RangeRequestHandler


def test_static_video_ranges():
    with TemporaryDirectory() as folder:
        Path(folder, "clip.mp4").write_bytes(b"0123456789")
        with ThreadingHTTPServer(("127.0.0.1", 0), partial(RangeRequestHandler, directory=folder)) as server:
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            url = f"http://127.0.0.1:{server.server_port}/clip.mp4"
            try:
                for method, byte_range, status, expected, length in [
                    ("GET", None, 200, b"0123456789", 10),
                    ("GET", "bytes=2-5", 206, b"2345", 4),
                    ("GET", "bytes=-3", 206, b"789", 3),
                    ("GET", "bytes=7-", 206, b"789", 3),
                    ("GET", "bytes=8-99", 206, b"89", 2),
                    ("HEAD", "bytes=2-5", 206, b"", 4),
                    ("HEAD", None, 200, b"", 10),
                ]:
                    headers = {"Range": byte_range} if byte_range else {}
                    with urlopen(Request(url, headers=headers, method=method)) as response:
                        assert response.status == status
                        assert response.read() == expected
                        assert int(response.headers["Content-Length"]) == length
                        assert response.headers["Accept-Ranges"] == "bytes"
                        if byte_range == "bytes=2-5":
                            assert response.headers["Content-Range"] == "bytes 2-5/10"
                for byte_range in ("bytes=20-", "bytes=8-4", "bytes=-0", "bytes=-"):
                    try:
                        urlopen(Request(url, headers={"Range": byte_range}))
                    except HTTPError as response:
                        assert response.code == 416
                        assert response.headers["Content-Range"] == "bytes */10"
                        assert response.read() == b""
                        response.close()
                    else:
                        raise AssertionError(f"accepted unsatisfiable range {byte_range}")
            finally:
                server.shutdown()
                thread.join()


if __name__ == "__main__":
    test_static_video_ranges()
    print("PASS static GET, bounded/suffix/open ranges, 416, and HEAD")
