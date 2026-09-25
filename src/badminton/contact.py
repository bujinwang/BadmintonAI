"""Contact-height estimation (metres) — how high the shuttle was at each contact.

No 3D reconstruction: the HITTER is the ruler. For a stroke whose shuttle sits at
image y `hit_y` with the hitter's ground point at image y `gy`, the contact is
(gy − hit_y) px above the floor at the hitter's depth; a standing player of
BODY_M metres spans standing_bbox_px at that same depth, so

    height_m = (gy − hit_y) × BODY_M / standing_bbox_px(depth)

standing_bbox_px is the 80th-percentile bbox height binned by bbox-bottom y
(lunges and crouches shrink the box; the high percentile ≈ standing upright).

Validated against ShuttleSet's binary hit_height on 3,632 labeled contacts across
all four matches: 81.9% above/below-net agreement at HIGH_M=1.55 m (per match
79/81/82/87%), with by-shot median heights perfectly ordered (lob 0.71 → net shot
0.96 → drive 1.46 → drop 1.94 → clear 1.98 → smash 2.18 m; overheads read ~0.4 m
low — a ruler calibration bias, irrelevant for banding). Failed variants (do NOT
relearn): taking the max shuttle height in a ±2-frame window grabs the INCOMING
arc's apex and inflates every low shot (67%); an above-shoulder-keypoint test
lands at 72%. ShuttleSet's own hit_x/hit_y is a floor-plane click (≈ the previous
stroke's landing, 0–6 px from the hitter's feet) and carries NO height signal —
the TrackNet shuttle track is the height source.

CLI:  PYTHONPATH=src python -m badminton.contact <match_id>   # backfill + band report
"""

from __future__ import annotations

import argparse

import numpy as np
import pandas as pd

from . import config, db

BODY_M = 1.78     # generic standing height for the person-ruler; a per-player
                  # roster height would only rescale, the bands barely move
HIGH_M = 1.55     # net-tape height: contact above this = "taken above the net"
                  # (ShuttleSet hit_height 1), below = defensive/low (2)
RULER_Q = 0.80    # bbox-height percentile ≈ standing (lunges shrink the box)
BIN_PX = 30       # bbox-bottom y bin width for the depth-dependent ruler


def ruler(match_id: str) -> dict[tuple[str, int], float]:
    """(player_id, bottom_y_bin) -> standing bbox height in px, whole match."""
    con = db.connect(read_only=True)
    df = con.execute(
        "SELECT player_id, CAST(FLOOR((bbox[2] + bbox[4] / 2) / ?) AS INT) AS bin,"
        " QUANTILE_CONT(bbox[4], ?) AS h FROM tracks WHERE match_id=?"
        " GROUP BY 1, 2", [BIN_PX, RULER_Q, match_id]).fetchall()
    con.close()
    return {(pid, int(b)): float(h) for pid, b, h in df}


def estimate_df(match_id: str, df: pd.DataFrame) -> pd.Series:
    """Contact height per row of df[frame_num, hitter ('near'|'far'), hit_y].

    frame_num is on the VIDEO/tracks timeline, hit_y is the shuttle's image y at
    contact. Returns a float Series aligned to df.index (NaN = no estimate)."""
    con = db.connect(read_only=True)
    t = con.execute(
        "SELECT frame_num, player_id, img_y, bbox[2] + bbox[4] / 2 AS bot"
        " FROM tracks WHERE match_id=? ORDER BY frame_num", [match_id]).df()
    con.close()
    out = pd.Series(np.nan, index=df.index, dtype=float)
    if not len(t) or not len(df):
        return out
    R = ruler(match_id)
    for side in ("near", "far"):
        sel = df[(df["hitter"] == side) & df["hit_y"].notna()
                 & df["frame_num"].notna()]
        if not len(sel):
            continue
        ts = t[t["player_id"] == side]
        m = pd.merge_asof(
            sel[["frame_num", "hit_y"]].reset_index().sort_values("frame_num"),
            ts[["frame_num", "img_y", "bot"]], on="frame_num",
            direction="nearest", tolerance=4)
        rp = np.array([R.get((side, int(b // BIN_PX)), np.nan)
                       if pd.notna(b) else np.nan for b in m["bot"]])
        out.loc[m["index"]] = ((m["img_y"] - m["hit_y"]) * BODY_M / rp).to_numpy()
    return out.where(out.between(-0.5, 5.0)).round(3)   # ruler/track glitches -> NaN


def estimate(match_id: str) -> pd.DataFrame:
    """[stroke_id, contact_height_m] for this match's pipeline strokes.

    Pipeline rows store the shuttle's image point at contact in hit_x/hit_y
    (write_strokes persists hit_img_*), and the hitter slot in `hitter`."""
    con = db.connect(read_only=True)
    s = con.execute(
        "SELECT stroke_id, frame_num, hitter, hit_y FROM strokes"
        " WHERE match_id=? AND source='pipeline' AND hit_y IS NOT NULL"
        " AND hitter IN ('near', 'far')", [match_id]).df()
    con.close()
    if not len(s):
        return pd.DataFrame(columns=["stroke_id", "contact_height_m"])
    s["contact_height_m"] = estimate_df(match_id, s)
    return s[["stroke_id", "contact_height_m"]].dropna()




def backfill(match_id: str) -> int:
    """Fill strokes.contact_height_m for this match's pipeline rows. Idempotent.
    Caller must not hold another connection (DuckDB single-writer, gotcha 1)."""
    if config.get_match(match_id).get("discipline", "singles") == "doubles":
        return 0   # 4-slot hitter attribution first — see docs/DOUBLES.md
    df = estimate(match_id)
    con = db.connect()
    try:
        con.execute("UPDATE strokes SET contact_height_m = NULL"
                    " WHERE match_id=? AND source='pipeline'", [match_id])
        if len(df):
            con.executemany(
                "UPDATE strokes SET contact_height_m=? WHERE stroke_id=?",
                [(float(h), int(i)) for i, h in df.itertuples(index=False)])
    finally:
        con.close()
    return len(df)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Backfill contact_height_m")
    ap.add_argument("match_id")
    args = ap.parse_args()
    n = backfill(args.match_id)
    con = db.connect(read_only=True)
    rep = con.execute(
        "SELECT shot_type, COUNT(*) n, ROUND(MEDIAN(contact_height_m), 2) med,"
        " ROUND(AVG(CASE WHEN contact_height_m > ? THEN 100.0 ELSE 0 END)) pct_high"
        " FROM strokes WHERE match_id=? AND source='pipeline'"
        " AND contact_height_m IS NOT NULL GROUP BY 1 ORDER BY med",
        [HIGH_M, args.match_id]).df()
    con.close()
    print(f"{args.match_id}: {n} strokes backfilled")
    print(rep.to_string(index=False))
