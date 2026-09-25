// Node-only storage regression: no browser dependencies or persistent user storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../node_modules/typescript');
const vm = require('node:vm');
const modules = new Map();
function load(name) {
 if (modules.has(name)) return modules.get(name);
 const filename = path.join(__dirname, '../lib', name + '.ts');
 const module = { exports: {} }; modules.set(name, module.exports);
 const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
 vm.runInNewContext(source, { module, exports: module.exports, require: (p) => load(p.replace('./', '')), console }, { filename });
 return module.exports;
}
const { readReviews, saveReview, importReviews, REVIEW_STORAGE_KEY } = load('review-storage');
const { serializeReviews } = load('review');
const record = (matchId, frame) => ({ matchId, source:'ai', players:{A:'Alice',B:'Bob'}, set:1,rally:1,br:frame,frame,final:false,original:{shot:'smash',p:'A',winner:null,category:null},corrected:{shot:'smash',p:'A',winner:null,category:null},status:'confirmed',note:'',updatedAt:'2026-09-07T12:00:00.000Z' });
let raw = null; let writes = 0; let reject = false;
const storage = { getItem: key => { assert.equal(key,REVIEW_STORAGE_KEY);return raw; },setItem: (key,value) => { assert.equal(key,REVIEW_STORAGE_KEY);if(reject)throw new Error('Quota exceeded');raw=value;writes++; }};
const first=record('first',1), other=record('other',2);
assert.equal(readReviews(storage).length,0);
saveReview(storage,undefined,first);
// Concurrent change to another match survives the selected-contact save.
raw=serializeReviews([first,other]); const updated={...first,note:'checked'};
assert.equal(saveReview(storage,first,updated).length,2);
assert.equal(readReviews(storage).find(r=>r.matchId==='other').frame,2);
// Conflicting same-contact edits cannot be silently replaced.
const before=raw;assert.throws(()=>saveReview(storage,first,{...first,note:'stale draft'}),/another tab/);assert.equal(raw,before);
reject=true;assert.throws(()=>saveReview(storage,updated,{...updated,note:'not durable'}),/Quota/);assert.equal(raw,before);reject=false;
const count=writes;assert.throws(()=>importReviews(storage,serializeReviews([{...updated,note:'conflict'}])),/Conflicting/);assert.equal(raw,before);assert.equal(writes,count);
const merged=importReviews(storage,serializeReviews([record('third',3)]));assert.equal(merged.length,3);
raw='{corrupt'; const corrupt=raw;assert.throws(()=>readReviews(storage));assert.throws(()=>saveReview(storage,undefined,first));assert.throws(()=>importReviews(storage,serializeReviews([first])));assert.equal(raw,corrupt);
raw=null;assert.throws(()=>importReviews(storage,JSON.stringify({version:1,records:[first,{...other,note:'x'.repeat(2001)}]})));assert.equal(raw,null);
console.log('PASS review storage: preservation, conflict, quota, corrupt-read and whole-import atomicity');
const { readReviewDraft, draftStorageKey } = load('review-storage');
let tabRaw=JSON.stringify({record:updated,expected:first});
const session={getItem:key=>{assert.equal(key,draftStorageKey('first'));return tabRaw;}};
assert.equal(readReviewDraft(session,'first').record.note,'checked');
assert.equal(readReviewDraft(session,'first').expected.note,'');
tabRaw=JSON.stringify({record:updated,expected:other});assert.throws(()=>readReviewDraft(session,'first'),/identity/);
tabRaw='{broken';assert.throws(()=>readReviewDraft(session,'first'));assert.equal(tabRaw,'{broken');
console.log('PASS tab draft recovery validates contact identity and preserves corrupt input');
