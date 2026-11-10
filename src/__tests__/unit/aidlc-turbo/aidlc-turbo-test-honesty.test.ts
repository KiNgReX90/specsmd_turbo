/**
 * AI-DLC Turbo - a story's tests must be able to fail.
 *
 * A green proof says little when the tests behind it cannot go red: an
 * expected value computed the way the code computes it, a mock of the unit
 * under test, a test switched off, or an existing test bent to fit the new
 * code. So:
 * - the builders write honest tests, mock only at the edge of the system and
 *   never switch a test off; in fix mode they change an assertion only when
 *   the finding says the test is wrong;
 * - a builder writes each test before its code but runs no red first: that
 *   run costs a test run per criterion, and the mutants prove the test bites;
 *   a fix still sees its test fail on the defect;
 * - `story-verify.cjs` fails a story that switches a test off and lists the
 *   existing tests it changed or deleted, which the story lens judges;
 * - the story lens (only it knows what a criterion asks) proposes one mutant
 *   per acceptance criterion a test covers, named by its number, and lists the
 *   criteria no test covers; `story-mutate.cjs` runs them after the reviews; a
 *   survivor is a `major` finding the builder fixes in the test, never in the
 *   production line, and a criterion with a test and no killed mutant is a
 *   `major` `C` finding of the story lens, which proposes one new mutant for it
 *   in the delta;
 * - `construction.mutants` in the config is a cap, no cap by default, 0 turns
 *   it off.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');

/** The file with every run of whitespace collapsed, so a phrase may wrap. */
const flat = (rel: string) => readFileSync(path.join(FLOW, rel), 'utf8').replace(/\s+/g, ' ');
const BUILDERS = ['commands/aidlc-turbo-builder.md', 'commands/aidlc-turbo-builder-low.md', 'skills/construction/build-story.md'];

