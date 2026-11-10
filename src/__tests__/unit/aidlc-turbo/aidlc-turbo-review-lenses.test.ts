/**
 * AI-DLC Turbo - a story is reviewed through three lenses, side by side.
 *
 * One reviewer missed too much: the code was judged against the story, never
 * against the project's own rules, and the Project Documentation (nested pages
 * pulled from Confluence) never reached construction at all. Now every built
 * story gets its reviewers at the same time, each through one lens:
 * - `story`: does the code do what the story asks (criteria, edge cases,
 *   decisions, scope, own test data, integration tests, the Code Scaffold,
 *   changed tests);
 * - `quality`: is it well written and safe (correctness, errors, security,
 *   fit with the code around it, readability, cost, leftovers);
 * - `docs`: does it keep the project's own rules, the standards and the
 *   Project Documentation, one reviewer per reading batch, every finding
 *   naming its rule.
 * The construction agent makes their verdicts one; a criterion of the story
 * that breaks a rule of the project goes to the human, not the builder. A fix
 * is delta-reviewed by every lens. The builders read the same documentation.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');

/** The file with every run of whitespace collapsed, so a phrase may wrap. */
const flat = (rel: string) => readFileSync(path.join(FLOW, rel), 'utf8').replace(/\s+/g, ' ');
const BUILDERS = ['commands/aidlc-turbo-builder.md', 'commands/aidlc-turbo-builder-low.md', 'skills/construction/build-story.md'];

describe('aidlc-turbo review lenses', () => {
  it('the review skill walks one lens per reviewer: story, quality and the project\'s own rules', () => {
    const review = flat('skills/construction/review.md');
    expect(review).toContain('`lens` (`story`, `quality` or `docs`)');
    expect(review).toContain('Walk only your own lens: the other lenses look at the same change at the same time. A `blocker` you see outside it you still report.');
    expect(review).toContain('`lens: story`, does the code do what the story asks:');
    expect(review).toContain('`lens: quality`, is it well written and safe, whatever the project\'s own rules say:');
    expect(review).toContain('`lens: docs`, does it keep the project\'s own rules, those in your batch:');
    expect(review).toContain('rights checked where data is read or changed');
    expect(review).toContain('no secret or personal data in a log');
    expect(review).toContain('no query inside a loop');
    expect(review).toContain('a page that carries a review checklist is walked item by item');
    expect(review).toContain('a `D-n` decision or a `## Standards deltas` line that sets a rule aside makes it no finding');
  });

  it('the docs lens reads the index first and its whole batch, and names the rule of every finding', () => {
    const review = flat('skills/construction/review.md');
    expect(review).toContain('`lens: docs`: `index` first, for where every rule lives, then every file of your batch, whole');
    expect(review).toContain('Every `lens: docs` finding names its rule in `rule`: the file and the heading it stands under');
    expect(review).toContain('marked `story_demands: true`: the human decides it, not the builder');
    expect(review).toContain('A rule broken by the agent half (a name or a place the Code Scaffold planned) is an ordinary finding: the rule wins');
    expect(review).toContain('`D{batch}-1`, `D{batch}-2`, ... for `lens: docs`');
    expect(review).toContain('`Q1`, `Q2`, ... for `lens: quality`');
    expect(review).toContain('a decision, a standard or a rule of the Project Documentation is broken, a wrong name that outlives the build (a table, a column, an API field)');
  });

  it('only the story lens judges the proof, and the intent review keeps its own checklist', () => {
    const review = flat('skills/construction/review.md');
    expect(review).toContain('Then, for `lens: story` and `scope: intent`, the proof (the other lenses leave it to the story lens)');
    expect(review).toContain('`scope: intent`, the whole only, not every story again.');
    expect(review).toContain('**Never rerun the suite**');
  });

  it('dispatch sends every lens at once, one docs reviewer per batch, and makes the verdicts one', () => {
    const dispatch = flat('skills/construction/dispatch.md');
    expect(dispatch).toContain('5. **Review**: every reviewer of the story at once');
    expect(dispatch).toContain('one Agent call per reviewer, all in the same message, in the background');
    expect(dispatch).toContain('one `lens: docs` per batch of `project_docs.batches`, with that batch as `docs`, its number as `batch` (from 1) and `project_docs.index` as `index`. No batches: no docs reviewer.');
    expect(dispatch).toContain('6. **Verdict**: wait for every reviewer of the story, then make their verdicts one:');
    expect(dispatch).toContain('`fail` when any of them is `fail`, else `pass`.');
    expect(dispatch).toContain('The same fault found by two lenses goes to the builder once, at the higher severity, with both ids.');
    expect(dispatch).toContain('a rule of the project wins over the quality lens\'s taste and over what the Code Scaffold planned');
    expect(dispatch).toContain('Hosts without subagents: follow `review.md` inline, one lens after the other.');
  });

  it('a criterion of the story against a rule of the project goes to the human, as no miss', () => {
    const dispatch = flat('skills/construction/dispatch.md');
    expect(dispatch).toContain('A finding with `story_demands: true`');
    expect(dispatch).toContain('is not the builder\'s fault and no miss: the story becomes a human stop');
    expect(dispatch).toContain('**Keep the rule**');
    expect(dispatch).toContain('**The story wins**, a new `D-n` sets the rule aside for this story');
    expect(dispatch).toContain('2. A review finds that the story itself asks for what a rule of the project forbids (`story_demands: true`).');
  });

  it('a fix is delta-reviewed by every lens, in dispatch and at finish', () => {
    const dispatch = flat('skills/construction/dispatch.md');
    expect(dispatch).toContain('**Delta review**: every reviewer of the last round again, side by side, each with `mode: delta`, its own previous verdict verbatim');
    expect(dispatch).toContain('Never skip a story\'s reviews, not even for a one-line story, and never one of its lenses.');
    const finish = flat('skills/construction/finish.md');
    expect(finish).toContain('the story\'s reviewers (`specsmd-aidlc-turbo-reviewer`, every lens as in `dispatch` step 3.5)');
    expect(finish).toContain('The `quality` and `docs` lenses also check every fix of an intent-review finding.');
    expect(finish).toContain('The `docs` lenses take `project_docs` from `intent-status.cjs --json`.');
  });

  it('the reviewer agent works through the lens it is given', () => {
    const agent = flat('commands/aidlc-turbo-reviewer.md');
    expect(agent).toContain('you judge one story\'s change through one lens');
    expect(agent).toContain('with `scope: story` and the `lens` your assignment names');
    expect(agent).toContain('Never edit or write a file');
  });

  it('the builders read the Project Documentation the docs reviewer judges them by', () => {
    for (const rel of BUILDERS) {
      const text = flat(rel);
      expect(text, rel).toContain('`project_docs` (`index`, the root page of the Project Documentation or none, and `batches`');
      expect(text, rel).toContain('the Project Documentation: `project_docs.index` first, then every page in `project_docs.batches` that sets rules for the code you will write');
      expect(text, rel).toContain('So is a `project_docs` with no index and no batches: the project has no documentation.');
      expect(text, rel).toContain('A name or a place it plans that breaks a rule of the standards or the Project Documentation: the rule wins, named under Different.');
      expect(text, rel).toContain('no Project Documentation, unless a finding names one (a `rule` names the page and its heading)');
      expect(text, rel).toContain('The standards or the Project Documentation answer it');
      expect(text, rel).toMatch(/Never read `\.specs-aidlc-turbo\/docs\/\{inception\}\/pages\/`/);
    }
    expect(flat('skills/construction/dispatch.md')).toContain('`brief`, `standards`, `project_docs`, `verification` and `touches` from the JSON');
  });
});
