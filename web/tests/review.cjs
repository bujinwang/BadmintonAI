// Run: node web/tests/review.cjs. No database, browser, model or new dependency.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const previous = require.extensions['.ts'];
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename);
const { reviewKey, buildReviewQueue, recordMatches, parseReviewFile, serializeReviews, mergeReviews } = require('../lib/review.ts');
if (previous) require.extensions['.ts'] = previous; else delete require.extensions['.ts'];

const players = { A: 'Ann', B: 'Ben' };
const stroke = (f, br, shot = 'clear', p = 'A', conf = 0.9, rally = 1, set = 1) => ({ f, br, shot, p, conf, rally, set, t: f / 30 });
function bundle(source, strokes, names = players, offset = source === 'labels' ? -7 : 0) {
  const groups = new Map();
  for (const s of strokes) {
    const key = `${s.set}:${s.rally}`, old = groups.get(key);
    if (!old || old.br < s.br) groups.set(key, s);
  }
  return { meta: { id: 'test-match', source, players: { ...names }, fps: 30, contactFrameOffset: offset }, strokes,
    rallies: [...groups.values()].map((s) => ({ set: s.set, rally: s.rally, endRound: s.br, winner: s.p, category: 'Winner' })) };
}
function record(item, edits = {}) {
  return { matchId: 'test-match', source: 'ai', players: { ...players }, set: item.stroke.set,
    rally: item.stroke.rally, br: item.stroke.br, frame: item.stroke.f, final: item.final,
    original: { ...item.original }, corrected: { ...item.original }, status: 'confirmed',
    note: '', updatedAt: '2026-09-07T12:00:00.000Z', ...edits };
}
const encode = (records) => JSON.stringify({ version: 1, records });
const clone = (value) => JSON.parse(JSON.stringify(value));

const ai = bundle('ai', [stroke(140, 3, 'drop', 'A', 0.99), stroke(100, 1, 'clear', 'A', 0.8), stroke(120, 2, 'smash', 'B', 0.4)]);
const labels = bundle('labels', [stroke(147, 3, 'clear', 'B', null, 9, 2), stroke(107, 1, 'clear', 'B', null, 9, 2), stroke(127, 2, 'smash', 'A', null, 9, 2)], { A: 'Ben', B: 'Ann' });
const before = JSON.stringify({ ai, labels });
const queue = buildReviewQueue(ai, labels);
assert.equal(queue.length, 3);
assert.equal(queue[0].stroke.f, 140, 'high-confidence disagreement comes before low confidence');
assert.ok(queue[0].reasons.includes('Shot differs from labels'));
assert.equal(queue[1].stroke.f, 120);
assert.deepEqual(queue[1].reasons, ['Low confidence']);
assert.equal(JSON.stringify({ ai, labels }), before, 'alignment must never mutate input bundles or player identities');
for (const item of queue) {
  assert.equal(item.reference.f, item.stroke.f, 'calibrated exported frame must align despite drifting rally/set IDs');
  assert.equal(item.reference.t, item.reference.f / 30);
  assert.equal(item.reference.p, item.stroke.p, 'reference side remaps by athlete name');
  if (!item.final) assert.deepEqual([item.original.winner, item.original.category], [null, null]);
}
assert.equal(queue[0].original.winner, 'A');
assert.equal(queue[0].original.category, 'Winner');
assert.equal(buildReviewQueue(bundle('ai', [stroke(100, 1)]), bundle('labels', [stroke(109, 1)], players, -9))[0].reference.f, 100);
const noLabels = buildReviewQueue(bundle('ai', [stroke(100, 1), stroke(120, 2, 'smash', 'B', null), stroke(140, 3, 'drop', 'A', 0.649)]), null);
assert.equal(noLabels[0].stroke.conf, null);
assert.ok(noLabels[0].reasons.includes('Confidence unavailable'));
assert.ok(noLabels[1].reasons.includes('Low confidence'));
assert.deepEqual(noLabels[2].reasons, [], 'no reference bundle must not flag every confident contact');
assert.deepEqual(buildReviewQueue(bundle('ai', [stroke(100, 1, 'clear', 'A', 0.65)]), null)[0].reasons, []);
assert.equal(buildReviewQueue(bundle('ai', [stroke(100, 1)]), bundle('labels', [stroke(113, 1)]))[0].reference.f, 106, 'inclusive six-frame tolerance');
assert.ok(buildReviewQueue(bundle('ai', [stroke(100, 1)]), bundle('labels', [stroke(114, 1)]))[0].reasons.includes('No labeled contact nearby'));
for (const [left, right] of [
  [[stroke(99, 1), stroke(101, 2)], [stroke(107, 1)]],
  [[stroke(100, 1)], [stroke(106, 1), stroke(108, 2)]],
]) {
  const ambiguous = buildReviewQueue(bundle('ai', left), bundle('labels', right));
  assert.ok(ambiguous.every((i) => i.reference === null && i.reasons.includes('Ambiguous label alignment')));
}
const oneToOne = buildReviewQueue(bundle('ai', [stroke(100, 1), stroke(104, 2)]), bundle('labels', [stroke(108, 1)]));
assert.equal(oneToOne.filter((i) => i.reference).length, 1);
for (const bad of [
  { ...labels, meta: { ...labels.meta, id: 'wrong-match' } },
  { ...labels, meta: { ...labels.meta, source: 'ai' } },
  { ...labels, meta: { ...labels.meta, contactFrameOffset: undefined } },
  { ...labels, meta: { ...labels.meta, contactFrameOffset: NaN } },
  { ...labels, meta: { ...labels.meta, players: { A: 'Unknown', B: 'Ann' } } },
]) assert.throws(() => buildReviewQueue(ai, bad));
assert.throws(() => buildReviewQueue(labels, null));
assert.throws(() => buildReviewQueue(bundle('ai', [stroke(100, 1), stroke(100, 2)]), null));

