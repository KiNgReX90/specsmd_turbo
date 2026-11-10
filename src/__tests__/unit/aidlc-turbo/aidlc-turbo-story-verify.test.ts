/**
 * Unit tests for story-verify.cjs of the AI-DLC Turbo flow.
 *
 * The proof is the evidence the reviewer and story-land.cjs trust, so the
 * builder never writes it:
 * - `git add -N .` first, so `git diff HEAD` shows new files, then the diff hash;
 * - every verification command of the brief in the code root, with a timeout;
 *   the first failure stops the run, the rest are skipped;
 * - proof/{SSS}.json with per command the exit, seconds, parsed counts and a
 *   40-line tail, never the full output;
 * - one summary line, exit 1 when a command fails;
 * - sandbox mode is production here too: the same diff hash and tests_changed;
 * - tests_changed: the existing test files the story modified or deleted, and
 *   every added line that switches a test off, which fails the proof.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const SCRIPT = path.join(FLOW, 'scripts/story-verify.cjs');
const verify = createRequire(import.meta.url)(SCRIPT);

const bases: string[] = [];
afterAll(() => bases.forEach((d) => rmSync(d, { recursive: true, force: true })));

const TEST_JS = [
  "const fs = require('fs');",
  "const bad = fs.readFileSync('src/app.txt', 'utf8').includes('BAD');",
  "for (let i = 0; i < 100; i += 1) console.log('noise ' + i);",
  "console.log(bad ? ' Tests  1 failed | 2 passed (3)' : ' Tests  3 passed (3)');",
  'process.exit(bad ? 1 : 0);',
].join('\n');

/** A git project with the auth intent, in either mode. */
function project(commands: string[], mode = 'production', files: Record<string, string> = {}) {
  const base = mkdtempSync(path.join(tmpdir(), 'turbo-verify-'));
  bases.push(base);
  const app = path.join(base, 'app');
  const intent = path.join(app, '.specs-aidlc-turbo/docs/auth/auth');
  mkdirSync(path.join(intent, 'stories'), { recursive: true });
  mkdirSync(path.join(app, '.specs-aidlc-turbo/repo'), { recursive: true });
  writeFileSync(path.join(app, '.specs-aidlc-turbo/repo/config.yaml'), `mode: ${mode}\n`);
  writeFileSync(path.join(intent, 'brief.md'), [
    '---', 'id: auth', 'status: building', '---', '', '## Verification', '',
    ...commands.map((c) => `- \`${c}\``), '',
  ].join('\n'));
  writeFileSync(path.join(intent, 'stories/001-login.md'), '---\nid: "001"\ntitle: Login\nstatus: building\n---\n');
  mkdirSync(path.join(app, 'src'));
  writeFileSync(path.join(app, 'src/app.txt'), 'good\n');
  writeFileSync(path.join(app, 'test.js'), TEST_JS);
  for (const [f, text] of Object.entries(files)) put(app, f, text);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: app, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'Test');
  git('add', '-A');
  git('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
  return { app, proof: path.join(intent, 'proof/001.json') };
}

/** Write one file, creating its folder. */
function put(root: string, file: string, text: string) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

const run = (cwd: string, ...args: string[]) => spawnSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8' });

