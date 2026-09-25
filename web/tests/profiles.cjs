// Run: node web/tests/profiles.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/profiles.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const context = { exports: {}, URLSearchParams };
vm.runInNewContext(output, context);
const { aggregateProfile, profilePlayers, loadProfileMatches, shotEvidence } = context.exports;

function match(id, side, n, shot, movement, outcome = {}) {
  const opponent = side === 'A' ? 'B' : 'A';
  return {
    meta: { id, source: 'ai', players: { [side]: 'Player', [opponent]: 'Opponent' }, date: id },
    strokes: Array.from({ length: n }, () => ({ p: side, shot, set: 1, rally: 2 })),
    rallies: [{ endHitter: side, endShot: shot, winner: outcome.unknown ? null : side,
      category: outcome.unknown ? '—' : 'Winner' }],
    insights: {
      shotMix: [{ p: side, shot, n, pct: 100 }, { p: opponent, shot, n: 999, pct: 100 }],
      shotOutcomes: [{ p: side, shot, w: outcome.w ?? 0, e: outcome.e ?? 0 }],
    },
    movement: { [side]: movement, [opponent]: { distM: 9999, secs: 1, speed: 9999 } },
  };
}

const first = match('first', 'A', 1, 'smash', { distM: 100, secs: 10, speed: 10 }, { w: 1 });
const second = match('second', 'B', 9, 'clear', { distM: 100, secs: 100, speed: 1 }, { e: 1, unknown: true });
const profile = aggregateProfile('Player', 'ai', [first, second]);
assert.equal(profile.ownShots, 10);
assert.equal(profile.rallies, 2);
assert.equal(profile.classified, 10);
const smash = profile.shotMix.find((row) => row.shot === 'smash');
const clear = profile.shotMix.find((row) => row.shot === 'clear');
assert.equal(smash.pct, 10, 'pool counts, never average 100% match shares');
assert.equal(clear.pct, 90);
assert.equal(smash.winnerPct, 100);
assert.equal(clear.errorPct, 100 / 9, 'outcome denominator is own shots of that type');
assert.equal(clear.unrated, 1, 'unknown endings remain explicit');
assert.equal(profile.unknownWinners, 1);
assert.equal(profile.movement.speed, 200 / 110, 'speed uses distance / time, not mean of speeds');
assert.equal(profile.matches[1].side, 'B');
assert.equal(profile.matches[1].opponent, 'Opponent');
assert.equal(aggregateProfile('Player', 'ai', [first]).matches.length, 1);
assert.equal(aggregateProfile('Player', 'ai', []).movement.speed, null);
assert.equal(aggregateProfile('Player', 'ai', [match('missing', 'A', 0, 'clear', { distM: 10, secs: 0 })]).movement.matches, 0);
assert.throws(() => aggregateProfile('player', 'ai', [first]), /identity/, 'no fuzzy name matching');
assert.throws(() => aggregateProfile('Player', 'labels', [first]), /one data source/);
assert.throws(() => aggregateProfile('Player', 'ai', [first, first]), /unique matches/);

const evidence = new URL(shotEvidence(second, 'B', 'clear'), 'https://example.test');
assert.equal(evidence.pathname, '/m/second/ai/film/');
assert.equal(evidence.searchParams.get('keys'), '1-2', 'rallies deduplicate repeated strokes');
assert.equal(shotEvidence(second, 'A', 'clear'), null, 'evidence belongs to the selected player');

const index = { matches: [first, second].map((data) => ({
  id: data.meta.id, players: data.meta.players, sources: ['ai'], date: data.meta.date,
})).concat([{ id: 'labels-only', players: { A: 'Player', B: 'Other' }, sources: ['labels'], date: 'third' }]) };
assert.equal(profilePlayers(index)[0].name, 'Player');

(async () => {
  const requested = [];
  const resolves = [];
  const pending = loadProfileMatches(index, 'Player', 'ai', (url) => {
    requested.push(url);
    return new Promise((resolve) => resolves.push(resolve));
  });
  assert.equal(requested.length, 2, 'matching same-source requests start in parallel');
  assert.ok(requested.every((url) => url.endsWith('/ai.json')));
  resolves[0](first); resolves[1](second);
  assert.equal((await pending).length, 2);
  await assert.rejects(loadProfileMatches(index, 'Player', 'ai', async (url) => {
    if (url.includes('second')) throw new Error('offline');
    return first;
  }), /offline/, 'one failure must not return partial totals');
  assert.equal((await loadProfileMatches(index, 'Player', 'ai', async (url) => url.includes('first') ? first : second)).length, 2, 'retry can recover');
  await assert.rejects(loadProfileMatches(index, 'Player', 'ai', async () => ({ ...first, meta: { ...first.meta, source: 'labels' } })), /source/);

  // Real exports: Lee Zii Jia changes from B to A; sums must follow his exact name.
  const dataRoot = path.join(__dirname, '../public/data');
  const realIndex = JSON.parse(fs.readFileSync(path.join(dataRoot, 'index.json')));
  for (const source of ['ai', 'labels']) {
    const matches = await loadProfileMatches(realIndex, 'Lee Zii Jia', source,
      async (url) => JSON.parse(fs.readFileSync(path.join(__dirname, '../public', url))));
    const result = aggregateProfile('Lee Zii Jia', source, matches);
    assert.equal(result.matches.length, 2);
    assert.deepEqual([...result.matches.map((m) => m.side)].sort(), ['A', 'B']);
    const expected = matches.reduce((total, data) => total + data.strokes.filter((stroke) => data.meta.players[stroke.p] === 'Lee Zii Jia').length, 0);
    assert.equal(result.ownShots, expected);
    assert.ok(Math.abs(result.shotMix.reduce((total, row) => total + row.pct, 0) - 100) < 1e-8);
  }
  console.log('Profiles: weighted counts, exact A/B identity, unknowns, movement, evidence, source isolation, parallel loading and all-or-nothing retries passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
