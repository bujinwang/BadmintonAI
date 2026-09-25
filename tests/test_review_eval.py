"""Pure stdlib review evaluation checks. No database, video, models, or training.

Run: PYTHONPATH=src .venv/bin/python tests/test_review_eval.py
"""
from copy import deepcopy
from contextlib import redirect_stdout, redirect_stderr
from io import StringIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from badminton.review_eval import evaluate, main, match_contacts, read_json, validate_reviews


def review(frame=100, br=1, final=False, match="held", changed=True):
    original = dict(shot="drop" if changed else "smash", p="A", winner="B" if final else None,
                    category="Out" if final else None)
    corrected = dict(shot="smash", p="A", winner="A" if final else None,
                     category="Winner" if final else None)
    if not changed:
        original = corrected.copy()
    return dict(matchId=match, source="ai", players={"A": "Alice", "B": "Bea"},
                set=1, rally=1, br=br, frame=frame, final=final, original=original,
                corrected=corrected, status="corrected" if changed else "confirmed",
                note="Checked the footage", updatedAt="2026-09-07T18:00:00.000Z")


def candidate(frames=(100, 120), swapped=False):
    # Candidate rally IDs differ deliberately: only absolute frames identify contacts.
    return dict(meta=dict(id="held", source="ai", players={"A": "Bea", "B": "Alice"} if swapped else {"A": "Alice", "B": "Bea"}),
                strokes=[dict(set=2, rally=9, br=i + 1, f=frame, p="B" if swapped else "A", shot="smash") for i, frame in enumerate(frames)],
                rallies=[dict(set=2, rally=9, endRound=len(frames), winner="B" if swapped else "A", category="Winner")])


def write_candidate(folder, value, mid="held"):
    path = Path(folder, mid, "ai.json")
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(value))


def rejects(call, fragment):
    try:
        call()
    except (ValueError, OSError) as error:
        assert fragment in str(error), error
    else:
        raise AssertionError("invalid input was accepted")


def test_paired_scoring_names_and_final_contacts():
    document = dict(version=1, records=[review(), review(120, 2, final=True), review(300, 3, changed=False)])
    with TemporaryDirectory() as folder:
        write_candidate(folder, candidate(swapped=True))
        result = evaluate(document, folder, ["held"], ["training"])
    pooled = result["pooled"]
    assert pooled["matched"] == 2 and pooled["unmatched"] == 1
    assert pooled["coverage_pct"] == 66.667
    assert pooled["metrics"]["shot"] == dict(reviewed=3, baseline_correct=1, candidate_correct=2,
                                             baseline_pct=33.333, candidate_pct=66.667, delta_pp=33.333)
    assert pooled["metrics"]["hitter"]["candidate_correct"] == 2
    assert pooled["metrics"]["joint"]["candidate_correct"] == 2
    assert pooled["metrics"]["winner"]["candidate_correct"] == 1
    assert pooled["metrics"]["category"]["delta_pp"] == 100.
    assert pooled["matched_candidate_endings"] == 1
    assert result["training_matches"] == ["training"]
    assert "not whole-match accuracy" in result["warning"]
    # A matching frame is insufficient if the candidate considers it nonfinal.
    with TemporaryDirectory() as folder:
        write_candidate(folder, candidate((100, 120, 130)))
        row = evaluate(document, folder, ["held"], [])["pooled"]
    assert row["metrics"]["winner"]["candidate_correct"] == 0
    assert row["metrics"]["category"]["candidate_correct"] == 0
    assert row["unmatched_endings"] == 1


def test_nearest_contact_ties_and_one_to_one():
    assert match_contacts([100], [94])[0] == {0: 0}
    assert match_contacts([100], [107])[0] == {}
    assert match_contacts([100], [99, 101]) == ({}, {0})
    assert match_contacts([100], [100, 100]) == ({}, {0})
    assert match_contacts([99, 101], [100]) == ({}, {0, 1})
    assert match_contacts([100, 103], [101])[0] == {0: 0}
    assert match_contacts([103, 100], [101])[0] == {1: 0}
    assert match_contacts([100, 130], [130, 100])[0] == {0: 1, 1: 0}


