/**
 * Unit tests for the crash safety of story-mutate.cjs of the AI-DLC Turbo flow.
 *
 * A kill during a mutant run skips every `finally`, so the mutant would stay in
 * the worktree and the next story-verify would hash it into the proof:
 * - before a mutant is written, `{proof}/{SSS}.mutant.json` holds the file, the
 *   original bytes and both sha256s; it goes only after a checked restore;
 * - story-verify (story runs) and story-mutate look for it first: a file that
 *   still holds the mutant is put back and named on stderr, a file that is
 *   already back only loses the marker, and a file changed since is refused
 *   (exit 1) and left alone;
 * - a SIGTERM never skips a restore: the run stops after the current mutant,
 *   prints `interrupted`, exits 1 and writes nothing to the proof.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { spawn, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import path from 'path';
import {
  FLOW, SCRIPT, bases, CALC_STORY, project, buildAndVerify, M, run, mutantsFile,
} from './aidlc-turbo-mutate-fixture';

type P = ReturnType<typeof project>;
const VERIFY = path.join(FLOW, 'scripts/story-verify.cjs');

afterAll(() => bases.forEach((d) => rmSync(d, { recursive: true, force: true })));

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** What a killed mutant run leaves: the marker, and the mutant still in the file. */
function cutOff(p: P) {
  const file = path.join(p.app, 'src/calc.js');
  const original = readFileSync(file);
  const mutated = Buffer.from(original.toString().replace('a + b', 'a - b'));
  const marker = p.proofFile.replace(/\.json$/, '.mutant.json');
  writeFileSync(marker, JSON.stringify({
    file, original_sha: sha(original), mutated_sha: sha(mutated), original: original.toString('base64'),
  }));
  writeFileSync(file, mutated);
  return { file, marker };
}

const verifyCli = (p: P) => spawnSync('node', [VERIFY, 'auth', '001', '--code-root', '.'], { cwd: p.app, encoding: 'utf8' });

describe('aidlc-turbo story-mutate crash safety', () => {
  it('story-verify puts a cut-off mutant back before it verifies', () => {
    const p = project();
    buildAndVerify(p);
    const sha0 = p.proof().diff_sha;
    const c = cutOff(p);
    const r = verifyCli(p);
    expect(r.stderr.trim()).toBe(`restored ${c.file}: a mutant run was cut off`);
    expect(r.status).toBe(0);
    expect(readFileSync(c.file, 'utf8')).toBe(CALC_STORY);
    expect(existsSync(c.marker)).toBe(false);
    expect(p.proof().diff_sha).toBe(sha0);
  });

  it('story-mutate puts a cut-off mutant back, then runs', () => {
    const p = project();
    buildAndVerify(p);
    const c = cutOff(p);
    const r = run(p, [M('M1', {})]);
    expect(r.stderr.trim()).toBe(`restored ${c.file}: a mutant run was cut off`);
    expect(r.stdout.trim().split('\n')).toEqual(['KILLED M1 src/calc.js:2', 'MUTANTS 001 1/1 killed, 0 survived, 0 invalid']);
    expect(r.status).toBe(0);
    expect(existsSync(c.marker)).toBe(false);
  });

  it('only drops the marker when the file is already back', () => {
    const p = project();
    buildAndVerify(p);
    const c = cutOff(p);
    writeFileSync(c.file, CALC_STORY);
    const r = run(p, [M('M1', {})]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(existsSync(c.marker)).toBe(false);
  });

  it('refuses a file changed since the cut-off run and leaves it alone', () => {
    const p = project();
    buildAndVerify(p);
    const c = cutOff(p);
    writeFileSync(c.file, 'edited by hand\n');
    const message = `Error: a cut-off mutant run left ${c.file} changed since: compare it with ${c.marker} by hand`;
    for (const r of [verifyCli(p), run(p, [M('M1', {})])]) {
      expect(r.status).toBe(1);
      expect(r.stderr.trim()).toBe(message);
    }
    expect(readFileSync(c.file, 'utf8')).toBe('edited by hand\n');
    expect(existsSync(c.marker)).toBe(true);
  });

  it('stops after the current mutant on SIGTERM, restored, and writes nothing', async () => {
    const p = project();
    buildAndVerify(p);
    const file = mutantsFile(p, [M('M1', { test: 'node check.js slow' }), M('M2', {})]);
    const child = spawn('node', [SCRIPT, 'auth', '001', '--code-root', '.', '--mutants', file], { cwd: p.app });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    const closed = new Promise((resolve) => child.on('close', resolve));
    const started = path.join(p.base, 'started.txt');
    const until = Date.now() + 15000;
    while (!existsSync(started) && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
    expect(existsSync(started)).toBe(true);
    child.kill('SIGTERM');
    expect(await closed).toBe(1);
    expect(out.trim().split('\n')).toEqual(['interrupted']);
    expect(readFileSync(path.join(p.app, 'src/calc.js'), 'utf8')).toBe(CALC_STORY);
    expect(existsSync(p.proofFile.replace(/\.json$/, '.mutant.json'))).toBe(false);
    expect(p.proof()).not.toHaveProperty('mutants');
  }, 20000);
});
