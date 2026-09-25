// Serve web/out with scripts/serve_web.py. Uses an existing Playwright installation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const base = process.env.BASE_URL || 'http://127.0.0.1:8080';
const mid = 'india_open_2022_final';
const route = `/m/${mid}/ai/review/`;
const key = 'courtside-reviews-v1';
const data = JSON.parse(fs.readFileSync(path.join(__dirname, `../public/data/${mid}/ai.json`)));
const stroke = data.strokes.find((s) => s.f === 12509);
const ending = data.strokes.find((s) => s.set === stroke.set && s.rally === stroke.rally && s.br === data.rallies.find((r) => r.set === s.set && r.rally === s.rally).endRound);
const alternateShot = stroke.shot === 'clear' ? 'smash' : 'clear';
(async () => {
 const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
 const errors = [];
 async function pageIn(context) {
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (r) => r.request().url().startsWith(base) ? r.continue() : r.abort());
  return page;
 }
 const waitEditor = async (page, frame = stroke.f) => {
  await page.locator(`[data-review-frame="${frame}"]`).waitFor();
  await page.getByLabel('Reviewed shot', { exact: true }).waitFor();
 };
 const saved = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
 try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await pageIn(context);
  await page.goto(base + route + `?frame=${stroke.f}`); await waitEditor(page);
  const rally = data.rallies.find((r) => r.set === stroke.set && r.rally === stroke.rally);
  const origin = Number(rally.clip.match(/f(\d+)-/)[1]);
  await page.waitForFunction(({ frame, origin, fps }) => {
   const v = document.querySelector('video'), court = document.querySelector('[data-playback="video"]');
   return v && court && Math.abs(v.currentTime - (frame - origin) / fps) < 0.04 && Math.abs(Number(court.dataset.frame) - frame) <= 1;
  }, { frame: stroke.f, origin, fps: data.meta.fps });
  await page.getByLabel('Reviewed shot', { exact: true }).selectOption(alternateShot);
  await page.getByLabel('Reviewed hitter', { exact: true }).selectOption(stroke.p === 'A' ? 'B' : 'A');
  await page.getByLabel('Review note', { exact: true }).fill('Synthetic browser regression; not a human annotation.');
  const other = page.getByRole('button', { name: /^Review contact / }).filter({ hasNotText: `frame ${stroke.f}` }).first();
  page.once('dialog', (dialog) => dialog.dismiss()); await other.click();
  assert.equal(await page.locator('[data-review-frame]').getAttribute('data-review-frame'), String(stroke.f));
  assert.equal(await page.getByLabel('Reviewed shot', { exact: true }).inputValue(), alternateShot);
  await page.getByRole('button', { name: 'Save correction', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Review saved' }).waitFor();
  const record = (await saved(page)).records[0];
  assert.equal(record.frame, stroke.f); assert.equal(record.original.shot, stroke.shot);
  assert.equal(record.corrected.shot, alternateShot); assert.equal(record.status, 'corrected');
  assert.equal(record.original.winner, null); assert.equal(record.corrected.category, null);
  await page.reload(); await waitEditor(page);
  assert.equal(await page.getByLabel('Reviewed shot', { exact: true }).inputValue(), alternateShot);
  console.log('PASS exact-contact video/court, dirty navigation guard, immutable correction and reload');

  // Two tabs must never silently replace one another's edit of the same contact.
  const second = await pageIn(context);
  await second.goto(base + route + `?frame=${stroke.f}`); await waitEditor(second);
  await second.getByLabel('Review note', { exact: true }).fill('Second tab draft');
  await page.getByLabel('Review note', { exact: true }).fill('First tab committed');
  await page.getByRole('button', { name: 'Save correction', exact: true }).click();
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).records[0].note === 'First tab committed', key);
  await second.getByRole('button', { name: 'Save correction', exact: true }).click();
  await second.getByRole('status').filter({ hasText: 'not saved' }).waitFor();
  assert.equal((await saved(second)).records[0].note, 'First tab committed');
  await second.close();
  console.log('PASS cross-tab conflict preserves committed reviews');

  await page.goto(base + route + `?frame=${ending.f}`); await waitEditor(page, ending.f);
  await page.getByLabel('Reviewed winner', { exact: true }).selectOption('B');
  await page.getByLabel('Reviewed ending', { exact: true }).selectOption('Out');
  await page.getByRole('button', { name: 'Save correction', exact: true }).click();
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).records.length === 2, key);
  const file = await saved(page); assert(file.records.find((r) => r.frame === ending.f).final);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export reviews', exact: true }).click();
  const exportPath = path.join(os.tmpdir(), 'courtside-review-browser.json');
  await (await download).saveAs(exportPath);
  assert.deepEqual(JSON.parse(fs.readFileSync(exportPath)), file);
  console.log(`PASS ending correction and portable export: ${exportPath}`);

  const importedContext = await browser.newContext(); const imported = await pageIn(importedContext);
  await imported.goto(base + route + `?frame=${stroke.f}`); await waitEditor(imported);
  await imported.getByLabel('Import reviews', { exact: true }).setInputFiles(exportPath);
  await imported.getByRole('status').filter({ hasText: 'Imported and merged successfully' }).waitFor();
  assert.deepEqual(await saved(imported), file);
  const before = JSON.stringify(await saved(imported));
  const upload = async (value) => imported.getByLabel('Import reviews', { exact: true }).setInputFiles({ name: 'reviews.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  const conflict = structuredClone(file); conflict.records[0].note = 'Conflicting imported note';
  await upload(conflict); await imported.getByRole('status').filter({ hasText: 'Import failed' }).waitFor();
  assert.equal(JSON.stringify(await saved(imported)), before);
  await upload({ version: 1, records: [file.records[0], { invalid: true }] });
  await imported.getByRole('status').filter({ hasText: 'Import failed' }).waitFor();
  assert.equal(JSON.stringify(await saved(imported)), before);
  console.log('PASS whole-file import validation and conflict rejection');

  const staleContext = await browser.newContext();
  await staleContext.addInitScript(({ key, file }) => localStorage.setItem(key, JSON.stringify(file)), { key, file });
  const stale = await pageIn(staleContext);
  await stale.route(`**/data/${mid}/ai.json`, (r) => {
   const changed = structuredClone(data); changed.strokes.find((s) => s.f === stroke.f).shot = 'net shot';
   return r.fulfill({ contentType: 'application/json', body: JSON.stringify(changed) });
  });
  await stale.goto(base + route + `?frame=${stroke.f}`); await waitEditor(stale);
  await stale.getByRole('alert').filter({ hasText: 'prediction or player identity changed' }).waitFor();
  assert.equal(await stale.getByLabel('Reviewed shot', { exact: true }).inputValue(), 'net shot');
  assert.equal((await saved(stale)).records[0].original.shot, stroke.shot);
  console.log('PASS stale prediction cannot silently inherit a previous correction');

  const corruptContext = await browser.newContext();
  await corruptContext.addInitScript((key) => localStorage.setItem(key, '{broken'), key);
  const corrupt = await pageIn(corruptContext); await corrupt.goto(base + route + `?frame=${stroke.f}`);
  await corrupt.getByRole('alert').filter({ hasText: 'Browser storage could not be read' }).waitFor();
  assert(await corrupt.getByRole('button', { name: 'Save correction', exact: true }).isDisabled());
  assert.equal(await corrupt.evaluate((key) => localStorage.getItem(key), key), '{broken');
  const quotaContext = await browser.newContext();
  await quotaContext.addInitScript((key) => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v) { if (k === key) throw new DOMException('Full', 'QuotaExceededError'); return set.call(this, k, v); }; }, key);
  const quota = await pageIn(quotaContext); await quota.goto(base + route + `?frame=${stroke.f}`); await waitEditor(quota);
  await quota.getByRole('button', { name: 'Confirm prediction', exact: true }).click();
  await quota.getByRole('status').filter({ hasText: 'not saved' }).waitFor();
  assert.equal(await quota.evaluate((key) => localStorage.getItem(key), key), null);
  console.log('PASS corrupt storage and failed writes preserve records');

  const missingContext = await browser.newContext(); const missing = await pageIn(missingContext);
  let fail = true;
  await missing.route(`**/data/${mid}/labels.json`, (r) => fail ? r.fulfill({ status: 503, body: 'Temporary' }) : r.continue());
  await missing.goto(base + route); await missing.getByRole('button', { name: 'Use confidence-only mode' }).waitFor();
  assert.equal(await missing.getByLabel('Reviewed shot', { exact: true }).count(), 0);
  fail = false; await missing.getByRole('button', { name: 'Retry reference', exact: true }).click();
  await missing.getByLabel('Reviewed shot', { exact: true }).waitFor();
  console.log('PASS failed references are explicit and retry restores the queue');

  const historyContext = await browser.newContext(); const historyPage = await pageIn(historyContext);
  await historyPage.goto(base + `/m/${mid}/ai/film/`);
  await historyPage.getByRole('link', { name: 'Review', exact: true }).click();
  await historyPage.getByLabel('Review note', { exact: true }).waitFor();
  const historyFrame = await historyPage.locator('[data-review-frame]').getAttribute('data-review-frame');
  await historyPage.getByLabel('Review note', { exact: true }).fill('Recover this unfinished review after Back.');
  await historyPage.goBack(); await historyPage.waitForURL('**/film/');
  await historyPage.goForward(); await historyPage.waitForURL('**/review/');
  await waitEditor(historyPage, historyFrame);
  assert.equal(await historyPage.getByLabel('Review note', { exact: true }).inputValue(), 'Recover this unfinished review after Back.');
  assert.equal(await historyPage.evaluate((key) => localStorage.getItem(key), key), null);
  console.log('PASS unfinished review survives Back/Forward without becoming a saved correction');

  for (const width of [390, 1440]) {
   await page.setViewportSize({ width, height: 1100 });
   await page.goto(base + route + `?frame=${stroke.f}`); await waitEditor(page);
   const size = await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth]);
   assert(size[1] <= size[0] + 1, `Review overflow at ${width}: ${size}`);
   await page.screenshot({ path: path.join(os.tmpdir(), `courtside-review-${width}.png`), fullPage: true, animations: 'disabled' });
  }
  assert.deepEqual(errors, []);
  console.log('PASS 390/1440 layouts; no page errors');
 } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
