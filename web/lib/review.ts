import { SHOT_ORDER, type MatchData, type P, type Rally, type Stroke } from "./types";

export const REVIEW_CATEGORIES = ["Winner", "Net", "Out", "Misjudged", "Error", "—"];
export interface ReviewValues { shot: string; p: P; winner: P | null; category: string | null }
export interface ReviewRecord {
  matchId: string; source: "ai"; players: Record<P, string>;
  set: number; rally: number; br: number; frame: number; final: boolean;
  original: ReviewValues; corrected: ReviewValues; status: "confirmed" | "corrected";
  note: string; updatedAt: string;
}
export interface ReviewFile { version: 1; records: ReviewRecord[] }
export interface ReviewItem {
  key: string; stroke: Stroke; rally: Rally; reference: Stroke | null;
  reasons: string[]; original: ReviewValues; final: boolean;
}

const sameValues = (a: ReviewValues, b: ReviewValues) =>
  a.shot === b.shot && a.p === b.p && a.winner === b.winner && a.category === b.category;
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const integer = (value: unknown, minimum = 0): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
const player = (value: unknown): value is P => value === "A" || value === "B";

export function reviewKey(matchId: string, frame: number): string {
  if (!validId(matchId) || !integer(frame)) throw new Error("Invalid review contact identity");
  return `${matchId}:${frame}`;
}

/** Labels use a player-position clock; their calibrated offset aligns actual contacts. */
export function buildReviewQueue(ai: MatchData, labels: MatchData | null): ReviewItem[] {
  if (ai.meta.source !== "ai" || !validId(ai.meta.id)) throw new Error("Reviews require an AI match");
  const names = validatePlayers(ai.meta.players);
  let references: Stroke[] = [];
  const labelRallies = new Map<string, Rally>();
  const mappedPlayers: Record<P, P> = { A: "A", B: "B" };
  if (labels) {
    if (labels.meta.id !== ai.meta.id || labels.meta.source !== "labels") {
      throw new Error("Reference match or source does not match the AI bundle");
    }
    const referenceNames = validatePlayers(labels.meta.players);
    for (const p of ["A", "B"] as const) {
      const mapped = (["A", "B"] as const).find((side) => names[side] === referenceNames[p]);
      if (!mapped) throw new Error("Reference player identities do not match the AI bundle");
      mappedPlayers[p] = mapped;
    }
    const offset = labels.meta.contactFrameOffset;
    if (!Number.isSafeInteger(offset) || !Number.isFinite(labels.meta.fps) || labels.meta.fps <= 0) {
      throw new Error("Reference contact timing is unavailable");
    }
    references = labels.strokes.map((s) => ({ ...s, p: mappedPlayers[s.p],
      f: s.f + offset!, t: (s.f + offset!) / labels.meta.fps }));
    for (const r of labels.rallies) labelRallies.set(`${r.set}:${r.rally}`, r);
  }
  const chronology = (a: Stroke, b: Stroke) => a.f - b.f || a.set - b.set || a.rally - b.rally || a.br - b.br;
  const ordered = [...ai.strokes].sort(chronology);
  references.sort(chronology);
  const frames = new Set<number>();
  for (const s of [...ordered, ...references]) {
    if (!integer(s.f) || !integer(s.set, 1) || !integer(s.rally, 1) || !integer(s.br, 1) || !player(s.p)) {
      throw new Error("Invalid contact in match data");
    }
  }
  for (const s of ordered) {
    if (frames.has(s.f)) throw new Error("Duplicate AI contact frame");
    frames.add(s.f);
  }
  const distancesByAi: number[][] = ordered.map(() => []);
  let lower = 0;
  const candidates = references.map((reference) => {
    while (lower < ordered.length && ordered[lower].f < reference.f - 6) lower++;
    const choices: { i: number; distance: number }[] = [];
    for (let i = lower; i < ordered.length && ordered[i].f <= reference.f + 6; i++) {
      const distance = Math.abs(ordered[i].f - reference.f);
      choices.push({ i, distance });
      distancesByAi[i].push(distance);
    }
    return choices;
  });
  const ambiguous = new Set<number>();
  // Reject equally near alternatives in either direction, rather than guessing by array order.
  for (const choices of candidates) {
    const distance = Math.min(...choices.map((c) => c.distance));
    const nearest = choices.filter((c) => c.distance === distance);
    if (nearest.length > 1) nearest.forEach((c) => ambiguous.add(c.i));
  }
  distancesByAi.forEach((distances, i) => {
    const nearest = Math.min(...distances);
    if (distances.filter((distance) => distance === nearest).length > 1) ambiguous.add(i);
  });
  const aligned = new Map<number, Stroke>();
  candidates.forEach((choices, j) => {
    const available = choices.filter((c) => !aligned.has(c.i) && !ambiguous.has(c.i));
    const closest = Math.min(...available.map((c) => c.distance));
    const nearest = available.filter((c) => c.distance === closest);
    if (nearest.length === 1) aligned.set(nearest[0].i, references[j]);
    else if (nearest.length > 1) nearest.forEach((c) => ambiguous.add(c.i));
  });
  const rallies = new Map(ai.rallies.map((r) => [`${r.set}:${r.rally}`, r]));
  return ordered.map((stroke, i) => {
    const rally = rallies.get(`${stroke.set}:${stroke.rally}`);
    if (!rally) throw new Error("AI contact has no matching rally");
    const final = stroke.br === rally.endRound;
    const original: ReviewValues = { shot: stroke.shot, p: stroke.p,
      winner: final ? rally.winner : null, category: final ? rally.category : null };
    const reference = ambiguous.has(i) ? null : aligned.get(i) ?? null;
    const reasons: string[] = [];
    let mismatch = false;
    if (reference) {
      if (reference.shot !== stroke.shot) { reasons.push("Shot differs from labels"); mismatch = true; }
      if (reference.p !== stroke.p) { reasons.push("Player differs from labels"); mismatch = true; }
      const labelRally = labelRallies.get(`${reference.set}:${reference.rally}`);
      if (labelRally && final && reference.br === labelRally.endRound) {
        const winner = labelRally.winner ? mappedPlayers[labelRally.winner] : null;
        if (winner !== original.winner || labelRally.category !== original.category) {
          reasons.push("Outcome differs from labels"); mismatch = true;
        }
      }
    } else if (labels) reasons.push(ambiguous.has(i) ? "Ambiguous label alignment" : "No labeled contact nearby");
    if (stroke.conf == null || !Number.isFinite(stroke.conf) || stroke.conf < 0 || stroke.conf > 1) {
      reasons.push("Confidence unavailable");
    } else if (stroke.conf < 0.65) reasons.push("Low confidence");
    return { item: { key: reviewKey(ai.meta.id, stroke.f), stroke, rally, reference, reasons, original, final }, mismatch };
  }).sort((a, b) => Number(b.mismatch) - Number(a.mismatch)
    || (a.item.stroke.conf ?? -1) - (b.item.stroke.conf ?? -1)
    || chronology(a.item.stroke, b.item.stroke)).map(({ item }) => item);
}

