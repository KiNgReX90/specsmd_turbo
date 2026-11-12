'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { tempDir } = require('./test-temp.cjs');
const { writeFile } = require('./test-write.cjs');
const { parseYaml } = require('./run-yaml.cjs');
const lib = require('./run-lib.cjs');
const table = require('./run-tools-table.cjs');

const RUN = path.join(__dirname, 'run.cjs');
const CONFIG = '.specs-inferno/config.yaml';
const SHELLCHECK = "git ls-files -z '*.sh' '*.bash' | xargs -0 shellcheck -f gcc";
const RUFF = 'ruff check . --output-format concise';

// The host's config before the step: comments, other keys and a check of its own that the step must leave as they are.
const BEFORE = [
  '# Acme Shop: the gift card service.',
  'models:',
  '  strong: claude-opus-5-5   # the strong tier',
  '',
  'verification:',
  '  finalize:',
  '    - npm test',
  '  integrate:',
  '    - npm run check',
  '',
  'dispatch:',
  '  constraints:',
  '    - "Builds run bare on this machine."',
  '',
].join('\n');

function write(tree, file, body) {
  fs.mkdirSync(path.dirname(path.join(tree, file)), { recursive: true });
  writeFile(path.join(tree, file), body);
}

function git(tree, ...args) {
  return execFileSync('git', args, { cwd: tree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * An invented host with two languages, shell and Python, and a bin dir that holds git and the
 * fake tools `installed` names, each printing its version as the real one does. PATH is that dir
 * alone, so a tool this machine happens to have never reads as installed here.
 */
function fixture(t, { installed = ['ast-grep', 'shellcheck', 'ruff'], config = BEFORE } = {}) {
  const dir = tempDir('inferno-tools-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tree = path.join(dir, 'shop');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(tree);
  fs.mkdirSync(bin);
  fs.symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), path.join(bin, 'git'));
  const versions = { 'ast-grep': 'ast-grep 0.39.0', shellcheck: 'ShellCheck - shell script analysis tool\\nversion: 0.10.0', ruff: 'ruff 0.6.9' };
  for (const tool of installed) {
    write(bin, tool, `#!/bin/sh\nprintf '${versions[tool]}\\n'\n`);
    fs.chmodSync(path.join(bin, tool), 0o755);
  }
  git(tree, 'init', '-q', '-b', 'main');
  for (const name of ['deploy', 'backup', 'seed', 'rotate']) write(tree, `scripts/${name}.sh`, '#!/bin/sh\necho ok\n');
  for (const name of ['cards', 'balance', 'refund']) write(tree, `service/${name}.py`, 'print("ok")\n');
  write(tree, 'pyproject.toml', '[project]\nname = "gift-cards"\n');
  write(tree, 'README.md', '# Gift cards\n');
  if (config !== null) write(tree, CONFIG, config);
  git(tree, 'add', '-A');
  return { tree, bin };
}

function run(f, ...args) {
  const result = spawnSync(process.execPath, [RUN, 'tools', ...args], {
    cwd: f.tree, encoding: 'utf8', env: { ...process.env, PATH: f.bin },
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const line = (out, id) => out.split('\n').find((entry) => entry.startsWith(`${id}: `));
const readConfig = (f) => fs.readFileSync(path.join(f.tree, CONFIG), 'utf8');

test('a host with two languages gets a search line for the reading roles and one lint per kind of file', (t) => {
  const f = fixture(t);
  const { code, out, err } = run(f);
  assert.equal(code, 0, err);
  assert.match(line(out, 'stack'), /\.sh 4, \.py 3/);
  assert.match(line(out, 'stack'), /manifests: pyproject\.toml/);
  const search = line(out, 'search');
  assert.match(search, /ast-grep for the reading roles/);
  assert.match(search, /dispatch\.constraints/);
  assert.match(search, /bash, python/);
  assert.match(search, /ast-grep 0\.39\.0 on this machine/);
  assert.match(line(out, 'shellcheck'), /lint for 4 shell scripts: verification\.integrate/);
  assert.ok(line(out, 'shellcheck').includes(SHELLCHECK));
  assert.match(line(out, 'shellcheck'), /scoped to \*\*\/\*\.sh, \*\*\/\*\.bash/);
  assert.match(line(out, 'ruff'), /lint for 3 Python files: verification\.integrate/);
  assert.equal(line(out, 'actionlint'), undefined, 'no workflow, no workflow lint');
  assert.equal(line(out, 'tsc'), undefined, 'no JavaScript, no tsc');
  assert.match(out, /^not proposed: a language server per agent: .* GB of memory free$/m);
  assert.match(out, /^not proposed: a formatter: /m);
  assert.doesNotMatch(out, /cargo-nextest/, 'no Cargo.toml, no word on a Rust test runner');
  assert.equal(line(out, 'tools'), 'tools: ast-grep 0.39.0, ruff 0.6.9, shellcheck 0.10.0');
  assert.equal(line(out, 'missing'), undefined);
  assert.equal(readConfig(f), BEFORE, 'proposing writes nothing');
});

test('accepting writes each accepted line in place and nothing the owner declined', (t) => {
  const f = fixture(t);
  const { code, out, err } = run(f, '--write', 'search,shellcheck');
  assert.equal(code, 0, err);
  assert.match(out, /^written: search to dispatch\.constraints$/m);
  assert.match(out, /^written: shellcheck to verification\.integrate, scoped to \*\*\/\*\.sh, \*\*\/\*\.bash$/m);
  const text = readConfig(f);
  assert.doesNotMatch(text, /ruff/, 'the declined lint is written nowhere');
  const config = parseYaml(text);
  assert.deepEqual(config.verification.integrate, ['npm run check', SHELLCHECK]);
  assert.deepEqual(config.verification.finalize_scopes, { [SHELLCHECK]: ['**/*.sh', '**/*.bash'] });
  assert.deepEqual(config.verification.finalize, ['npm test']);
  assert.equal(config.dispatch.constraints.length, 2);
  assert.equal(config.dispatch.constraints[0], 'Builds run bare on this machine.');
  assert.match(config.dispatch.constraints[1], /^Reading roles: search code by its structure with ast-grep .* bash, python\.$/);
  assert.deepEqual(config.dispatch.tools, { 'ast-grep': '0.39.0', shellcheck: '0.10.0' });
  assert.equal(config.models.strong, 'claude-opus-5-5');
  // Every line the host wrote stays, in its order and as written: the step only adds lines.
  const kept = text.split('\n').filter((entry) => BEFORE.split('\n').includes(entry));
  assert.deepEqual(kept.filter(Boolean), BEFORE.split('\n').filter(Boolean));
  // The scoped check is one integrate reads: the config is valid and the scope keys a command it runs.
  assert.doesNotThrow(() => lib.readConfig(f.tree));
});

test('a config that already holds the check is not given it twice', (t) => {
  const f = fixture(t);
  assert.equal(run(f, '--write', 'shellcheck').code, 0);
  const once = readConfig(f);
  assert.match(line(run(f).out, 'shellcheck'), /already in the config$/);
  const again = run(f, '--write', 'shellcheck');
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /^already in the config: shellcheck$/m);
  assert.equal(readConfig(f), once, 'a second accept changes no byte');

  // A host that wrote the check by hand, without a scope, keeps it exactly as it wrote it.
  const own = fixture(t, { config: `verification:\n  integrate:\n    - ${RUFF}\n` });
  assert.match(line(run(own).out, 'ruff'), /already in the config$/);
  assert.equal(run(own, '--write', 'ruff').code, 0);
  assert.deepEqual(parseYaml(readConfig(own)).verification, { integrate: [RUFF] });
});

test('a tool this machine lacks gets the line that says so, and is not written', (t) => {
  const f = fixture(t, { installed: ['ast-grep', 'shellcheck'] });
  const { code, out } = run(f);
  assert.equal(code, 0);
  assert.match(line(out, 'ruff'), /ruff missing on this machine$/);
  assert.equal(line(out, 'tools'), 'tools: ast-grep 0.39.0, ruff missing, shellcheck 0.10.0');
  assert.equal(line(out, 'missing'), 'missing: ruff is not on this machine');
  const refused = run(f, '--write', 'shellcheck,ruff');
  assert.equal(refused.code, 2);
  assert.match(refused.err, /ruff is not on this machine/);
  assert.equal(readConfig(f), BEFORE, 'a refused accept writes nothing, not even the installed lint');
});

test('a recorded tool another machine lacks gets its missing line on this one', (t) => {
  const f = fixture(t);
  assert.equal(run(f, '--write', 'search,shellcheck').code, 0);
  fs.rmSync(path.join(f.bin, 'shellcheck'));
  const { out } = run(f);
  assert.equal(line(out, 'missing'), 'missing: shellcheck is not on this machine');
  assert.equal(line(out, 'tools'), 'tools: ast-grep 0.39.0, ruff 0.6.9, shellcheck 0.10.0 recorded, missing');
});

test('a host with no config gets one holding only the accepted lines', (t) => {
  const f = fixture(t, { config: null });
  assert.equal(run(f, '--write', 'ruff').code, 0);
  assert.deepEqual(parseYaml(readConfig(f)), {
    verification: { integrate: [RUFF], finalize_scopes: { [RUFF]: ['**/*.py'] } },
    dispatch: { tools: { ruff: '0.6.9' } },
  });
});

test('the accept writes the --config file it names, and only that file', (t) => {
  const f = fixture(t);
  write(f.tree, '.specs-inferno/config.codex.yaml', 'host: codex\n');
  assert.equal(run(f, '--write', 'ruff', '--config', '.specs-inferno/config.codex.yaml').code, 0);
  assert.equal(readConfig(f), BEFORE);
  const codex = parseYaml(fs.readFileSync(path.join(f.tree, '.specs-inferno/config.codex.yaml'), 'utf8'));
  assert.equal(codex.host, 'codex');
  assert.deepEqual(codex.verification.integrate, [RUFF]);
});

test('an unknown id, a refused shape and a bad tools list each write nothing', (t) => {
  const f = fixture(t);
  const unknown = run(f, '--write', 'search,eslint');
  assert.equal(unknown.code, 1);
  assert.match(unknown.err, /eslint is no proposal here: accept one of search, shellcheck, ruff/);
  assert.equal(readConfig(f), BEFORE);

  const inline = fixture(t, { config: 'verification:\n  integrate: [npm run check]\n' });
  const flow = run(inline, '--write', 'ruff');
  assert.equal(flow.code, 2);
  assert.match(flow.err, /verification\.integrate in .* is written inline: write it as a block, one entry per line/);
  assert.equal(readConfig(inline), 'verification:\n  integrate: [npm run check]\n');

  const bad = fixture(t, { config: 'dispatch:\n  tools: [ruff]\n' });
  const refused = run(bad);
  assert.equal(refused.code, 2);
  assert.match(refused.err, /BAD_CONFIG.*dispatch\.tools in .* must be a map of tool name to version, as shellcheck: "0\.10\.0"/);
});

test('every lint of the table keys its scope and names its files', () => {
  const ids = [table.SEARCH.id, ...table.LINTS.map((lint) => lint.id)];
  assert.equal(new Set(ids).size, ids.length, 'one id per proposal');
  for (const lint of table.LINTS) {
    assert.doesNotMatch(lint.run, /"/, `${lint.id}: a double quote cannot key its scope`);
    assert.ok(lint.globs === null || lint.globs.length > 0, lint.id);
    assert.ok(lint.bin && lint.kind, lint.id);
  }
});

test('a kind with fewer tracked files than the table asks for gets no lint, only its not proposed line', (t) => {
  const f = fixture(t);
  git(f.tree, 'rm', '-q', '--cached', 'service/refund.py');
  const { code, out } = run(f);
  assert.equal(code, 0);
  assert.equal(line(out, 'ruff'), undefined);
  assert.match(out, /^not proposed: ruff: 2 Python files, fewer than 3$/m);
  assert.equal(run(f, '--write', 'ruff').code, 1, 'a kind left out is no proposal to write');
});

test('the lint of the host\'s own ast-grep rules is proposed only where its rule config is tracked', (t) => {
  const f = fixture(t);
  assert.equal(line(run(f).out, 'ast-grep-rules'), undefined);
  write(f.tree, 'sgconfig.yml', 'ruleDirs: [rules]\n');
  git(f.tree, 'add', 'sgconfig.yml');
  const rules = line(run(f).out, 'ast-grep-rules');
  assert.match(rules, /verification\.integrate "ast-grep scan", scoped to \*\*\/\*\.sh, \*\*\/\*\.bash, \*\*\/\*\.py;/);
});

test('two accepted proposals that share one tool record that tool once', (t) => {
  const f = fixture(t);
  write(f.tree, 'sgconfig.yml', 'ruleDirs: [rules]\n');
  git(f.tree, 'add', 'sgconfig.yml');
  const { code, err } = run(f, '--write', 'search,ast-grep-rules');
  assert.equal(code, 0, err);
  const text = readConfig(f);
  assert.equal(text.match(/^ +ast-grep: /gm).length, 1, text);
  assert.deepEqual(parseYaml(text).dispatch.tools, { 'ast-grep': '0.39.0' });
});

test('accepted lines that would change what the config already says are refused, and nothing is written', (t) => {
  // A section written twice reads as its last block, while a new entry lands in the first one.
  const twice = 'verification:\n  integrate:\n    - npm run check\nverification:\n  finalize:\n    - npm test\n';
  const f = fixture(t, { config: twice });
  const { code, err } = run(f, '--write', 'ruff');
  assert.equal(code, 2);
  assert.match(err, /the accepted lines would change what \.specs-inferno\/config\.yaml already says, so nothing was written/);
  assert.equal(readConfig(f), twice);
});
