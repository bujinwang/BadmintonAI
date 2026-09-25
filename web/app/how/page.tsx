import type { Metadata } from "next";
import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import { AUTHOR, CHAIN, LINKS } from "@/lib/site";

export const metadata: Metadata = {
  title: "How it works — COURTSIDE",
  description:
    "The label-free chain: how COURTSIDE turns a broadcast badminton feed into a validated scouting report with no human labels at inference — and what was measured, tried, and thrown away.",
};

/* Per-stage narrative. Kept next to the numbers in lib/site.ts so a stat and its
   story can't drift apart. `hard` is the thing a reader wouldn't guess. */
const NOTES: Record<string, { hard: string; how: string }> = {
  "01": {
    hard:
      "There is no court-line detector. Every detection is projected through one homography calibrated by hand from four outer corners — and the corners sit on the outer edge of a painted line, so reading them off a gridded crop beats every automatic pick tried.",
    how:
      "Pose gives ankles, but ankles float above the floor and bias depth. The ground point blends the ankle down toward the box bottom (0.65 of the way), which is what pulls far-court error from metres to centimetres.",
  },
  "02": {
    hard:
      "The frame offset between our video and the labels is not one number. Player feet are insensitive — their error curve is flat over ±10 frames — but the shuttle moves 20+ px per frame and pins the true contact sharply, and the right offset differs per match.",
    how:
      "Two offsets are stored per match: a global +6 for the (flat) player tracks, and a fitted per-match shuttle offset used everywhere contact timing matters.",
  },
  "03": {
    hard:
      "A smash off a descending lift has no 2D direction change at all. Detecting contacts by looking for the shuttle to turn around misses the single most important shot in the sport.",
    how:
      "Two per-frame signals are unioned over ±4-frame velocities: an acceleration term (|Δv| ≥ 30 px/f) that catches smashes, and a reversal term weighted by speed that catches slow net play. Serves can’t kink — they start from rest — so they get a dedicated motion-onset pass.",
  },
  "04": {
    hard:
      "Drives and pushes look nearly identical from geometry alone. Position, landing and timing get you to the mid-80s on easy classes and stall on the ones that decide rallies — you need the body, not the trajectory.",
    how:
      "BST-0 reads our YOLO pose and TrackNetV3 shuttle windows. A stacked classifier combines its probabilities with court geometry and estimated contact height. Training uses detected contacts from other matches, so it sees the timing noise present when the system is deployed.",
  },
  "05": {
    hard:
      "Shuttle visibility is useless as a rally signal. TrackNetV3 fires happily on replays and warm-ups — 83–94% visible during rallies versus 77–82% during the gaps. The two distributions barely separate.",
    how:
      "Rallies are camera runs where both players hold in-court tracks (98% of rally frames, 7–18% of gaps), with bounding-box height bands self-calibrated off the dominant cluster to throw out close-ups and zoomed replays, then split at dead-shuttle restarts.",
  },
  "06": {
    hard:
      "The BWF score digits are about 12 pixels tall. OCR engines return noise. And the overlay updates two to five seconds late — sometimes fifteen-plus seconds behind, when the broadcast cuts to a replay.",
    how:
      "Digit templates are bootstrapped from a labeled match. A rule-constrained decoder repairs score sequences; delayed events are associated with already-ended rallies. The next server and service-court parity provide independent checks. Correct final scores do not make every inferred rally winner exact.",
  },
};

const DEAD_ENDS = [
  [
    "Pixel court-line check for segmentation",
    "Corners sit on the outer edge of the painted line and per-line offsets run 2–5 px. The check rejected real rallies as often as replays.",
  ],
  [
    "Serve-stance gate",
    "Tracks are missing entirely in the half-second before the serve in 56 of 84 rallies — there is no stance to detect.",
  ],
  [
    "Static-rest detection to split rallies",
    "A lob leaves the top of the frame for up to 62 frames mid-rally, which is indistinguishable from a dead shuttle.",
  ],
  [
    "Attributing the server from the first detected contact",
    "The contact detector misses far-side serves — they sit at the window edge as an extremum. The server is derived from the score instead: the winner serves next.",
  ],
  [
    "A scoreboard gate on singles rally segmentation",
    "It helped doubles and hurt singles: the set-start graphic is absent for a beat and one tournament’s badge defeats the digit templates. The real fix was hardening the OCR, not gating on it.",
  ],
];

