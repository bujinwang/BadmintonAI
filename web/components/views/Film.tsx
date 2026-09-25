"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ViewProps } from "@/components/Dashboard";
import { Card, Select } from "@/components/ui";
import { RallyMap } from "@/components/court";
import RallyInspector from "@/components/RallyInspector";
import SequenceSearch from "@/components/SequenceSearch";
import { findShotSequences, parseSequence, isValidSequence } from "@/lib/sequences";
import { useReplay } from "@/lib/data";
import type { Rally, P } from "@/lib/types";
import { PCOLOR, ytLink } from "@/lib/fmt";

export default function Film({ d, id, src }: ViewProps) {
  const { meta, rallies, strokes } = d;
  const names = meta.players;
  const sp = useSearchParams();
  const [focusRequest, setFocusRequest] = useState(0);

  // evidence preset (?title&keys=1-2.1-7) or direct rally (?r=1-5)
  const preset = useMemo(() => {
    const keys = sp.get("keys");
    if (!keys) return null;
    return {
      title: sp.get("title") ?? "selection",
      keys: new Set(keys.split(".").map((k) => k.trim())),
    };
  }, [sp]);
  const directR = sp.get("r");
  const rawSequence = sp.get("sequence");
  const sequence = useMemo(() => parseSequence(rawSequence), [rawSequence]);
  const starter = sp.get("starter") ?? "";
  const validSequence = isValidSequence(rawSequence) && ["", "A", "B"].includes(starter);
  const occurrences = useMemo(() => findShotSequences(strokes, sequence, starter === "A" || starter === "B" ? starter : undefined), [strokes, sequence, starter]);
  const occurrenceRallies = useMemo(() => new Set(occurrences.map((m) => `${m.set}-${m.rally}`)), [occurrences]);
  const changeSequence = (shots: string[], first: P | "") => {
    const query = new URLSearchParams(sp.toString());
    if (shots.length) query.set("sequence", shots.join(",")); else query.delete("sequence");
    if (first) query.set("starter", first); else query.delete("starter");
    for (const key of ["r", "contact", "through"]) query.delete(key);
    window.history.pushState(null, "", `?${query}`);
  };

  const navigate = (key: string, value: string) => {
    const query = new URLSearchParams(sp.toString());
    query.set(key, value);
    if (key !== "r") query.delete("r");
    query.delete("contact");
    query.delete("through");
    window.history.pushState(null, "", `?${query}`);
  };
  const clearFilters = () => window.history.pushState(null, "", `/m/${id}/${src}/film/`);
  const setSel = sp.get("set") ?? "All";
  const winSel = sp.get("winner") ?? "Either player";
  const catSel = sp.get("category") ?? "Anything";
  const shotSel = sp.get("shot") ?? "Any";
  const lenSel = sp.get("length") ?? "Any";
  const sortSel = sp.get("sort") ?? "Match order";

  const filtered = useMemo(() => {
    let f = [...rallies];
    if (preset) f = f.filter((r) => preset.keys.has(`${r.set}-${r.rally}`));
    else {
      if (setSel !== "All") f = f.filter((r) => r.set === Number(setSel));
      if (winSel !== "Either player") f = f.filter((r) => r.winner && names[r.winner] === winSel);
      if (catSel !== "Anything") f = f.filter((r) => r.category === catSel);
      if (shotSel !== "Any") f = f.filter((r) => r.endShot === shotSel);
      if (lenSel !== "Any") f = f.filter((r) => r.bucket === lenSel);
      if (sortSel === "Longest first") f.sort((a, b) => b.durS - a.durS);
      else if (sortSel === "Most shots") f.sort((a, b) => b.shots - a.shots);
      else if (sortSel === "Clutch first")
        f.sort((a, b) => Number(b.clutch) - Number(a.clutch) || a.set - b.set || a.rally - b.rally);
    }
    if (!validSequence) return [];
    if (sequence.length) f = f.filter((r) => occurrenceRallies.has(`${r.set}-${r.rally}`));
    return f;
  }, [rallies, preset, setSel, winSel, catSel, shotSel, lenSel, sortSel, names, validSequence, sequence, occurrenceRallies]);

  const sel: Rally | undefined =
    filtered.find((r) => `${r.set}-${r.rally}` === directR) ?? filtered[0];

  const selectedIndex = sel ? filtered.indexOf(sel) : -1;
  const pick = (rally: Rally) => navigate("r", `${rally.set}-${rally.rally}`);
  const rep = useReplay(id, src, sel?.set ?? null, sel?.rally ?? null);
  const selStrokes = useMemo(
    () =>
      sel
        ? strokes
            .filter((s) => s.set === sel.set && s.rally === sel.rally)
            .sort((a, b) => a.br - b.br)
        : [],
    [strokes, sel],
  );

  const selectedOccurrences = useMemo(() => occurrences.filter((m) => m.set === sel?.set && m.rally === sel?.rally), [occurrences, sel]);
  const contact = Number(sp.get("contact"));
  const through = Number(sp.get("through"));
  const focusFrames = useMemo<[number, number] | null>(() => {
    const start = selStrokes.find((s) => s.br === contact);
    const end = selStrokes.find((s) => s.br === through);
    if (start && end && end.f >= start.f && (!sequence.length || selectedOccurrences.some((m) => m.startBr === contact && m.endBr === through))) return [start.f, end.f];
    const first = selectedOccurrences[0];
    return first ? [first.startFrame, first.endFrame] : null;
  }, [selStrokes, contact, through, selectedOccurrences, sequence]);
  const occurrenceCount = occurrences.filter((m) => filtered.some((r) => r.set === m.set && r.rally === m.rally)).length;

  const cats = ["Anything", ...new Set(rallies.map((r) => r.category).filter((c) => c !== "—"))];
  const endShots = ["Any", ...new Set(rallies.map((r) => r.endShot))].sort();

  return (
    <div className="space-y-4">
      {preset ? (
        <div className="card rise px-4 py-2.5 flex items-center gap-3 text-[13.5px]">
          <span className="kicker shrink-0">EVIDENCE</span>
          <span className="text-ink/90">
            the <b className="mono">{filtered.length}</b> rallies behind:{" "}
            <i>{preset.title}</i>
          </span>
          <button
            onClick={clearFilters}
            className="ml-auto mono text-[11px] px-2.5 py-1 rounded border border-[var(--line)] text-mut hover:text-ink"
          >
            ✕ CLEAR
          </button>
        </div>
      ) : (
        <div className="card rise px-4 py-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Select label="SET" value={setSel} onChange={(value) => navigate("set", value)}
            options={["All", ...new Set(rallies.map((r) => String(r.set)))]} />
          <Select label="POINT TO" value={winSel} onChange={(value) => navigate("winner", value)}
            options={["Either player", names.B, names.A]} />
          <Select label="ENDED BY" value={catSel} onChange={(value) => navigate("category", value)} options={cats} />
          <Select label="FINAL SHOT" value={shotSel} onChange={(value) => navigate("shot", value)} options={endShots} />
          <Select label="LENGTH" value={lenSel} onChange={(value) => navigate("length", value)}
            options={["Any", "short (≤4)", "mid (5–9)", "long (10+)"]} />
          <Select label="SORT" value={sortSel} onChange={(value) => navigate("sort", value)}
            options={["Match order", "Longest first", "Most shots", "Clutch first"]} />
        </div>
      )}

      <SequenceSearch sequence={sequence} starter={starter === "A" || starter === "B" ? starter : ""} names={names} onChange={changeSequence} />
      {!validSequence && <p role="alert" className="text-err text-[13px]">This sequence link is invalid. Choose a preset or reset the filters.</p>}
      <div className="flex flex-wrap items-center gap-3 text-[12px]">
        <span className="mono text-mut" role="status">{filtered.length} of {rallies.length} rallies{sequence.length > 0 && ` · ${occurrenceCount} sequence occurrences`}</span>
        {sp.size > 0 && <button onClick={clearFilters} className="text-mut underline underline-offset-4">Reset selection and filters</button>}
      </div>

      <div className="grid xl:grid-cols-[320px_minmax(0,1fr)] gap-4 items-start">
        {/* rally list */}
        <Card className="rise-1 !p-0 overflow-hidden min-w-0">
          <div className="px-4 py-2.5 border-b border-[var(--line-soft)] kicker">
            {filtered.length} RALLIES — SCORE IS A–B AFTER THE RALLY · ◆ CLUTCH
          </div>
          <div className="max-h-[260px] lg:max-h-[520px] overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-5 py-12 text-center text-[13px] text-mut" role="status">
                <p>No rallies match this selection.</p>
                <button onClick={clearFilters} className="mt-3 underline underline-offset-4">Show all rallies</button>
              </div>
            )}
            {filtered.map((r) => {
              const on = sel && r.set === sel.set && r.rally === sel.rally;
              return (
                <button
                  key={`${r.set}-${r.rally}`}
                  onClick={() => pick(r)}
                  aria-current={on ? "true" : undefined}
                  aria-label={`Set ${r.set}, rally ${r.rally}, score ${r.a} to ${r.b}`}
                  className="w-full text-left px-4 py-2 grid grid-cols-[64px_1fr_44px_40px] gap-2 items-baseline border-b border-[var(--line-soft)] last:border-0 transition-colors"
                  style={{ background: on ? "var(--panel-solid)" : "transparent" }}
                >
                  <span className="mono text-[13px] font-semibold">
                    <span className="block text-[9px] text-dim font-normal">S{r.set} · R{r.rally}</span>
                    {r.a}–{r.b}
                    {r.clutch && <span className="text-[10px]"> ◆</span>}
                  </span>
                  <span className="text-[12.5px] truncate">
                    {r.winner ? (
                      <>
                        <span style={{ color: PCOLOR[r.winner] }}>●</span>{" "}
                        <span className="text-mut">{r.endPhrase}</span>
                      </>
                    ) : (
                      <span className="text-dim">
                        {src === "ai" ? "winner unread (OCR gap)" : "outcome not labeled"}
                      </span>
                    )}
                  </span>
                  <span className="mono text-[11px] text-dim text-right">{r.shots} sh</span>
                  <span className="mono text-[11px] text-dim text-right">{r.durS}s</span>
                </button>
              );
            })}
          </div>
        </Card>

        {/* player + replay */}
        <div className="space-y-4 min-w-0">
          {sel && (
            <Card className="rise-2 min-w-0 overflow-hidden">
              <div className="flex items-baseline gap-3 flex-wrap mb-3">
                <span className="disp text-[1.2rem] font-semibold">
                  Set {sel.set} · Rally {sel.rally}
                </span>
                <span className="mono text-[13px] text-mut">
                  {sel.pa}–{sel.pb} → <b className="text-ink">{sel.a}–{sel.b}</b>
                </span>
                <span className="text-[13px] text-mut">
                  {sel.winner ? (
                    <>
                      <span style={{ color: PCOLOR[sel.winner] }}>{names[sel.winner]}</span>{" "}
                      takes it — {sel.endPhrase}
                    </>
                  ) : (
                    "winner unknown"
                  )}
                </span>
                {src === "ai" && selStrokes[0] && <Link href={`/m/${id}/ai/review/?frame=${focusFrames?.[0] ?? selStrokes[0].f}`}
                  className="text-[12px] text-[var(--ai)] underline underline-offset-4">Review contacts</Link>}
                {meta.youtubeId && (
                  <a
                    href={ytLink(meta.youtubeId, sel.t0)}
                    target="_blank"
                    className="ml-auto mono text-[11px] text-dim hover:text-mut"
                  >
                    OPEN ON YOUTUBE ↗
                  </a>
                )}
              </div>
              <div className="flex items-center gap-3 mb-3 mono text-[11px]">
                <button disabled={selectedIndex <= 0} onClick={() => pick(filtered[selectedIndex - 1])}
                  className="rounded border border-[var(--line)] px-3 py-2 disabled:opacity-40 disabled:cursor-default">← Previous rally</button>
                <span className="text-dim">{selectedIndex + 1} / {filtered.length}</span>
                <button disabled={selectedIndex >= filtered.length - 1} onClick={() => pick(filtered[selectedIndex + 1])}
                  className="rounded border border-[var(--line)] px-3 py-2 disabled:opacity-40 disabled:cursor-default">Next rally →</button>
              </div>
              {selectedOccurrences.length > 0 && <div className="flex flex-wrap items-center gap-2 mb-3 text-[12px]" aria-label="Sequence occurrences">
                <span className="text-mut">Matching exchanges</span>
                {selectedOccurrences.map((m) => <button key={m.startBr}
                  aria-pressed={focusFrames?.[0] === m.startFrame && focusFrames?.[1] === m.endFrame}
                  className="rounded border border-[var(--line)] px-2 py-1 aria-pressed:border-[var(--ai)] aria-pressed:text-[var(--ai)]"
                  onClick={() => {
                    const query = new URLSearchParams(sp.toString());
                    query.set("r", `${m.set}-${m.rally}`);
                    query.set("contact", String(m.startBr));
                    query.set("through", String(m.endBr));
                    setFocusRequest((request) => request + 1);
                    window.history.pushState(null, "", `?${query}`);
                  }}>Shots {m.startBr}–{m.endBr}</button>)}
              </div>}
              <RallyInspector key={`${id}-${src}-${sel.set}-${sel.rally}`} rally={sel} strokes={selStrokes}
                replay={rep.data} fps={meta.fps} names={names} source={src} youtubeId={meta.youtubeId}
                replayError={rep.error} onRetry={rep.retry} focusFrames={focusFrames} focusRequest={focusRequest} />
            </Card>
          )}

          {sel && (
            <details className="card px-4 py-3">
              <summary className="text-[13px] text-mut cursor-pointer">Whole-rally contact map</summary>
              <div className="max-w-sm mx-auto mt-3">
                <RallyMap strokes={selStrokes} land={rep.data?.land ?? null} replay={rep.data}
                  smap={rep.data?.smap ?? { A: "near", B: "far" }} />
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
