export interface FrameWindow { start: number; end: number }

/** Clip names encode the padded video window, independent of the rally/source. */
export function clipWindow(path: string | null): FrameWindow | null {
  const match = path?.match(/(?:^|\/)f(\d+)-(\d+)\.mp4(?:[?#].*)?$/);
  if (!match) return null;
  const start = Number(match[1]), end = Number(match[2]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start ? { start, end } : null;
}

export function clampFrame(frame: number, bounds: FrameWindow, fps: number, duration?: number): number {
  if (!Number.isFinite(fps) || fps <= 0) throw new RangeError("Video frame rate must be positive");
  const last = duration != null && Number.isFinite(duration) && duration > 0
    ? Math.min(bounds.end, bounds.start + Math.max(0, Math.ceil(duration * fps) - 1)) : bounds.end;
  return Math.max(bounds.start, Math.min(last, Number.isFinite(frame) ? frame : bounds.start));
}

export function frameToTime(frame: number, bounds: FrameWindow, fps: number, duration?: number): number {
  return (clampFrame(frame, bounds, fps, duration) - bounds.start) / fps;
}

// Native media clocks quantize seek times to microseconds. Preserve the requested frame.
export function timeToFrame(time: number, bounds: FrameWindow, fps: number): number {
  return clampFrame(bounds.start + Math.floor((Math.max(0, time) + 1e-6) * fps), bounds, fps);
}

export function adjacentContact(frames: number[], frame: number, direction: -1 | 1): number | null {
  const candidates = frames.filter((value) => Number.isFinite(value) && (direction < 0 ? value < frame : value > frame));
  return candidates.length ? direction < 0 ? Math.max(...candidates) : Math.min(...candidates) : null;
}

/** Include the final selected shot until the next contact, or the rally end. */
export function exchangeLoop(frames: number[], first: number, last: number, bounds: FrameWindow): FrameWindow | null {
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first || last >= frames.length) return null;
  const start = Math.max(bounds.start, frames[first]);
  const end = Math.min(bounds.end, frames[last + 1] == null ? bounds.end : frames[last + 1] - 1);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? { start, end } : null;
}
