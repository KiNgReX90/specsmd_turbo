/**
 * Unit tests for story-mutate.cjs of the AI-DLC Turbo flow: one mutant per
 * acceptance criterion.
 *
 * Three mutants were a sample: the test of every criterion outside it was
 * never seen to fail. So the story lens proposes one mutant per criterion a
 * test covers, its `criterion` starting with the criterion's number, and the
 * criteria no real test covers come as `--untested`. story-mutate.cjs:
 * - runs at most one mutant per criterion: a second is `invalid`, and so is
 *   one that names no criterion of the story by its number;
 * - prints one `CRITERION` line per criterion and writes the same into the
 *   proof's `criteria`: killed, survived, invalid (with the reason), missing
 *   (a criterion with a test and no proposal), untested or capped;
 * - reads `construction.mutants` as a cap: a number keeps the mutants of the
 *   first that many criteria with a test (an old `mutants: 3` still caps at
 *   3), and no number is no cap, which is the default the config is written
 *   with;
 * - lets a criterion whose mutant was invalid have one new proposal in a later
 *   `--only` run, and no more; a criterion with a killed or surviving mutant
 *   gets none;
 * - still reads a proof written before `criteria` existed.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, readFileSync, rmSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import {
  FLOW, bases, project, buildAndVerify, M, run, type P,
} from './aidlc-turbo-mutate-fixture';

const req = createRequire(import.meta.url);
const { capOf } = req(path.join(FLOW, 'scripts/lib/mutant-criteria.cjs'));
const { parseYamlMap } = req(path.join(FLOW, 'scripts/story-start.cjs'));
const { renderTurboConfig } = req(path.resolve(FLOW, '../../lib/flow-config.js'));

afterAll(() => bases.forEach((d) => rmSync(d, { recursive: true, force: true })));

const CALC4 = 'exports.base = 1;\nexports.add = (a, b) => a + b;\nexports.mul = (a, b) => a * b;\nexports.sub = (a, b) => a - b;\n';

/** Story 001 with these criteria, in the product-team half as render-specs writes it. */
function withCriteria(p: P, criteria: string[]) {
  const file = path.join(p.app, '.specs-aidlc-turbo/docs/auth/auth/stories/001-login.md');
  writeFileSync(file, [
    '---', 'id: "001"', 'title: Login', 'status: building', 'depends_on: []', '---', '',
    '# S001: Login', '', '## For the product team', '',
    '**As** a shopper, **I want** to count, **so that** I pay the right amount.', '',
    '### Acceptance criteria', '',
    ...criteria.map((c) => `- **Given** two numbers **when** I ${c} them **then** I see the result *(tester: screen)*`),
    '', '---', '', '## For the agent', '', '### Test plan', '', '- Unit: check.js', '',
  ].join('\n'));
}

/** A project whose story has these criteria, built and verified, with this construction block. */
function story(criteria: string[], construction = '') {
  const p = project();
  withCriteria(p, criteria);
  if (construction) {
    writeFileSync(path.join(p.app, '.specs-aidlc-turbo/repo/config.yaml'),
      `mode: production\nbranching:\n  project_key: shop\n  story_branches: false\nconstruction:\n${construction}`);
  }
  buildAndVerify(p, { 'src/calc.js': CALC4 });
  return p;
}

const ADD = (id: string, criterion: string, extra: Record<string, unknown> = {}) => M(id, { criterion, ...extra });
const MUL = (id: string, criterion: string, extra: Record<string, unknown> = {}) =>
  M(id, { line: 3, from: 'a * b', to: 'a + b', test: 'node check.js mul', criterion, ...extra });
const lines = (r: { stdout: string }) => r.stdout.trim().split('\n');

