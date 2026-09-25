"""Serve the static dashboard with byte ranges for native video seeking.

Run: python scripts/serve_web.py --directory web/out --port 8080
"""
from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import re


class RangeRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def send_head(self):
        self._remaining = None
        value = self.headers.get("Range", "")
        match = re.fullmatch(r"bytes=([0-9]*)-([0-9]*)", value)
        path = self.translate_path(self.path)
        # Unsupported multi-range requests and directory handling use the stdlib.
        if not match or not os.path.isfile(path):
            return super().send_head()
        try:
            source = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None
        stat = os.fstat(source.fileno())
        modified = self.date_time_string(stat.st_mtime)
        if self.headers.get("If-Range") not in (None, modified):
            source.close()
            return super().send_head()
        size = stat.st_size
        first, last = match.groups()
        try:
            if first:
                start = int(first)
                end = min(int(last), size - 1) if last else size - 1
            else:
                count = int(last)
                start, end = max(0, size - count), size - 1
            if start < 0 or start >= size or end < start:
                raise ValueError("unsatisfiable range")
        except ValueError:
            source.close()
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Last-Modified", modified)
        self.end_headers()
        source.seek(start)
        self._remaining = end - start + 1
        return source

    def copyfile(self, source, outputfile):
        if self._remaining is None:
            return super().copyfile(source, outputfile)
        remaining = self._remaining
        while remaining:
            chunk = source.read(min(64 * 1024, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", default=str(Path(__file__).resolve().parents[1] / "web/out"))
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    handler = partial(RangeRequestHandler, directory=args.directory)
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        print(f"Serving {args.directory} at http://127.0.0.1:{args.port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
