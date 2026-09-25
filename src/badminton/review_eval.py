"""Evaluate a candidate AI export against separately reviewed, explicitly held-out contacts.

No database, inference, training, or export mutation. Example:
  python -m badminton.review_eval --reviews reviews.json --candidate-dir web/public/data \
      --held-out-match india_open_2022_final --no-training --json
"""
from __future__ import annotations

import argparse
from bisect import bisect_left
from collections import Counter, defaultdict
from datetime import datetime
import json
from pathlib import Path
import re

SHOTS = {"short serve", "high serve", "clear", "drive", "drop", "lift", "net shot", "smash", "push", "block"}
CATEGORIES = {"Winner", "Net", "Out", "Misjudged", "Error", "—"}
METRICS = ("shot", "hitter", "joint", "winner", "category")
FIELDS = {"shot", "p", "winner", "category"}
RECORD_FIELDS = {"matchId", "source", "players", "set", "rally", "br", "frame", "final", "original", "corrected", "status", "note", "updatedAt"}
WARNING = "Reviewed sample, not whole-match accuracy. Review selection may be biased. Training declarations do not independently verify model training history."


def require(condition, message):
    if not condition:
        raise ValueError(message)


def integer(value, minimum=0):
    return type(value) is int and minimum <= value <= 2**53 - 1


def text(value, maximum=200):
    return isinstance(value, str) and bool(value.strip()) and len(value) <= maximum


def match_id(value):
    return isinstance(value, str) and bool(re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value))


def players(value):
    return (isinstance(value, dict) and set(value) == {"A", "B"}
            and all(text(name) for name in value.values()) and value["A"] != value["B"])


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(path):
    path = Path(path)
    require(path.stat().st_size <= 128 * 1024 * 1024, f"JSON file exceeds 128 MiB: {path}")
    def invalid_number(value):
        raise ValueError(f"Invalid JSON number: {value}")
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_unique_object,
                      parse_constant=invalid_number)


