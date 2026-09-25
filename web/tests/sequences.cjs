// Run: node web/tests/sequences.cjs (uses the installed TypeScript compiler).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const previous = require.extensions['.ts'];
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename);
const { findShotSequences, parseSequence, isValidSequence } = require('../lib/sequences.ts');
if (previous) require.extensions['.ts'] = previous;
else delete require.extensions['.ts'];

const s = (br, shot, p = 'A', rally = 1, set = 1) => ({ br, shot, p, rally, set, f: 100 * set + 10 * rally + br });
const match = (first, last) => ({ set: first.set, rally: first.rally, startBr: first.br,
  endBr: last.br, startFrame: first.f, endFrame: last.f });
const rows = [s(1, 'short serve'), s(2, 'lift', 'B'), s(3, 'smash'), s(4, 'block', 'B'), s(5, 'lift')];
const unordered = [rows[4], rows[2], rows[0], rows[3], rows[1]];
const original = [...unordered];
assert.deepEqual(findShotSequences(unordered, ['lift', 'smash', 'block']), [match(rows[1], rows[3])]);
assert.deepEqual(unordered, original, 'search must not mutate input order');
assert.equal(findShotSequences(rows, ['lift', 'smash'], 'B').length, 1, 'starter applies only to first shot');
assert.equal(findShotSequences(rows, ['lift', 'smash'], 'A').length, 0);
const repeated = [s(1, 'drive'), s(2, 'drive', 'B'), s(3, 'drive')];
assert.deepEqual(findShotSequences(repeated, ['drive', 'drive']), [match(repeated[0], repeated[1]), match(repeated[1], repeated[2])]);
assert.equal(findShotSequences([s(2, 'smash'), s(4, 'block')], ['smash', 'block']).length, 0, 'missing ball round breaks sequence');
assert.equal(findShotSequences([s(1, 'smash'), s(2, 'block', 'B', 2)], ['smash', 'block']).length, 0, 'rally boundary');
assert.equal(findShotSequences([s(1, 'smash'), s(2, 'block', 'B', 1, 2)], ['smash', 'block']).length, 0, 'set boundary');
assert.deepEqual(findShotSequences(rows, []), []);
assert.deepEqual(findShotSequences([], ['smash']), []);
assert.deepEqual(findShotSequences(rows, ['not a shot']), []);
assert.deepEqual(parseSequence('lift,smash,block'), ['lift', 'smash', 'block']);
assert.deepEqual(parseSequence(' lift, smash '), ['lift', 'smash']);
for (const raw of [null, '', 'smash', 'drive,drive,drive,drive,drive,drive']) assert.equal(isValidSequence(raw), true, String(raw));
for (const raw of ['unknown', 'smash,,block', ' ', 'smash,block,', 'drive,drive,drive,drive,drive,drive,drive']) {
  assert.equal(isValidSequence(raw), false, raw);
  assert.deepEqual(parseSequence(raw), [], raw);
}

// Independent per-rally, ball-round lookup checks real exported data in both sources.
let occurrences = 0;
for (const source of ['labels', 'ai']) {
  const { strokes } = JSON.parse(fs.readFileSync(path.join(__dirname, `../public/data/india_open_2022_final/${source}.json`), 'utf8'));
  const pattern = ['smash', 'block'];
  const indexed = new Map(strokes.map((row) => [`${row.set}/${row.rally}/${row.br}`, row]));
  const expected = strokes.filter((row) => row.shot === 'smash' && indexed.get(`${row.set}/${row.rally}/${row.br + 1}`)?.shot === 'block')
    .sort((a, b) => a.set - b.set || a.rally - b.rally || a.br - b.br)
    .map((first) => match(first, indexed.get(`${first.set}/${first.rally}/${first.br + 1}`)));
  assert.deepEqual(findShotSequences([...strokes].reverse(), pattern), expected);
  occurrences += expected.length;
}
assert.ok(occurrences > 0, 'real-match check must exercise actual occurrences');
console.log(`Shot sequences: ordering, interior/overlap, gaps, players, boundaries, parsing and ${occurrences} real occurrences passed.`);
