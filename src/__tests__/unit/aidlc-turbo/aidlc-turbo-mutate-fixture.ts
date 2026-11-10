/**
 * Shared fixture of the story-mutate tests of the AI-DLC Turbo flow: a git
 * project with the auth intent, `check.js` with one narrow check per name,
 * story 001 built in the project tree and verified, and helpers to run
 * story-mutate.cjs through its CLI or its function.
 */

import { expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

export const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
export const SCRIPT = path.join(FLOW, 'scripts/story-mutate.cjs');
const { mutateStory } = req(SCRIPT);
const { verifyStory } = req(path.join(FLOW, 'scripts/story-verify.cjs'));

export const bases: string[] = [];

export const INTENT_BRANCH = 'shop/intent-auth/intent';

/** `node check.js <name>`: one narrow check against src/calc.js. */
export const CHECK_JS = [
  "const fs = require('fs');",
  "const name = process.argv[2];",
  "const calc = () => require('./src/calc.js');",
  "const say = (ok) => { console.log(ok ? ' Tests  1 passed (1)' : ' Tests  1 failed (1)'); process.exit(ok ? 0 : 1); };",
  "if (name === 'add') say(calc().add(2, 3) === 5);",
  "if (name === 'mul') say(calc().mul(2, 3) === 6);",
  "if (name === 'weak') say(true);",
  "if (name === 'quiet') process.exit(calc().add(2, 3) === 5 ? 0 : 1);",
  "if (name === 'none') { console.log(' Tests  0 passed (0)'); process.exit(0); }",
  "if (name === 'red') say(false);",
  "if (name === 'hang') { if (calc().add(2, 3) !== 5) for (;;) {} say(true); }",
  "if (name === 'neg') say(require('./src/neg.js').neg(2) === -2);",
  "if (name === 'crlf') say(!fs.readFileSync('src/crlf.txt', 'utf8').includes('1 - 1'));",
  "if (name === 'slow') { if (calc().add(2, 3) !== 5) { fs.writeFileSync('../started.txt', ''); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500); } say(calc().add(2, 3) === 5); }",
  "if (name === 'write') { fs.appendFileSync('src/other.txt', 'run\\n'); say(calc().add(2, 3) === 5); }",
  "console.log('unknown check'); process.exit(3);",
].join('\n');

export const CALC_HEAD = 'exports.base = 1;\n';
export const CALC_STORY = 'exports.base = 1;\nexports.add = (a, b) => a + b;\nexports.mul = (a, b) => a * b;\n';

/** A git project with the auth intent, in either mode; buildAndVerify builds story 001 in the project tree. */
export function project(mode = 'production', verification = ['node check.js add', 'cd src && node ../check.js add']) {
  const base = mkdtempSync(path.join(tmpdir(), 'turbo-mutate-'));
  bases.push(base);
  const app = path.join(base, 'app');
  const specs = path.join(app, '.specs-aidlc-turbo');
  const intent = path.join(specs, 'docs/auth/auth');
  mkdirSync(path.join(intent, 'stories'), { recursive: true });
  mkdirSync(path.join(specs, 'repo'), { recursive: true });
  writeFileSync(path.join(specs, 'repo/config.yaml'),
    `mode: ${mode}\nbranching:\n  project_key: shop\n  story_branches: false\n`);
  writeFileSync(path.join(intent, 'brief.md'), [
    '---', 'id: auth', 'status: building', `branch: ${INTENT_BRANCH}`, '---', '',
    '## Verification', '', ...verification.map((c) => `- \`${c}\``), '',
  ].join('\n'));
  writeFileSync(path.join(intent, 'stories/001-login.md'),
    '---\nid: "001"\ntitle: Login\nstatus: todo\ndepends_on: []\ncommit: null\nbranch: null\n---\n\n# S001\n');
  mkdirSync(path.join(app, 'src'));
  writeFileSync(path.join(app, 'src/calc.js'), CALC_HEAD);
  writeFileSync(path.join(app, 'src/other.txt'), 'other\n');
  writeFileSync(path.join(app, 'src/calc.test.js'), "it('x', () => {});\n");
  writeFileSync(path.join(app, 'check.js'), CHECK_JS);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: app, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', '/dev/null');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  git('switch', '-q', '-c', INTENT_BRANCH);
  const proofFile = path.join(intent, 'proof/001.json');
  return { base, app, git, proofFile, proof: () => JSON.parse(readFileSync(proofFile, 'utf8')) };
}

export type P = ReturnType<typeof project>;

/** The story writes its code in the project tree and story-verify proves it. */
export function buildAndVerify(p: P, files: Record<string, string> = { 'src/calc.js': CALC_STORY }) {
  for (const [f, text] of Object.entries(files)) writeFileSync(path.join(p.app, f), text);
  const v = verifyStory({ intentSlug: 'auth', storyId: '001', codeRoot: '.', cwd: p.app });
  expect(v.error).toBeUndefined();
  expect(v.proof.passed).toBe(true);
}

export const M = (id: string, extra: Record<string, unknown>) => ({
  id, file: 'src/calc.js', line: 2, from: 'a + b', to: 'a - b', test: 'node check.js add', criterion: 'AC-1', ...extra,
});

export function mutantsFile(p: P, mutants: unknown) {
  const file = path.join(p.base, 'mutants.json');
  writeFileSync(file, typeof mutants === 'string' ? mutants : JSON.stringify(mutants));
  return file;
}

export const run = (p: P, mutants: unknown, ...extra: string[]) => spawnSync('node',
  [SCRIPT, 'auth', '001', '--code-root', '.', '--mutants', mutantsFile(p, mutants), ...extra],
  { cwd: p.app, encoding: 'utf8' });

export const mutate = (p: P, mutants: unknown[], extra: Record<string, unknown> = {}) =>
  mutateStory({ intentSlug: 'auth', storyId: '001', codeRoot: '.', mutants, cwd: p.app, ...extra });

