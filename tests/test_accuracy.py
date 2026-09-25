"""Accuracy regressions runnable without video, model weights or a match database."""
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

import numpy as np
import pandas as pd

from badminton import court, export_web, hits, insights, pipeline, shotclass


def _labels():
    rows = []
    for rid in (1, 2, 3):
        for br, hitter in ((1, "A"), (2, "B")):
            far = (hitter == "B") != (rid == 3)
            rows.append(dict(set_no=3, rally_id=rid, ball_round=br,
                             frame_num=rid * 100 + br * 20, hitter=hitter,
                             hitter_mx=2., hitter_my=10. if far else 3.4,
                             land_mx=2., land_my=3.4 if far else 10.,
                             hitter_nx=4.1 if far else 2., hitter_ny=3.4,
                             recv_nx=2., recv_ny=10., land_nx=2., land_ny=10.,
                             hit_y=200., hitter_y=250., hit_height=1,
                             backhand=False, aroundhead=False, shot="clear"))
    return pd.DataFrame(rows)


def _predictions(labels):
    sides = insights.rally_side_map(labels)
    return pd.DataFrame([dict(frame_num=r.frame_num - 1, set_no=r.set_no,
                              rally_id=r.rally_id, shot_type=r.shot,
                              hitter=sides[(r.set_no, r.rally_id)][r.hitter])
                         for r in labels.itertuples()])


def test_deciding_set_sides_in_evaluation_and_features():
    labels = _labels()
    predicted = _predictions(labels)
    with patch.object(insights, "stroke_df", return_value=labels), \
            patch.object(hits, "shuttle_offset", return_value=-1), \
            patch.object(pipeline, "build_strokes", return_value=predicted), \
            patch.object(pipeline, "classify", side_effect=lambda df, *a, **kw: df):
        result = pipeline.evaluate("synthetic", "train", verbose=False)
        assert result["hitter_acc"] == 1., result
        feats = shotclass.build_features("synthetic", feet_landing=True)
        assert np.allclose(feats.loc[feats.ball_round == 1, "land_ny"], 10.), feats
    detected = [dict(frame=r.frame_num, player=r.hitter)
                for r in predicted.itertuples()]
    with patch.object(insights, "stroke_df", return_value=labels), \
            patch.object(insights, "rally_df", return_value=pd.DataFrame(columns=["set_no", "rally_id"])), \
            patch.object(hits.config, "get_match", return_value={"homography": np.eye(3).tolist()}), \
            patch.object(hits, "detect_hits", side_effect=lambda m, f0, f1, **kw:
                         [h for h in detected if f0 <= h["frame"] <= f1]), \
            patch.object(hits, "attribute_hits"):
        assert hits.validate("synthetic", verbose=False)["attribution_acc"] == 1.


def test_bbox_fallback_uses_stored_center():
    con = Mock()
    con.execute.return_value.fetchall.return_value = [(10, "near", None, [100, 200, 40, 80])]
    with patch.object(hits.db, "connect", return_value=con):
        assert hits._player_refs("synthetic", 10, 10)[(10, "near")] == [(100, 200)]


def test_wrist_recovery_checks_all_nearby_shuttle_samples():
    def keypoints(x):
        points = [0.] * 51
        points[27:30] = [x, 0., .9]
        return points
    con = Mock()
    con.execute.return_value.fetchall.return_value = [
        (0, "near", keypoints(0)), (1, "near", keypoints(20))]
    shuttle = np.array([[np.nan, np.nan], [1000., 0.], [21., 0.], [22., 0.]])
    with patch.object(hits.db, "connect", return_value=con):
        found = hits._wrist_hits("synthetic", 0, 3, [], shuttle, 0)
    assert len(found) == 1 and found[0]["frame"] == 1, found
    assert found[0]["x"] == 21., found  # closest sample, despite first visible being far away


def test_agreement_counts_missed_shots_and_wrong_hitter():
    labels = _labels()
    labels.loc[0, "shot"] = "smash"  # Entirely missed class must still appear.
    predicted = _predictions(labels).iloc[1:].copy()
    predicted.loc[1, "hitter"] = "near"  # right shot, wrong player
    con = Mock()
    con.execute.return_value.df.return_value = predicted
    with patch.object(export_web.db, "connect", return_value=con), \
            patch.object(insights, "stroke_df", return_value=labels), \
            patch.object(hits, "shuttle_offset", return_value=-1):
        result = export_web._agreement("synthetic")
    assert result["coverage"] == round(5 / 6, 4), result
    assert result["precision"] == 1., result
    assert result["e2e"] == round(5 / 6, 4), result
    assert result["jointE2e"] == round(4 / 6, 4), result
    smash = next(r for r in result["recall"] if r["shot"] == "smash")
    assert smash == dict(shot="smash", recall=None, n=0, nLabel=1, overallRecall=0.)


def test_stack_cache_changes_with_calibration_and_feature_code():
    with TemporaryDirectory() as tmp, \
            patch.object(pipeline.config, "REPO_ROOT", Path(tmp)), \
            patch.object(pipeline.config, "get_match", return_value={"ss_shuttle_offset": -1, "date": date(2022, 1, 16)}) as match:
        before = pipeline._stack_cache_path("synthetic")
        assert before == pipeline._stack_cache_path("synthetic")
        match.return_value = {"ss_shuttle_offset": -3, "date": date(2022, 1, 16)}
        assert before != pipeline._stack_cache_path("synthetic")
        match.return_value = {"ss_shuttle_offset": -1, "date": date(2022, 1, 16)}
        with patch.object(Path, "read_bytes", return_value=b"changed feature code"):
            assert before != pipeline._stack_cache_path("synthetic")


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)}/{len(fns)} passed")
