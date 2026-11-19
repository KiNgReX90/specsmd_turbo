'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

// A tree's run records sit in one folder under the cache, and run-state-dir.cjs alone names it. A
// file that joined the cache folder with the branch name filed every detached tree under HEAD, one
// folder for all of them. This file holds every script of the flow to that: under the cache a folder
// is named by a literal or a constant, and a tree's own folder comes from stateDir (or branchDir for
// a named branch).

const FLOW = path.resolve(__dirname, '../../../../..');
const OWNER = path.relative(FLOW, path.join(__dirname, 'run-state-dir.cjs'));
// Built in two halves so this file never matches its own rule.
const CACHE = 'cache' + 'Dir';
const CALL = `(?:[\\w.]+\\.)?${CACHE}\\([^()]*\\)`;
/** A folder name spelled out: a quoted string or a template with no placeholder, or a constant. */
const SPELLED = /^(?:(['"])[^'"]*\1|`[^`$]*`|[A-Z][A-Z0-9_]*)$/;

const isTestCode = (file) => file.endsWith('.test.cjs') || file.endsWith('-fixture.cjs');
const lineOf = (source, index) => source.slice(0, index).split('\n').length;

/** Every line in a {file: source} map, tests and the owner aside, that joins the cache folder with a name it does not spell. */
function offenders(files) {
  const found = [];
  for (const [file, source] of Object.entries(files)) {
    if (isTestCode(file) || file === OWNER) continue;
    const held = [...source.matchAll(new RegExp(`\\b(?:const|let|var)\\s+(\\w+)\\s*=\\s*${CALL}`, 'g'))].map((match) => `\\b${match[1]}\\b`);
    const start = [CALL, ...held].join('|');
    const joins = [...source.matchAll(new RegExp(`\\bpath\\.(?:posix\\.)?(?:join|resolve)\\(\\s*(?:${start})\\s*,\\s*([^,)]+)`, 'g'))]
      .filter((match) => !SPELLED.test(match[1].trim()));
    const glued = [...source.matchAll(new RegExp(`\\$\\{\\s*${CALL}\\s*\\}/\\$\\{|${CALL}\\s*\\+`, 'g'))];
    for (const match of [...joins, ...glued]) found.push(`${file}:${lineOf(source, match.index)}`);
  }
  return found.sort();
}

function flowSources() {
  const files = {};
  for (const rel of fs.readdirSync(FLOW, { recursive: true, encoding: 'utf8' })) {
    if (rel.endsWith('.cjs')) files[rel] = fs.readFileSync(path.join(FLOW, rel), 'utf8');
  }
  return files;
}

function refusal(found) {
  return `${found.join('\n')}\n` +
    'These lines name a folder under the cache by a value, as a branch name: every detached tree is on HEAD, so they share it.\n' +
    'Take the tree\'s own folder from run-state-dir.cjs:\n' +
    "  const { stateDir } = require('./run-state-dir.cjs');\n" +
    "  path.join(stateDir(tree), 'owner.json');\n" +
    'and spell any other folder under the cache as a literal or a constant.';
}

test('a join of the cache folder with the branch is found, by a call, a variable, a held cache folder or a template', () => {
  const files = {
    'a.cjs': `return path.join(lib.${CACHE}(tree), lib.currentBranch(tree), 'owner.json');\n`,
    'b.cjs': `const branch = lib.currentBranch(tree);\nconst dir = path.join(lib.${CACHE}(tree),\n  branch, 'x');\n`,
    'c.cjs': `const cache = lib.${CACHE}(tree);\nreturn path.resolve(cache, branch);\n`,
    'd.cjs': `const dir = \`\${lib.${CACHE}(tree)}/\${branch}\`;\nconst e = ${CACHE}(tree) + '/' + branch;\n`,
  };
  assert.deepEqual(offenders(files), ['a.cjs:1', 'b.cjs:2', 'c.cjs:2', 'd.cjs:1', 'd.cjs:2']);
});

test('a folder under the cache spelled as a literal or a constant, a test, and the owner are left alone', () => {
  const join = `path.join(lib.${CACHE}(tree), lib.currentBranch(tree));\n`;
  const files = {
    'a.cjs': `const cache = lib.${CACHE}(tree);\npath.join(cache, 'green-commands', key);\npath.join(lib.${CACHE}(tree), "dispatch", \`\${intent}.log\`);\n` +
      `path.join(lib.${CACHE}(primary), EVIDENCE, folder);\npath.join(lib.${CACHE}(tree), \`item-proofs\`);\nthrow new Error(\`left the cache (\${lib.${CACHE}(tree)})\`);\n`,
    'b.test.cjs': join,
    'c-fixture.cjs': join,
    [OWNER]: join,
  };
  assert.deepEqual(offenders(files), []);
});

test('no script of the flow but run-state-dir.cjs joins the cache folder with a name it does not spell', () => {
  const found = offenders(flowSources());
  assert.equal(found.length, 0, refusal(found));
});
