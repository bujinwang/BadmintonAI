// Run: node web/tests/playback.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/playback.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const { clipWindow, clampFrame, frameToTime, timeToFrame, adjacentContact, exchangeLoop } = context.exports;
const bounds = clipWindow('/clips/match/f964-1242.mp4');
assert.equal(bounds.start, 964);
assert.equal(bounds.end, 1242);
assert.equal(clipWindow('/clips/f20-10.mp4'), null);
assert.equal(clipWindow('/clips/unknown.mp4'), null);
assert.equal(clipWindow(null), null);
assert.equal(clipWindow('/clips/f964-1242.mp4?v=1').start, 964);
// Rally begins at frame 1000, but the clip includes 36 padding frames.
assert.equal(frameToTime(1000, bounds, 30), 1.2);
assert.equal(timeToFrame(1.2, bounds, 30), 1000);
assert.equal(timeToFrame(4.766666, { start: 12383, end: 13158 }, 30), 12526, 'native seek-time microsecond truncation must not lose a frame');
for (const fps of [24, 29.97, 30, 60]) {
  for (const frame of [964, 965, 1000, 1242]) assert.equal(timeToFrame(frameToTime(frame, bounds, fps), bounds, fps), frame);
}
assert.equal(frameToTime(900, bounds, 30), 0);
assert.equal(timeToFrame(100, bounds, 30), 1242);
assert.equal(clampFrame(1242, bounds, 30, 2), 1023, 'short files clamp to the last actual video frame');
assert.equal(frameToTime(1242, bounds, 30, 2), 59 / 30);
assert.throws(() => frameToTime(1000, bounds, 0), /frame rate/);
const frames = [1000, 1030, 1060, 1090];
assert.equal(adjacentContact(frames, 1030, -1), 1000);
assert.equal(adjacentContact(frames, 1030, 1), 1060);
assert.equal(adjacentContact(frames, 1031, -1), 1030);
assert.equal(adjacentContact(frames, 999, -1), null);
assert.equal(adjacentContact(frames, 1090, 1), null);
assert.equal(adjacentContact([], 1000, 1), null);
const single = exchangeLoop(frames, 1, 1, bounds);
assert.equal(single.start, 1030);
assert.equal(single.end, 1059, 'last selected shot ends before the next contact');
assert.equal(exchangeLoop(frames, 2, 3, bounds).end, 1242, 'last contact can loop through video end');
assert.equal(exchangeLoop(frames, 2, 1, bounds), null);
assert.equal(exchangeLoop([], 0, 0, bounds), null);
assert.equal(exchangeLoop(frames, 0, 8, bounds), null);
assert.equal(exchangeLoop(frames, 0, 1, { start: 1010, end: 1040 }).start, 1010);
assert.equal(exchangeLoop(frames, 0, 1, { start: 1010, end: 1040 }).end, 1040);
assert.equal(exchangeLoop(frames, 2, 3, { start: 900, end: 950 }), null);
console.log('Playback: padded origins, frame/time conversion, bounds, contact navigation and loop edges passed.');
