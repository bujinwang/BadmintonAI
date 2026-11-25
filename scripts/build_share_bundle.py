"""Pack a match into the Plan-B cloud bundle (index + poster + highlight only).

Plan B: the original recording and the full-match replay never leave the phone.
What goes to R2 is exactly three things plus a manifest:

    manifest.json      identity, summary, asset list with sizes + hashes
    events.json        the whole structured analysis (rallies, shots, landings,
                       formation, control, commentary)
    poster.jpg         share card / OG image
    highlights-*.mp4   the rally clips, concatenated, nothing else

A viewer that has these four can render timelines, heatmaps, shot maps, formation
and a playable highlight — i.e. everything except the full match. That is the
whole point: the shareable artefact is ~100 MB instead of ~1 GB, and it costs one
Class A operation to write.

  PYTHONPATH=src .venv/bin/python scripts/build_share_bundle.py wtf_2024_md_sf
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from badminton import config  # noqa: E402

SCHEMA = "bm.share/1"
HIGHLIGHT_MB_BUDGET = 150.0     # what we promise to push to the cloud per match


def _sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _probe(p: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=codec_name,width,height,r_frame_rate",
         "-show_entries", "format=duration", "-of", "json", str(p)],
        capture_output=True, text=True, check=True,
    ).stdout
    j = json.loads(out)
    s = (j.get("streams") or [{}])[0]
    num, _, den = (s.get("r_frame_rate") or "30/1").partition("/")
    return {
        "w": s.get("width"), "h": s.get("height"), "codec": s.get("codec_name"),
        "fps": round(float(num) / float(den or 1), 3) if num else None,
        "seconds": round(float(j.get("format", {}).get("duration") or 0), 2),
    }


def _clips(match_id: str) -> list[Path]:
    d = config.REPO_ROOT / "web" / "public" / "clips" / match_id
    if not d.is_dir():
        return []
    def key(p: Path) -> int:
        # f<start>-<end>.mp4 — order by start frame, not lexicographically
        return int(p.stem.split("-")[0].lstrip("f"))
    return sorted(d.glob("f*-*.mp4"), key=key)


def _concat(clips: list[Path], out: Path, workdir: Path) -> None:
    """Stream-copy concat: the clips already share codec/params, so this is I/O bound."""
    lst = workdir / "concat.txt"
    lst.write_text("".join(f"file '{c.resolve()}'\n" for c in clips))
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0",
         "-i", str(lst), "-c", "copy", "-movflags", "+faststart", str(out)],
        check=True,
    )


def _duration(p: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nk=1:nw=1", str(p)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return round(float(out or 0), 3)


def _chapters(clips: list[Path], rallies: list[dict]) -> list[dict]:
    """Map each rally onto its offset *inside the concatenated highlight*.

    The rally's f0/t0 refer to the original recording, which the viewer does not
    have — so a share page that wants "jump to rally 12" needs this mapping or it
    seeks to the wrong place. Clips are concatenated in start-frame order, so the
    offset is the running sum of the preceding clip durations.
    """
    by_name = {Path(r["clip"]).name: r for r in rallies if r.get("clip")}
    out, at = [], 0.0
    for p in clips:
        d = _duration(p)
        r = by_name.get(p.name)
        out.append({
            "rally": r.get("rally") if r else None,
            "at": round(at, 3),
            "dur": d,
            "clip": p.name,
        })
        at += d
    return out


def _poster(src: Path, out: Path) -> None:
    """First frame that is not a fade-in, scaled to a 16:9 card."""
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-ss", "1.5", "-i", str(src),
         "-frames:v", "1", "-vf", "scale=1280:-2", "-q:v", "3", str(out)],
        check=True,
    )


def build(match_id: str, dest: Path | None = None) -> dict:
    src_json = config.REPO_ROOT / "web" / "public" / "data" / match_id / "doubles.json"
    if not src_json.is_file():
        raise SystemExit(f"no exported analysis at {src_json} — run doubles.export_web first")
    events = json.loads(src_json.read_text())
    meta = events.get("meta", {})
    clips = _clips(match_id)
    if not clips:
        raise SystemExit(f"no rendered clips for {match_id} — run scripts/render_doubles_clips.py")

    out_dir = dest or (config.REPO_ROOT / "dist" / "share" / match_id)
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    t0 = time.time()
    (out_dir / "events.json").write_text(
        json.dumps(events, ensure_ascii=False, separators=(",", ":"))
    )

    with tempfile.TemporaryDirectory() as td:
        work = Path(td)
        hl = out_dir / "highlights.mp4"
        _concat(clips, hl, work)
        _poster(clips[0], out_dir / "poster.jpg")
        chapters = _chapters(clips, events.get("rallies") or [])

    assets = {}
    for name, fn, extra in (
        ("events", "events.json", {}),
        ("poster", "poster.jpg", {}),
        ("highlight", "highlights.mp4", _probe(out_dir / "highlights.mp4")),
    ):
        p = out_dir / fn
        assets[name] = {
            "path": fn,
            "bytes": p.stat().st_size,
            "sha256": _sha256(p),
            **extra,
        }

    cloud_bytes = sum(a["bytes"] for a in assets.values())
    manifest = {
        "schema": SCHEMA,
        "matchId": match_id,
        "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "meta": meta,
        "summary": {
            "rallies": meta.get("totals", {}).get("rallies"),
            "rallySecs": meta.get("totals", {}).get("rallySecs"),
            "sets": len(meta.get("sets") or []),
            "teams": meta.get("teams"),
        },
        "assets": assets,
        # The contract of Plan B, stated in the artefact itself so a client cannot
        # accidentally assume the full match is available from the cloud.
        "local": {
            "fullMatch": "on-device-only",
            "lanReplay": True,
            "note": "全场回放只在录制设备上；跨设备需手机在场，走局域网直连",
        },
        # Offsets are into the highlight, not the original recording — see _chapters.
        "chapters": chapters,
        "budget": {
            "cloudBytes": cloud_bytes,
            "targetBytes": int(HIGHLIGHT_MB_BUDGET * 1_000_000),
            "withinTarget": cloud_bytes <= HIGHLIGHT_MB_BUDGET * 1_000_000,
        },
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2)
    )
    manifest["_buildSeconds"] = round(time.time() - t0, 1)
    return manifest


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("match_id")
    ap.add_argument("--dest", type=Path)
    a = ap.parse_args()

    m = build(a.match_id, a.dest)
    print(f"\n{a.match_id}  ->  {a.dest or config.REPO_ROOT / 'dist/share' / a.match_id}")
    print(f"{'asset':10s} {'bytes':>12s}  {'MB':>7s}  detail")
    for k, v in m["assets"].items():
        d = ""
        if k == "highlight":
            d = f"{v.get('w')}x{v.get('h')} {v.get('codec')} {v.get('seconds')}s"
        print(f"{k:10s} {v['bytes']:12,d}  {v['bytes']/1e6:7.2f}  {d}")
    b = m["budget"]
    print(f"{'TOTAL':10s} {b['cloudBytes']:12,d}  {b['cloudBytes']/1e6:7.2f}  "
          f"{'within' if b['withinTarget'] else 'OVER'} {HIGHLIGHT_MB_BUDGET:.0f} MB budget")
    print(f"rallies={m['summary']['rallies']}  rallySecs={m['summary']['rallySecs']}  "
          f"build={m['_buildSeconds']}s")


if __name__ == "__main__":
    main()