const nonfinal = queue.find((item) => !item.final);
const saved = record(nonfinal);
assert.equal(reviewKey('test-match', 0), 'test-match:0');
assert.equal(recordMatches(nonfinal, saved, players), true);
for (const stale of [
  { ...saved, br: saved.br + 1 }, { ...saved, frame: saved.frame + 1 }, { ...saved, frame: NaN },
  { ...saved, final: !saved.final }, { ...saved, matchId: 'different' },
  { ...saved, original: { ...saved.original, p: 'A' } },
]) assert.equal(recordMatches(nonfinal, stale, players), false);
assert.equal(recordMatches(nonfinal, saved, { A: 'Ben', B: 'Ann' }), false);
const changed = record(nonfinal, { corrected: { ...nonfinal.original, shot: 'lift' }, status: 'corrected', note: 'Contact review' });
assert.equal(recordMatches(nonfinal, changed, players), true, 'a correction does not make its own original stale');
assert.deepEqual(parseReviewFile(serializeReviews([changed])).records, [changed]);
assert.deepEqual(parseReviewFile(serializeReviews([])), { version: 1, records: [] });
assert.doesNotThrow(() => parseReviewFile(encode([{ ...saved, updatedAt: '2026-09-07T12:00:00Z' }])));
assert.doesNotThrow(() => parseReviewFile(encode([{ ...changed, original: { ...changed.original, shot: 'unclassified' } }])));
const finalSaved = record(queue.find((item) => item.final));
assert.doesNotThrow(() => parseReviewFile(encode([{ ...finalSaved, original: { ...finalSaved.original, winner: null, category: null }, corrected: { ...finalSaved.corrected, winner: null, category: null } }])));

