'use strict';

// `verification.run` and `verification.wrapped`: read and refused as `mutate.run` and
// `mutate.wrapped` are, by the same reader, and inherited through a --config file as the
// verification keys beside them are. The run itself: run-item-check.test.cjs.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const lib = require('./run-lib.cjs');
const { fixture } = require('./run-attribution-fixture.cjs');
const { commandOf, wrapperOf } = require('./run-mutate-host.cjs');
const { CHECK, WRAPPER, configOf, hostOf, wrapCalls } = require('./run-item-check-fixture.cjs');
const { writeFile } = require('./test-write.cjs');

const SHAPE = "must be the wrapper's command with \\{tree\\} and \\{test\\} once each, after its own words\\.";

test('a verification.run or verification.wrapped this runner cannot use is BAD_CONFIG with the shape it needs, and runs nothing', (t) => {
  const f = hostOf(fixture(t, { a: { editable: ['a.cjs'], check: CHECK } }));
  const run = `  run: "${WRAPPER} auto {tree} {test}"\n`;
  for (const [body, refusal] of [
    ['  run: ""\n', new RegExp(`verification\\.run in \\S+ ${SHAPE}`)],
    ['  run: "tools/w.sh {test}"\n', new RegExp(`verification\\.run in \\S+ ${SHAPE}`)],
    ['  run: "tools/w.sh {tree}"\n', new RegExp(`verification\\.run in \\S+ ${SHAPE}`)],
    ['  run: "tools/w.sh {tree} {test} {test}"\n', new RegExp(`verification\\.run in \\S+ ${SHAPE}`)],
    ['  run: "tools/w.sh {tree} {tree} {test}"\n', new RegExp(`verification\\.run in \\S+ ${SHAPE}`)],
    ['  run: "{tree} {test}"\n', new RegExp(`verification\\.run in \\S+ ${SHAPE}`)],
    ['  run: [a]\n', new RegExp(`verification\\.run in \\S+ ${SHAPE}`)],
    [`${run}  wrapped: ""\n`, /verification\.wrapped in \S+ must be a non-empty regex\./],
    [`${run}  wrapped: '(node'\n`, /verification\.wrapped in \S+ must be a regex \(/],
    [`${run}  wrapped: '(?:\\w+= )*'\n`, /verification\.wrapped in \S+ must be a regex that an empty test does not match, or every test reads as wrapped\./],
    ["  wrapped: '^node '\n", /verification\.wrapped in \S+ must be set beside verification\.run, the wrapper whose spellings it marks\./],
  ]) {
    f.write('.specs-inferno/config.yaml', `verification:\n${body}`);
    const result = f.verify('a');
    assert.equal(result.code, 2, body + result.out);
    assert.match(result.out, /BAD_CONFIG/, body);
    assert.match(result.out, refusal, body);
    assert.ok(result.out.includes(path.join(f.root, '.specs-inferno', 'config.yaml')), result.out);
  }
  assert.deepEqual(wrapCalls(f), [], 'a refused config runs nothing');
});

test('a --config file inherits verification.run and verification.wrapped, and a bad one is refused against the selected file', (t) => {
  const f = fixture(t, { a: { editable: ['a.cjs'], check: CHECK } });
  f.write('.specs-inferno/config.yaml', configOf({ wrapped: '^X=1 node ' }));
  const selected = path.join(path.dirname(f.root), 'selected.yaml');
  writeFile(selected, 'verification:\n  integrate:\n    - echo one\n');
  const verification = lib.readConfig(f.root, selected).verification;
  assert.equal(verification.run, `${WRAPPER} auto {tree} {test}`);
  const run = wrapperOf(verification);
  assert.equal(commandOf({ run }, '/w/app', 'npm test'), `${WRAPPER} auto '/w/app' 'npm test'`, 'the inherited key places a bare check');
  assert.equal(commandOf({ run }, '/w/app', 'X=1 node w.cjs'), 'X=1 node w.cjs', 'the inherited regex marks a check as wrapped');
  writeFile(selected, 'verification:\n  run: "tools/remote.sh {tree} {test}"\n');
  assert.equal(lib.readConfig(f.root, selected).verification.run, 'tools/remote.sh {tree} {test}', 'a selected file\'s own key wins');
  writeFile(selected, 'verification:\n  run: "tools/remote.sh {test}"\n');
  assert.throws(() => lib.readConfig(f.root, selected),
    (error) => error.code === 'BAD_CONFIG' && /verification\.run/.test(error.message) && error.message.includes(selected));
  assert.equal(wrapperOf({}), null, 'without the key there is no wrapper');
  assert.equal(wrapperOf(undefined), null);
});

test('the run and wrapped lines the config example documents under verification read as the keys this runner takes', (t) => {
  const example = fs.readFileSync(path.join(__dirname, '../../../config.example.yaml'), 'utf8');
  const lineOf = (key) => {
    const at = example.indexOf(`\n  # ${key}:`);
    assert.ok(at > 0 && at > example.indexOf('\nverification:') && at < example.indexOf('\ndoubles:'), `the ${key} line sits in the verification block`);
    return example.slice(at + 1).split('\n')[0].replace(/^ {2}# /, '  ').replace(/\s+# .*$/, '');
  };
  const f = fixture(t, { a: { editable: ['a.cjs'], check: CHECK } });
  f.write('.specs-inferno/config.yaml', `verification:\n${lineOf('run')}\n${lineOf('wrapped')}\n`);
  const run = wrapperOf(lib.readConfig(f.root).verification);
  assert.match(commandOf({ run }, '/w/app', 'npm test'), / '\/w\/app' 'npm test'$/);
  assert.equal(commandOf({ run }, '/w/app', `${run.words} . 'npm test'`), `${run.words} . 'npm test'`);
});
