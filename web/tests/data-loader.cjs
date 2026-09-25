// Run: node web/tests/data-loader.cjs (uses the existing TypeScript dependency).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

let calls = 0;
let respond;
const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/json.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const context = { exports: {}, require, fetch: (...args) => { calls++; return respond(...args); } };
vm.runInNewContext(output, context);
const { fetchJson } = context.exports;

(async () => {
  let resolve;
  respond = () => new Promise((done) => { resolve = done; });
  const first = fetchJson('/same');
  assert.equal(fetchJson('/same'), first, 'concurrent requests must be deduplicated');
  resolve({ ok: true, json: async () => ({ rally: 1 }) });
  assert.equal((await first).rally, 1);
  assert.equal((await fetchJson('/same')).rally, 1);
  assert.equal(calls, 1, 'successful responses should be cached');

  respond = async () => ({ ok: false, status: 503 });
  await assert.rejects(fetchJson('/retry'), /503/);
  respond = async () => ({ ok: true, json: async () => ({ recovered: true }) });
  assert.equal((await fetchJson('/retry')).recovered, true, 'HTTP failure must allow retry');

  respond = async () => { throw new Error('offline'); };
  await assert.rejects(fetchJson('/network'), /offline/);
  respond = async () => ({ ok: true, json: async () => { throw new Error('bad JSON'); } });
  await assert.rejects(fetchJson('/network'), /bad JSON/);
  respond = async () => ({ ok: true, json: async () => ({ recovered: true }) });
  assert.equal((await fetchJson('/network')).recovered, true, 'network and parse errors must allow retry');
  console.log('Data loader: deduplication, caching, HTTP/network/JSON retries passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
