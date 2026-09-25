// Run: node web/tests/court-accessibility.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const context = {
  exports: {},
  require: (name) => {
    if (name === '@/lib/types') return { COURT: { w: 6.1, l: 13.4, net: 6.7 } };
    if (name === '@/lib/fmt') return { PCOLOR: {} };
    if (name === '@/components/ui') return { useChartTip: () => ({ ref: null, on: () => ({}), tipEl: null }) };
    return require(name);
  },
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../components/court.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText, context);
const { PlacementMap } = context.exports;
const marks = ['rally', 'winner', 'error'].map((kind, index) => ({
  kind, x: 2, y: 8, set: 1, rally: index + 1, label: 'smash',
}));
const collect = (node) => {
  if (Array.isArray(node)) return node.flatMap(collect);
  if (!node?.props) return [];
  return [...(node.type === 'g' && node.props.onClick ? [node.props] : []), ...collect(node.props.children)];
};
let selections = [];
const interactive = collect(PlacementMap({ marks, onPick: (set, rally) => selections.push([set, rally]) }));
assert.equal(interactive.length, 3);
for (const [index, props] of interactive.entries()) {
  assert.equal(props.role, 'button');
  assert.equal(props.tabIndex, 0);
  assert.match(props['aria-label'], new RegExp(`Set 1, rally ${index + 1}.*smash`));
  for (const key of ['Enter', ' ']) {
    let prevented = false;
    props.onKeyDown({ key, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true, 'activation keys must not scroll the document');
    assert.deepEqual(selections.at(-1), [1, index + 1]);
  }
  const count = selections.length;
  props.onKeyDown({ key: 'Escape', preventDefault() { assert.fail('unrelated key intercepted'); } });
  assert.equal(selections.length, count);
}
for (const props of collect(PlacementMap({ marks }))) {
  assert.equal(props.tabIndex, undefined);
  assert.equal(props.role, undefined);
  assert.equal(props.onKeyDown, undefined);
}
console.log('Placement map: Enter/Space activation, labels, and noninteractive focus checks passed.');
