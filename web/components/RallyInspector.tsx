"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Replay2D } from "@/components/court";
import RallyVideo from "@/components/RallyVideo";
import { useOverlayPref } from "@/lib/overlay";
import { adjacentContact, clampFrame, clipWindow, exchangeLoop, frameToTime, timeToFrame } from "@/lib/playback";
import { PCOLOR } from "@/lib/fmt";
import type { P, Rally, Replay, Source, Stroke } from "@/lib/types";

const button = "rounded border border-[var(--line)] px-2.5 py-2 text-[12px] disabled:opacity-40 disabled:cursor-default";

export default function RallyInspector({
  rally, strokes, replay, fps, names, source, youtubeId, replayError, onRetry, focusFrames, focusRequest = 0,
}: {
  rally: Rally; strokes: Stroke[]; replay: Replay | null; fps: number;
  names: Record<P, string>; source: Source; youtubeId: string | null;
  replayError?: string | null; onRetry: () => void; focusFrames?: [number, number] | null; focusRequest?: number;
}) {
  const [overlayOn, setOverlayOn] = useOverlayPref();
  const bounds = useMemo(() => clipWindow(rally.clip), [rally.clip]);
  const contacts = useMemo(() => [...strokes].filter((stroke) => Number.isFinite(stroke.f)).sort((a, b) => a.f - b.f), [strokes]);
  const frames = useMemo(() => contacts.map((stroke) => stroke.f), [contacts]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingSeek = useRef<number | null>(focusFrames?.[0] ?? rally.f0);
  const [frame, setFrame] = useState(bounds?.start ?? rally.f0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [duration, setDuration] = useState<number>();
  const [videoError, setVideoError] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [first, setFirst] = useState(0);
  const [last, setLast] = useState(Math.max(0, contacts.length - 1));
  const [loopEnabled, setLoopEnabled] = useState(false);
  const synchronized = overlayOn && !!bounds && Number.isFinite(fps) && fps > 0 && !videoError;
  useEffect(() => {
    if (!synchronized) {
      setPlaying(false);
      setLoopEnabled(false);
      setDuration(undefined);
    }
  }, [synchronized]);
  const endFrame = bounds && fps > 0 ? clampFrame(bounds.end, bounds, fps, duration) : rally.f1;
  const loop = useMemo(() => bounds ? exchangeLoop(frames, first, last, {
    start: Math.max(bounds.start, rally.f0), end: Math.min(endFrame, rally.f1),
  }) : null, [bounds, frames, first, last, endFrame, rally.f0, rally.f1]);
  const loopRef = useRef(loopEnabled ? loop : null);
  useEffect(() => { loopRef.current = loopEnabled ? loop : null; }, [loopEnabled, loop]);

  const sample = useCallback(() => {
    const video = videoRef.current;
    if (!video || !bounds || fps <= 0) return;
    const active = loopRef.current;
    if (active && !video.paused && video.currentTime >= (active.end + 1 - bounds.start) / fps) {
      video.currentTime = frameToTime(active.start, bounds, fps, video.duration);
    }
    setFrame(timeToFrame(video.currentTime, bounds, fps));
  }, [bounds, fps]);

  const seek = useCallback((target: number, keepLoop = false) => {
    if (!synchronized || !bounds) return;
    if (!keepLoop) { setLoopEnabled(false); loopRef.current = null; }
    const video = videoRef.current;
    video?.pause();
    pendingSeek.current = target;
    if (video && video.readyState >= 1) {
      video.currentTime = frameToTime(target, bounds, fps, video.duration);
      pendingSeek.current = null;
      sample();
    }
  }, [synchronized, bounds, fps, sample]);

  const play = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setPlayError(null);
    void video.play().catch((error) => {
      if (error.name !== "AbortError") setPlayError("Playback could not start. Try the video's play control.");
    });
  }, []);

  // Read the media clock; never accumulate an independent animation clock.
  useEffect(() => {
    const video = videoRef.current;
    if (!synchronized || !video) return;
    let active = true;
    let handle = 0;
    const native = typeof video.requestVideoFrameCallback === "function";
    const tick = () => {
      if (!active) return;
      sample();
      handle = native ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    };
    handle = native ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
    return () => {
      active = false;
      if (native) video.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
    };
  }, [synchronized, sample]);

  const focusStart = focusFrames?.[0], focusEnd = focusFrames?.[1];
  useEffect(() => {
    if (focusStart == null) {
      pendingSeek.current = null;
      setLoopEnabled(false);
      loopRef.current = null;
      setFirst(0);
      setLast(Math.max(0, frames.length - 1));
      return;
    }
    pendingSeek.current = focusStart;
    seek(focusStart);
    const startIndex = frames.findIndex((value) => value >= focusStart);
    if (startIndex >= 0) {
      setFirst(startIndex);
      const endIndex = frames.findLastIndex((value) => value <= (focusEnd ?? focusStart));
      setLast(Math.max(startIndex, endIndex));
    }
  }, [focusStart, focusEnd, focusRequest, frames, seek]);

  const availableFrames = bounds ? frames.filter((value) => value >= bounds.start && value <= endFrame) : frames;
  const previous = adjacentContact(availableFrames, frame, -1);
  const next = adjacentContact(availableFrames, frame, 1);
  const current = contacts.findLast((stroke) => stroke.f <= frame);

  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-[minmax(0,1.65fr)_minmax(0,0.65fr)] gap-4 items-start">
        <div className="min-w-0">
          {synchronized ? (
            <div className="aspect-video overflow-hidden rounded-md border border-[var(--line)] bg-black">
              <video ref={videoRef} src={rally.clip!} controls muted playsInline preload="metadata"
                aria-label={`Annotated video, set ${rally.set}, rally ${rally.rally}`}
                className="w-full h-full"
                onLoadedMetadata={() => {
                  const video = videoRef.current!;
                  setDuration(video.duration);
                  video.playbackRate = speed;
                  const resume = !video.paused;
                  seek(pendingSeek.current ?? rally.f0, true);
                  if (resume) play();
                }}
                onTimeUpdate={sample} onSeeked={sample}
                onSeeking={() => {
                  const active = loopRef.current;
                  const target = timeToFrame(videoRef.current!.currentTime, bounds!, fps);
                  if (active && (target < active.start || target > active.end)) {
                    loopRef.current = null; setLoopEnabled(false);
                  }
                  sample();
                }}
                onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
                onRateChange={() => setSpeed(videoRef.current?.playbackRate ?? 1)}
                onError={() => { setVideoError(true); setPlaying(false); }}
                onEnded={() => {
                  const active = loopRef.current;
                  if (active) { seek(active.start, true); play(); }
                  else setPlaying(false);
                }}
              />
            </div>
          ) : <RallyVideo rally={videoError ? { ...rally, clip: null } : rally} youtubeId={youtubeId} />}
          <p className="mt-2 mono text-[10px] tracking-wide text-mut">
            {synchronized ? "VIDEO + COURT SYNCHRONIZED · AI-ANNOTATED CLIP" : "Synchronization requires an annotated clip. The court replay has separate controls."}
          </p>
          {!synchronized && !!bounds && <button className={`${button} mt-2`} onClick={() => {
            setVideoError(false); setOverlayOn(true); pendingSeek.current = focusStart ?? rally.f0;
          }}>{videoError ? "Retry annotated clip" : "Turn on AI overlay to synchronize"}</button>}
          {videoError && <p role="alert" className="text-err text-[12px] mt-2">The annotated clip could not load. Raw footage is shown when available.</p>}
          {playError && <p role="alert" className="text-err text-[12px] mt-2">{playError}</p>}

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button className={button} disabled={!synchronized} onClick={() => playing ? videoRef.current?.pause() : play()}>{playing ? "Pause" : "Play"}</button>
            <button className={button} aria-label="Previous contact" disabled={!synchronized || previous == null} onClick={() => previous != null && seek(previous)}>← Previous contact</button>
            <button className={button} aria-label="Next contact" disabled={!synchronized || next == null} onClick={() => next != null && seek(next)}>Next contact →</button>
            {[0.25, 0.5, 1, 2].map((value) => <button key={value} className={button}
              disabled={!synchronized} aria-label={`Playback speed ${value} times`} aria-pressed={speed === value}
              style={{ color: speed === value ? "var(--ai)" : "var(--mut)" }}
              onClick={() => { if (videoRef.current) videoRef.current.playbackRate = value; }}>{value}×</button>)}
          </div>
          {synchronized && bounds && <label className="flex gap-3 items-center mt-3">
            <span className="kicker shrink-0">POSITION</span>
            <input type="range" min={bounds.start} max={endFrame} value={Math.min(endFrame, Math.max(bounds.start, frame))} step={1}
              aria-label="Synchronized video and court position" aria-valuetext={`${((frame - bounds.start) / fps).toFixed(2)} seconds into clip`}
              className="min-w-0 flex-1 accent-[var(--ai)]" onChange={(event) => seek(Number(event.target.value))} />
            <span className="mono text-[11px] text-dim shrink-0">{((frame - bounds.start) / fps).toFixed(2)}s</span>
          </label>}
        </div>
        <div className="min-w-0 max-w-[300px] w-full mx-auto">
          <div className="kicker mb-2">{synchronized ? "COURT · VIDEO CLOCK" : "COURT · SEPARATE REPLAY"}</div>
          {replayError ? <div role="alert" className="text-[12px] py-8">
            <p>Tracking could not load.</p><button className={`${button} mt-2`} onClick={onRetry}>Retry tracking</button>
          </div> : replay ? <Replay2D rep={replay} ai={source === "ai"} frame={synchronized ? frame : undefined}
            hideControls={synchronized} onFrame={synchronized ? undefined : setFrame} /> : <p role="status" className="text-dim text-[12px] py-8">Loading tracks…</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13px]">
        <span>{current ? <><span style={{ color: PCOLOR[current.p] }}>{names[current.p]}</span> · #{current.br} {current.shot}</> : "Before first contact"}</span>
        <span className="mono text-[11px] text-dim">Score before point: {names.A} {rally.pa}–{rally.pb} {names.B}</span>
        {current?.conf != null && source === "ai" && <span className="mono text-[11px] text-dim">{Math.round(current.conf * 100)}% shot confidence</span>}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2" aria-label="Shot sequence">
        {contacts.map((stroke, index) => <button key={`${stroke.br}-${stroke.f}`} className={`${button} shrink-0 min-w-[90px] text-left`}
          disabled={!synchronized || !bounds || stroke.f < bounds.start || stroke.f > endFrame}
          aria-label={`Seek contact ${stroke.br}, ${names[stroke.p]}, ${stroke.shot}${stroke.press != null ? `, required reach speed ${stroke.press.toFixed(1)} meters per second` : ""}${source === "ai" && stroke.conf != null ? `, ${Math.round(stroke.conf * 100)} percent shot confidence` : ""}`} aria-current={current === stroke ? "true" : undefined}
          style={{ borderColor: current === stroke ? PCOLOR[stroke.p] : "var(--line)", background: current === stroke ? "var(--panel-solid)" : "transparent" }}
          onClick={() => { seek(stroke.f); setFirst(index); setLast(index); }}>
          <span className="block mono text-[10px]" style={{ color: PCOLOR[stroke.p] }}>#{stroke.br} · {names[stroke.p].split(" ").at(-1)}</span>
          <span className="h-7 flex items-end mt-1" aria-hidden="true">
            <span className="w-2 rounded-t-sm" style={{
              height: `${Math.max(0, Math.min(100, ((stroke.press ?? 0) / 4.5) * 100))}%`,
              minHeight: stroke.press ? 2 : 0,
              background: (stroke.press ?? 0) >= 2.5 ? "var(--warn)" : "var(--dim)",
            }} />
          </span>
          <span className="block text-[12px] mt-1">{stroke.shot}</span>
          <span className="block mono text-[9px] text-dim mt-1">{stroke.press == null ? "Reach speed —" : `${stroke.press.toFixed(1)} m/s`}</span>
          {source === "ai" && stroke.conf != null && <span className="block mono text-[9px] text-[var(--ai)]">{Math.round(stroke.conf * 100)}% confidence</span>}
        </button>)}
        {!contacts.length && <p className="text-mut text-[12px]">No stroke sequence is available for this rally.</p>}
      </div>
      {!!contacts.length && <p className="text-[10px] text-dim mono">
        Bar = speed required to reach the shot · amber ≥ 2.5 m/s{source === "ai" ? " · confidence = AI shot classification" : ""}
      </p>}
      <div className="flex flex-wrap items-end gap-3 pt-3 border-t border-[var(--line-soft)]">
        <label className="flex flex-col gap-1 min-w-32 flex-1">
          <span className="kicker">LOOP FROM</span>
          <select value={first} disabled={!synchronized || !contacts.length} className="min-w-0 rounded border border-[var(--line)] bg-[var(--panel-solid)] p-2 text-[12px]"
            onChange={(event) => { const value = Number(event.target.value); setFirst(value); setLast(Math.max(value, last)); }}>
            {contacts.map((stroke, index) => <option key={index} value={index}>#{stroke.br} {stroke.shot}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 min-w-32 flex-1">
          <span className="kicker">THROUGH</span>
          <select value={last} disabled={!synchronized || !contacts.length} className="min-w-0 rounded border border-[var(--line)] bg-[var(--panel-solid)] p-2 text-[12px]"
            onChange={(event) => setLast(Number(event.target.value))}>
            {contacts.map((stroke, index) => index >= first && <option key={index} value={index}>#{stroke.br} {stroke.shot}</option>)}
          </select>
        </label>
        <button className={button} disabled={!synchronized || !loop} aria-pressed={loopEnabled} onClick={() => {
          if (!loop) return;
          setLoopEnabled(true); loopRef.current = loop; seek(loop.start, true); play();
        }}>Loop exchange</button>
        <button className={button} disabled={!loopEnabled} onClick={() => { setLoopEnabled(false); loopRef.current = null; }}>Clear loop</button>
        {loopEnabled && <span role="status" className="text-[11px] text-mut w-full">Looping contacts #{contacts[first]?.br} through #{contacts[last]?.br}. Contact and position controls clear the loop.</span>}
      </div>
    </div>
  );
}
