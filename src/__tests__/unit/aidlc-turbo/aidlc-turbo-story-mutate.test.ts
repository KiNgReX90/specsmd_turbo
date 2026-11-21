/**
 * Unit tests for story-mutate.cjs of the AI-DLC Turbo flow, on throwaway projects.
 *
 * story-mutate runs the mutants the story reviewer proposed, one at a time,
 * and writes the result into the story's proof:
 * - a mutant breaks one line, its narrow test runs, the line goes back byte
 *   for byte (CRLF and a missing final newline included), also after a
 *   timeout or an exception; a failed test is killed, 0 survived (the
 *   verdict itself: aidlc-turbo-story-mutate-verdict.test.ts);
 * - invalid mutants never run: from equals to, a test file, a line the story
 *   did not add, a test that is no verification program or has shell
 *   operators, from not on its line (a moved line is found again), and a test
 *   that fails or runs no tests without the mutant (the baseline run);
 * - a leading `cd {dir} && ` is allowed in the test and in the brief;
 * - lines of a file the story added count as added (`git add -N .` first);
 * - --only updates just those entries; every other proof field stays, so
 *   story-land.cjs still lands the story;
 * - a test command that writes a tracked file is a changed diff, exit 1;
 * - a mutant with missing or mistyped fields is invalid, the rest still runs;
 * - no proof, a failed proof, no JSON array, duplicate or unknown ids: exit 1;
 * - sandbox mode runs them exactly as production does;
 * - the story's test files get a newer modification time before every run and
 *   after the last, so an incremental build compiles them again: Java copies a
 *   constant into the test class, and Maven recompiles a test only when its
 *   own source changed, so a mutated constant would otherwise survive.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, readFileSync, rmSync, existsSync, statSync, utimesSync } from 'fs';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import {
  FLOW, SCRIPT, bases, CALC_STORY, project, buildAndVerify, M, run, mutate,
} from './aidlc-turbo-mutate-fixture';

const req = createRequire(import.meta.url);
const { mutateStory } = req(SCRIPT);
const { mutateBuffer, testProgram, locate } = req(path.join(FLOW, 'scripts/lib/mutants.cjs'));
const { verifyStory } = req(path.join(FLOW, 'scripts/story-verify.cjs'));
const { startStory } = req(path.join(FLOW, 'scripts/story-start.cjs'));
const { landStory } = req(path.join(FLOW, 'scripts/story-land.cjs'));

afterAll(() => bases.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('aidlc-turbo story-mutate', () => {
  it('kills a mutant the test catches, keeps a survivor, restores the file and keeps the proof', () => {
    const p = project();
    buildAndVerify(p);
    const before = p.proof();
    const r = run(p, [
      M('M1', {}),
      M('M2', { line: 3, from: 'a * b', to: 'a + b', test: 'node check.js weak', criterion: 'AC-2' }),
      M('M3', { line: 3, from: 'a * b', to: 'a / b', test: 'cd src && node ../check.js mul' }),
    ]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual([
      'KILLED M1 src/calc.js:2',
      'SURVIVED M2 src/calc.js:3',
      'KILLED M3 src/calc.js:3',
      'MUTANTS 001 2/3 killed, 1 survived, 0 invalid',
    ]);
    expect(readFileSync(path.join(p.app, 'src/calc.js'), 'utf8')).toBe(CALC_STORY);
    const proof = p.proof();
    const { mutants, ...rest } = proof;
    expect(rest).toEqual(before);
    expect(mutants[0]).toEqual({
      id: 'M1', file: 'src/calc.js', line: 2, from: 'a + b', to: 'a - b', test: 'node check.js add',
      criterion: 'AC-1', result: 'killed', exit: 1,
    });
    expect(mutants[1]).toMatchObject({ id: 'M2', result: 'survived', exit: 0, criterion: 'AC-2' });
    expect(mutants[1]).not.toHaveProperty('reason');
  });

  it('marks every invalid mutant with its reason and never runs it', () => {
    const p = project();
    buildAndVerify(p);
    const r = run(p, [
      M('M1', { to: 'a + b' }),
      M('M2', { file: 'src/calc.test.js', line: 1, from: 'x', to: 'y' }),
      M('M3', { line: 1, from: 'base = 1', to: 'base = 2' }),
      M('M4', { test: 'npm test' }),
      M('M5', { test: 'node check.js add; rm -rf src' }),
      M('M6', { test: 'node check.js add | cat' }),
      M('M7', { test: 'node check.js $HOME' }),
      M('M8', { test: 'node check.js `id`' }),
      M('M9', { test: 'node check.js add > out.txt' }),
      M('M10', { from: 'a % b' }),
      M('M11', { from: 'b' }),
      M('M12', { file: '../outside.js' }),
      M('M13', { file: 'src/missing.js' }),
      M('M14', { test: 'cd ../.. && node check.js add' }),
      M('M15', { test: 'node check.js add\nnode check.js add' }),
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual([
      'INVALID M1 src/calc.js:2 (from equals to)',
      'INVALID M2 src/calc.test.js:1 (file is a test file)',
      'INVALID M3 src/calc.js:1 (line not added by the story)',
      'INVALID M4 src/calc.js:2 (test is not a verification program)',
      'INVALID M5 src/calc.js:2 (test has shell operators)',
      'INVALID M6 src/calc.js:2 (test has shell operators)',
      'INVALID M7 src/calc.js:2 (test has shell operators)',
      'INVALID M8 src/calc.js:2 (test has shell operators)',
      'INVALID M9 src/calc.js:2 (test has shell operators)',
      'INVALID M10 src/calc.js:2 (from not on its line)',
      'INVALID M11 src/calc.js:2 (from not on its line)',
      'INVALID M12 ../outside.js:2 (file outside the code root)',
      'INVALID M13 src/missing.js:2 (file not found)',
      'INVALID M14 src/calc.js:2 (test has shell operators)',
      'INVALID M15 src/calc.js:2 (test has shell operators)',
      'MUTANTS 001 0/0 killed, 0 survived, 15 invalid',
    ]);
    const m = p.proof().mutants;
    expect(m[0]).toMatchObject({ result: 'invalid', exit: null, reason: 'from equals to' });
    expect(readFileSync(path.join(p.app, 'src/calc.js'), 'utf8')).toBe(CALC_STORY);
  });

  it('finds a moved line again when exactly one line holds from', () => {
    const p = project();
    buildAndVerify(p);
    const r = run(p, [M('M1', { line: 9 }), M('M2', { line: 1 })]);
    expect(r.stdout.trim().split('\n')).toEqual([
      'KILLED M1 src/calc.js:2', 'KILLED M2 src/calc.js:2', 'MUTANTS 001 2/2 killed, 0 survived, 0 invalid',
    ]);
    expect(p.proof().mutants[0].line).toBe(2);
  });

  it('runs every test once without the mutant first: a red test or one that runs no tests is invalid', () => {
    const p = project();
    buildAndVerify(p);
    const r = run(p, [
      M('M1', { test: 'node check.js red' }),
      M('M2', { line: 3, from: 'a * b', to: 'a + b', test: 'node check.js red' }),
      M('M3', { test: 'node check.js none' }),
      M('M4', { test: 'node check.js quiet' }),
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual([
      'INVALID M1 src/calc.js:2 (test fails without the mutant)',
      'INVALID M2 src/calc.js:3 (test fails without the mutant)',
      'INVALID M3 src/calc.js:2 (test runs no tests)',
      'KILLED M4 src/calc.js:2',
      'MUTANTS 001 1/1 killed, 0 survived, 3 invalid',
    ]);
    expect(p.proof().mutants[0]).toMatchObject({ result: 'invalid', exit: 1, reason: 'test fails without the mutant' });
    expect(p.proof().mutants[2]).toMatchObject({ result: 'invalid', exit: 0, reason: 'test runs no tests' });
  });

  it('counts the lines of a file the story added, also when git no longer has it as intent-to-add', () => {
    const p = project(undefined, ['node check.js neg']);
    buildAndVerify(p, { 'src/neg.js': 'exports.neg = (a) => -a;\n' });
    p.git('reset', '-q', '--', 'src/neg.js');
    const r = run(p, [M('M1', { file: 'src/neg.js', line: 1, from: '-a', to: 'a', test: 'node check.js neg' })]);
    expect(r.stdout.trim().split('\n')).toEqual(['KILLED M1 src/neg.js:1', 'MUTANTS 001 1/1 killed, 0 survived, 0 invalid']);
    expect(r.status).toBe(0);
  });

  it('touches the story\'s test files so a build that compiles only changed tests still sees the mutant', async () => {
    const p = project();
    buildAndVerify(p, { 'src/calc.js': CALC_STORY, 'src/calc.test.js': "it('adds', () => {});\n" });
    const testFile = path.join(p.app, 'src/calc.test.js');
    const past = new Date('2001-01-01T00:00:00Z');
    utimesSync(testFile, past, past);
    // Like Maven's test compile: the test copies calc.js in only when its own source has a new time.
    let compiled = '';
    let seen = -1;
    const runner = () => {
      const mtime = statSync(testFile).mtimeMs;
      if (mtime !== seen) { compiled = readFileSync(path.join(p.app, 'src/calc.js'), 'utf8'); seen = mtime; }
      const ok = compiled.includes('a + b');
      return { exit: ok ? 0 : 1, passed_count: ok ? 1 : 0, failed_count: ok ? 0 : 1 };
    };
    const r = await mutate(p, [M('M1', {})], { runner });
    expect(r.lines).toEqual(['KILLED M1 src/calc.js:2', 'MUTANTS 001 1/1 killed, 0 survived, 0 invalid']);
    // Touched once more after the last run: the next build compiles the test against the restored code.
    expect(statSync(testFile).mtimeMs).toBeGreaterThan(seen);
    expect(readFileSync(path.join(p.app, 'src/calc.js'), 'utf8')).toBe(CALC_STORY);
  });

  it('restores the file and drops the marker when the test runner throws', async () => {
    const p = project();
    buildAndVerify(p);
    let calls = 0;
    const runner = () => {
      calls += 1;
      if (calls === 1) return { exit: 0, passed_count: 1, failed_count: 0 };
      expect(readFileSync(path.join(p.app, 'src/calc.js'), 'utf8')).toContain('a - b');
      throw new Error('boom');
    };
    await expect(mutate(p, [M('M1', {})], { runner })).rejects.toThrow('boom');
    expect(readFileSync(path.join(p.app, 'src/calc.js'), 'utf8')).toBe(CALC_STORY);
    expect(existsSync(p.proofFile.replace(/\.json$/, '.mutant.json'))).toBe(false);
  });

  it('--only reruns just those mutants and keeps the other entries', () => {
    const p = project();
    buildAndVerify(p);
    const mutants = [M('M1', {}), M('M2', { line: 3, from: 'a * b', to: 'a + b', test: 'node check.js weak' })];
    run(p, mutants);
    const first = p.proof().mutants;
    mutants[1].test = 'node check.js mul';
    const r = run(p, mutants, '--only', 'M2');
    expect(r.stdout.trim().split('\n')).toEqual(['KILLED M2 src/calc.js:3', 'MUTANTS 001 1/1 killed, 0 survived, 0 invalid']);
    const next = p.proof().mutants;
    expect(next[0]).toEqual(first[0]);
    expect(next[1]).toMatchObject({ id: 'M2', result: 'killed', test: 'node check.js mul' });
    expect(run(p, mutants, '--only', 'M7').status).toBe(1);
  });

  it('stops with exit 1 when a test command changed the diff', () => {
    const p = project(undefined, ['node check.js write']);
    buildAndVerify(p);
    const r = run(p, [M('M1', { test: 'node check.js write' })]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('diff changed: run story-verify.cjs again');
    expect(p.proof()).not.toHaveProperty('mutants');
  });

  it('stops with exit 1 when the diff already changed before the run', () => {
    const p = project();
    buildAndVerify(p);
    writeFileSync(path.join(p.app, 'src/other.txt'), 'changed after verify\n');
    const r = run(p, [M('M1', {})]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('diff changed: run story-verify.cjs again');
  });

  it('needs a passed proof, a JSON array and unique ids (exit 1), and the usage (exit 2)', () => {
    const p = project();
    writeFileSync(path.join(p.app, 'src/calc.js'), CALC_STORY);
    expect(run(p, [M('M1', {})]).status).toBe(1);
    buildAndVerify(p);
    expect(run(p, 'not json').status).toBe(1);
    expect(run(p, { id: 'M1' }).status).toBe(1);
    expect(run(p, [M('M1', {}), M('M1', {})]).status).toBe(1);
    const failed = { ...p.proof(), passed: false };
    writeFileSync(p.proofFile, JSON.stringify(failed));
    const r = run(p, [M('M1', {})]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('did not pass');
    expect(spawnSync('node', [SCRIPT, 'auth', '001', '--code-root', '.'], { cwd: p.app }).status).toBe(2);
  });

  it('marks a mutant with missing or mistyped fields invalid and runs the rest', () => {
    const p = project();
    buildAndVerify(p);
    const noCriterion: Record<string, unknown> = M('M1', {});
    delete noCriterion.criterion;
    const noId: Record<string, unknown> = M('x', {});
    delete noId.id;
    const r = run(p, [
      noCriterion, noId, M('M3', { line: '2' }), M('M4', { from: 5, test: ' ' }), 'M5', M('M6', {}),
    ]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual([
      'INVALID M1 src/calc.js:2 (missing criterion)',
      'INVALID #2 src/calc.js:2 (missing id)',
      'INVALID M3 src/calc.js:2 (line must be a whole number from 1)',
      'INVALID M4 src/calc.js:2 (from, test must be text)',
      'INVALID #5 ?:? (missing id, file, line, from, to, test, criterion)',
      'KILLED M6 src/calc.js:2',
      'MUTANTS 001 1/1 killed, 0 survived, 5 invalid',
    ]);
    expect(p.proof().mutants[1]).toMatchObject({ id: '#2', result: 'invalid', exit: null, reason: 'missing id' });
  });

  it('runs in sandbox mode as in production', () => {
    const p = project('sandbox', ['node check.js add']);
    buildAndVerify(p);
    const r = run(p, [M('M1', {})]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual(['KILLED M1 src/calc.js:2', 'MUTANTS 001 1/1 killed, 0 survived, 0 invalid']);
    expect(p.proof().mutants[0]).toMatchObject({ id: 'M1', result: 'killed' });
    expect(readFileSync(path.join(p.app, 'src/calc.js'), 'utf8')).toBe(CALC_STORY);
  });

  it('restores CRLF and a missing final newline byte for byte', () => {
    const p = project(undefined, ['node check.js crlf']);
    const crlf = 'first\r\nconst x = 1 + 1;\r\nlast line';
    buildAndVerify(p, { 'src/calc.js': CALC_STORY, 'src/crlf.txt': crlf });
    const r = run(p, [
      M('M1', { file: 'src/crlf.txt', line: 2, from: '1 + 1', to: '1 - 1', test: 'node check.js crlf' }),
      M('M2', { line: 3, from: 'a * b', to: 'a + b', test: 'node check.js crlf' }),
    ]);
    expect(r.stdout.trim().split('\n')).toEqual([
      'KILLED M1 src/crlf.txt:2', 'SURVIVED M2 src/calc.js:3', 'MUTANTS 001 1/2 killed, 1 survived, 0 invalid',
    ]);
    expect(r.status).toBe(0);
    expect(readFileSync(path.join(p.app, 'src/crlf.txt'))).toEqual(Buffer.from(crlf));
  });

  it('lands the story after a mutation run in its worktree', async () => {
    const p = project();
    const started = startStory({ intentSlug: 'auth', storyId: '001', cwd: p.app });
    expect(started.error).toBeUndefined();
    writeFileSync(path.join(started.worktree, 'src/calc.js'), CALC_STORY);
    const v = verifyStory({ intentSlug: 'auth', storyId: '001', codeRoot: started.worktree, cwd: p.app });
    expect(v.proof.passed).toBe(true);
    const out = await mutateStory({ intentSlug: 'auth', storyId: '001', codeRoot: started.worktree, mutants: [M('M1', {})], cwd: p.app });
    expect(out.error).toBeUndefined();
    expect(out.lines[0]).toBe('KILLED M1 src/calc.js:2');
    const landed = landStory({ intentSlug: 'auth', storyId: '001', changedFiles: 'src/calc.js', cwd: p.app });
    expect(landed.error).toBeUndefined();
    expect(p.git('show', 'HEAD~1:src/calc.js') + '\n').toBe(CALC_STORY);
    expect(existsSync(started.worktree)).toBe(false);
  });
});

describe('aidlc-turbo story-mutate helpers', () => {
  it('mutates one line and keeps CRLF and a missing final newline', () => {
    const buf = Buffer.from('a = 1\r\nb = 1 + 1\r\nc');
    expect(mutateBuffer(buf, 2, '1 + 1', '1 - $&').toString()).toBe('a = 1\r\nb = 1 - $&\r\nc');
    expect(mutateBuffer(buf, 3, 'c', 'd').toString()).toBe('a = 1\r\nb = 1 + 1\r\nd');
  });

  it('replaces bytes, so a line that is not UTF-8 keeps its other bytes', () => {
    const buf = Buffer.from('String s = "caf\xe9"; int x = 1 + 1;\nint y = 2;\n', 'latin1');
    expect(locate(buf, 1, '1 + 1')).toBe(1);
    expect(locate(buf, 2, '1 + 1')).toBe(1);
    expect(mutateBuffer(buf, 1, '1 + 1', '1 - 1')).toEqual(
      Buffer.from('String s = "caf\xe9"; int x = 1 - 1;\nint y = 2;\n', 'latin1'));
  });

  it('reads the program of a test after an optional cd prefix', () => {
    expect(testProgram('cd src && npx --no vitest run x')).toEqual({ program: 'npx', rest: 'npx --no vitest run x' });
    expect(testProgram('node a.js')).toEqual({ program: 'node', rest: 'node a.js' });
    expect(testProgram('cd /etc && node a.js')).toEqual({ program: 'cd', rest: 'cd /etc && node a.js' });
  });
});
