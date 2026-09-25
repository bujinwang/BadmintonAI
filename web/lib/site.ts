/* Site identity + the one-line version of the label-free chain.
   Shared by the landing page and /how so the numbers can't drift apart.
   Full narrative (what's hard, what was tried, what failed) lives in app/how/page.tsx. */

import benchmark from "@/public/data/india_open_2022_final/showcase.json";

export const AUTHOR = "Jayden Lim";
export const LINKS = {
  site: "https://jaydenclim.com",
  repo: "https://github.com/jayclim/BadmintonAI",
};

/** Absolute base for social-card URLs — must be the real domain or scrapers can't
    fetch /og.png. Override with NEXT_PUBLIC_SITE_URL for preview deploys. */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://badminton.jaydenclim.com";

export interface Stage {
  n: string;
  name: string;
  metric: string;
  /** what the number is measured against */
  of: string;
  /** the comparator that makes the number mean something */
  vs: string;
  tech: string;
}

/** India Open benchmark, read from the same export as the Validation view. */
export const CHAIN: Stage[] = [
  {
    n: "01",
    name: "Player tracking",
    metric: `${benchmark.tracking.medianM.toFixed(2)} m`,
    of: `median position error vs ${benchmark.tracking.n} labeled strokes, India Open`,
    vs: `near court ${benchmark.tracking.nearM} m, far ${benchmark.tracking.farM} m`,
    tech: "YOLO11x-pose · ByteTrack · hand-calibrated homography",
  },
  {
    n: "02",
    name: "Shuttle tracking",
    metric: "99.8%",
    of: "of 980 labeled hit points found across the full broadcast",
    vs: "115 px median residual — the same scale as the human click noise",
    tech: "TrackNetV3 on MPS · 128,400 frames",
  },
  {
    n: "03",
    name: "Hit detection",
    metric: `F1 ${(benchmark.hits.f1 * 100).toFixed(1)}`,
    of: "contacts found within ±6 frames of the India Open labels",
    vs: `${(benchmark.hits.precision * 100).toFixed(1)}% precision · ${(benchmark.hits.recall * 100).toFixed(1)}% recall`,
    tech: "acceleration + reversals · serve onset · wrist motion",
  },
  {
    n: "04",
    name: "Shot classification",
    metric: `${((benchmark.agreement.shotAcc ?? 0) * 100).toFixed(1)}%`,
    of: "10-class agreement on matched India Open contacts",
    vs: "The stacked classifier trains on other matches; missed contacts are excluded here",
    tech: "BST-0 + geometry + estimated contact height",
  },
  {
    n: "05",
    name: "Rally segmentation",
    metric: `F1 ${(benchmark.segmentation.f1 * 100).toFixed(1)}`,
    of: "rally-window agreement against India Open annotations",
    vs: "Score totals help identify missing rallies; equal counts do not guarantee alignment",
    tech: "camera runs · restart splitting · score-driven rescue",
  },
  {
    n: "06",
    name: "Score OCR",
    metric: `${benchmark.ocr.events.length} events`,
    of: "score changes read from the India Open broadcast",
    vs: "Scoring rules repair missed readings; per-rally attribution remains approximate",
    tech: "digit templates · rule-constrained score decoding · serve parity",
  },
];
