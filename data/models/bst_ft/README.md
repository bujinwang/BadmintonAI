# Fine-tuned BST (Phase 2, 2026-08-30) — validated upgrade, NOT yet deployed

`bst_ft20.pt`: BST-0 backbone from `third_party/BST/bst_weights/bst_0_JnB_bone_merged.pt`
with a fresh 20-class head (2 sides × 10 canonical EN shots), fine-tuned on OUR CV inputs
(tracks pose + TrackNet shuttle) for india+ae_sf, val ws_final, TEST denmark:
class 88.5% / side 98.5% (pretrained argmax baseline 82.6%).

Per-fold leave-one-match-out (`ft_folds.py`; held-out probs in `ftprobs_<match>.npz`):
india 85.6 / denmark 89.2 / ae_sf 80.1 / ws_final 78.4 — mean 83.3% vs 76.8% pretrained.

NOT wired into the pipeline: the deployed stacked classifier (geometry + contact height +
PRETRAINED BST probs, `pipeline.stack_training_frame`) scores 85.7% mean at labeled frames
and swapping in FT probs added only +0.4 (`stack_ft.py`) — not worth per-target weights.
Re-visit when deploying to unlabeled consumer matches: one FT model trained on all four
labeled matches would then be the single-model alternative (argmax 83.4% ≈ stack quality).

Scripts carry scratchpad paths from the session that made them; they need the cached
`bst_<match>.npz` input dumps (rebuild via `bst_eval.build_inputs` + `_forward`).
