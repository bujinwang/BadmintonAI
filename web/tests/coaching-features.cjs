// Serve web/out, then PLAYWRIGHT_MODULE=/path/to/playwright-core node web/tests/coaching-features.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const read = (file) => JSON.parse(fs.readFileSync(path.join(__dirname, '../public/data', file)));
const data = read('india_open_2022_final/ai.json');
const matches = data.strokes.filter((s, i, all) => s.shot === 'smash' && all[i + 1]?.shot === 'block' && all[i + 1].br === s.br + 1 && all[i + 1].set === s.set && all[i + 1].rally === s.rally);
const first = matches[0];
const base = process.env.BASE_URL || 'http://127.0.0.1:8080';
const film = '/m/india_open_2022_final/ai/film/';
(async () => {
 const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
 try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await page.goto(base + film);
  await page.getByRole('button', { name: 'smash → block', exact: true }).click();
  await page.getByRole('status').filter({ hasText: `${matches.length} sequence occurrences` }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('sequence'), 'smash,block');
  await page.getByText(`Set ${first.set} · Rally ${first.rally}`, { exact: true }).waitFor();
  const video = page.locator('video');
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  const rally = data.rallies.find((r) => r.set === first.set && r.rally === first.rally);
  const origin = Number(rally.clip.match(/f(\d+)-/)[1]);
  const checkFrame = async (frame) => {
   await page.waitForFunction(({ frame, origin, fps }) => {
    const v = document.querySelector('video');
    const c = document.querySelector('[data-playback="video"]');
    return v && c && Math.abs(v.currentTime - (frame - origin) / fps) < 0.04 && Math.abs(Number(c.dataset.frame) - frame) <= 1;
   }, { frame, origin, fps: data.meta.fps });
  };
  await checkFrame(first.f);
  assert(await video.evaluate((v) => v.paused));
  const next = data.strokes.find((s) => s.set === first.set && s.rally === first.rally && s.br === first.br + 1);
  await page.getByRole('button', { name: new RegExp(`^Seek contact ${next.br},`) }).click();
  await checkFrame(next.f);
  await page.getByRole('button', { name: `Shots ${first.br}–${next.br}`, exact: true }).click();
  await checkFrame(first.f);
  await page.getByRole('button', { name: new RegExp(`^Seek contact ${next.br},`) }).click();
  await checkFrame(next.f);
  await page.getByRole('button', { name: `Shots ${first.br}–${next.br}`, exact: true }).click();
  await checkFrame(first.f);
  await page.getByRole('button', { name: new RegExp(`^Seek contact ${next.br},`) }).click();
  await checkFrame(next.f);
  await page.getByRole('button', { name: 'Previous contact', exact: true }).click();
  await checkFrame(first.f);
  await page.getByRole('button', { name: 'Playback speed 0.5 times', exact: true }).click();
  assert.equal(await video.evaluate((v) => v.playbackRate), 0.5);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(250);
  const clocks = await page.evaluate(() => ({ time: document.querySelector('video').currentTime, frame: Number(document.querySelector('[data-playback="video"]').dataset.frame) }));
  assert(Math.abs(clocks.frame - (origin + clocks.time * data.meta.fps)) <= 3, JSON.stringify(clocks));
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const frozen = await video.evaluate((v) => v.currentTime); await page.waitForTimeout(120);
  assert.equal(await video.evaluate((v) => v.currentTime), frozen);
  console.log('PASS interior sequence search, contact seeking, slow motion, shared clock and pause');

  const rallyStrokes = data.strokes.filter((s) => s.set === first.set && s.rally === first.rally).sort((a, b) => a.f - b.f);
  const ix = rallyStrokes.findIndex((s) => s.br === first.br);
  await page.getByRole('combobox', { name: 'LOOP FROM', exact: true }).selectOption(String(ix));
  await page.getByRole('combobox', { name: 'THROUGH', exact: true }).selectOption(String(ix + 1));
  await page.getByRole('button', { name: 'Playback speed 1 times', exact: true }).click();
  await page.getByRole('button', { name: 'Loop exchange', exact: true }).click();
  const loopEnd = rallyStrokes[ix + 2]?.f ?? rally.f1 + 1;
  await video.evaluate((v, time) => { v.currentTime = time; }, (loopEnd - origin - 2) / data.meta.fps);
  await page.waitForFunction(({ origin, start, fps }) => {
   const v = document.querySelector('video');
   return !v.paused && v.currentTime >= (start - origin) / fps && v.currentTime < (start - origin) / fps + 0.3;
  }, { origin, start: first.f, fps: data.meta.fps });
  assert.equal(await page.getByRole('button', { name: 'Loop exchange', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Clear loop', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Loop exchange', exact: true }).getAttribute('aria-pressed'), 'false');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Loop exchange', exact: true }).click();
  await page.getByRole('button', { name: 'Clear sequence', exact: true }).click();
  await page.getByRole('button', { name: 'Loop exchange', exact: true, pressed: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Loop exchange', exact: true }).getAttribute('aria-pressed'), 'false');
  assert.equal(await page.getByRole('combobox', { name: 'LOOP FROM', exact: true }).inputValue(), '0');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  console.log('PASS exchange wraps at selected contacts; clearing restores normal playback');

  await page.getByRole('button', { name: /AI OVERLAY ON/ }).click();
  await page.getByText('Synchronization requires an annotated clip. The court replay has separate controls.', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-playback="video"]').count(), 0);
  await page.getByRole('button', { name: 'Turn on AI overlay to synchronize', exact: true }).click();
  await page.locator('[data-playback="video"]').waitFor();
  await page.goto(base + film + '?sequence=smash,block&r=1-1&contact=1&through=2');
  await checkFrame(first.f);
  await page.goto(base + film + '?sequence=unknown,smash');
  await page.getByRole('alert').filter({ hasText: 'sequence link is invalid' }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^Set \d+, rally/ }).count(), 0);
  await page.getByRole('button', { name: 'Show all rallies', exact: true }).click();
  await page.getByRole('button', { name: 'Next rally →', exact: true }).waitFor();
  await page.getByRole('button', { name: 'smash → block', exact: true }).click();
  await page.getByLabel('First hitter', { exact: true }).selectOption('B');
  await page.getByLabel('POINT TO', { exact: true }).selectOption(data.meta.players.A);
  const constrained = matches.filter((stroke) => stroke.p === 'B' && data.rallies.some((r) => r.set === stroke.set && r.rally === stroke.rally && r.winner === 'A'));
  await page.getByRole('status').filter({ hasText: `${constrained.length} sequence occurrences` }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('starter'), 'B');
  console.log('PASS raw-broadcast fallback, invalid search reset, first-hitter and winner filters');

  const index = read('index.json');
  const player = 'Lakshya Sen';
  const entries = index.matches.filter((m) => Object.values(m.players).includes(player));
  const totals = (source) => entries.filter((m) => m.sources.includes(source)).flatMap((m) => {
   const d = read(`${m.id}/${source}.json`); const p = d.meta.players.A === player ? 'A' : 'B';
   return d.insights.shotMix.filter((row) => row.p === p);
  });
  await page.goto(base + '/players/?player=Lakshya+Sen&source=ai');
  const testMix = async (source) => {
   await page.getByRole('heading', { name: 'Shot mix and recorded outcomes' }).waitFor();
   const rows = totals(source); const total = rows.reduce((n, row) => n + row.n, 0);
   const shot = 'smash'; const count = rows.filter((r) => r.shot === shot).reduce((n, row) => n + row.n, 0);
   const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: shot, exact: true }) });
   await row.getByText(`${(100 * count / total).toFixed(1)}%`, { exact: false }).first().waitFor();
   assert((await row.textContent()).includes(`· ${count}`));
  };
  await testMix('ai');
  await page.getByRole('button', { name: 'Ground truth', exact: true }).click();
  await page.waitForURL('**source=labels'); await testMix('labels');
  await page.goBack(); await page.waitForURL('**source=ai'); await testMix('ai');
  console.log('PASS player identity across A/B, weighted shot mix, source separation and history');

  // A failed bundle cannot silently remove one match from the profile totals.
  const retryPage = await browser.newPage();
  let fail = true;
  await retryPage.route('**/data/india_open_2022_final/ai.json', (route) => fail ? route.fulfill({ status: 503, body: 'temporary' }) : route.continue());
  await retryPage.goto(base + '/players/?player=Lakshya+Sen&source=ai');
  await retryPage.getByRole('button', { name: 'Retry all matches' }).waitFor();
  assert.equal(await retryPage.getByRole('table').count(), 0);
  fail = false; await retryPage.getByRole('button', { name: 'Retry all matches' }).click();
  await retryPage.getByRole('table').waitFor(); await retryPage.close();
  console.log('PASS profile all-or-nothing failure and retry');
  for (const width of [390, 1440]) {
   await page.setViewportSize({ width, height: 1050 });
   for (const [name, url] of [['inspector', film + '?sequence=smash,block'], ['profiles', '/players/']]) {
    await page.goto(base + url);
    await page.getByRole(name === 'profiles' ? 'table' : 'slider').waitFor();
    const size = await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth]);
    assert(size[1] <= size[0] + 1, `${name} overflow at ${width}: ${size}`);
    if (name === 'inspector') {
     const select = await page.getByRole('combobox', { name: 'LOOP FROM', exact: true }).boundingBox();
     assert(select.width >= 128, 'loop shot selector must remain readable on mobile');
    }
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), `courtside-${name}-${width}.png`), fullPage: true, animations: 'disabled' });
   }
  }
  assert.deepEqual(errors, []);
  console.log('PASS desktop/mobile layouts and no page errors');
 } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