describe('aidlc-turbo test honesty', () => {
  it('the builders write honest tests and never switch one off', () => {
    for (const rel of BUILDERS) {
      const text = flat(rel);
      expect(text, rel).toContain('an expected value is a literal from the criterion, an example or an edge-case row, never computed the way the code computes it');
      expect(text, rel).toContain('A test never asserts only what it arranged itself.');
      expect(text, rel).toContain('Mock only at the edge of the system: an external service, the clock, chance.');
      expect(text, rel).toContain('Never mock the unit under test, never code of this or an earlier story, and never the database when the project tests against a real one.');
      expect(text, rel).toContain('**Never switch a test off**: no `skip`, `only`, `todo`, `xit`, `@Disabled` or `@Ignore`.');
      expect(text, rel).toContain('An existing test changes or goes only when the story changes the behaviour it checks, named in the build notes.');
      expect(text, rel).toContain('`story-verify.cjs` fails a story that switches a test off.');
      expect(text, rel).toContain('every test honest and none switched off');
    }
  });

  it('in fix mode a builder bends no test, and makes a surviving mutant red in the test', () => {
    for (const rel of BUILDERS) {
      const text = flat(rel);
      expect(text, rel).toContain('Change a test\'s assertion only when the finding says the test is wrong, and say so in the build notes.');
      expect(text, rel).toContain('make the test turn red on that change and leave the production line as it is; `story-mutate.cjs` reruns the mutant to check.');
    }
  });

  it('a builder writes the test before the code but runs no red first, a fix still does', () => {
    for (const rel of BUILDERS) {
      const text = flat(rel);
      expect(text, rel).not.toContain('Run it and read the failure');
      expect(text, rel).not.toContain('red first');
      expect(text, rel).toContain('1. **Test**: one test that states the criterion in the project\'s own test style, written before the code.');
      expect(text, rel).toContain('Do not run it before the code exists');
      expect(text, rel).toContain('`story-mutate.cjs` breaks the story\'s lines one at a time and checks that a test turns red');
      expect(text, rel).toContain('one test per row, written before its code.');
      expect(text, rel).toContain('Never write the implementation before its test.');
      expect(text, rel).toContain('Per finding: a test that fails on the defect, then the fix, then green.');
    }
  });

  it('the story lens catches dishonest tests and judges every changed or deleted existing test', () => {
    const review = flat('skills/construction/review.md');
    expect(review).toContain('an expected value computed the way the code computes it, a test that mocks the unit it tests or code of this or an earlier story');
    expect(review).toContain('8. **Changed tests**: every existing test the proof\'s `tests_changed` lists as `modified` or `deleted` needs a reason in the story');
    expect(review).toContain('Without one it is `major`: a test bent to fit the code.');
    expect(review).toContain('The tests are the story lens\'s: you judge the production code.');
  });

  it('the story lens proposes one mutant per tested criterion, never runs one, and in delta mode only the new one a C finding asks for', () => {
    const review = flat('skills/construction/review.md');
    expect(review).not.toContain('at most 3');
    expect(review).toContain('Then, in `mode: full`, propose **mutants**, one per acceptance criterion that a test covers: each one small change to a production line this story added or changed, a line that criterion says must matter.');
    expect(review).toContain('`criterion` starts with the criterion\'s number in the story\'s list, 1 for the first');
    expect(review).toContain('Never two mutants on one criterion, never a test file.');
    expect(review).toContain('A criterion no real test covers gets no mutant: its number goes in `untested`, besides its finding under item 1.');
    expect(review).toContain('a mutant whose test stays green, and a criterion with a test and no killed mutant, are `major` findings.');
    expect(review).toContain('a `C` finding (a criterion with a test whose mutant was invalid, or that had none) handed to you with the script\'s reason gets one new mutant for that criterion');
    expect(review).toContain('A `C` finding whose one new mutant is spent you judge the same way, from the code.');
    expect(review).toContain('In `mode: full` one mutant per criterion with a test, ids `M1`, `M2`, ... in criterion order');
    expect(review).toMatch(/criterion: "1: [^"]+" untested: \[\]/);
    expect(review).toContain('Flip a comparison, a condition or a constant, or drop a call, so that the code still compiles.');
    expect(review).toContain('and passes on the code as it is');
    expect(review).toContain('It may start with `cd {dir} &&` and a folder inside the code root, as a verification command may; beyond that, no shell operator');
    expect(review).toContain('Return `mutants: []` when no criterion has a test.');
    expect(review).toContain('Never run a mutant yourself: you are read-only, and the other lenses read the same worktree.');
    expect(review).toContain('No mutants in delta mode, but one:');
    expect(review).toMatch(/mutants: - id: M1 file: \S+ line: \d+ from: .+ to: .+ test: .+ criterion: /);
  });

  it('a delta review blocks a fix that switches a test off, also at finish', () => {
    const review = flat('skills/construction/review.md');
    expect(review).toContain('a fix that changes a test\'s assertion where the finding did not say the test was wrong is `major`');
    expect(review).toContain('A fix that switches a test off (`skip`, `only`, `todo`, `xit`, `@Disabled`, `@Ignore`) is a `blocker`. This holds at finish too, where `story-verify.cjs` does not look for it.');
  });

  it('dispatch misses a switched-off test without review and runs the mutants before the one verdict', () => {
    const dispatch = flat('skills/construction/dispatch.md');
    expect(dispatch).toContain('A `FAIL` followed by `switched off` lines is the same miss: those lines and the proof path are the finding.');
    expect(dispatch).not.toContain('default 3');
    expect(dispatch).toContain('unless `construction.mutants` in the config is 0. Write all of the story lens\'s `mutants`');
    expect(dispatch).toContain('--mutants {that file} --untested {its untested, comma-joined}');
    expect(dispatch).toContain('a number in `construction.mutants` keeps the mutants of the first that many criteria with a test, no number (the default) runs one per criterion');
    expect(dispatch).toContain('story branches on, no cap on the mutants');
    expect(dispatch).toContain('`{tmp}/{intent}-S{SSS}-mutants.json`');
    expect(dispatch).toContain('story-mutate.cjs {intent} {SSS} --code-root {worktree} --mutants {that file}');
    expect(dispatch).toContain('issue "`{test}` stays green when `{file}:{line}` `{from}` becomes `{to}`: {criterion} is not really covered"');
    expect(dispatch).toContain('fix "make the test turn red on that change; leave the production line as it is"');
    expect(dispatch).toContain('`INVALID` is no finding. A `CRITERION {n} invalid` or `CRITERION {n} missing` line is a criterion with a test and no killed mutant: a finding `C{n}`, `severity: major`');
    expect(dispatch).toContain('Exit 1 with `diff changed`: run `story-verify.cjs` again (the changed diff is no miss, a `FAIL` is), and after its `PASS` run `story-mutate.cjs` once more; a second `diff changed` means its tests write files: go on without the mutants.');
    expect(dispatch).toContain('in the background (on Claude Code: `run_in_background`, never a short timeout): every mutant costs a test run');
    expect(dispatch).toContain('`interrupted`: run it once more, it first puts back what a cut-off run left.');
    expect(dispatch).toContain('6. `story-mutate.cjs` stops with `restore failed` or an `Error:`.');
    expect(dispatch).toContain('Delete the mutants file once the story lands.');
    expect(dispatch).toContain('with `--only {the open M ids}`, before the delta review. `KILLED` resolves that finding, `SURVIVED` keeps it open, verbatim.');
    expect(dispatch).toContain('Never run a mutant yourself');
    expect(dispatch).toContain('(mode, branching, `construction.mutants`)');
  });

  it('dispatch sends a criterion with a test and no killed mutant to the story lens, which gets one new proposal', () => {
    const dispatch = flat('skills/construction/dispatch.md');
    expect(dispatch).toContain('A `C` finding is the story lens\'s, never the builder\'s: it goes to the story lens\'s delta review as **Mutants again** in step 4 says.');
    expect(dispatch).toContain('A verdict whose only `blocker` or `major` findings are `C` findings is no miss: only the story lens\'s delta review runs, at once and without a fix diff');
    expect(dispatch).toContain('`INVALID`, and an `M` finding the builder disputed, go to the story lens\'s delta review with the script\'s reason or the builder\'s evidence. A `C` finding goes there too, with the script\'s reason and the next free `M` id: the story lens proposes one new mutant for that criterion.');
    expect(dispatch).toContain('run `story-mutate.cjs` with `--only {its id}` before the verdicts are made one.');
    expect(dispatch).toContain('A criterion gets one new proposal: a line that still reads `invalid` or `missing` sends the `C` finding to the story lens\'s next delta review with its one new mutant spent');
    expect(dispatch).toContain('Run it also when the story lens proposed none, so every criterion gets its line');
  });

  it('the construction agent draws the mutation step between the review and the verdict', () => {
    const agent = flat('agents/construction-agent.md');
    const review = agent.indexOf('[review]');
    const mutate = agent.indexOf('[mutate] story-mutate.cjs');
    const verdict = agent.indexOf('[verdict]');
    expect(review).toBeGreaterThan(-1);
    expect(mutate).toBeGreaterThan(review);
    expect(verdict).toBeGreaterThan(mutate);
  });

  it('the config carries construction.mutants, a cap with no cap by default, wherever its keys are listed', () => {
    const template = readFileSync(path.join(FLOW, 'templates/config.example.yaml'), 'utf8').replace(/\n\s*#\s*/g, ' ').replace(/\s+/g, ' ');
    expect(template).toContain('construction: After a story\'s reviews a script breaks one line per acceptance criterion a test covers, to prove that test can fail. A number caps them per story, the first criteria first; 0 turns them off; all (the default) is no cap. mutants: all');
    expect(flat('README.md')).toContain('construction: mutants: all');
    expect(flat('memory-bank.yaml')).toContain('- construction: "mutants (default all): a script breaks one line per acceptance criterion a test covers');
    expect(flat('commands/aidlc-turbo-config.md')).toContain('**Mutants per story** -> after a story\'s reviews a script breaks one line per acceptance criterion a test covers');
    expect(flat('commands/aidlc-turbo-config.md')).toContain('*(default: all, no cap)*');
    for (const rel of ['README.md', 'PRD.md', 'quick-start.md', 'skills/master/explain-flow.md']) {
      expect(flat(rel), rel).toContain('breaks a few lines the story changed, to prove its tests can fail');
    }
  });
});