describe('aidlc-turbo story-mutate, one mutant per criterion', { timeout: 30000 }, () => {
  it('runs one mutant per criterion: a second proposal on the same criterion is invalid and never runs', () => {
    const p = story(['add', 'multiply']);
    const r = run(p, [ADD('M1', '1: the sum'), MUL('M2', '1: the sum again'), MUL('M3', '2: the product')]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(lines(r)).toEqual([
      'KILLED M1 src/calc.js:2',
      'INVALID M2 src/calc.js:3 (criterion 1 has M1 already)',
      'KILLED M3 src/calc.js:3',
      'CRITERION 1 killed M1',
      'CRITERION 2 killed M3',
      'MUTANTS 001 2/2 killed, 0 survived, 1 invalid',
    ]);
    expect(p.proof().mutants[1]).toMatchObject({ id: 'M2', result: 'invalid', exit: null, reason: 'criterion 1 has M1 already' });
  });

  it('a proposal that names no criterion of the story by its number is invalid', () => {
    const p = story(['add', 'multiply']);
    const r = run(p, [
      ADD('M1', 'the sum'), MUL('M2', '7: no such criterion'), MUL('M3', '0: none either'), ADD('M4', 'AC-1: the sum'),
    ], '--untested', '2');
    expect(r.status).toBe(0);
    expect(lines(r)).toEqual([
      'INVALID M1 src/calc.js:2 (criterion names no acceptance criterion by its number)',
      'INVALID M2 src/calc.js:3 (criterion 7 is not in the story)',
      'INVALID M3 src/calc.js:3 (criterion 0 is not in the story)',
      'KILLED M4 src/calc.js:2',
      'CRITERION 1 killed M4',
      'CRITERION 2 untested',
      'MUTANTS 001 1/1 killed, 0 survived, 3 invalid',
    ]);
  });

  it('a criterion with a test and no proposal is missing; one no test covers is untested', () => {
    const p = story(['add', 'multiply', 'subtract']);
    const r = run(p, [ADD('M1', '1: the sum')], '--untested', '3');
    expect(r.status).toBe(0);
    expect(lines(r)).toEqual([
      'KILLED M1 src/calc.js:2',
      'CRITERION 1 killed M1',
      'CRITERION 2 missing',
      'CRITERION 3 untested',
      'MUTANTS 001 1/1 killed, 0 survived, 0 invalid',
    ]);
  });

  it('records the result per criterion in the proof, with the reason of an invalid one', () => {
    const p = story(['add', 'multiply', 'subtract', 'compare']);
    const r = run(p, [
      ADD('M1', '1: the sum'),
      MUL('M2', '2: the product', { test: 'node check.js weak' }),
      M('M3', { line: 4, from: 'a - b', to: 'a + b', test: 'node check.js red', criterion: '3: the difference' }),
    ], '--untested', '4');
    expect(r.status).toBe(0);
    expect(lines(r).slice(3)).toEqual([
      'CRITERION 1 killed M1',
      'CRITERION 2 survived M2',
      'CRITERION 3 invalid M3 (test fails without the mutant)',
      'CRITERION 4 untested',
      'MUTANTS 001 1/2 killed, 1 survived, 1 invalid',
    ]);
    expect(p.proof().criteria).toEqual([
      { criterion: 1, result: 'killed', mutants: ['M1'] },
      { criterion: 2, result: 'survived', mutants: ['M2'] },
      { criterion: 3, result: 'invalid', mutants: ['M3'], reason: 'test fails without the mutant' },
      { criterion: 4, result: 'untested', mutants: [] },
    ]);
  });
});

describe('aidlc-turbo story-mutate, construction.mutants is a cap', { timeout: 30000 }, () => {
  it('a number keeps the mutants of the first that many criteria with a test; the rest are capped', () => {
    const p = story(['add', 'multiply', 'subtract'], '  mutants: 1\n');
    const r = run(p, [ADD('M1', '2: the sum'), MUL('M2', '3: the product')], '--untested', '1');
    expect(r.status).toBe(0);
    expect(lines(r)).toEqual([
      'KILLED M1 src/calc.js:2',
      'CRITERION 1 untested',
      'CRITERION 2 killed M1',
      'CRITERION 3 capped',
      'MUTANTS 001 1/1 killed, 0 survived, 0 invalid',
    ]);
    expect(p.proof().mutants.map((m: { id: string }) => m.id)).toEqual(['M1']);
  });

  it('an old config that says mutants: 3 still caps at 3, also on a story whose criteria the script cannot read', () => {
    const p = project();
    writeFileSync(path.join(p.app, '.specs-aidlc-turbo/repo/config.yaml'),
      'mode: production\nbranching:\n  project_key: shop\n  story_branches: false\nconstruction:\n  mutants: 3\n');
    buildAndVerify(p, { 'src/calc.js': CALC4 });
    const r = run(p, [ADD('M1', 'AC-1'), MUL('M2', 'AC-2'), ADD('M3', 'AC-3'), MUL('M4', 'AC-4')]);
    expect(r.status).toBe(0);
    expect(lines(r)).toEqual([
      'KILLED M1 src/calc.js:2', 'KILLED M2 src/calc.js:3', 'KILLED M3 src/calc.js:2',
      'MUTANTS 001 3/3 killed, 0 survived, 0 invalid',
    ]);
    expect(p.proof()).not.toHaveProperty('criteria');
    expect(capOf({ construction: { mutants: 3 } })).toBe(3);
    expect(capOf({ construction: { mutants: 0 } })).toBe(0);
  });

  it('the default is no cap: the config is written without a number, and every criterion runs its mutant', () => {
    expect(capOf(parseYamlMap(renderTurboConfig()))).toBeNull();
    expect(capOf(parseYamlMap(renderTurboConfig({ mode: 'sandbox' })))).toBeNull();
    const template = readFileSync(path.join(FLOW, 'templates/config.example.yaml'), 'utf8');
    expect(capOf(parseYamlMap(template))).toBeNull();
    expect(capOf({})).toBeNull();
    expect(capOf({ construction: { mutants: 'all' } })).toBeNull();

    const p = story(['add', 'multiply', 'subtract', 'add again'], '  mutants: all\n');
    const r = run(p, [
      ADD('M1', '1: the sum'), MUL('M2', '2: the product'),
      M('M3', { line: 4, from: 'a - b', to: 'a + b', test: 'node check.js weak', criterion: '3: the difference' }),
      ADD('M4', '4: the sum again', { to: 'a * b' }),
    ]);
    expect(lines(r)).toEqual([
      'KILLED M1 src/calc.js:2', 'KILLED M2 src/calc.js:3', 'SURVIVED M3 src/calc.js:4', 'KILLED M4 src/calc.js:2',
      'CRITERION 1 killed M1', 'CRITERION 2 killed M2', 'CRITERION 3 survived M3', 'CRITERION 4 killed M4',
      'MUTANTS 001 3/4 killed, 1 survived, 0 invalid',
    ]);
  });
});

describe('aidlc-turbo story-mutate, the delta', { timeout: 30000 }, () => {
  it('a criterion whose mutant was invalid is owed one new proposal, and no more', () => {
    const p = story(['add', 'multiply']);
    const mutants = [ADD('M1', '1: the sum'), MUL('M2', '2: the product', { test: 'node check.js red' })];
    expect(lines(run(p, mutants)).slice(2, 4)).toEqual([
      'CRITERION 1 killed M1', 'CRITERION 2 invalid M2 (test fails without the mutant)',
    ]);
    // A fix round: story-verify writes the proof again and keeps what the mutants found.
    buildAndVerify(p, { 'src/calc.js': CALC4 });

    mutants.push(MUL('M3', '2: the product'));
    const again = run(p, mutants, '--only', 'M3');
    expect(again.stderr).toBe('');
    expect(lines(again)).toEqual([
      'KILLED M3 src/calc.js:3',
      'CRITERION 1 killed M1',
      'CRITERION 2 killed M3',
      'MUTANTS 001 1/1 killed, 0 survived, 0 invalid',
    ]);
    expect(p.proof().criteria).toEqual([
      { criterion: 1, result: 'killed', mutants: ['M1'] },
      { criterion: 2, result: 'killed', mutants: ['M2', 'M3'] },
    ]);
    expect(p.proof().mutants.map((m: { id: string }) => m.id)).toEqual(['M1', 'M2', 'M3']);

    mutants.push(ADD('M4', '1: the sum'));
    expect(lines(run(p, mutants, '--only', 'M4'))[0]).toBe('INVALID M4 src/calc.js:2 (criterion 1 has M1 already)');
  });

  it('a second invalid proposal spends the one new proposal of its criterion', () => {
    const p = story(['add', 'multiply']);
    const mutants = [ADD('M1', '1: the sum'), MUL('M2', '2: the product', { to: 'a * b' })];
    run(p, mutants);
    mutants.push(MUL('M3', '2: the product', { test: 'node check.js none' }));
    expect(lines(run(p, mutants, '--only', 'M3'))).toEqual([
      'INVALID M3 src/calc.js:3 (test runs no tests)',
      'CRITERION 1 killed M1',
      'CRITERION 2 invalid M3 (test runs no tests)',
      'MUTANTS 001 0/0 killed, 0 survived, 1 invalid',
    ]);
    mutants.push(MUL('M4', '2: the product'));
    expect(lines(run(p, mutants, '--only', 'M4'))[0]).toBe('INVALID M4 src/calc.js:3 (criterion 2 had its one new proposal)');
  });

  it('a missing criterion gets its proposal in a later --only run, and untested stays as the first run said', () => {
    const p = story(['add', 'multiply', 'subtract']);
    const mutants = [ADD('M1', '1: the sum')];
    expect(lines(run(p, mutants, '--untested', '3')).slice(1, 4)).toEqual([
      'CRITERION 1 killed M1', 'CRITERION 2 missing', 'CRITERION 3 untested',
    ]);
    mutants.push(MUL('M2', '2: the product'));
    expect(lines(run(p, mutants, '--only', 'M2')).slice(1, 4)).toEqual([
      'CRITERION 1 killed M1', 'CRITERION 2 killed M2', 'CRITERION 3 untested',
    ]);
  });

  it('reads a proof written before the per-criterion results, without crashing', () => {
    const p = story(['add', 'multiply']);
    const old = p.proof();
    old.mutants = [
      { id: 'M1', file: 'src/calc.js', line: 2, from: 'a + b', to: 'a - b', test: 'node check.js add', criterion: 'the sum', result: 'killed', exit: 1 },
      { id: 'M2', file: 'src/calc.js', line: 3, from: 'a * b', to: 'a + b', test: 'node check.js weak', criterion: 'the product', result: 'survived', exit: 0 },
    ];
    writeFileSync(p.proofFile, JSON.stringify(old));
    const mutants = [...old.mutants.map(({ result, exit, ...m }: Record<string, unknown>) => m), MUL('M3', '2: the product')];
    const r = run(p, mutants, '--only', 'M2,M3');
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(lines(r)).toEqual([
      'INVALID M2 src/calc.js:3 (criterion names no acceptance criterion by its number)',
      'KILLED M3 src/calc.js:3',
      'CRITERION 1 missing',
      'CRITERION 2 killed M3',
      'MUTANTS 001 1/1 killed, 0 survived, 1 invalid',
    ]);
    expect(p.proof().criteria[1]).toEqual({ criterion: 2, result: 'killed', mutants: ['M3'] });
  });
});