def test_schema_and_declared_holdout_guards():
    valid = dict(version=1, records=[review()])
    mutations = [
        ("matchId", "../held", "matchId/source"), ("source", "labels", "matchId/source"),
        ("frame", True, "anchor"), ("frame", 2**53, "anchor"), ("br", 0, "anchor"),
        ("final", 1, "boolean"), ("status", "confirmed", "status"),
        ("note", "x" * 2001, "note"), ("updatedAt", "2026-02-30T00:00:00Z", "calendar"),
        ("updatedAt", "2026-09-07T00:00:00", "UTC ISO"),
        ("updatedAt", "2026-09-07T00:00:00.1Z", "UTC ISO"),
        ("players", {"A": "Alice", "B": "Alice"}, "identities"),
    ]
    for key, value, message in mutations:
        changed = deepcopy(valid)
        changed["records"][0][key] = value
        rejects(lambda: validate_reviews(changed), message)
    changed = deepcopy(valid)
    changed["records"][0]["corrected"]["shot"] = "lob"
    rejects(lambda: validate_reviews(changed), "shot")
    changed = deepcopy(valid)
    changed["records"][0]["corrected"]["winner"] = "A"
    rejects(lambda: validate_reviews(changed), "nonfinal")
    changed = deepcopy(valid)
    changed["records"].append(review(br=2))
    rejects(lambda: validate_reviews(changed), "duplicate")
    changed = deepcopy(valid)
    changed["records"].append(review(frame=120))
    # Refreshed inference can reuse display IDs while an old frame review remains.
    assert len(validate_reviews(changed)) == 2
    with TemporaryDirectory() as folder:
        rejects(lambda: evaluate(valid, folder, ["held"], ["held"]), "overlap")
        rejects(lambda: evaluate(valid, folder, ["held"], None), "declaration")
        rejects(lambda: evaluate(valid, folder, [], []), "held-out")
        rejects(lambda: evaluate(valid, folder, ["held"], []), "ai.json")
        bad = candidate()
        bad["meta"]["players"]["B"] = "Someone else"
        write_candidate(folder, bad)
        rejects(lambda: evaluate(valid, folder, ["held"], []), "player names")
        bad = candidate()
        bad["meta"]["source"] = "labels"
        write_candidate(folder, bad)
        rejects(lambda: evaluate(valid, folder, ["held"], []), "identity/source")
        path = Path(folder, "duplicate.json")
        path.write_text('{"version":1,"version":1,"records":[]}')
        rejects(lambda: read_json(path), "Duplicate JSON")


def test_pooled_counts_and_cli_no_partial_reports():
    document = dict(version=1, records=[review(), review(300, 2), review(match="other"), review(match="train")])
    with TemporaryDirectory() as folder:
        write_candidate(folder, candidate())
        other = candidate()
        other["meta"]["id"] = "other"
        write_candidate(folder, other, "other")
        result = evaluate(document, folder, ["held", "other"], ["train"])
        assert result["pooled"]["metrics"]["shot"]["candidate_pct"] == 66.667
        assert result["excluded_review_records"] == 1
        assert len(result["per_match"]) == 2
        reviews = Path(folder, "reviews.json")
        reviews.write_text(json.dumps(document))
        base = ["--reviews", str(reviews), "--candidate-dir", folder, "--held-out-match", "held", "--held-out-match", "other", "--json"]
        output = StringIO()
        with redirect_stdout(output):
            main(base + ["--no-training"])
        assert json.loads(output.getvalue())["training_declaration"] == "no-training"
        # No report is emitted if any selected candidate is missing or training undeclared.
        Path(folder, "other", "ai.json").unlink()
        for args in (base + ["--no-training"], base):
            output, errors = StringIO(), StringIO()
            with redirect_stdout(output), redirect_stderr(errors):
                try:
                    main(args)
                except SystemExit as error:
                    assert error.code == 2
                else:
                    raise AssertionError("CLI should reject incomplete evaluation")
            assert output.getvalue() == ""


if __name__ == "__main__":
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        test()
        print(f"PASS {test.__name__}")
