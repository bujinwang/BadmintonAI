"""Fine-tune BST backbone (fresh 20-class head: 2 sides x 10 canonical shots).
Train india+ae_sf, val ws_final (early stop), TEST denmark (held-out)."""
import sys
import numpy as np
import torch
from torch import nn, optim
sys.path.insert(0, "src")
from badminton import insights
from badminton.bst_eval import BST_0, PAIRS, SEQ_LEN, WEIGHTS  # noqa: E402 (adds BST path)
from preparing_data.shuttleset_dataset import RandomTranslation_batch  # noqa: E402

SP = "/private/tmp/claude-501/-Users-jaydenl-Dev-AI-badminton/8fc71b9b-1c04-43d9-bbe5-c3a79bd1399e/scratchpad"
EN = insights.SHOT_ORDER


def load(ms):
    X, S, Y = [], [], []
    for m in ms:
        z = np.load(f"{SP}/bst_{m}.npz", allow_pickle=True)
        X.append(z["JnB"]); S.append(z["sh"])
        Y += [(0 if s == "Top_" else 10) + EN.index(e)
              for s, e in zip(z["sides"], z["shots"])]
    return np.concatenate(X), np.concatenate(S), np.array(Y)


Xtr, Str_, ytr = load(["india_open_2022_final", "all_england_2022_sf"])
Xv, Sv, yv = load(["all_england_2022_ws_final"])
Xte, Ste, yte = load(["denmark_open_2022_sf"])
print(f"train {len(Xtr)}  val {len(Xv)}  test {len(Xte)}", flush=True)

dev = "mps" if torch.backends.mps.is_available() else "cpu"
net = BST_0(in_dim=(17 + len(PAIRS)) * 2, n_class=20, seq_len=SEQ_LEN,
            depth_tem=2, depth_inter=1)
sd = torch.load(WEIGHTS, map_location="cpu", weights_only=False)
net.load_state_dict({k: v for k, v in sd.items()
                     if not k.startswith("mlp_head")}, strict=False)
net.to(dev)
shift = RandomTranslation_batch()
loss_fn = nn.CrossEntropyLoss(label_smoothing=0.1)
opt = optim.AdamW([
    {"params": [p for k, p in net.named_parameters() if k.startswith("mlp_head")],
     "lr": 5e-4},
    {"params": [p for k, p in net.named_parameters() if not k.startswith("mlp_head")],
     "lr": 5e-5}])


def fwd(x, s):
    x = x.view(*x.shape[:-2], -1)
    vl = torch.full((len(x),), SEQ_LEN, dtype=torch.long, device=x.device)
    return net(x, s, vl)


@torch.no_grad()
def acc_of(X, S, y, batch=256):
    net.eval()
    preds = []
    for i in range(0, len(X), batch):
        preds.append(fwd(torch.from_numpy(X[i:i + batch]).to(dev),
                         torch.from_numpy(S[i:i + batch]).to(dev)).argmax(1).cpu().numpy())
    p = np.concatenate(preds)
    return (p == y).mean(), (p % 10 == y % 10).mean(), (p // 10 == y // 10).mean()


best, best_state, patience = 0.0, None, 0
aug_ok = True
for ep in range(1, 301):
    net.train()
    idx = np.random.permutation(len(Xtr))
    tot = 0.0
    for i in range(0, len(idx), 64):
        b = idx[i:i + 64]
        x = torch.from_numpy(Xtr[b]).to(dev)
        s = torch.from_numpy(Str_[b]).to(dev)
        y = torch.from_numpy(ytr[b]).to(dev)
        if aug_ok:
            try:
                x = torch.cat([shift(x[:, :, :, :17, :].contiguous()),
                               x[:, :, :, 17:, :]], dim=-2)
            except Exception as e:
                print(f"aug disabled: {e}", flush=True)
                aug_ok = False
        loss = loss_fn(fwd(x, s), y)
        opt.zero_grad(); loss.backward(); opt.step()
        tot += loss.item()
    j, c, sde = acc_of(Xv, Sv, yv)
    tag = ""
    if c > best:
        best, patience = c, 0
        best_state = {k: v.cpu().clone() for k, v in net.state_dict().items()}
        tag = " *"
    else:
        patience += 1
    if ep % 5 == 0 or tag:
        print(f"ep {ep}: loss {tot / max(1, len(idx) // 64):.3f} "
              f"val joint {j:.3f} cls {c:.3f} side {sde:.3f}{tag}", flush=True)
    if patience >= 40:
        print("early stop", flush=True)
        break

net.load_state_dict(best_state)
torch.save(best_state, f"{SP}/bst_ft20.pt")
j, c, sde = acc_of(Xte, Ste, yte)
print(f"TEST denmark : joint {j:.1%}  class {c:.1%}  side {sde:.1%}  "
      f"(pretrained argmax class baseline 82.6%)")
j, c, sde = acc_of(Xv, Sv, yv)
print(f"VAL  ws_final: joint {j:.1%}  class {c:.1%}  side {sde:.1%}  (baseline 77.4%)")
