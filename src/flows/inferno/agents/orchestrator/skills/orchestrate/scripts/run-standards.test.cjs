'use strict';

// The project's rules live in .specs-inferno/standards/, and .specs-inferno/config.yaml lists
// each file under `standards:` with the path globs it applies to. standardsFor is the one
// entry point: the builder dispatch asks it with the item's ownership.editable, and the
// quality lens with the changed paths. A host without the folder or the block runs as before.

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { tempDir } = require('./test-temp.cjs');
const { writeFile } = require('./test-write.cjs');
const { overlaps, readStandards, standardsFor } = require('./run-standards.cjs');

const BLOCK = `standards:
  - file: typescript.md
    paths: ["src/**/*.ts", "*.tsx"]
  - file: copy.md
    paths:
      - "src/copy/**"
      - docs/
  - file: architecture.md
    paths: ["**"]
`;

function write(root, file, value) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFile(path.join(root, file), value);
}

/** A project root with the config holding `config` and one rule file per name in `rules`. */
function project(t, { config = BLOCK, rules = ['typescript.md', 'copy.md', 'architecture.md'] } = {}) {
  const root = tempDir('inferno-standards-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  if (config !== null) write(root, '.specs-inferno/config.yaml', config);
  for (const name of rules) write(root, `.specs-inferno/standards/${name}`, `# ${name}\n\n## One rule\n`);
  return root;
}

const at = (name) => `.specs-inferno/standards/${name}`;

test('the standards block parses into each file with its path globs', (t) => {
  const root = project(t);
  assert.deepEqual(readStandards(root), [
    { file: at('typescript.md'), paths: ['src/**/*.ts', '*.tsx'] },
    { file: at('copy.md'), paths: ['src/copy/**', 'docs/'] },
    { file: at('architecture.md'), paths: ['**'] },
  ]);
});

test('the block config.example.yaml documents parses once it is uncommented', (t) => {
  const example = fs.readFileSync(path.join(__dirname, '../../../config.example.yaml'), 'utf8');
  const block = /^# standards:.*\n(?:#  .*\n)+/m.exec(example)[0].replace(/^# ?/gm, '').replace(/\s+#.*$/m, '');
  const root = project(t, { config: block, rules: ['typescript.md', 'copy.md'] });
  assert.deepEqual(readStandards(root).map((entry) => entry.file), [at('typescript.md'), at('copy.md')]);
  assert.deepEqual(standardsFor(root, ['src/copy/labels.ts']), [at('typescript.md'), at('copy.md')]);
});

test('the files that apply are exactly those whose globs reach a path, in the order the config lists them', (t) => {
  const root = project(t, { config: BLOCK.replace(/  - file: architecture\.md\n.*\n/, ''), rules: ['typescript.md', 'copy.md'] });
  assert.deepEqual(standardsFor(root, ['src/api/order.ts']), [at('typescript.md')]);
  assert.deepEqual(standardsFor(root, ['src/copy/labels.json', 'src/api/order.ts']), [at('typescript.md'), at('copy.md')]);
  assert.deepEqual(standardsFor(root, ['web/Card.tsx']), [at('typescript.md')]);
  assert.deepEqual(standardsFor(root, ['docs/guide/start.md']), [at('copy.md')]);
  assert.deepEqual(standardsFor(root, ['scripts/build.sh', 'README.md']), []);
  assert.deepEqual(standardsFor(root, []), []);
});

test('an ownership glob takes every file whose globs could match a path it covers, and no other', (t) => {
  const root = project(t, { config: BLOCK.replace(/  - file: architecture\.md\n.*\n/, ''), rules: ['typescript.md', 'copy.md'] });
  assert.deepEqual(standardsFor(root, ['src/api/**']), [at('typescript.md')]);
  assert.deepEqual(standardsFor(root, ['src/**']), [at('typescript.md'), at('copy.md')]);
  assert.deepEqual(standardsFor(root, ['src/api/*.ts']), [at('typescript.md')]);
  assert.deepEqual(standardsFor(root, ['src/api/*.json']), []);
  assert.deepEqual(standardsFor(root, ['docs/**/*.md']), [at('copy.md')]);
  assert.deepEqual(standardsFor(root, ['scripts/*.sh', 'scripts/**/*.json']), []);
  // A rule on a name at any depth reaches into every folder a glob covers.
  assert.deepEqual(standardsFor(root, ['scripts/**']), [at('typescript.md')]);
  assert.deepEqual(standardsFor(root, ['web/**/*.tsx']), [at('typescript.md')]);
  assert.deepEqual(standardsFor(root, ['**/*.tsx']), [at('typescript.md'), at('copy.md')]);
});

test('a host without the folder or without the block gets no file and no failure', (t) => {
  assert.deepEqual(standardsFor(project(t, { rules: [] }), ['src/a.ts']), []);
  assert.deepEqual(standardsFor(project(t, { config: null }), ['src/a.ts']), []);
  assert.deepEqual(standardsFor(project(t, { config: 'verification:\n  finalize:\n    - echo ok\n' }), ['src/a.ts']), []);
  assert.deepEqual(standardsFor(project(t, { config: null, rules: [] }), ['src/a.ts']), []);
});

test('a listed file that does not exist is an error that names it', (t) => {
  const root = project(t, { rules: ['typescript.md', 'architecture.md'] });
  assert.throws(() => standardsFor(root, ['scripts/build.sh']), (error) => {
    assert.match(error.message, /\.specs-inferno\/standards\/copy\.md/);
    assert.match(error.message, /does not exist/);
    return true;
  });
});

test('an entry the block cannot use is refused with its reason', (t) => {
  const refused = (config, reason) => assert.throws(() => standardsFor(project(t, { config }), ['src/a.ts']), reason);
  refused('standards:\n  - file: typescript.md\n', /typescript\.md[\s\S]*paths/);
  refused('standards:\n  - file: typescript.md\n    paths: []\n', /typescript\.md[\s\S]*paths/);
  refused('standards:\n  - paths: ["src/**"]\n', /file/);
  refused('standards:\n  - file: /etc/rules.md\n    paths: ["src/**"]\n', /\/etc\/rules\.md/);
  refused('standards: typescript.md\n', /standards/);
});

test('a file that climbs out of the standards folder is refused by name, even when the file it reaches exists', (t) => {
  // config.yaml sits one folder up, so only the refusal of the climb stops it, never the check that the file exists.
  for (const name of ['../config.yaml', 'a/../../config.yaml', '..']) {
    const root = project(t, { config: `standards:\n  - file: ${name}\n    paths: ["src/**"]\n` });
    const named = new RegExp(`needs a file inside \\.specs-inferno/standards/, not ${name.replace(/[./]/g, '\\$&')}$`);
    assert.throws(() => readStandards(root), named);
    assert.throws(() => standardsFor(root, ['src/a.ts']), named);
  }
});

test('a single star or a question mark never reaches across a slash when two globs are compared', () => {
  // Each pair shares a path only if a star or a question mark could stand for a slash.
  assert.equal(overlaps('src/*', 'src/api/*.ts'), false);
  assert.equal(overlaps('src/api/*.ts', 'src/*'), false);
  assert.equal(overlaps('src/a?b/*', 'src/a/b/*'), false);
  // Beside them, pairs that do share a path.
  assert.equal(overlaps('src/*', 'src/*.ts'), true);
  assert.equal(overlaps('src/**', 'src/api/*.ts'), true);
  assert.equal(overlaps('src/a?b/*', 'src/a-b/*'), true);
});

test('a host config without the block takes the block of config.yaml, and one with its own block keeps it', (t) => {
  const root = project(t);
  write(root, '.specs-inferno/config.codex.yaml', 'host: codex\n');
  assert.deepEqual(standardsFor(root, ['web/Card.tsx'], { config: '.specs-inferno/config.codex.yaml' }),
    [at('typescript.md'), at('architecture.md')]);
  write(root, '.specs-inferno/config.codex.yaml', 'host: codex\nstandards:\n  - file: copy.md\n    paths: ["**"]\n');
  assert.deepEqual(standardsFor(root, ['web/Card.tsx'], { config: '.specs-inferno/config.codex.yaml' }), [at('copy.md')]);
});

// The builder dispatch: dispatch-log names the files that apply to the item's ownership.editable.

function git(tree, ...args) {
  return execFileSync('git', args, { cwd: tree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function repository(t, files) {
  const dir = tempDir('inferno-standards-dispatch-');
  const tree = path.join(dir, 'app');
  fs.mkdirSync(tree);
  const old = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = path.join(dir, 'cache');
  t.after(() => {
    if (old === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = old;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  git(tree, 'init', '-q', '-b', 'main');
  git(tree, 'config', 'user.name', 'Fixture');
  git(tree, 'config', 'user.email', 'fixture@example.test');
  const item = (id, editable) => [`.specs-inferno/intents/shop/work-items/${id}.md`,
    `---\nid: ${id}\n---\n\n## Execution Manifest\n\nownership:\n  editable: [${editable.join(', ')}]\n`];
  for (const [file, value] of [
    ['src/api/order.ts', 'export {};\n'],
    ['.specs-inferno/state.yaml', 'intents: []\n'],
    item('cards', ['src/api/order.ts', 'src/api/card.ts']),
    item('scripts', ['scripts/release.sh']),
    ...Object.entries(files),
  ]) write(tree, file, value);
  git(tree, 'add', '-A');
  git(tree, 'commit', '-qm', 'fixture');
  return tree;
}

function dispatchLog(tree, item, extra = {}) {
  const intents = require('./run-intents.cjs');
  return intents.dispatchLog('shop', { cwd: tree, tree, item, tier: 'strong', agent: 'builder', dispatch_id: `dispatch-${item}`, ...extra });
}

test('the builder dispatch names exactly the standards files that apply to the item\'s editable paths', (t) => {
  const tree = repository(t, {
    '.specs-inferno/config.yaml': 'standards:\n  - file: typescript.md\n    paths: ["src/**/*.ts"]\n  - file: copy.md\n    paths: ["src/copy/**"]\n',
    '.specs-inferno/standards/typescript.md': '# TypeScript\n',
    '.specs-inferno/standards/copy.md': '# Copy\n',
  });
  const cards = dispatchLog(tree, 'cards');
  assert.deepEqual(cards.out.filter((line) => line.startsWith('standards ')), ['standards .specs-inferno/standards/typescript.md']);
  const scripts = dispatchLog(tree, 'scripts');
  assert.deepEqual(scripts.out.filter((line) => line.startsWith('standards')), []);
});

test('a dispatch on a host without the standards folder prints what it printed before and records the dispatch', (t) => {
  const tree = repository(t, {});
  const result = dispatchLog(tree, 'cards');
  assert.equal(result.exit, 0);
  assert.deepEqual(result.out.map((line) => line.split(' ')[0]), ['logged', 'dispatch']);
});

test('a dispatch whose config lists a missing standards file is refused before it records anything', (t) => {
  const tree = repository(t, {
    '.specs-inferno/config.yaml': 'standards:\n  - file: typescript.md\n    paths: ["src/**/*.ts"]\n  - file: gone.md\n    paths: ["docs/**"]\n',
    '.specs-inferno/standards/typescript.md': '# TypeScript\n',
  });
  assert.throws(() => dispatchLog(tree, 'cards'), /\.specs-inferno\/standards\/gone\.md/);
  assert.equal(require('./run-dispatch.cjs').currentRecords(tree).length, 0);
});

test('a Codex dispatch reads the block through the config it was given', (t) => {
  const tree = repository(t, {
    '.specs-inferno/config.codex.yaml': 'host: codex\nstandards:\n  - file: typescript.md\n    paths: ["src/**"]\n',
    '.specs-inferno/standards/typescript.md': '# TypeScript\n',
  });
  const result = dispatchLog(tree, 'cards', { config: '.specs-inferno/config.codex.yaml' });
  assert.deepEqual(result.out.filter((line) => line.startsWith('standards ')), ['standards .specs-inferno/standards/typescript.md']);
});
