"""Stacked shot classifier: geometry + contact height + BST probs, leave-one-match-out."""
import sys
import numpy as np
import pandas as pd
sys.path.insert(0, "src")
from badminton import insights, shotclass, shuttleset
from badminton.bst_eval import CLASSES

SP = "/private/tmp/claude-501/-Users-jaydenl-Dev-AI-badminton/8fc71b9b-1c04-43d9-bbe5-c3a79bd1399e/scratchpad"
MATCHES = ["india_open_2022_final", "denmark_open_2022_sf",
           "all_england_2022_sf", "all_england_2022_ws_final"]
EN = insights.SHOT_ORDER
en_of = {i: ("unknown" if n == "未知球種"
             else shuttleset.canonical_shot_type(n.split("_", 1)[1]))
         for i, n in enumerate(CLASSES)}

bst = []
for m in MATCHES:
    z = np.load(f"{SP}/bst_{m}.npz", allow_pickle=True)
    d = pd.DataFrame(z["ids"], columns=["set_no", "rally_id", "ball_round"])
    for en in EN:
        cols = [i for i, v in en_of.items() if v == en]
        d[f"p_{en}"] = z["probs"][:, cols].sum(1)
    d["p_unknown"] = z["probs"][:, 0]
    d["bst_conf"] = z["probs"].max(1)
    d["match_id"] = m
    bst.append(d)
bst = pd.concat(bst, ignore_index=True)

geo = pd.concat([shotclass.build_features(m, feet_landing=True) for m in MATCHES],
                ignore_index=True)
ch = pd.read_parquet(f"{SP}/contact_height.parquet")[
    ["match_id", "set_no", "rally_id", "ball_round", "est_h"]]
key = ["match_id", "set_no", "rally_id", "ball_round"]
df = geo.merge(bst, on=key, how="left").merge(ch, on=key, how="left")
P = [f"p_{en}" for en in EN]
SETS = {
    "geometry (baseline)": shotclass.CV_FEATURES,
    "geo + contact_h": shotclass.CV_FEATURES + ["est_h"],
    "geo + bst": shotclass.CV_FEATURES + P + ["p_unknown", "bst_conf"],
    "STACK (geo+h+bst)": shotclass.CV_FEATURES + ["est_h"] + P + ["p_unknown", "bst_conf"],
}
print(f"n={len(df)}  bst joined {df['bst_conf'].notna().mean():.0%}  "
      f"est_h joined {df['est_h'].notna().mean():.0%}")
accs = {k: [] for k in list(SETS) + ["bst argmax (baseline)"]}
for te in MATCHES:
    tr, t = df[df.match_id != te], df[df.match_id == te]
    line = [f"{te:<26} n={len(t):<5}"]
    b_ok = (np.array(EN)[t[P].fillna(0).to_numpy().argmax(1)] == t["shot"]).mean()
    accs["bst argmax (baseline)"].append(b_ok)
    line.append(f"bstArg {b_ok:.1%}")
    for name, feats in SETS.items():
        clf = shotclass._model().fit(tr[feats], tr["shot"])
        a = float((clf.predict(t[feats]) == t["shot"]).mean())
        accs[name].append(a)
        line.append(f"{name.split(' ')[0]} {a:.1%}")
    print("  ".join(line))
print("\nmean over 4 held-out matches:")
for k, v in accs.items():
    print(f"  {k:<24} {np.mean(v):.1%}")