const STACK = [
  ["Vision", "YOLO11x-pose, ByteTrack, TrackNetV3, BST-0, OpenCV homography"],
  ["Runtime", "PyTorch on Apple-silicon MPS, chunked + resumable batch jobs"],
  ["Data", "DuckDB as the source of truth, keyed by match — parsed once, never re-parsed"],
  ["Web", "Next.js static export, TypeScript, Tailwind, hand-written SVG charts (no chart library)"],
  ["Validation", "ShuttleSet22 annotations — classifier training on other matches and evaluation on the target match"],
];

export default function How() {
  return (
    <main className="max-w-4xl mx-auto px-6 py-10 w-full">
      <nav className="flex items-center gap-4 mb-14">
        <Link href="/" className="disp font-bold text-[1.25rem] tracking-tight">
          COURT<span style={{ color: "var(--ai)" }}>SIDE</span>
        </Link>
        <span className="text-dim text-[13px]">/ how it works</span>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </nav>

      <header className="rise mb-14">
        <div className="kicker mb-3">THE LABEL-FREE CHAIN</div>
        <h1 className="text-[clamp(2.2rem,5vw,3.4rem)] font-bold leading-[1.02] tracking-tight max-w-3xl">
          Six stages, one broadcast feed, and no target-match labels at inference.
        </h1>
        <div className="mt-6 space-y-4 text-[15.5px] leading-relaxed text-mut max-w-2xl">
          <p>
            A badminton broadcast is a single moving camera, two players in motion blur, and a
            shuttle that is four pixels wide at the back of the court. COURTSIDE turns that into
            a scouting report: who moved where, who hit what, who was under pressure, and how
            every point ended.
          </p>
          <p>
            The interesting constraint is that{" "}
            <span className="text-ink font-medium">
              target-match annotations are reserved for evaluation
            </span>
            . Rally boundaries, contacts, shot types, scores, and which end each player is on all
            have to come from the broadcast and court calibration. Annotations from other matches
            train the shot classifier; the target match’s annotations measure what it recovered
            and what it missed.
          </p>
        </div>
      </header>

      {/* ── at a glance ── */}
      <section className="rise rise-1 grid grid-cols-2 sm:grid-cols-4 gap-px bg-[var(--line)] border border-[var(--line)] rounded-md overflow-hidden mb-14">
        {[
          ["SCOPE", "Solo build", "design, CV, backend, frontend"],
          ["PROCESSING", "Resumable", "saved tracks reused across analyses"],
          ["PYTHON", "Stage CLIs", "vision, scoring and analytics"],
          ["MATCHES", "4 singles + doubles", "human labels for the singles matches"],
        ].map(([k, v, s]) => (
          <div key={k} className="bg-[var(--panel)] px-4 py-4">
            <div className="kicker mb-1.5">{k}</div>
            <div className="text-[15px] font-semibold leading-tight">{v}</div>
            <div className="text-dim text-[11.5px] mt-1 leading-snug">{s}</div>
          </div>
        ))}
      </section>

      {/* ── the chain ── */}
      <section className="space-y-4">
        {CHAIN.map((s, i) => {
          const note = NOTES[s.n];
          return (
            <article
              key={s.n}
              className={`card p-6 rise rise-${Math.min(i + 1, 5)}`}
            >
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-4">
                <span className="mono text-[10px] tracking-[0.18em] text-dim">{s.n}</span>
                <h2 className="text-[1.3rem] font-semibold leading-none">{s.name}</h2>
                <span
                  className="bignum text-[1.9rem] ml-auto"
                  style={{ color: "var(--ai)" }}
                >
                  {s.metric}
                </span>
              </div>

              <div className="grid sm:grid-cols-2 gap-x-8 gap-y-4 text-[13.5px] leading-relaxed">
                <div>
                  <div className="kicker mb-1.5">WHAT’S HARD</div>
                  <p className="text-mut">{note.hard}</p>
                </div>
                <div>
                  <div className="kicker mb-1.5">THE APPROACH</div>
                  <p className="text-mut">{note.how}</p>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-[var(--line-soft)] grid sm:grid-cols-2 gap-x-8 gap-y-2 text-[12.5px]">
                <div className="text-mut">
                  <span className="text-ink">{s.metric}</span> {s.of}
                </div>
                <div className="text-mut">
                  <span className="mono text-[10px] tracking-[0.16em] text-dim mr-1.5">
                    IN CONTEXT
                  </span>
                  {s.vs}
                </div>
              </div>
              <div className="mono text-[10.5px] text-dim mt-3">{s.tech}</div>
            </article>
          );
        })}
      </section>

      {/* ── held-out ── */}
      <section className="mt-8 card p-6 border-[var(--ai)]/30">
        <div className="kicker mb-2" style={{ color: "var(--ai)" }}>
          THE NUMBER THAT ACTUALLY MATTERS
        </div>
        <h2 className="text-[1.3rem] font-semibold mb-3">
          Measure the whole pipeline, including the contacts it misses.
        </h2>
        <p className="text-mut text-[14px] leading-relaxed max-w-3xl">
          Shot accuracy on matched contacts excludes undetected strokes. The Validation view
          also reports full stroke accuracy: the contact must be found, its hitter must be
          correct, and its shot type must match the label. The classifier is trained on other
          matches, while detectors and pretrained models have separate development histories.
          Compare all four singles matches before treating an improvement as general.
        </p>
        <Link
          href="/m/denmark_open_2022_sf/ai/lab/"
          className="inline-block mt-5 mono text-[10.5px] tracking-[0.12em] px-3 py-1.5 rounded border transition-colors"
          style={{ borderColor: "var(--ai)", color: "var(--ai)", background: "var(--ai-soft)" }}
        >
          SEE MATCH VALIDATION →
        </Link>
      </section>

      {/* ── dead ends ── */}
      <section className="mt-14">
        <div className="kicker mb-1">THINGS THAT DIDN’T WORK</div>
        <h2 className="text-[1.6rem] font-semibold tracking-tight mb-2">Discarded approaches</h2>
        <p className="text-mut text-[14px] leading-relaxed max-w-2xl mb-6">
          Most of the build time went here. Each of these looked obviously correct on paper and
          failed against the footage for a specific, measurable reason.
        </p>
        <div className="space-y-px">
          {DEAD_ENDS.map(([title, why]) => (
            <div
              key={title}
              className="grid sm:grid-cols-[1fr_1.5fr] gap-x-6 gap-y-1 py-4 border-t border-[var(--line-soft)]"
            >
              <div className="text-[14px] font-medium">{title}</div>
              <div className="text-mut text-[13.5px] leading-relaxed">{why}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── scale ── */}
      <section className="mt-14">
        <div className="kicker mb-1">RUNNING IT</div>
        <h2 className="text-[1.6rem] font-semibold tracking-tight mb-6">Scale and shape</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            ["5", "matches parsed end to end", "singles + a doubles broadcast"],
            ["~828k", "per-frame track rows", "position + 17 keypoints, in DuckDB"],
            ["4.5 h", "longest single tracking run", "166,650 frames, resumable 20k chunks"],
          ].map(([v, l, s]) => (
            <div key={l} className="card p-5">
              <div className="bignum text-[2rem]">{v}</div>
              <div className="text-[13px] mt-1">{l}</div>
              <div className="text-dim text-[11.5px] mono mt-1">{s}</div>
            </div>
          ))}
        </div>
        <p className="text-mut text-[14px] leading-relaxed max-w-3xl mt-6">
          Tracking is measured in MPS-hours, so every long job is chunked and crash-resumable, and
          parsed data is durable — the database is the source of truth and a match is never
          re-parsed. The dashboard you’re reading is a fully static export: all analytics are
          precomputed into JSON at build time, so there is no server, no API, and no cold start.
        </p>
      </section>

      {/* ── stack ── */}
      <section className="mt-14">
        <div className="kicker mb-1">BUILT WITH</div>
        <h2 className="text-[1.6rem] font-semibold tracking-tight mb-6">Stack</h2>
        <div className="space-y-px">
          {STACK.map(([k, v]) => (
            <div
              key={k}
              className="grid sm:grid-cols-[140px_1fr] gap-x-6 gap-y-1 py-3.5 border-t border-[var(--line-soft)]"
            >
              <div className="kicker pt-1">{k}</div>
              <div className="text-[13.5px] text-mut">{v}</div>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-16 pt-8 border-t border-[var(--line)] flex flex-wrap items-baseline gap-x-6 gap-y-2 text-[13px]">
        <span className="text-mut">
          Built by <span className="text-ink font-medium">{AUTHOR}</span>
        </span>
        <a href={LINKS.repo} className="text-mut hover:text-ink transition-colors" target="_blank" rel="noopener noreferrer">
          Source ↗
        </a>
        <a href={LINKS.site} className="text-mut hover:text-ink transition-colors" target="_blank" rel="noopener noreferrer">
          jaydenclim.com ↗
        </a>
        <Link href="/" className="ml-auto text-mut hover:text-ink transition-colors">
          ← back to the matches
        </Link>
      </footer>
    </main>
  );
}
