/**
 * Unit tests for the verdict of one mutant run of story-mutate.cjs of the
 * AI-DLC Turbo flow.
 *
 * A mutant is `killed` only when a test noticed it:
 * - a run that ends in a timeout (exit 124) is `invalid: timed out`;
 * - a run whose code does not build (javac, Maven, tsc, go, dotnet, cargo),
 *   does not parse (node, vitest) or whose tests are not collected (pytest)
 *   is `invalid`, also when the runner's counts show an error;
 * - a run whose counts show a failed test is `killed`, counts with no failed
 *   test under a red exit are `invalid: no test failed`;
 * - output without counts: the exit code decides, but only after the
 *   build-failure markers are ruled out.
 *
 * The counts come from story-verify.cjs's parser, so every fake run here is
 * built from the output exactly as runCommand builds it.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, rmSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import {
  FLOW, bases, CALC_STORY, project, buildAndVerify, M, run, mutate,
} from './aidlc-turbo-mutate-fixture';

const req = createRequire(import.meta.url);
const { parseCounts, tail } = req(path.join(FLOW, 'scripts/story-verify.cjs'));

afterAll(() => bases.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A run result as runCommand returns it, for this output and exit. */
function result(output: string, exit: number) {
  const { passed, failed } = parseCounts(output);
  return { command: 'node check.js add', exit, seconds: 0.1, passed_count: passed, failed_count: failed, tail: tail(output) };
}

const GREEN = result(' Tests  1 passed (1)', 0);

/** The lines of one mutant run whose test, with the mutant in, prints this output and exits so. */
async function verdict(output: string, exit: number, file = 'src/calc.js') {
  const p = project();
  buildAndVerify(p);
  let calls = 0;
  const runner = () => {
    calls += 1;
    return calls === 1 ? GREEN : result(output.split('{abs}').join(path.join(p.app, file)), exit);
  };
  const r = await mutate(p, [M('M1', {})], { runner });
  expect(r.error).toBeUndefined();
  expect(readFileSync(path.join(p.app, 'src/calc.js'), 'utf8')).toBe(CALC_STORY);
  return { lines: r.lines as string[], entry: p.proof().mutants[0] };
}

