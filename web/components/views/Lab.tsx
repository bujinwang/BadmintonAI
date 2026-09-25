"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ViewProps } from "@/components/Dashboard";
import { AiTag, Card, Metric, Section, Select, useChartTip } from "@/components/ui";
import { Confusion, HBars, OcrStairs } from "@/components/charts";
import { Replay2D } from "@/components/court";
import RallyVideo from "@/components/RallyVideo";
import { useReplay, useShowcase } from "@/lib/data";
import type { Replay } from "@/lib/types";
import { SHOT_ORDER } from "@/lib/types";

export default function Lab({ d, id, src }: ViewProps) {
  const { data: sc, error, retry } = useShowcase(id);
  const { meta, rallies } = d;

  const [ralKey, setRalKey] = useState<string>(() => {
    const r = rallies.reduce((best, r) => (r.shots > best.shots ? r : best), rallies[0]);
    return r ? `${r.set}-${r.rally}` : "";
  });
  const sel = rallies.find((r) => `${r.set}-${r.rally}` === ralKey) ?? rallies[0];
  const rep = useReplay(id, src, sel?.set ?? null, sel?.rally ?? null);

  const stages = useMemo(() => {
    if (!sc) return [];
    return [
      {
        name: "PLAYER TRACKING",
        tech: "YOLO11x-pose + ByteTrack + homography",
        metric: `${sc.tracking.medianM} m`,
        sub: `median position error vs ${sc.tracking.n} labeled strokes (near ${sc.tracking.nearM} / far ${sc.tracking.farM})`,
        vs: "≈ the annotators' own click noise",
      },
      {
        name: "SHUTTLE TRACKING",
        tech: "TrackNetV3, full broadcast",
        metric: "2D trajectory",
        sub: "Shuttle positions in broadcast pixels, including detection gaps",
        vs: "Screen coordinates do not measure shuttle height or 3D flight",
      },
      sc.hits && {
        name: "HIT DETECTION",
        tech: "velocity kinks + serve onset + wrist motion",
        metric: `F1 ${(sc.hits.f1 * 100).toFixed(1)}`,
        sub: `P ${(sc.hits.precision * 100).toFixed(0)} / R ${(sc.hits.recall * 100).toFixed(0)} ±6 frames · attribution ${(sc.hits.attribution * 100).toFixed(0)}% · landings ${sc.hits.landingMedM ?? "—"} m median`,
        vs: "Precision counts false contacts; recall counts missed labeled contacts",
      },
      {
        name: "SHOT CLASSIFICATION",
        tech: "BST-0 + geometry + contact-height stack",
        metric: sc.agreement.shotAcc == null ? "—" : `${(sc.agreement.shotAcc * 100).toFixed(1)}%`,
        sub: `on hits matched to labels (${sc.agreement.nMatched}) · 10 shot classes`,
        vs: "Trained on other matches at detected contacts; missed hits are excluded here",
      },
      sc.segmentation && {
        name: "RALLY SEGMENTATION",
        tech: "camera runs + restart splitting + score rescue",
        metric: `F1 ${(sc.segmentation.f1 * 100).toFixed(1)}`,
        sub: `${sc.segmentation.nDet} detected vs ${sc.segmentation.nLabel} labeled rallies`,
        vs: "Compare the score-derived rally counts below to see remaining gaps",
      },
      {
        name: "SCORE OCR",
        tech: "template-matched 12 px digits",
        metric: `${sc.ocr.events.length} events`,
        sub: "Score changes read from this broadcast, repaired using scoring rules",
        vs: "A correct final score does not guarantee each rally winner is correct",
      },
    ].filter(Boolean) as {
      name: string;
      tech: string;
      metric: string;
      sub: string;
      vs: string;
    }[];
  }, [sc]);

  return (
    <div className="space-y-10">
      <div className="card px-4 py-3 flex flex-wrap items-center gap-3 text-[13px]">
        <p className="text-mut">Inspect uncertain contacts and reference disagreements, then save a separate review record.</p>
        <Link href={`/m/${id}/ai/review/`} className="ml-auto shrink-0 text-[var(--ai)] underline underline-offset-4">Open accuracy review →</Link>
      </div>
      {error && <div role="alert" className="card p-5">
        <p className="text-err">Couldn’t load validation data.</p>
        <button onClick={retry} className="mt-3 rounded border border-[var(--line)] px-3 py-1.5">Try again</button>
      </div>}
      {!sc && !error && <p role="status" className="mono text-mut">Loading validation data…</p>}
      <section>
        <Section
          kicker="THE LABEL-FREE CHAIN"
          title="Pipeline stages"
          hint={
            "Saved validation against ShuttleSet22 human labels. The shot classifier excludes this match from training; detection thresholds and upstream models have separate validation histories."
          }
        >
          <AiTag text="VALIDATION" />
        </Section>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {stages.map((s, i) => (
            <Card key={s.name} delay={Math.min(i + 1, 5) as 1} className="relative overflow-hidden">
              <div className="mono text-[9.5px] text-dim tracking-[0.18em] mb-1">
                {String(i + 1).padStart(2, "0")} ▸ {s.name}
              </div>
              <div className="bignum text-[2rem]" style={{ color: "var(--ai)" }}>
                {s.metric}
              </div>
              <div className="text-[11.5px] text-mut mt-1 leading-snug">{s.sub}</div>
              <div className="text-[11px] text-dim mt-2 pt-2 border-t border-[var(--line-soft)] leading-snug">
                <span className="mono text-[9.5px] tracking-[0.16em] mr-1.5">IN CONTEXT</span>
                {s.vs}
              </div>
              <div className="mono text-[10px] text-dim mt-2">{s.tech}</div>
              {i < stages.length - 1 && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 text-dim text-[18px] hidden lg:block">
                  →
                </div>
              )}
            </Card>
          ))}
        </div>
      </section>

      {!!sc?.rallyCoverage?.length && <section>
        <Section kicker="CHECK THE DENOMINATOR" title="How much of the match was recovered?"
          hint="Each point requires one rally. Compare detected rally windows with the decoded final score. Matching counts alone do not prove that the right rallies were found." />
        <div className="grid sm:grid-cols-3 gap-3">
          {sc.rallyCoverage.map((s) => <Card key={s.set}>
            <div className="kicker mb-2">SET {s.set}</div>
            <Metric label="RALLIES DETECTED / POINTS" value={`${s.detected} / ${s.expected}`} size="text-[1.8rem]" />
            <p className="text-[13px] mt-3" style={{ color: s.missing ? "var(--warn)" : "var(--mut)" }}>
              {s.missing > 0 ? `${s.missing} missing ${s.missing === 1 ? "rally" : "rallies"}` : s.missing < 0 ? `${-s.missing} extra ${s.missing === -1 ? "window" : "windows"}` : "Rally count matches the score"}
            </p>
            <p className="text-[12px] text-mut mt-1">{s.unknownWinners} {s.unknownWinners === 1 ? "winner" : "winners"} still unknown</p>
          </Card>)}
        </div>
      </section>}

      <div className="rule" />

      {/* rally x-ray */}
      <section>
        <Section
          kicker="ONE RALLY"
          title="Rally breakdown"
          hint="Inspect the same rally in the broadcast, tracked court, and shuttle trajectory. Each player has separate playback controls. Yellow = machine; dashed gray = human label, where one exists."
        />
        <div className="max-w-xs mb-3">
          <Select
            label="RALLY"
            value={sel ? `${sel.set}-${sel.rally}` : ""}
            onChange={setRalKey}
            options={rallies.map((r) => `${r.set}-${r.rally}`)}
          />
        </div>
        <div className="grid lg:grid-cols-2 gap-4 [&>*]:min-w-0">
          <Card className="rise-1">
            <div className="kicker mb-2">FOOTAGE — TOGGLE “AI OVERLAY” IN THE NAVBAR FOR THE FULLY ANNOTATED FEED</div>
            {sel && <RallyVideo rally={sel} youtubeId={meta.youtubeId} />}
            <div className="kicker mt-4 mb-2">WHAT THE MACHINE SEES — 2D COURT</div>
            {rep.error ? <div role="alert" className="text-[13px] py-6">
              <p>Couldn’t load this rally’s tracking.</p>
              <button onClick={rep.retry} className="mt-2 rounded border border-[var(--line)] px-3 py-1.5">Try again</button>
            </div> : rep.data ? (
              <Replay2D key={`${id}-${src}-${sel?.set}-${sel?.rally}`} rep={rep.data} ai />
            ) : (
              <div role="status" className="text-dim mono text-[12px] py-10 text-center">{sel ? "Loading rally…" : "No rallies available."}</div>
            )}
          </Card>
          <Card className="rise-2">
            <div className="kicker mb-2">
              SHUTTLE TRAJECTORY — SCREEN PX VS TIME · <span style={{ color: "var(--ai)" }}>│ DETECTED HIT</span>
              {rep.data?.refHits.length ? " · ┊ HUMAN LABEL" : ""}
            </div>
            {rep.data && <Trajectory rep={rep.data} />}
            {rep.data && (
              <div className="kicker mt-4 mb-2">
                {rep.data.hits.length} DETECTED CONTACTS — SCROLL
              </div>
            )}
            <div className="mt-1 space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
              {rep.data?.hits.map((h) => (
                <div key={h.f} className="flex items-center gap-2 text-[12px]">
                  <span className="mono text-[10.5px] text-dim w-16">f{h.f}</span>
                  <span className="mono text-[10.5px] px-1.5 rounded"
                    style={{ background: "var(--ai-soft)", color: "var(--ai)" }}>
                    {meta.players[h.p].split(" ").map((w) => w[0]).join("")}
                  </span>
                  <span className="text-mut">{h.shot}</span>
                  {h.conf != null && (
                    <span className="mono text-[10.5px] text-dim ml-auto">
                      {(h.conf * 100).toFixed(0)}% conf
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      <div className="rule" />

      {/* score OCR */}
      {sc && (
        <section>
          <Section
            kicker="READING THE BROADCAST GRAPHICS"
            title="Score OCR"
            hint="The BWF overlay digits are ~12 px — too small for OCR engines, so digit templates are matched directly (bootstrapped once from a labeled match; they transfer across tournaments). Reading the score after every rally yields winners, set boundaries and which side each player is on. Hover the staircase for each reading."
          />
          <div className="grid lg:grid-cols-[0.9fr_1.4fr] gap-4 [&>*]:min-w-0">
            <Card className="rise-1">
              <div className="kicker mb-3">SCOREBOARD CROPS + MACHINE READING</div>
              <div className="space-y-2.5">
                {sc.ocr.crops.map((c) => (
                  <div key={c.frame} className="flex items-center gap-3 flex-wrap">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/data/${id}/${c.img}`}
                      alt={`scoreboard at frame ${c.frame}`}
                      className="rounded border border-[var(--line)] w-[230px] max-w-full"
                    />
                    <div className="mono text-[12px]">
                      <div style={{ color: "var(--ai)" }}>
                        read: {c.top}–{c.bot}
                      </div>
                      <div className="text-dim text-[10.5px]">set {c.set} · f{c.frame}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="rise-2">
              <div className="kicker mb-2">EVERY MACHINE-READ SCORE CHANGE</div>
              <OcrStairs events={sc.ocr.events} />
              <div className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t border-[var(--line-soft)]">
                <Metric label="SCORE EVENTS" value={sc.ocr.events.length} size="text-[1.6rem]" />
                <Metric
                  label="WINNERS READ"
                  value={sc.ocr.events.filter((e) => e.winner).length}
                  size="text-[1.6rem]"
                />
                <Metric label="SIDE MAP" value="✓ per set" size="text-[1.6rem]"
                  sub="winner serves next → row ↔ court side" />
              </div>
            </Card>
          </div>
        </section>
      )}

      <div className="rule" />

      {/* agreement vs ground truth */}
      {sc && (
        <section>
          <Section
            kicker="AI VS HUMAN LABELS"
            title="AI accuracy vs human labels"
            hint="The label-free pipeline's strokes matched to ShuttleSet's human annotations (±6 frames). This is the exact gap between the GROUND TRUTH and AI VISION toggles."
          />
          <div className="grid sm:grid-cols-4 gap-3 mb-4">
            <Card delay={1}>
              <Metric label="STROKES FOUND" value={`${(sc.agreement.coverage * 100).toFixed(1)}%`}
                sub={`${sc.agreement.nMatched}/${sc.agreement.nLabel} labeled strokes`} accent="var(--ai)" />
            </Card>
            <Card delay={2}>
              <Metric label="WHO HIT IT" value={sc.agreement.hitterAcc == null ? "—" : `${(sc.agreement.hitterAcc * 100).toFixed(1)}%`}
                sub="hitter agreement on matched" accent="var(--ai)" />
            </Card>
            <Card delay={3}>
              <Metric label="SHOT TYPE" value={sc.agreement.shotAcc == null ? "—" : `${(sc.agreement.shotAcc * 100).toFixed(1)}%`}
                sub="10-class agreement on matched" accent="var(--ai)" />
            </Card>
            <Card delay={4}>
              <Metric label="FULL STROKE ACCURACY" value={sc.agreement.jointE2e == null ? "—" : `${(sc.agreement.jointE2e * 100).toFixed(1)}%`}
                sub="found + correct hitter + correct shot, out of all labeled strokes" accent="var(--ai)" />
            </Card>
          </div>
          <div className="grid lg:grid-cols-2 gap-4 [&>*]:min-w-0">
            <Card>
              <div className="kicker mb-2">CONFUSION — WHERE THE AI DISAGREES</div>
              <Confusion cells={sc.agreement.confusion} order={SHOT_ORDER} />
            </Card>
            <Card className="self-start">
              <div className="kicker mb-3">{sc.agreement.recall.every((r) => r.overallRecall != null)
                ? "SHOT RECOVERY — INCLUDING MISSED CONTACTS" : "SHOT RECALL — ON MATCHED CONTACTS"}</div>
              <HBars
                rows={[...sc.agreement.recall]
                  .sort((a, b) => (b.overallRecall ?? b.recall ?? 0) - (a.overallRecall ?? a.recall ?? 0))
                  .map((r) => ({ label: r.shot, value: r.overallRecall ?? r.recall ?? 0 }))}
                color="var(--ai)"
                format={(v) => `${(v * 100).toFixed(0)}%`}
              />
              <p className="text-dim text-[12px] mt-4 leading-snug">
                Drives and pushes look alike from geometry alone — that&apos;s why the chain
                uses BST&apos;s pose transformer at each detected contact. Smashes off a descending
                lift have no 2D direction change; the |Δv| detector was built for exactly that.
              </p>
            </Card>
          </div>
        </section>
      )}
    </div>
  );
}

/* shuttle screen-trajectory chart with detected vs labeled hit rules */
function Trajectory({ rep }: { rep: Replay }) {
  const W = 640, H = 300, pad = 34;
  const pts = rep.shuttle;
  const { ref, on, tipEl } = useChartTip();
  if (!pts.length) return <div className="text-dim text-[12px]">No shuttle track.</div>;
  const f0 = rep.f0, f1 = rep.f1;
  const x = (f: number) => pad + ((W - 2 * pad) * (f - f0)) / Math.max(1, f1 - f0);
  const yx = (v: number) => pad + ((H - 2 * pad) * v) / 1280;
  const yy = (v: number) => pad + ((H - 2 * pad) * v) / 720;
  const seg = (key: 1 | 2, scale: (v: number) => number) => {
    let d = "", pen = false;
    let prevF = -10;
    for (const p of pts) {
      const X = x(p[0]), Y = scale(p[key]);
      if (!pen || p[0] - prevF > 3) d += `M${X.toFixed(1)},${Y.toFixed(1)}`;
      else d += `L${X.toFixed(1)},${Y.toFixed(1)}`;
      pen = true;
      prevF = p[0];
    }
    return d;
  };
  return (
    <div className="relative" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {/* Contact rules sit BEHIND the traces and are drawn as rail ticks with only a
            whisper of a full-height line — a long rally has 40+ of them and solid rules
            at full opacity bury the very trajectories they annotate. */}
        {rep.refHits.map((h) => (
          <line key={`r${h.f}`} x1={x(h.f)} y1={pad - 6} x2={x(h.f)} y2={H - pad}
            stroke="var(--ref-tick)" strokeDasharray="2 5" opacity={0.5} />
        ))}
        {rep.hits.map((h) => (
          <g key={`d${h.f}`}>
            <line x1={x(h.f)} y1={pad - 6} x2={x(h.f)} y2={H - pad}
              stroke="var(--ai)" strokeWidth={1} opacity={0.16} />
            <line x1={x(h.f)} y1={pad - 6} x2={x(h.f)} y2={pad + 7}
              stroke="var(--ai)" strokeWidth={1.6} opacity={0.95} />
            <line x1={x(h.f)} y1={H - pad - 7} x2={x(h.f)} y2={H - pad}
              stroke="var(--ai)" strokeWidth={1.6} opacity={0.95} />
          </g>
        ))}
        <path d={seg(1, yx)} fill="none" stroke="var(--trace-x)" strokeWidth={1.8} />
        <path d={seg(2, yy)} fill="none" stroke="var(--trace-y)" strokeWidth={1.8} />
        {/* invisible wide hover targets over the hit rules */}
        {rep.refHits.map((h) => (
          <line key={`rh${h.f}`} x1={x(h.f)} y1={pad - 6} x2={x(h.f)} y2={H - pad}
            stroke="transparent" strokeWidth={8}
            {...on(<span>human-labeled hit · <span className="mono">f{h.f}</span></span>)} />
        ))}
        {rep.hits.map((h) => (
          <line key={`dh${h.f}`} x1={x(h.f)} y1={pad - 6} x2={x(h.f)} y2={H - pad}
            stroke="transparent" strokeWidth={8}
            {...on(
              <span>
                detected: <b style={{ color: "var(--ai)" }}>{h.shot}</b>
                {h.conf != null && <span className="text-dim"> {(h.conf * 100).toFixed(0)}%</span>}
                {" · "}<span className="mono">f{h.f}</span>
              </span>,
            )} />
        ))}
        <text x={pad} y={14} fontSize={10} fill="var(--trace-x)" className="mono">x(px)</text>
        <text x={pad + 44} y={14} fontSize={10} fill="var(--trace-y)" className="mono">y(px)</text>
        <text x={W - pad} y={H - 8} textAnchor="end" fontSize={9.5} fill="var(--dim)" className="mono">
          VIDEO FRAME →
        </text>
      </svg>
      {tipEl}
    </div>
  );
}