def validate_reviews(document):
    require(isinstance(document, dict) and set(document) == {"version", "records"}, "Expected version and records")
    require(type(document["version"]) is int and document["version"] == 1, "Unsupported review version")
    records = document["records"]
    require(isinstance(records, list) and len(records) <= 50000, "Expected at most 50000 review records")
    anchors, roster = set(), {}
    for index, record in enumerate(records):
        label = f"Review {index + 1}"
        require(isinstance(record, dict) and set(record) == RECORD_FIELDS, f"{label}: invalid fields")
        mid = record["matchId"]
        require(match_id(mid) and record["source"] == "ai", f"{label}: invalid matchId/source")
        require(players(record["players"]), f"{label}: invalid player identities")
        require(mid not in roster or roster[mid] == record["players"], f"{label}: inconsistent baseline player identities")
        roster[mid] = record["players"]
        require(all(integer(record[key], 1) for key in ("set", "rally", "br")) and integer(record["frame"]), f"{label}: invalid contact anchor")
        anchor = mid, record["frame"]
        require(anchor not in anchors, f"{label}: duplicate reviewed contact")
        anchors.add(anchor)
        require(type(record["final"]) is bool, f"{label}: final must be boolean")
        for field in ("original", "corrected"):
            value = record[field]
            require(isinstance(value, dict) and set(value) == FIELDS, f"{label}: invalid {field}")
            require(text(value["shot"], 200) and (field == "original" or value["shot"] in SHOTS), f"{label}: invalid {field} shot")
            require(value["p"] in ("A", "B") and value["winner"] in (None, "A", "B"), f"{label}: invalid {field} player")
            require(value["category"] is None or isinstance(value["category"], str) and value["category"] in CATEGORIES, f"{label}: invalid {field} category")
            require(record["final"] or value["winner"] is None and value["category"] is None, f"{label}: nonfinal outcomes must be null")
        changed = record["original"] != record["corrected"]
        require(record["status"] == ("corrected" if changed else "confirmed"), f"{label}: status does not match correction")
        require(isinstance(record["note"], str) and len(record["note"]) <= 2000, f"{label}: note exceeds 2000 characters")
        stamp = record["updatedAt"]
        require(isinstance(stamp, str) and bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z", stamp)), f"{label}: timestamp must be UTC ISO format")
        try:
            datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError(f"{label}: invalid calendar timestamp") from error
    return records


def validate_candidate(document, mid, baseline_players):
    require(isinstance(document, dict) and isinstance(document.get("meta"), dict), f"{mid}: missing candidate metadata")
    meta = document["meta"]
    require(meta.get("id") == mid and meta.get("source") == "ai", f"{mid}: candidate identity/source mismatch")
    require(players(meta.get("players")) and set(meta["players"].values()) == set(baseline_players.values()), f"{mid}: candidate player names differ from reviewed identities")
    remap = {side: next(p for p, name in baseline_players.items() if name == person) for side, person in meta["players"].items()}
    strokes, rallies = document.get("strokes"), document.get("rallies")
    require(isinstance(strokes, list) and isinstance(rallies, list), f"{mid}: missing strokes/rallies")
    ends = {}
    for rally in rallies:
        require(isinstance(rally, dict) and all(integer(rally.get(key), 1) for key in ("set", "rally", "endRound")), f"{mid}: invalid candidate rally anchor")
        key = rally["set"], rally["rally"]
        require(key not in ends, f"{mid}: duplicate candidate rally")
        require(rally.get("winner") in (None, "A", "B") and "winner" in rally, f"{mid}: invalid candidate winner")
        require(isinstance(rally.get("category"), str) and rally["category"] in CATEGORIES, f"{mid}: invalid candidate category")
        ends[key] = rally
    seen, result = set(), []
    for stroke in strokes:
        require(isinstance(stroke, dict) and all(integer(stroke.get(key), 1) for key in ("set", "rally", "br")) and integer(stroke.get("f")), f"{mid}: invalid candidate stroke anchor")
        key = stroke["set"], stroke["rally"], stroke["br"]
        require(key not in seen and key[:2] in ends, f"{mid}: duplicate/orphan candidate stroke")
        seen.add(key)
        require(stroke.get("p") in ("A", "B") and text(stroke.get("shot"), 200), f"{mid}: invalid candidate shot/player")
        end = ends[key[:2]]
        final = stroke["br"] == end["endRound"]
        result.append(dict(frame=stroke["f"], shot=stroke["shot"], p=remap[stroke["p"]], final=final,
                           winner=remap.get(end["winner"]) if final else None,
                           category=end["category"] if final else None))
    require(all((s, r, row["endRound"]) in seen for (s, r), row in ends.items()), f"{mid}: candidate rally ending has no stroke")
    return result


def match_contacts(review_frames, candidate_frames):
    """Unique nearest contact within ±6 frames; ties get no credit, each candidate once.

    Competing reviews use the closer anchor. A rejected review is not reassigned to
    a second-best candidate; this conservative rule avoids order-dependent credit.
    """
    by_frame = defaultdict(list)
    for index, frame in enumerate(candidate_frames):
        by_frame[frame].append(index)
    ordered, claims, ambiguous = sorted(by_frame), defaultdict(list), set()
    for index, frame in enumerate(review_frames):
        position = bisect_left(ordered, frame)
        neighbors = ordered[max(0, position - 1):position + 1]
        neighbors = [value for value in neighbors if abs(value - frame) <= 6]
        if not neighbors:
            continue
        distance = min(abs(value - frame) for value in neighbors)
        closest = [value for value in neighbors if abs(value - frame) == distance]
        if len(closest) != 1 or len(by_frame[closest[0]]) != 1:
            ambiguous.add(index)
            continue
        claims[by_frame[closest[0]][0]].append((distance, index))
    matches = {}
    for candidate, contenders in claims.items():
        contenders.sort()
        if len(contenders) > 1 and contenders[0][0] == contenders[1][0]:
            ambiguous.update(index for distance, index in contenders if distance == contenders[0][0])
        else:
            matches[contenders[0][1]] = candidate
    return matches, ambiguous


def _counts():
    return {"reviewed": 0, "matched": 0, "ambiguous": 0, "reviewed_final": 0, "matched_candidate_final": 0,
            "confirmed": 0, "corrected": 0, "denominators": Counter(), "baseline_correct": Counter(), "candidate_correct": Counter()}


def _score(records, candidates):
    result = _counts()
    matches, ambiguous = match_contacts([r["frame"] for r in records], [c["frame"] for c in candidates])
    result.update(reviewed=len(records), matched=len(matches), ambiguous=len(ambiguous))
    for index, review in enumerate(records):
        original, truth = review["original"], review["corrected"]
        candidate = candidates[matches[index]] if index in matches else None
        result[review["status"]] += 1
        final = review["final"]
        result["reviewed_final"] += int(final)
        result["matched_candidate_final"] += int(final and candidate is not None and candidate["final"])
        for metric in METRICS:
            if metric in ("winner", "category") and not (final and truth[metric] not in (None, "—")):
                continue
            result["denominators"][metric] += 1
            def correct(value):
                if value is None:
                    return False
                if metric == "joint":
                    return value["shot"] == truth["shot"] and value["p"] == truth["p"]
                return value["p" if metric == "hitter" else metric] == truth["p" if metric == "hitter" else metric]
            result["baseline_correct"][metric] += int(correct(original))
            eligible = candidate if metric not in ("winner", "category") or candidate and candidate["final"] else None
            result["candidate_correct"][metric] += int(correct(eligible))
    return result


def _report(counts):
    metrics = {}
    for name in METRICS:
        denominator = counts["denominators"][name]
        old, new = counts["baseline_correct"][name], counts["candidate_correct"][name]
        metrics[name] = dict(reviewed=denominator, baseline_correct=old, candidate_correct=new,
                             baseline_pct=round(100 * old / denominator, 3) if denominator else None,
                             candidate_pct=round(100 * new / denominator, 3) if denominator else None,
                             delta_pp=round(100 * (new - old) / denominator, 3) if denominator else None)
    return dict(review_counts={key: counts[key] for key in ("reviewed", "confirmed", "corrected")},
                matched=counts["matched"], unmatched=counts["reviewed"] - counts["matched"], ambiguous=counts["ambiguous"],
                coverage_pct=round(100 * counts["matched"] / counts["reviewed"], 3) if counts["reviewed"] else None,
                reviewed_endings=counts["reviewed_final"], matched_candidate_endings=counts["matched_candidate_final"],
                unmatched_endings=counts["reviewed_final"] - counts["matched_candidate_final"], metrics=metrics)


def evaluate(document, candidate_dir, held_out_matches, training_matches):
    """Return the complete report or raise ValueError/OSError; never emit partial totals.

    Pass [] for training_matches only when explicitly declaring no training.
    """
    records = validate_reviews(document)
    require(isinstance(held_out_matches, (list, tuple)) and held_out_matches and all(match_id(mid) for mid in held_out_matches), "Declare at least one valid held-out match")
    require(isinstance(training_matches, (list, tuple)) and all(match_id(mid) for mid in training_matches), "Explicit training declaration required ([] means no training)")
    require(len(set(held_out_matches)) == len(held_out_matches) and len(set(training_matches)) == len(training_matches), "Duplicate match declaration")
    require(not set(held_out_matches) & set(training_matches), "Training and held-out matches overlap")
    base = Path(candidate_dir).resolve()
    require(base.is_dir(), "Candidate directory does not exist")
    per_match, pooled = [], _counts()
    for mid in held_out_matches:
        selected = [record for record in records if record["matchId"] == mid]
        require(selected, f"{mid}: no held-out reviews")
        path = (base / mid / "ai.json").resolve()
        require(path.is_relative_to(base), f"{mid}: candidate path escapes the export directory")
        candidates = validate_candidate(read_json(path), mid, selected[0]["players"])
        counts = _score(selected, candidates)
        per_match.append(dict(match_id=mid, **_report(counts)))
        for key, value in counts.items():
            if isinstance(value, Counter):
                pooled[key].update(value)
            else:
                pooled[key] += value
    return dict(version=1, warning=WARNING, held_out_matches=list(held_out_matches), training_matches=list(training_matches),
                training_declaration="no-training" if not training_matches else "listed-matches",
                matching="Unique nearest absolute video frame within ±6; player identity remapped by exact names; ambiguous ties and unmatched contacts score incorrect; no reassignment to second-best contacts.",
                outcome_basis="Winner/category use final reviews with known corrected values; candidate contact must also be its rally's final contact. Unmatched endings score incorrect.",
                total_review_records=len(records), excluded_review_records=len(records) - pooled["reviewed"],
                per_match=per_match, pooled=_report(pooled))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reviews", required=True, type=Path)
    parser.add_argument("--candidate-dir", required=True, type=Path)
    parser.add_argument("--held-out-match", required=True, action="append")
    declaration = parser.add_mutually_exclusive_group(required=True)
    declaration.add_argument("--training-match", action="append")
    declaration.add_argument("--no-training", action="store_true")
    parser.add_argument("--json", action="store_true", help="Print the complete report as JSON")
    args = parser.parse_args(argv)
    try:
        report = evaluate(read_json(args.reviews), args.candidate_dir, args.held_out_match, args.training_match or [])
    except (ValueError, OSError) as error:
        parser.error(str(error))
    if args.json:
        print(json.dumps(report, indent=2, allow_nan=False))
        return
    print(report["warning"])
    print("Held out:", ", ".join(report["held_out_matches"]))
    print("Training declaration:", ", ".join(report["training_matches"]) or "no training")
    print(report["matching"])
    print(report["outcome_basis"])
    for name, row in [(match["match_id"], match) for match in report["per_match"]] + [("POOLED", report["pooled"])]:
        print(f"\n{name}: {row['matched']}/{row['review_counts']['reviewed']} contacts matched; {row['ambiguous']} ambiguous; {row['unmatched_endings']} unmatched endings")
        for metric, value in row["metrics"].items():
            delta = f"{value['delta_pp']:+.3f} pp" if value["delta_pp"] is not None else "n/a"
            print(f"  {metric}: baseline {value['baseline_correct']}/{value['reviewed']} → candidate {value['candidate_correct']}/{value['reviewed']} ({delta})")


if __name__ == "__main__":
    main()