const mutations = [
  (r) => { r.source = 'labels'; }, (r) => { r.frame = -1; }, (r) => { r.frame = 1.5; },
  (r) => { r.frame = Number.MAX_SAFE_INTEGER + 1; }, (r) => { r.set = 0; },
  (r) => { r.rally = Infinity; }, (r) => { r.br = 0; }, (r) => { r.matchId = '../wrong'; },
  (r) => { r.note = 'x'.repeat(2001); }, (r) => { r.corrected.shot = 'unknown'; },
  (r) => { r.players.A = r.players.B; }, (r) => { r.corrected.p = 'C'; },
  (r) => { r.corrected.winner = 'A'; }, (r) => { r.corrected.category = 'Out'; },
  (r) => { r.original.winner = 'B'; }, (r) => { r.original.category = 'unknown'; },
  (r) => { r.updatedAt = 'yesterday'; }, (r) => { r.updatedAt = '2026-02-30T12:00:00Z'; },
  (r) => { r.status = 'corrected'; }, (r) => { r.corrected.shot = 'lift'; },
  (r) => { r.extra = true; }, (r) => { delete r.note; }, (r) => { r.final = 'false'; },
];
for (const mutate of mutations) { const invalid = clone(saved); mutate(invalid); assert.throws(() => parseReviewFile(encode([invalid]))); }
assert.throws(() => parseReviewFile('{'));
assert.throws(() => parseReviewFile(JSON.stringify({ version: 2, records: [] })));
assert.throws(() => parseReviewFile(JSON.stringify({ version: 1, records: [], extra: true })));
assert.throws(() => parseReviewFile(encode(Array(50_001).fill(saved))));
assert.throws(() => parseReviewFile(encode([saved, saved])));
assert.equal(parseReviewFile(encode([saved, { ...saved, frame: saved.frame + 1 }])).records.length, 2, "orphaned prior frame and refreshed same-round frame must coexist");
assert.throws(() => parseReviewFile(encode([saved, { ...saved, br: saved.br + 1 }])));
const reordered = Object.fromEntries(Object.entries(saved).reverse());
assert.deepEqual(mergeReviews([saved], [reordered]), [saved], 'identical records dedupe regardless object key order');
assert.throws(() => mergeReviews([saved], [{ ...saved, note: 'different' }]), /Conflicting/);
assert.throws(() => mergeReviews([saved], [changed]), /Conflicting/);
assert.equal(mergeReviews([saved], [finalSaved]).length, 2);

// Actual exported contacts must align on the contact clock, not the player-position clock.
const root = path.join(__dirname, '../public/data');
const index = JSON.parse(fs.readFileSync(path.join(root, 'index.json')));
const realCounts = [];
for (const match of index.matches) {
  const a = JSON.parse(fs.readFileSync(path.join(root, match.id, 'ai.json')));
  const l = JSON.parse(fs.readFileSync(path.join(root, match.id, 'labels.json')));
  const original = JSON.stringify(l);
  const q = buildReviewQueue(a, l);
  const refs = q.filter((item) => item.reference);
  const expected = JSON.parse(fs.readFileSync(path.join(root, match.id, 'showcase.json'))).agreement.nMatched;
  const ambiguous = q.filter((item) => item.reasons.includes('Ambiguous label alignment')).length;
  assert.equal(q.length, a.strokes.length);
  assert.equal(JSON.stringify(l), original);
  assert.equal(new Set(refs.map((item) => `${item.reference.set}/${item.reference.rally}/${item.reference.br}`)).size, refs.length);
  assert.ok(refs.every((item) => Math.abs(item.stroke.f - item.reference.f) <= 6));
  assert.ok(Math.abs(refs.length - expected) <= ambiguous + 3,
    `${match.id}: aligned ${refs.length}, expected approximately ${expected}, ambiguous ${ambiguous}`);
  realCounts.push({ match: match.id, contacts: q.length, aligned: refs.length, publishedMatched: expected, ambiguous, flagged: q.filter((i) => i.reasons.length).length });
}
console.log('Review domain: alignment/timing/names/ties, parsing, staleness, merge and real exports passed.');
console.table(realCounts);
