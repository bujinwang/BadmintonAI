import { SHOT_ORDER, type P, type Stroke } from "./types";

export interface SequenceMatch {
  set: number;
  rally: number;
  startBr: number;
  endBr: number;
  startFrame: number;
  endFrame: number;
}

export const MAX_SEQUENCE_LENGTH = 6;

/** Comma-separated display names. Check isValidSequence before treating [] as disabled. */
export function parseSequence(raw: string | null): string[] {
  if (raw === null || raw === "") return [];
  const shots = raw.split(",").map((shot) => shot.trim());
  return shots.length <= MAX_SEQUENCE_LENGTH && shots.every((shot) => SHOT_ORDER.includes(shot))
    ? shots : [];
}

export function isValidSequence(raw: string | null): boolean {
  return raw === null || raw === "" || parseSequence(raw).length > 0;
}

/** Find every contiguous occurrence, including interior and overlapping sequences. */
export function findShotSequences(
  strokes: Stroke[], sequence: string[], firstPlayer?: P,
): SequenceMatch[] {
  if (!sequence.length || sequence.length > MAX_SEQUENCE_LENGTH ||
      sequence.some((shot) => !SHOT_ORDER.includes(shot))) return [];
  const ordered = [...strokes].sort((a, b) =>
    a.set - b.set || a.rally - b.rally || a.br - b.br || a.f - b.f);
  const matches: SequenceMatch[] = [];
  for (let i = 0; i <= ordered.length - sequence.length; i++) {
    const first = ordered[i];
    if (firstPlayer && first.p !== firstPlayer) continue;
    if (!sequence.every((shot, offset) => {
      const current = ordered[i + offset];
      return current.set === first.set && current.rally === first.rally &&
        current.br === first.br + offset && current.shot === shot;
    })) continue;
    const last = ordered[i + sequence.length - 1];
    matches.push({ set: first.set, rally: first.rally, startBr: first.br,
      endBr: last.br, startFrame: first.f, endFrame: last.f });
  }
  return matches;
}