describe('aidlc-turbo story-mutate verdict', () => {
  it('a mutant whose test fails an assertion is killed', async () => {
    const out = ' FAIL  src/calc.test.ts > add > adds two numbers\nAssertionError: expected -1 to be 5\n Tests  1 failed (1)';
    const { lines, entry } = await verdict(out, 1);
    expect(lines[0]).toBe('KILLED M1 src/calc.js:2');
    expect(entry).toMatchObject({ result: 'killed', exit: 1 });
    expect(entry).not.toHaveProperty('reason');
  });

  it('a mutant whose test stays green survived', async () => {
    const { lines, entry } = await verdict(' Tests  1 passed (1)', 0);
    expect(lines[0]).toBe('SURVIVED M1 src/calc.js:2');
    expect(entry).toMatchObject({ result: 'survived', exit: 0 });
  });

  it('a mutant that breaks the build is invalid: did not build', async () => {
    const out = [
      '[INFO] --- maven-compiler-plugin:3.11.0:compile (default-compile) @ shop ---',
      '[ERROR] COMPILATION ERROR : ',
      '[ERROR] /work/shop/src/main/java/acme/Calc.java:[12,21] \';\' expected',
      '[INFO] BUILD FAILURE',
      '[ERROR] Failed to execute goal org.apache.maven.plugins:maven-compiler-plugin:3.11.0:compile (default-compile) on project shop: Compilation failure',
    ].join('\n');
    const { lines, entry } = await verdict(out, 1);
    expect(lines[0]).toBe('INVALID M1 src/calc.js:2 (did not build)');
    expect(lines[1]).toBe('MUTANTS 001 0/0 killed, 0 survived, 1 invalid');
    expect(entry).toMatchObject({ result: 'invalid', exit: 1, reason: 'did not build' });
  });

  it('a mutant whose test times out is invalid: timed out, and the file is back', () => {
    const p = project();
    buildAndVerify(p);
    const r = run(p, [M('M1', { test: 'node check.js hang' })], '--timeout', '1');
    expect(r.stdout.trim().split('\n')).toEqual([
      'INVALID M1 src/calc.js:2 (timed out)', 'MUTANTS 001 0/0 killed, 0 survived, 1 invalid',
    ]);
    expect(p.proof().mutants[0]).toMatchObject({ result: 'invalid', exit: 124, reason: 'timed out' });
    expect(readFileSync(path.join(p.app, 'src/calc.js'), 'utf8')).toBe(CALC_STORY);
  });

  it('a mutant that node cannot parse is invalid: did not parse, a real run', () => {
    const p = project();
    buildAndVerify(p);
    const r = run(p, [M('M1', { to: 'a +' })]);
    expect(r.stdout.trim().split('\n')[0]).toBe('INVALID M1 src/calc.js:2 (did not parse)');
    expect(readFileSync(path.join(p.app, 'src/calc.js'), 'utf8')).toBe(CALC_STORY);
  });

  it('counts with no failed test under a red exit are invalid: no test failed', async () => {
    const { lines } = await verdict(' Test Files  1 failed (1)\n Tests  3 passed (3)', 1);
    expect(lines[0]).toBe('INVALID M1 src/calc.js:2 (no test failed (exit 1))');
  });

  it('a run a signal ended is invalid', async () => {
    expect((await verdict('Killed', 137)).lines[0]).toBe('INVALID M1 src/calc.js:2 (ended by a signal (exit 137))');
    const cargo = 'error: test failed, to rerun pass `--lib`\nCaused by:\n  process didn\'t exit successfully: `target/debug/deps/shop-1a2b` (signal: 9, SIGKILL: kill)';
    expect((await verdict(cargo, 101)).lines[0]).toBe('INVALID M1 src/calc.js:2 (ended by SIGKILL)');
  });

  describe('output without counts: the exit code decides only after the build-failure markers', () => {
    const BUILD: Array<[string, string, string]> = [
      ['javac', 'did not build', 'src/main/java/acme/Calc.java:12: error: \';\' expected\n        return a - b\n                    ^\n1 error'],
      ['gradle javac', 'did not build', '> Task :compileJava FAILED\nCompilation failed; see the compiler error output for details.'],
      ['maven', 'did not build', '[ERROR] Failed to execute goal org.apache.maven.plugins:maven-compiler-plugin:3.11.0:testCompile (default-testCompile) on project shop: Compilation failure'],
      ['tsc', 'did not build', 'src/calc.ts(2,30): error TS1109: Expression expected.'],
      ['tsc pretty', 'did not build', 'src/calc.ts:2:30 - error TS2322: Type \'string\' is not assignable to type \'number\'.\n\nFound 1 error in src/calc.ts:2'],
      ['go', 'did not build', '# acme/shop/calc\ncalc/calc.go:5:12: syntax error: unexpected newline\nFAIL\tacme/shop/calc [build failed]\nFAIL'],
      ['dotnet', 'did not build', '/work/Shop/Calc.cs(5,23): error CS1002: ; expected [/work/Shop/Shop.csproj]'],
      ['cargo', 'did not build', 'error[E0308]: mismatched types\nerror: could not compile `shop` (lib) due to 1 previous error'],
      ['node', 'did not parse', '{abs}:2\nexports.add = (a, b) => a +;\n                           ^\n\nSyntaxError: Unexpected token \';\'\n    at wrapSafe (node:internal/modules/cjs/loader:1464:18)'],
      ['vitest', 'did not parse', ' FAIL  src/calc.test.ts [ src/calc.test.ts ]\nError: Transform failed with 1 error:\n{abs}:2:27: ERROR: Unexpected ";"\n  Plugin: vite:esbuild\n  File: {abs}:2:27\n Test Files  1 failed (1)\n      Tests  no tests'],
    ];
    for (const [stack, reason, out] of BUILD) {
      it(`${stack}: invalid (${reason})`, async () => {
        const { lines, entry } = await verdict(out, 1);
        expect(lines[0]).toBe(`INVALID M1 src/calc.js:2 (${reason})`);
        expect(entry).toMatchObject({ result: 'invalid', exit: 1, reason });
      });
    }

    it('pytest collection: invalid (did not collect), although its counts show an error', async () => {
      const out = [
        '==================================== ERRORS ====================================',
        '_____________________ ERROR collecting tests/test_calc.py ______________________',
        'E     SyntaxError: invalid syntax',
        '!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!',
        '=============================== 1 error in 0.12s ===============================',
      ].join('\n');
      expect(parseCounts(out).failed).toBe(1);
      expect((await verdict(out, 2)).lines[0]).toBe('INVALID M1 src/calc.js:2 (did not collect)');
    });

    it('ts-jest: a type error is invalid (did not build), although jest counts 0 tests', async () => {
      const out = ' FAIL  src/calc.test.ts\n  ● Test suite failed to run\n\n    src/calc.ts:2:30 - error TS1109: Expression expected.\n\nTests:       0 total';
      expect((await verdict(out, 1)).lines[0]).toBe('INVALID M1 src/calc.js:2 (did not build)');
    });

    it('a parse failure in another file than the mutated one is no marker', async () => {
      const out = '/work/other.js:2\n\nSyntaxError: Unexpected token \';\'\n    at wrapSafe (node:internal/modules/cjs/loader:1464:18)';
      expect((await verdict(out, 1)).lines[0]).toBe('KILLED M1 src/calc.js:2');
    });

    it('a SyntaxError the code throws while it runs stays killed', async () => {
      const out = '{abs}:2\n\nSyntaxError: Unexpected token in JSON at position 0\n    at JSON.parse (<anonymous>)\n    at exports.add ({abs}:2:30)';
      expect((await verdict(out, 1)).lines[0]).toBe('KILLED M1 src/calc.js:2');
    });

    it('a red exit with no marker and no counts is killed', async () => {
      const out = 'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n\n-1 !== 5\n';
      expect(parseCounts(out)).toEqual({ passed: null, failed: null });
      expect((await verdict(out, 1)).lines[0]).toBe('KILLED M1 src/calc.js:2');
    });

    it('a test that prints a marker-like text but fails an assertion stays killed', async () => {
      const out = 'expected "error TS" in the message\n Tests  1 failed (1)';
      expect((await verdict(out, 1)).lines[0]).toBe('KILLED M1 src/calc.js:2');
    });
  });
});
