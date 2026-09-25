"""Per-fold BST fine-tune (leave-one-match-out) + dump held-out probs for stacking."""
import sys
import numpy as np
import torch
from torch import nn, optim
sys.path.insert(0, "src")
from badminton import insights
from badminton.bst_eval import BST_0, PAIRS, SEQ_LEN, WEIGHTS  # noqa: E402
from preparing_data.shuttleset_dataset import RandomTranslation_batch  # noqa: E402

SP = "/private/tmp/claude-501/-Users-jaydenl-Dev-AI-badminton/8fc71b9b-1c04-43d9-bbe5-c3a79bd1399e/scratchpad"
EN = insights.SHOT_ORDER
MS = ["india_open_2022_final", "denmark_open_2022_sf",
      "all_england_2022_sf", "all_england_2022_ws_final"]
dev = "mps" if torch.backends.mps.is_available() else "cpu"
shift = RandomTranslation_batch()
loss_fn = nn.CrossEntropyLoss(label_smoothing=0.1)


def load(ms):
    X, S, Y = [], [], []
    for m in ms:
        z = np.load(f"{SP}/bst_{m}.npz", allow_pickle=True)
        X.append(z["JnB"]); S.append(z["sh"])
        Y += [(0 if s == "Top_" else 10) + EN.index(e)
              for s, e in zip(z["sides"], z["shots"])]
    return np.concatenate(X), np.concatenate(S), np.array(Y)


def fwd(net, x, s):
    x = x.view(*x.shape[:-2], -1)
    vl = torch.full((len(x),), SEQ_LEN, dtype=torch.long, device=x.device)
    return net(x, s, vl)


@torch.no_grad()
def probs_of(net, X, S, batch=256):
    net.eval()
    out = []
    for i in range(0, len(X), batch):
        out.append(torch.softmax(
            fwd(net, torch.from_numpy(X[i:i + batch]).to(dev),
                torch.from_numpy(S[i:i + batch]).to(dev)), 1).cpu().numpy())
    return np.concatenate(out)


summary = []
for te in MS:
    rest = [m for m in MS if m != te]
    tr_ms, val_ms = rest[:2], rest[2:]
    Xtr, Str_, ytr = load(tr_ms)
    Xv, Sv, yv = load(val_ms)
    Xte, Ste, yte = load([te])
    net = BST_0(in_dim=(17 + len(PAIRS)) * 2, n_class=20, seq_len=SEQ_LEN,
                depth_tem=2, depth_inter=1)
    sd = torch.load(WEIGHTS, map_location="cpu", weights_only=False)
    net.load_state_dict({k: v for k, v in sd.items()
                         if not k.startswith("mlp_head")}, strict=False)
    net.to(dev)
    opt = optim.AdamW([
        {"params": [p for k, p in net.named_parameters() if k.startswith("mlp_head")],
         "lr": 5e-4},
        {"params": [p for k, p in net.named_parameters()
                    if not k.startswith("mlp_head")], "lr": 5e-5}])
    best, best_state, patience = 0.0, None, 0
    for ep in range(1, 301):
        net.train()
        idx = np.random.permutation(len(Xtr))
        for i in range(0, len(idx), 64):
            b = idx[i:i + 64]
            x = torch.from_numpy(Xtr[b]).to(dev)
            s = torch.from_numpy(Str_[b]).to(dev)
            y = torch.from_numpy(ytr[b]).to(dev)
            x = torch.cat([shift(x[:, :, :, :17, :].contiguous()),
                           x[:, :, :, 17:, :]], dim=-2)
            loss = loss_fn(fwd(net, x, s), y)
            opt.zero_grad(); loss.backward(); opt.step()
        pv = probs_of(net, Xv, Sv).argmax(1)
        c = (pv % 10 == yv % 10).mean()
        if c > best:
            best, patience = c, 0
            best_state = {k: v.cpu().clone() for k, v in net.state_dict().items()}
        else:
            patience += 1
        if patience >= 30:
            break
    net.load_state_dict(best_state)
    probs = probs_of(net, Xte, Ste)
    p = probs.argmax(1)
    cls = (p % 10 == yte % 10).mean()
    side = (p // 10 == yte // 10).mean()
    z = np.load(f"{SP}/bst_{te}.npz", allow_pickle=True)
    np.savez_compressed(f"{SP}/ftprobs_{te}.npz", probs=probs, ids=z["ids"])
    summary.append((te, cls, side, ep))
    print(f"FOLD {te}: class {cls:.1%} side {side:.1%} (stopped ep {ep}, "
          f"val {best:.3f} on {val_ms[0]})", flush=True)

print("\n== per-fold fine-tuned BST (held-out) ==")
for te, c, s, ep in summary:
    print(f"  {te:<28} class {c:.1%}  side {s:.1%}")
