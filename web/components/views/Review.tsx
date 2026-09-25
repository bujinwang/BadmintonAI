"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ViewProps } from "@/components/Dashboard";
import RallyInspector from "@/components/RallyInspector";
import { useIndex, useReplay } from "@/lib/data";
import { useJson } from "@/lib/json";
import { SHOT_ORDER, type MatchData, type P } from "@/lib/types";
import { buildReviewQueue, recordMatches, reviewKey, serializeReviews, REVIEW_CATEGORIES, type ReviewItem, type ReviewRecord, type ReviewValues } from "@/lib/review";
import { REVIEW_STORAGE_KEY, readReviews, saveReview, importReviews, draftStorageKey, readReviewDraft, type ReviewDraft } from "@/lib/review-storage";

const button = "rounded border border-[var(--line)] px-3 py-2 text-[13px] min-h-11 disabled:opacity-40 disabled:cursor-not-allowed";
const input = "w-full min-w-0 rounded border border-[var(--line)] bg-[var(--panel-solid)] px-3 py-2 text-ink min-h-11";
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
type Draft = { values: ReviewValues; note: string };

export default function Review(props: ViewProps) {
  if (props.src !== "ai") return <div className="card p-6 space-y-3"><h2 className="text-xl font-semibold">Review AI predictions</h2><p className="text-mut text-sm">Ground-truth labels are reference evidence. Corrections apply to AI predictions and stay in this browser until exported.</p><Link className="underline" href={`/m/${props.id}/ai/review/`}>Open AI review</Link></div>;
  return <AIReview key={props.id} {...props} />;
}

