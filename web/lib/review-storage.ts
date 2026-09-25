import { mergeReviews, parseReviewFile, reviewKey, serializeReviews, type ReviewRecord } from "./review";

export const REVIEW_STORAGE_KEY = "courtside-reviews-v1";
type StoragePort = Pick<Storage, "getItem" | "setItem">;

/** A failed read is never converted into an empty store. */
export function readReviews(storage: StoragePort): ReviewRecord[] {
  const raw = storage.getItem(REVIEW_STORAGE_KEY);
  return raw === null ? [] : parseReviewFile(raw).records;
}

const sameRecord = (a: ReviewRecord | undefined, b: ReviewRecord | undefined) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Re-read before writing, preserve other contacts, and reject an edited-contact conflict. */
export function saveReview(storage: StoragePort, expected: ReviewRecord | undefined, record: ReviewRecord): ReviewRecord[] {
  const current = readReviews(storage);
  const key = reviewKey(record.matchId, record.frame);
  const actual = current.find((row) => reviewKey(row.matchId, row.frame) === key);
  if (!sameRecord(actual, expected)) throw new Error("This contact changed in another tab. Reset the draft to load the saved review before saving again.");
  const next = [...current.filter((row) => reviewKey(row.matchId, row.frame) !== key), record];
  storage.setItem(REVIEW_STORAGE_KEY, serializeReviews(next));
  return next;
}

/** Validate the complete import and complete store before writing anything. */
export function importReviews(storage: StoragePort, raw: string): ReviewRecord[] {
  const incoming = parseReviewFile(raw).records;
  const next = mergeReviews(readReviews(storage), incoming);
  storage.setItem(REVIEW_STORAGE_KEY, serializeReviews(next));
  return next;
}

export const draftStorageKey = (matchId: string) => `courtside-review-draft-v1:${reviewKey(matchId, 0)}`;
export interface ReviewDraft { record: ReviewRecord; expected: ReviewRecord | null }
export function readReviewDraft(storage: Pick<Storage, "getItem">, matchId: string): ReviewDraft | null {
  const raw = storage.getItem(draftStorageKey(matchId));
  if (raw === null) return null;
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Object.keys(value).sort().join() !== "expected,record") throw new Error("Invalid draft recovery file");
  const record = parseReviewFile(JSON.stringify({ version: 1, records: [value.record] })).records[0];
  const expected = value.expected === null ? null : parseReviewFile(JSON.stringify({ version: 1, records: [value.expected] })).records[0];
  if (record.matchId !== matchId || (expected && reviewKey(expected.matchId, expected.frame) !== reviewKey(record.matchId, record.frame))) throw new Error("Draft recovery identity differs");
  return { record, expected };
}