export function recordMatches(item: ReviewItem, record: ReviewRecord, players: Record<P, string>): boolean {
  return record.source === "ai" && validId(record.matchId) && integer(record.frame) &&
    item.key === reviewKey(record.matchId, record.frame) && record.set === item.stroke.set &&
    record.rally === item.stroke.rally && record.br === item.stroke.br && record.frame === item.stroke.f &&
    record.final === item.final && record.players.A === players.A && record.players.B === players.B &&
    sameValues(record.original, item.original);
}

function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`Invalid ${label} fields`);
  }
  return value as Record<string, unknown>;
}

function validatePlayers(value: unknown): Record<P, string> {
  const names = object(value, ["A", "B"], "player identity");
  if ([names.A, names.B].some((name) => typeof name !== "string" || !name.trim() || name.length > 200) || names.A === names.B) {
    throw new Error("Invalid player identities");
  }
  return { A: names.A as string, B: names.B as string };
}

function values(value: unknown, final: boolean, corrected: boolean): ReviewValues {
  const v = object(value, ["shot", "p", "winner", "category"], "review values");
  if (typeof v.shot !== "string" || !v.shot.trim() || v.shot.length > 200 ||
      (corrected && !SHOT_ORDER.includes(v.shot)) || !player(v.p) ||
      (v.winner !== null && !player(v.winner)) ||
      (v.category !== null && (typeof v.category !== "string" || !REVIEW_CATEGORIES.includes(v.category))) ||
      (!final && (v.winner !== null || v.category !== null))) throw new Error("Invalid review values");
  return { shot: v.shot, p: v.p, winner: v.winner as P | null, category: v.category as string | null };
}

export function parseReviewFile(raw: string): ReviewFile {
  const file = object(JSON.parse(raw), ["version", "records"], "review file");
  if (file.version !== 1 || !Array.isArray(file.records) || file.records.length > 50_000) {
    throw new Error("Unsupported review version or record count");
  }
  const seen = new Set<string>();
  const records = file.records.map((value) => {
    const r = object(value, ["matchId", "source", "players", "set", "rally", "br", "frame", "final",
      "original", "corrected", "status", "note", "updatedAt"], "review record");
    if (!validId(r.matchId) || r.source !== "ai" || !integer(r.set, 1) || !integer(r.rally, 1) ||
        !integer(r.br, 1) || !integer(r.frame) || typeof r.final !== "boolean" ||
        typeof r.note !== "string" || r.note.length > 2000 ||
        typeof r.updatedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(r.updatedAt) ||
        !Number.isFinite(Date.parse(r.updatedAt)) ||
        new Date(r.updatedAt).toISOString().replace(".000Z", "Z") !== r.updatedAt.replace(".000Z", "Z")) {
      throw new Error("Invalid review identity, note or timestamp");
    }
    const original = values(r.original, r.final, false), corrected = values(r.corrected, r.final, true);
    if (!(r.status === "confirmed" && sameValues(original, corrected)) &&
        !(r.status === "corrected" && !sameValues(original, corrected))) throw new Error("Review status disagrees with its values");
    const key = reviewKey(r.matchId, r.frame);
    if (seen.has(key)) throw new Error("Duplicate review contact");
    seen.add(key);
    return { matchId: r.matchId, source: "ai" as const, players: validatePlayers(r.players),
      set: r.set, rally: r.rally, br: r.br, frame: r.frame, final: r.final, original, corrected,
      status: r.status as ReviewRecord["status"], note: r.note, updatedAt: r.updatedAt };
  });
  return { version: 1, records };
}

export function serializeReviews(records: ReviewRecord[]): string {
  return JSON.stringify(parseReviewFile(JSON.stringify({ version: 1, records })), null, 2) + "\n";
}

export function mergeReviews(existing: ReviewRecord[], incoming: ReviewRecord[]): ReviewRecord[] {
  const checked = [existing, incoming].map((records) => parseReviewFile(JSON.stringify({ version: 1, records })).records);
  const merged = new Map<string, ReviewRecord>();
  for (const record of checked.flat()) {
    const key = reviewKey(record.matchId, record.frame), previous = merged.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(record)) throw new Error(`Conflicting review for ${key}`);
    merged.set(key, record);
  }
  return parseReviewFile(JSON.stringify({ version: 1, records: [...merged.values()] })).records;
}