function AIReview({ d, id }: ViewProps) {
  const index = useIndex();
  const hasLabels = index.data?.matches.find((match) => match.id === id)?.sources.includes("labels") ?? false;
  const reference = useJson<MatchData>(hasLabels ? `/data/${id}/labels.json` : null);
  const [confidenceOnly, setConfidenceOnly] = useState(false);
  const built = useMemo(() => {
    try { return { queue: buildReviewQueue(d, confidenceOnly ? null : reference.data), error: null }; }
    catch (error) { return { queue: buildReviewQueue(d, null), error: String(error) }; }
  }, [d, reference.data, confidenceOnly]);
  const queue = built.queue;
  const referenceReady = confidenceOnly || (!built.error && !!index.data && (!hasLabels || !!reference.data));
  const query = useSearchParams();
  const queryFrame = query.get("frame");
  const [frame, setFrame] = useState<number | null>(null);
  const [reason, setReason] = useState("Flagged");
  const [status, setStatus] = useState("Pending");
  const [records, setRecords] = useState<ReviewRecord[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [locksAvailable, setLocksAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState<Draft | null>(null);
  const expectedRecord = useRef<ReviewRecord | undefined>(undefined);
  const draftKey = useRef<string | null>(null);
  const recoveryRef = useRef<ReviewDraft | null>(null);
  const [recovery, setRecovery] = useState<ReviewDraft | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const recoveryBlocked = useRef(false);
  const dirty = !same(draft, baseline);
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const saved = useMemo(() => new Map(records.map((row) => [reviewKey(row.matchId, row.frame), row])), [records]);
  const reviewed = (item: ReviewItem) => { const record = saved.get(item.key); return !!record && recordMatches(item, record, d.meta.players); };
  const stale = (item: ReviewItem) => saved.has(item.key) && !reviewed(item);
  const filtered = queue.filter((item) => (status === "All" || (status === "Reviewed" ? reviewed(item) : !reviewed(item))) && (reason === "All contacts" || (reason === "Flagged" ? item.reasons.length > 0 || stale(item) : reason === "Stale review" ? stale(item) : item.reasons.includes(reason))));
  const selected = queue.find((item) => item.stroke.f === frame);
  const selectedRecord = selected ? saved.get(selected.key) : undefined;
  const referenceRally = selected?.reference && reference.data?.rallies.find((rally) => rally.set === selected.reference!.set && rally.rally === selected.reference!.rally);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const replay = useReplay(id, "ai", selected?.rally.set ?? null, selected?.rally.rally ?? null);
  const rallyStrokes = useMemo(() => selected ? d.strokes.filter((stroke) => stroke.set === selected.rally.set && stroke.rally === selected.rally.rally) : [], [d.strokes, selected]);
  const focus = useMemo<[number, number] | null>(() => selected ? [selected.stroke.f, selected.stroke.f] : null, [selected]);

  function loadStorage() {
    try { setRecords(readReviews(window.localStorage)); setStorageError(null); }
    catch (error) { setStorageError(String(error)); }
    setStorageReady(true);
  }
  useEffect(() => {
    loadStorage();
    try { const cached = readReviewDraft(window.sessionStorage, id); recoveryRef.current = cached; setRecovery(cached); }
    catch (error) { recoveryBlocked.current = true; setRecoveryError(`Draft recovery could not be read; it will not be overwritten. ${String(error)}`); }
    setLocksAvailable(!!navigator.locks);
    const changed = (event: StorageEvent) => {
      if (event.key !== REVIEW_STORAGE_KEY && event.key !== null) return;
      loadStorage();
      setNotice(dirtyRef.current ? "Reviews changed in another tab. Your unsaved draft is preserved; saving checks for conflicts." : "Reviews updated from another tab. Reset the draft to load the latest saved version.");
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);

  function clearRecovery() {
    try { window.sessionStorage.removeItem(draftStorageKey(id)); recoveryRef.current = null; setRecovery(null); setRecoveryError(null); recoveryBlocked.current = false; }
    catch (error) { setRecoveryError(`Draft recovery could not be cleared. ${String(error)}`); }
  }
  function clearCurrentRecovery() {
    const item = selectedRef.current;
    if (item && recoveryRef.current && recordMatches(item, recoveryRef.current.record, d.meta.players)) clearRecovery();
  }
  function allowDiscard() {
    if (busyRef.current) return false;
    if (!dirtyRef.current) return true;
    if (!window.confirm("Discard your unsaved review draft?")) return false;
    clearCurrentRecovery(); return true;
  }
  function initialize(item: ReviewItem) {
    const record = saved.get(item.key);
    const current = record && recordMatches(item, record, d.meta.players);
    const next = { values: current ? { ...record.corrected } : { ...item.original }, note: current ? record.note : "" };
    const cached = recoveryRef.current;
    if (cached && recordMatches(item, cached.record, d.meta.players)) {
      setDraft({ values: { ...cached.record.corrected }, note: cached.record.note });
      expectedRecord.current = cached.expected ?? undefined;
      setNotice("Restored an unsaved draft from this tab. Review it and explicitly save; it has not been added to saved reviews.");
    } else { setDraft(next); expectedRecord.current = record; }
    setBaseline(next); draftKey.current = item.key;
  }
  useEffect(() => {
    if (!referenceReady || !storageReady) return;
    const requested = queryFrame !== null && /^\d+$/.test(queryFrame) ? Number(queryFrame) : null;
    const recoveredFrame = recoveryRef.current?.record.frame;
    const target = requested !== null ? queue.find((item) => item.stroke.f === requested) : queue.find((item) => item.stroke.f === recoveredFrame) ?? filtered[0];
    if (target?.stroke.f === frame || (!target && frame === null)) return;
    if (!allowDiscard()) {
      const params = new URLSearchParams(window.location.search);
      if (frame === null) params.delete("frame"); else params.set("frame", String(frame));
      window.history.replaceState(null, "", `?${params}`); return;
    }
    setFrame(target?.stroke.f ?? null);
    if (target) initialize(target); else { setDraft(null); setBaseline(null); draftKey.current = null; }
    // URL changes are the navigation signal; filtering explicitly resets selection below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryFrame, referenceReady, storageReady]);
  useEffect(() => {
    if (selected && storageReady && draftKey.current !== selected.key) initialize(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.key, storageReady]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirtyRef.current || busyRef.current) { event.preventDefault(); event.returnValue = ""; } };
    const link = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.hasAttribute("download") || anchor.target === "_blank" || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.href === window.location.href) return;
      if (!allowDiscard()) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", link, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", link, true); };
  }, []);

  function pick(item: ReviewItem) {
    if (item.key === selected?.key || !allowDiscard()) return;
    initialize(item); setFrame(item.stroke.f);
    const params = new URLSearchParams(window.location.search); params.set("frame", String(item.stroke.f));
    window.history.pushState(null, "", `?${params}`);
  }
  function filter(kind: "reason" | "status", value: string) {
    if (!allowDiscard()) return;
    if (selected) initialize(selected);
    if (kind === "reason") setReason(value); else setStatus(value);
  }
  function reset() { if (selected && allowDiscard()) { clearCurrentRecovery(); initialize(selected); setNotice(null); } }
  function changeDraft(next: Draft) {
    setDraft(next);
    if (!selected) return;
    if (same(next, baseline)) { if (!recoveryBlocked.current) clearCurrentRecovery(); return; }
    if (recoveryBlocked.current || (recoveryRef.current && !recordMatches(selected, recoveryRef.current.record, d.meta.players))) {
      setRecoveryError("An older draft is preserved below. Download or explicitly discard it before draft recovery can store these changes."); return;
    }
    const record: ReviewRecord = { matchId: id, source: "ai", players: { ...d.meta.players }, set: selected.stroke.set, rally: selected.stroke.rally, br: selected.stroke.br, frame: selected.stroke.f, final: selected.final, original: { ...selected.original }, corrected: next.values, status: same(next.values, selected.original) ? "confirmed" : "corrected", note: next.note, updatedAt: new Date().toISOString() };
    const cached = { record, expected: expectedRecord.current ?? null };
    try {
      // Validate the portable record before retaining a tab-local recovery copy.
      serializeReviews([record]);
      window.sessionStorage.setItem(draftStorageKey(id), JSON.stringify(cached));
      recoveryRef.current = cached; setRecovery(cached); setRecoveryError(null);
    } catch (error) { setRecoveryError(`Draft recovery is unavailable. Save this review before navigating away. ${String(error)}`); }
  }
  async function commit(confirm: boolean) {
    if (!selected || !draft || storageError || !locksAvailable || busyRef.current) return;
    const corrected = confirm ? { ...selected.original } : draft.values;
    if (confirm && !same(draft.values, selected.original) && !window.confirm("Confirm the original prediction and discard the field changes in this draft?")) return;
    const record: ReviewRecord = { matchId: id, source: "ai", players: { ...d.meta.players }, set: selected.stroke.set, rally: selected.stroke.rally, br: selected.stroke.br, frame: selected.stroke.f, final: selected.final, original: { ...selected.original }, corrected, status: same(corrected, selected.original) ? "confirmed" : "corrected", note: draft.note, updatedAt: new Date().toISOString() };
    busyRef.current = true; setBusy(true);
    try {
      await navigator.locks.request(REVIEW_STORAGE_KEY, () => {
      const next = saveReview(window.localStorage, expectedRecord.current, record);
      setRecords(next); expectedRecord.current = record;
      const clean = { values: { ...corrected }, note: draft.note }; setDraft(clean); setBaseline(clean);
      clearCurrentRecovery();
      setNotice("Review saved in this browser. Export reviews to keep a portable copy.");
      });
    } catch (error) { setNotice(`Review was not saved. ${String(error)}`); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function importFile(file: File | undefined) {
    if (!file || !locksAvailable || busyRef.current) return;
    if (file.size > 20 * 1024 * 1024) { setNotice("Import failed: file exceeds the 20 MB limit. Saved reviews are unchanged."); return; }
    busyRef.current = true; setBusy(true);
    try {
      const raw = await file.text();
      await navigator.locks.request(REVIEW_STORAGE_KEY, () => {
      const next = importReviews(window.localStorage, raw);
      setRecords(next); setStorageError(null);
      setNotice(`Imported and merged successfully: ${next.length} total reviews across all matches. No conflicting review was overwritten.`);
      // Retain the selected draft until the reviewer explicitly resets it.
      });
    } catch (error) { setNotice(`Import failed; saved reviews are unchanged. ${String(error)}`); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function download() {
    try {
      const blob = new Blob([serializeReviews(records)], { type: "application/json" });
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "courtside-reviews-v1.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setNotice(`Export failed. ${String(error)}`); }
  }
  const oldRecords = records.filter((record) => record.matchId === id && !queue.some((item) => item.key === reviewKey(record.matchId, record.frame)));
  const reasonOptions = ["Flagged", "All contacts", "Stale review", ...new Set(queue.flatMap((item) => item.reasons))];
  return <div className="space-y-5 min-w-0">
    <header><h2 className="text-2xl font-semibold">Review predictions</h2><p className="text-sm text-mut mt-2 max-w-3xl">Inspect uncertain contacts against the video, then confirm or correct the prediction. Reviews stay in this browser; they do not change the database, model, reference labels, or published accuracy.</p></header>
    <div className="card p-4 flex flex-wrap items-center gap-3 text-sm"><span>{records.length} saved reviews · {records.filter((row) => row.matchId !== id).length} from other matches</span><button className={button} disabled={!storageReady || !records.length} onClick={download}>Export reviews</button><label className={`${button} cursor-pointer`}>Import reviews<input aria-label="Import reviews" type="file" accept=".json,application/json" className="sr-only" disabled={!storageReady || !!storageError || !locksAvailable || busy} onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = ""; }} /></label></div>
    {storageReady && !locksAvailable && <p role="alert" className="card p-4 text-sm">Safe browser storage locking is unavailable. Saving and importing are disabled. Open this page over HTTPS or localhost in a browser that supports Web Locks.</p>}
    {storageError && <div role="alert" className="card p-4 text-sm space-y-2"><p>Browser storage could not be read. Saving and importing are disabled to protect the existing data. {storageError}</p><button className={button} onClick={loadStorage}>Retry storage</button><p>Any previously loaded reviews can still be exported.</p></div>}
    {recoveryError && <p role="alert" className="card p-4 text-sm">{recoveryError}</p>}
    {recovery && (!selected || !recordMatches(selected, recovery.record, d.meta.players)) && <div role="alert" className="card p-4 text-sm space-y-2"><p>An unsaved draft for frame {recovery.record.frame} is preserved in this tab. Its contact or original prediction differs from the current selection; it has not been applied automatically.</p><Values values={recovery.record.corrected} names={recovery.record.players} /><p className="whitespace-pre-wrap break-words">{recovery.record.note}</p><div className="flex flex-wrap gap-2"><button className={button} onClick={() => { const blob = new Blob([JSON.stringify(recovery, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "courtside-unsaved-draft.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Download draft recovery</button><button className={button} onClick={() => { if (window.confirm("Discard the preserved unsaved draft?")) clearRecovery(); }}>Discard preserved draft</button></div></div>}
    {notice && <p role="status" className="card p-4 text-sm break-words">{notice}</p>}
    {(index.error || reference.error || built.error) && <div role="alert" className="card p-4 space-y-3 text-sm"><p>{index.error ? "Could not check reference availability." : (built.error ? `Reference comparison cannot be used: ${built.error}. Reload this page after the reference export is updated.` : "Ground-truth reference could not be loaded.")} {confidenceOnly ? "Confidence-only mode is active by your choice." : "Reference comparisons are unavailable until loading succeeds or you choose confidence-only mode."}</p><div className="flex flex-wrap gap-2"><button className={button} onClick={index.error ? index.retry : reference.retry}>Retry reference</button>{!confidenceOnly && <button className={button} onClick={() => { if (allowDiscard()) { if (selected) initialize(selected); setConfidenceOnly(true); } }}>Use confidence-only mode</button>}</div></div>}
    {!referenceReady ? <p role="status">Loading reference availability…</p> : <>
      <p className="text-sm text-mut">{confidenceOnly ? "Confidence-only mode: reference disagreements are not included." : hasLabels ? "Reference labels are comparison evidence, never automatically accepted." : "This match has no reference labels; the queue uses confidence only."} Low confidence means below 65%; missing confidence is flagged separately.</p>
      <div className="grid sm:grid-cols-2 gap-3 card p-4"><label className="text-sm space-y-2"><span>Reason</span><select aria-label="Review reason" className={input} value={reason} onChange={(event) => filter("reason", event.target.value)}>{reasonOptions.map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-sm space-y-2"><span>Status</span><select aria-label="Review status" className={input} value={status} onChange={(event) => filter("status", event.target.value)}>{["Pending", "Reviewed", "All"].map((value) => <option key={value}>{value}</option>)}</select></label></div>
      <p role="status" className="text-sm text-mut">{filtered.length} matching contacts · {queue.filter(reviewed).length} currently reviewed · {queue.filter(stale).length} stale reviews needing review again</p>
      <div className="grid xl:grid-cols-[280px_minmax(0,1fr)] gap-4 items-start">
        <div className="card min-w-0 max-h-[360px] xl:max-h-[650px] overflow-y-auto p-2" aria-label="Review queue">
          {!filtered.length && <p className="p-4 text-sm text-mut">No contacts match these filters. Choose All contacts and All statuses to inspect every prediction.</p>}
          {filtered.map((item) => <button key={item.key} aria-label={`Review contact ${item.stroke.f}`} className="w-full text-left rounded p-3 border border-transparent aria-pressed:border-[var(--ai)] aria-pressed:bg-[var(--ai-soft)]" aria-pressed={selected?.key === item.key} onClick={() => pick(item)}><span className="block text-sm">Set {item.stroke.set} · Rally {item.stroke.rally} · Shot {item.stroke.br}</span><span className="block text-xs text-mut mt-1">{item.stroke.shot} · {item.stroke.conf == null ? "No confidence" : `${(item.stroke.conf * 100).toFixed(0)}% confidence`} · frame {item.stroke.f}</span><span className="block text-xs mt-1">{stale(item) ? "Stale review · review again" : reviewed(item) ? "Reviewed" : item.reasons.join(" · ") || "Unflagged"}</span></button>)}
        </div>
        <div className="space-y-4 min-w-0">
          {queryFrame !== null && !/^\d+$/.test(queryFrame) && <p role="alert">Invalid contact frame. Select a contact from the queue.</p>}
          {!selected ? <p className="card p-5 text-sm">{queryFrame !== null ? "No current AI contact matches this frame. Older saved reviews remain available below." : "Choose a contact to inspect."}</p> : <>
            <div className="card p-4 min-w-0"><h3 data-review-frame={selected.stroke.f} className="text-lg font-semibold mb-3">Set {selected.stroke.set} · Rally {selected.stroke.rally} · Contact {selected.stroke.br} <span className="text-sm text-mut">frame {selected.stroke.f}</span></h3><RallyInspector key={`${id}-${selected.rally.set}-${selected.rally.rally}`} rally={selected.rally} strokes={rallyStrokes} replay={replay.data} fps={d.meta.fps} names={d.meta.players} source="ai" youtubeId={d.meta.youtubeId} replayError={replay.error} onRetry={replay.retry} focusFrames={focus} /></div>
            {!filtered.some((item) => item.key === selected.key) && <p className="text-sm text-mut">The selected contact is outside the current filters. Its draft stays open until you choose another contact.</p>}
            {stale(selected) && <p role="alert" className="card p-4 text-sm">The prediction or player identity changed since this review was saved. This contact is pending again. Compare the saved record below and explicitly save a new review.</p>}
            {selectedRecord && !same(selectedRecord, expectedRecord.current) && <p role="alert" className="text-sm">The saved review changed while this draft was open. Reset the draft before saving to resolve the conflict.</p>}
            <div className="card p-4 space-y-4">
              <div className="grid sm:grid-cols-2 gap-4 text-sm"><div><h4 className="font-semibold mb-1">Original prediction</h4><Values values={selected.original} names={d.meta.players} /></div><div><h4 className="font-semibold mb-1">Reference contact</h4>{selected.reference ? <p>{selected.reference.shot} · {d.meta.players[selected.reference.p]}<br /><span className="text-mut">Frame {selected.reference.f}. {selected.final && referenceRally && selected.reference.br === referenceRally.endRound ? `Reference winner: ${referenceRally.winner ? reference.data!.meta.players[referenceRally.winner] : "Unknown"} · Ending: ${referenceRally.category}. ` : ""}Outcome corrections require video review.</span></p> : <p className="text-mut">{confidenceOnly || !hasLabels ? "No reference comparison in this mode." : "No unambiguous reference contact nearby."}</p>}</div></div>
              {draft && <><h4 className="font-semibold">Review draft {dirty && <span className="text-sm text-mut">· unsaved</span>}</h4><div className="grid sm:grid-cols-2 gap-3"><label className="text-sm">Shot<select disabled={busy} aria-label="Reviewed shot" className={input} value={draft.values.shot} onChange={(event) => changeDraft({ ...draft, values: { ...draft.values, shot: event.target.value } })}>{!SHOT_ORDER.includes(draft.values.shot) && <option value={draft.values.shot}>{draft.values.shot || "Choose a shot"}</option>}{SHOT_ORDER.map((shot) => <option key={shot}>{shot}</option>)}</select></label><label className="text-sm">Hitter<select disabled={busy} aria-label="Reviewed hitter" className={input} value={draft.values.p} onChange={(event) => changeDraft({ ...draft, values: { ...draft.values, p: event.target.value as P } })}>{(["A", "B"] as const).map((p) => <option value={p} key={p}>{d.meta.players[p]}</option>)}</select></label>{selected.final && <><label className="text-sm">Winner<select disabled={busy} aria-label="Reviewed winner" className={input} value={draft.values.winner ?? ""} onChange={(event) => changeDraft({ ...draft, values: { ...draft.values, winner: (event.target.value || null) as P | null } })}><option value="">Unknown</option>{(["A", "B"] as const).map((p) => <option key={p} value={p}>{d.meta.players[p]}</option>)}</select></label><label className="text-sm">Ending<select disabled={busy} aria-label="Reviewed ending" className={input} value={draft.values.category ?? "—"} onChange={(event) => changeDraft({ ...draft, values: { ...draft.values, category: event.target.value } })}>{REVIEW_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label></>}</div><label className="block text-sm">Review note<textarea disabled={busy} aria-label="Review note" className={`${input} mt-1`} rows={3} maxLength={2000} value={draft.note} onChange={(event) => changeDraft({ ...draft, note: event.target.value })} /><span className="text-xs text-mut">{draft.note.length}/2000 characters</span></label><div className="flex flex-wrap gap-2"><button className={button} disabled={!storageReady || !!storageError || !locksAvailable || busy} onClick={() => commit(true)}>Confirm prediction</button><button className={`${button} border-[var(--ai)]`} disabled={!storageReady || !!storageError || !locksAvailable || busy} onClick={() => commit(false)}>Save correction</button><button className={button} onClick={reset}>Reset draft</button><button className={button} disabled={!queue.some((item) => item.key !== selected.key && !reviewed(item) && (item.reasons.length || stale(item)))} onClick={() => { const next = queue.find((item) => item.key !== selected.key && !reviewed(item) && (item.reasons.length || stale(item))); if (next) pick(next); }}>Next pending</button></div></>}
            </div>
            {selectedRecord && <details className="card p-4 text-sm"><summary>Saved review {stale(selected) ? "(stale)" : ""} · {selectedRecord.updatedAt}</summary><div className="mt-3"><Values values={selectedRecord.corrected} names={selectedRecord.players} /><p className="whitespace-pre-wrap break-words mt-2">{selectedRecord.note || "No note"}</p></div></details>}
          </>}
        </div>
      </div>
      <details className="card p-4 text-sm"><summary>Saved contacts no longer in this prediction bundle ({oldRecords.length})</summary><p className="text-mut mt-2">These records remain in storage and exports. They cannot be applied to a different contact automatically.</p>{oldRecords.map((record) => <div key={reviewKey(record.matchId, record.frame)} className="border-t border-[var(--line)] mt-3 pt-3"><p>Set {record.set} · Rally {record.rally} · Frame {record.frame} · {record.status}</p><Values values={record.corrected} names={record.players} /><p className="whitespace-pre-wrap break-words">{record.note}</p></div>)}</details>
    </>}
  </div>;
}

function Values({ values, names }: { values: ReviewValues; names: Record<P, string> }) {
  return <p>{values.shot} · {names[values.p]}{values.category !== null && <><br /><span className="text-mut">Winner: {values.winner ? names[values.winner] : "Unknown"} · Ending: {values.category}</span></>}</p>;
}