describe('aidlc-turbo story-verify', () => {
  it('passes, writes the proof with counts and a 40-line tail, and shows new files in the diff', () => {
    const p = project(['node test.js', 'node -e "process.exit(0)"']);
    writeFileSync(path.join(p.app, 'src/new.txt'), 'new\n');
    const r = run(p.app, 'auth', '1', '--code-root', '.');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('PASS 001 2/2 commands (3 passed)');
    const proof = JSON.parse(readFileSync(p.proof, 'utf8'));
    expect(proof).toMatchObject({ story: '001', code_root: p.app, passed: true });
    expect(proof.diff_sha).toMatch(/^[0-9a-f]{64}$/);
    expect(proof.finished_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(proof.commands[0]).toMatchObject({ command: 'node test.js', exit: 0, passed_count: 3, failed_count: 0 });
    expect(proof.commands[0].tail.split('\n')).toHaveLength(40);
    expect(proof.commands[1]).toMatchObject({ passed_count: null, failed_count: null });
    const diff = execFileSync('git', ['diff', 'HEAD', '--name-only'], { cwd: p.app, encoding: 'utf8' });
    expect(diff).toContain('src/new.txt');
    expect(diff).not.toContain('.specs-aidlc-turbo');
  });

  it('hashes the tree as the commands left it, so a file they rewrote is in the proof', () => {
    const p = project(["node -e \"require('fs').writeFileSync('src/app.txt', 'formatted\\n')\""]);
    const r = run(p.app, 'auth', '001', '--code-root', '.');
    expect(r.status).toBe(0);
    const proof = JSON.parse(readFileSync(p.proof, 'utf8'));
    expect(proof.diff_sha).toBe(verify.diffSha(p.app, '.specs-aidlc-turbo').sha);
  });

  it('fails on the first red command, skips the rest and exits 1', () => {
    const p = project(['node test.js', 'node -e "process.exit(0)"']);
    writeFileSync(path.join(p.app, 'src/app.txt'), 'BAD\n');
    const r = run(p.app, 'auth', '001', '--code-root', p.app);
    expect(r.status).toBe(1);
    expect(r.stdout.trim()).toBe('FAIL 001 0/2 commands (2 passed, 1 failed)');
    expect(r.stdout).not.toContain('noise');
    const proof = JSON.parse(readFileSync(p.proof, 'utf8'));
    expect(proof.passed).toBe(false);
    expect(proof.commands[0]).toMatchObject({ exit: 1, passed_count: 2, failed_count: 1 });
    expect(proof.commands[1]).toMatchObject({ exit: null, skipped: true });
  });

  it('stops a command at the timeout', () => {
    const p = project(['node -e "setTimeout(() => {}, 20000)"']);
    const out = verify.verifyStory({ intentSlug: 'auth', storyId: '001', codeRoot: '.', timeout: 1, cwd: p.app });
    expect(out.proof.commands[0]).toMatchObject({ exit: 124, timed_out: true });
    expect(out.line).toBe('FAIL 001 0/1 commands');
  });

  it('kills the whole command at the timeout, not just its shell', () => {
    const p = project(["node -e \"require('fs').writeFileSync('pid.txt', String(process.pid)); setInterval(() => {}, 1000)\""]);
    const out = verify.verifyStory({ intentSlug: 'auth', storyId: '001', codeRoot: '.', timeout: 1, cwd: p.app });
    expect(out.proof.commands[0]).toMatchObject({ exit: 124, timed_out: true });
    const pid = Number(readFileSync(path.join(p.app, 'pid.txt'), 'utf8'));
    const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const until = Date.now() + 3000;
    while (alive() && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    const left = alive();
    if (left) process.kill(pid, 'SIGKILL');
    expect(left).toBe(false);
  });

  it('hashes the diff in sandbox mode as in production', () => {
    const p = project(['node test.js'], 'sandbox');
    writeFileSync(path.join(p.app, 'src/new.txt'), 'new\n');
    const r = run(p.app, 'auth', '001', '--code-root', '.');
    expect(r.status).toBe(0);
    const proof = JSON.parse(readFileSync(p.proof, 'utf8'));
    expect(proof.diff_sha).toBe(verify.diffSha(p.app, '.specs-aidlc-turbo').sha);
    expect(proof.tests_changed).toEqual({ modified: [], deleted: [], switched_off: [] });
  });

  it('needs git in sandbox mode too', () => {
    const p = project(['node test.js'], 'sandbox');
    rmSync(path.join(p.app, '.git'), { recursive: true, force: true });
    // Never let git find a repository above the temp project.
    const saved = process.env.GIT_CEILING_DIRECTORIES;
    process.env.GIT_CEILING_DIRECTORIES = path.dirname(p.app);
    let out;
    try {
      out = verify.verifyStory({ intentSlug: 'auth', storyId: '001', codeRoot: '.', cwd: p.app });
    } finally {
      if (saved === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = saved;
    }
    expect(out.error).toContain('git add -N failed');
    expect(existsSync(p.proof)).toBe(false);
  });

  it('runs the full verification at finish as story "intent"', () => {
    const p = project(['node test.js']);
    const r = run(p.app, 'auth', 'intent', '--code-root', '.');
    expect(r.stdout.trim()).toBe('PASS intent 1/1 commands (3 passed)');
    expect(JSON.parse(readFileSync(path.join(path.dirname(p.proof), 'intent.json'), 'utf8')).story).toBe('intent');
  });

  it('exits 2 without a code root', () => {
    const p = project(['node test.js'], 'sandbox');
    expect(run(p.app, 'auth', '001').status).toBe(2);
  });
});

describe('aidlc-turbo story-verify counts', () => {
  it.each([
    ['vitest', '\x1b[2m Tests \x1b[22m 1 failed | 13 passed (14)', 13, 1],
    ['jest', 'Tests:       1 failed, 13 passed, 14 total', 13, 1],
    ['mocha', '  14 passing (20ms)\n  2 failing', 14, 2],
    ['pytest', '===== 13 passed, 1 failed, 2 warnings in 0.52s =====', 13, 1],
    ['pytest -q', '13 passed in 0.10s', 13, 0],
    ['go test -v', '--- PASS: TestA (0.00s)\n--- PASS: TestB (0.00s)\n--- FAIL: TestC (0.00s)\nFAIL', 2, 1],
    ['dotnet', 'Passed!  - Failed:     0, Passed:    14, Skipped:     0, Total:    14\nFailed!  - Failed:     1, Passed:     2, Skipped:     0, Total:     3', 16, 1],
    ['phpunit ok', 'OK (14 tests, 30 assertions)', 14, 0],
    ['phpunit failed', 'Tests: 14, Assertions: 30, Errors: 1, Failures: 2.', 11, 3],
    ['maven', 'Tests run: 3, Failures: 0, Errors: 0, Skipped: 0\nResults:\nTests run: 14, Failures: 1, Errors: 0, Skipped: 1', 12, 1],
  ])('%s', (_name, output, passed, failed) => {
    expect(verify.parseCounts(output)).toEqual({ passed, failed });
  });

  it('leaves the counts null when nothing is obvious', () => {
    expect(verify.parseCounts('ok  \texample.com/pkg\t0.01s\nBUILD SUCCESS')).toEqual({ passed: null, failed: null });
  });
});

describe('aidlc-turbo story-verify tests_changed', () => {
  const EXISTING = {
    'src/__tests__/login.test.ts': "it('logs in', () => {\n  expect(1).toBe(1);\n});\n",
    'src/__tests__/old.test.ts': "it('old', () => {});\n",
    'src/__tests__/kept.test.ts': "it.skip('was already off', () => {});\n",
    'src/test/java/LoginTest.java': 'class LoginTest {\n  @Test\n  void logsIn() {}\n}\n',
  };

  it('lists modified and deleted existing tests, not an added one, and passes without a switch-off', () => {
    const p = project(['node test.js'], 'production', EXISTING);
    put(p.app, 'src/__tests__/login.test.ts', "it('logs in', () => {\n  expect(2).toBe(2);\n});\n");
    rmSync(path.join(p.app, 'src/__tests__/old.test.ts'));
    put(p.app, 'src/__tests__/new.test.ts', "it('new', () => {});\n");
    put(p.app, 'src/app.txt', 'changed\n');
    put(p.app, '.specs-aidlc-turbo/__tests__/x.test.ts', "it.skip('artifact', () => {});\n");
    const r = run(p.app, 'auth', '001', '--code-root', '.');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('PASS 001 1/1 commands (3 passed)');
    const proof = JSON.parse(readFileSync(p.proof, 'utf8'));
    expect(proof.tests_changed).toEqual({
      modified: ['src/__tests__/login.test.ts'],
      deleted: ['src/__tests__/old.test.ts'],
      switched_off: [],
    });
  });

  it('fails on an added .skip( and @Disabled, also in a new test file, but not on one already there', () => {
    const p = project(['node test.js'], 'production', EXISTING);
    put(p.app, 'src/__tests__/login.test.ts', "it.skip('logs in', () => {\n  expect(1).toBe(1);\n});\n");
    put(p.app, 'src/__tests__/kept.test.ts', "it.skip('was already off', () => {});\nit('more', () => {});\n");
    put(p.app, 'src/test/java/LoginTest.java', 'class LoginTest {\n  @Test\n  @Disabled("flaky")\n  void logsIn() {}\n}\n');
    put(p.app, 'src/__tests__/new.test.ts', "it('a', () => {});\nxit('b', () => {});\n");
    put(p.app, 'src/app.ts', "it.skip('not a test file', () => {});\n");
    const r = run(p.app, 'auth', '001', '--code-root', '.');
    expect(r.status).toBe(1);
    expect(r.stdout.trim().split('\n')).toEqual([
      'FAIL 001 1/1 commands (3 passed)',
      "switched off: src/__tests__/login.test.ts:1: it.skip('logs in', () => {",
      "switched off: src/__tests__/new.test.ts:2: xit('b', () => {});",
      'switched off: src/test/java/LoginTest.java:3: @Disabled("flaky")',
    ]);
    const proof = JSON.parse(readFileSync(p.proof, 'utf8'));
    expect(proof.passed).toBe(false);
    expect(proof.tests_changed.modified).toEqual([
      'src/__tests__/kept.test.ts', 'src/__tests__/login.test.ts', 'src/test/java/LoginTest.java',
    ]);
    expect(proof.tests_changed.switched_off).toEqual([
      { file: 'src/__tests__/login.test.ts', line: 1, text: "it.skip('logs in', () => {" },
      { file: 'src/__tests__/new.test.ts', line: 2, text: "xit('b', () => {});" },
      { file: 'src/test/java/LoginTest.java', line: 3, text: '@Disabled("flaky")' },
    ]);
  });

  it('counts the Playwright folder of repo.yaml as tests', () => {
    const p = project(['node test.js'], 'production', { 'e2e/login.ts': "test('a', () => {});\n" });
    writeFileSync(path.join(p.app, '.specs-aidlc-turbo/repo/repo.yaml'),
      'codebase:\n  playwright: true\n  playwright_test_dir: "e2e"\n  commands:\n    test: null\n');
    put(p.app, 'e2e/login.ts', "test.skip('a', () => {});\n");
    const out = verify.verifyStory({ intentSlug: 'auth', storyId: '001', codeRoot: '.', cwd: p.app });
    expect(out.proof.passed).toBe(false);
    expect(out.proof.tests_changed.modified).toEqual(['e2e/login.ts']);
    expect(out.lines).toEqual(['FAIL 001 1/1 commands (3 passed)', "switched off: e2e/login.ts:1: test.skip('a', () => {});"]);
  });

  it('fails a switch-off in sandbox mode as in production', () => {
    const s = project(['node test.js'], 'sandbox', EXISTING);
    put(s.app, 'src/__tests__/login.test.ts', "it.skip('logs in', () => {});\n");
    const r = run(s.app, 'auth', '001', '--code-root', '.');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("switched off: src/__tests__/login.test.ts:1: it.skip('logs in', () => {});");
    const proof = JSON.parse(readFileSync(s.proof, 'utf8'));
    expect(proof.passed).toBe(false);
    expect(proof.tests_changed.modified).toEqual(['src/__tests__/login.test.ts']);
  });

  it('is null for the intent run', () => {
    const p = project(['node test.js'], 'production', EXISTING);
    put(p.app, 'src/__tests__/login.test.ts', "it.skip('logs in', () => {});\n");
    expect(run(p.app, 'auth', 'intent', '--code-root', '.').status).toBe(0);
    expect(JSON.parse(readFileSync(path.join(path.dirname(p.proof), 'intent.json'), 'utf8')).tests_changed).toBeNull();
  });
});
