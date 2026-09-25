"""Stack with PER-FOLD fine-tuned BST probs (honest leave-one-match-out)."""
import sys
import numpy as np
import pandas as pd
sys.path.insert(0, "src")
from badminton import insights, shotclass

SP = "/private/tmp/claude-501/-Users-jaydenl-Dev-AI-badminton/8fc71b9b-1c04-43d9-bbe5-c3a79bd1399e/scratchpad"
MS = ["india_open_2022_final", "denmark_open_2022_sf",
      "all_england_2022_sf", "all_england_2022_ws_final"]
EN = insights.SHOT_ORDER
key = ["match_id", "set_no", "rally_id", "ball_round"]

geo = pd.concat([shotclass.build_features(m, feet_landing=True) for m in MS],
                ignore_index=True)
ch = pd.read_parquet(f"{SP}/contact_height.parquet")[key + ["est_h"]]
geo = geo.merge(ch, on=key, how="left")

# pretrained probs (train features) + FT probs (test features), both 10-class
def prob_cols(probs20):
    d = {f"p_{en}": probs20[:, i] + probs20[:, 10 + i] for i, en in enumerate(EN)}
    d["p_unknown"] = 0.0
    d["bst_conf"] = probs20.max(1)
    return pd.DataFrame(d)

from badminton import shuttleset
from badminton.bst_eval import CLASSES
en_of = {i: ("unknown" if n == "未知球種"
             else shuttleset.canonical_shot_type(n.split("_", 1)[1]))
         for i, n in enumerate(CLASSES)}

P = [f"p_{en}" for en in EN] + ["p_unknown", "bst_conf"]
def pre_frame(m):
    z = np.load(f"{SP}/bst_{m}.npz", allow_pickle=True)
    d = pd.DataFrame(z["ids"], columns=key[1:])
    for en in EN:
        cols = [i for i, v in en_of.items() if v == en]
        d[f"p_{en}"] = z["probs"][:, cols].sum(1)
    d["p_unknown"] = z["probs"][:, 0]
    d["bst_conf"] = z["probs"].max(1)
    d["match_id"] = m
    return d

def ft_frame(m):
    z = np.load(f"{SP}/ftprobs_{m}.npz", allow_pickle=True)
    d = prob_cols(z["probs"])
    d[key[1:]] = np.array(z["ids"], int)
    d["match_id"] = m
    return d

FEATS = shotclass.CV_FEATURES + ["est_h"] + P
accs = {"stack+pretrained": [], "stack+FT": [], "FT argmax": []}
for te in MS:
    tr = geo[geo.match_id != te].merge(
        pd.concat([pre_frame(m) for m in MS if m != te]), on=key, how="left")
    t_pre = geo[geo.match_id == te].merge(pre_frame(te), on=key, how="left")
    t_ft = geo[geo.match_id == te].merge(ft_frame(te), on=key, how="left")
    clf = shotclass._model().fit(tr[FEATS], tr["shot"])
    a_pre = (clf.predict(t_pre[FEATS]) == t_pre["shot"]).mean()
    a_ft = (clf.predict(t_ft[FEATS]) == t_ft["shot"]).mean()
    a_arg = (np.array(EN)[t_ft[P[:10]].fillna(0).to_numpy().argmax(1)]
             == t_ft["shot"]).mean()
    accs["stack+pretrained"].append(a_pre)
    accs["stack+FT"].append(a_ft)
    accs["FT argmax"].append(a_arg)
    print(f"{te:<28} stack+pre {a_pre:.1%}  stack+FT {a_ft:.1%}  FTargmax {a_arg:.1%}")
print("\nmeans:", {k: f"{np.mean(v):.1%}" for k, v in accs.items()})
