/**
 * Unit tests for the tense of the overview page: before the build (the plan
 * page, phase inception) its texts say what will happen, after the build
 * (phase construction) what happened.
 * - the labels intent-overview.cjs hands the page: the explanations of the
 *   flow, the slices and the integration tests, and the words and tips of a
 *   slice cell and a code file;
 * - the reasons behind a part's Certainty in the Code Scaffold
 *   (design-model.cjs), told in the past after the build;
 * - the masthead after the build leads with what the intent built, in the
 *   words finish writes into the brief (built); without them it keeps the
 *   intent's own summary, never the drawing's summary as if it were built;
 * - the template's own words, from the string table: the seams without a
 *   test, the link to the tests and when a test runs (the masthead no longer
 *   counts the tests, aidlc-turbo-overview-masthead.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const overview = req(path.join(FLOW, 'scripts/intent-overview.cjs'));
const render = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const paths = req(path.join(FLOW, 'scripts/lib/paths.cjs'));
const dm = req(path.join(FLOW, 'scripts/lib/design-model.cjs'));
const read = (f: string) => readFileSync(path.join(FLOW, f), 'utf8');
const EN = JSON.parse(read('templates/lang/en.json'));
const TEMPLATE = read('templates/overview/overview-template.html');
const DESIGN = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');

/** The template intent with the order status drawing, its stories rendered. */
function fixture() {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-tense-')), '.specs-aidlc-turbo');
  const dir = path.join(root, 'docs', 'user-auth', 'user-auth');
  mkdirSync(path.join(root, 'repo'), { recursive: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(root, 'repo', 'config.yaml'), 'mode: sandbox\n');
  const record = render.parseYaml(read('templates/inception/record-template.yaml'));
  record.intent.language = 'en';
  const src = render.parseYaml(readFileSync(DESIGN, 'utf8'));
  record.technical_design = { ...(record.technical_design || {}), drawing: src.technical_design.drawing };
  record.stories[0].drawing = src.stories[0].drawing;
  writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
  const intent = paths.findIntent(root, 'user-auth');
  render.applyPlan(intent, render.planRender(intent));
  return { root, intent };
}

const pageOf = (phase: string) => {
  const { root, intent } = fixture();
  return overview.buildData(root, intent, phase).page;
};

describe('aidlc-turbo overview tense: the labels', () => {
  it('before the build say what will happen', () => {
    const { explain, cell } = pageOf('inception').labels;
    expect(explain.flow).toMatch(/; the numbers are the stories that build a step\.$/);
    expect(explain.slices).toMatch(/the columns are in the order they are built in\.$/);
    expect(explain.slicesPhone).toMatch(/the stories are in the order they are built in\.$/);
    expect(explain.tests).toMatch(/ That proves the two stories work together, not only each on its own\.$/);
    expect(cell).toMatchObject({
      changes: 'changes',
      newTip: 'does not exist yet, the story creates it',
      changesTip: 'exists, the story changes it',
      usesTip: 'the story relies on it, but does not change it',
    });
  });

  it('after the build say what happened, under the same keys', () => {
    const before = pageOf('inception').labels;
    const { explain, cell, ...rest } = pageOf('construction').labels;
    expect(Object.keys(explain)).toEqual(Object.keys(before.explain));
    expect(Object.keys(cell)).toEqual(Object.keys(before.cell));
    expect(explain.flow).toMatch(/^The life of .+; the numbers are the stories that built a step\.$/);
    expect(explain.slices).toMatch(/the columns are in the order they were built in\.$/);
    expect(explain.slicesPhone).toMatch(/the stories are in the order they were built in\.$/);
    expect(explain.tests).toMatch(/ That proved the two stories work together, not only each on its own\.$/);
    expect(explain.slicesLink).toBe(before.explain.slicesLink);
    expect(cell).toEqual({
      ...before.cell,
      changes: 'changed',
      newTip: 'did not exist yet, the story created it',
      changesTip: 'existed, the story changed it',
      usesTip: 'the story relied on it, but did not change it',
    });
    expect(rest.more).toBe(before.more);
  });
});

describe('aidlc-turbo overview tense: the Certainty of a part', () => {
  const PAST = {
    open: 'At the design a choice was still open, to be made at the approval.',
    newFollows: 'New, and it followed an example in the code.',
    newOwn: 'New, with its own design: no example in the code did it the same way.',
    checked: 'At the design its place in the code was found and checked.',
    unchecked: 'At the design only the name was known. Its place in the code was not checked.',
    docs: 'At the design it was known only from documentation, not from the code.',
    assumption: 'Rested on an assumption: ',
    doubt: 'But the agent had a doubt: ',
  };

  it('after the build tells in the past what was known at the design, the colour unchanged', () => {
    expect(EN.design.reasonsBuilt).toEqual(PAST);
    expect(Object.keys(dm.REASONS_BUILT)).toEqual(Object.keys(dm.REASONS));
    expect(dm.confidence({ status: 'existing', path: 'a.js', lines: '1-9', open: 'which one?' }, true, EN)).toEqual({ level: 'red', reasons: [PAST.open] });
    expect(dm.confidence({ status: 'new', follows: { file: 'b.java' } }, true, EN).reasons).toEqual([PAST.newFollows]);
    expect(dm.confidence({ status: 'new' }, true, EN).reasons).toEqual([PAST.newOwn]);
    expect(dm.confidence({ status: 'changed', path: 'a.js' }, true, EN)).toEqual({ level: 'orange', reasons: [PAST.unchecked] });
    const c = dm.confidence({ status: 'existing', path: 'a.js', lines: '1-9', source: 'S-012', assumption: 'there is a role', doubt: 'maybe two' }, true, EN);
    expect(c).toEqual({ level: 'orange', reasons: [PAST.checked, PAST.docs, `${PAST.assumption}there is a role`, `${PAST.doubt}maybe two`] });
  });

  it('a model built with { built: true } has the past reasons; without it, and before the build, the plan reasons', () => {
    const record = render.parseYaml(readFileSync(DESIGN, 'utf8'));
    const plan = dm.designModel(record);
    const built = dm.designModel(record, { built: true });
    const all = (m: any) => m.parts.flatMap((p: any) => p.confidence.reasons);
    const pastWords = Object.values(PAST);
    expect(all(plan).some((r: string) => pastWords.some((w) => r.startsWith(w)))).toBe(false);
    expect(all(built).every((r: string) => pastWords.some((w) => r.startsWith(w)))).toBe(true);
    expect(built.parts.map((p: any) => p.confidence.level)).toEqual(plan.parts.map((p: any) => p.confidence.level));
  });

  it('the overview page after the build carries the past reasons on every part, before it the plan reasons', () => {
    const reasons = (phase: string) => pageOf(phase).design.parts.flatMap((p: any) => p.confidence.reasons);
    expect(reasons('inception')).toContain(EN.design.reasons.open);
    expect(reasons('construction')).toContain(PAST.open);
    expect(reasons('construction')).not.toContain(EN.design.reasons.open);
    expect(reasons('construction').every((r: string) => Object.values(PAST).some((w) => r.startsWith(w)))).toBe(true);
  });
});

describe('aidlc-turbo overview tense: the masthead after the build', () => {
  const BUILT = 'The inbox finds the **answer** itself. A `check` marks a hanging order as failed.';

  it('carries what the intent built from the brief closed at finish, only after the build', () => {
    const { root, intent } = fixture();
    const brief = readFileSync(intent.brief, 'utf8');
    writeFileSync(intent.brief, brief.replace(/^status: \w+$/m, `status: done\nbuilt: "${BUILT}"`));
    expect(overview.buildData(root, intent, 'construction').page.intent.built)
      .toBe('The inbox finds the answer itself. A check marks a hanging order as failed.');
    expect(overview.buildData(root, intent, 'inception').page.intent.built).toBeUndefined();
  });

  it('leads with it, else with the intent summary, never with the drawing summary as what was built', () => {
    expect(TEMPLATE).toContain('const lead = (afterBuild && intent.built) || intent.summary;');
    expect(TEMPLATE).not.toMatch(/const lead = [^;]*D\.design\.summary/);
    expect(TEMPLATE).toContain('const said = [afterBuild && intent.built, intent.plain].find((t) => t && t !== lead);');
  });

  it('finish asks for it when it closes the brief', () => {
    const step = /### 7\. Close the brief\n([\s\S]*?)\n### 8\./.exec(read('skills/construction/finish.md'))![1];
    expect(step).toMatch(/`built`/);
    expect(step).toMatch(/\*\*Built\*\*/);
    expect(step).toMatch(/Outside the Code Scaffold/);
  });
});

describe('aidlc-turbo overview tense: the words of the template', () => {
  it('knows the phase once', () => {
    expect(TEMPLATE).toContain("const afterBuild = D.phase === 'construction';");
    expect(TEMPLATE).toContain("const seamOpen = esc(TT(afterBuild ? 'seamOpenBuilt' : 'seamOpen'));");
  });

  it('names a seam without a test as planned or not, in the legend on a wide screen and on a phone', () => {
    expect(TEMPLATE.match(/\$\{seamOpen\}/g)).toHaveLength(2);
    expect(EN.overview.seamOpen).toBe('seam without a planned integration test');
    expect(EN.overview.seamOpenBuilt).toBe('seam without an integration test');
    expect(TEMPLATE).toContain("<span class=\"sl-mfeed\">${esc(TT(afterBuild ? 'noTest' : 'noTestYet'))}</span>");
    expect([EN.overview.noTest, EN.overview.noTestYet]).toEqual(['without an integration test', 'no integration test yet']);
  });

  it('links to the tests of the seams in the tense of the phase', () => {
    expect(TEMPLATE).toContain("const toTests = esc(TT(afterBuild ? 'toTestsBuilt' : 'toTests'));");
    expect(EN.overview.toTests).toBe('How these seams are tested is under Integration tests below');
    expect(EN.overview.toTestsBuilt).toBe('How these seams were tested is under Integration tests below');
  });

  it('says when a test ran after the build, and when it will run before it', () => {
    const when = /const whenRow = \(t\) => \{([\s\S]*?)\n {4}\};/.exec(TEMPLATE)![1];
    expect(when).toContain("(stageOf[t.earlier] < stageOf[t.later] ? 'whenAfter' : 'whenWith') + (afterBuild ? 'Built' : '')");
    expect(EN.overview.whenAfterBuilt).toBe('when story {later} was built, story {earlier} was already\u00a0done');
    expect(EN.overview.whenAfter).toBe('when story {later} is built, story {earlier} is already\u00a0done');
    expect(EN.overview.whenWithBuilt).toBe('story {later} was built together with story\u00a0{earlier}');
    expect(EN.overview.whenWith).toBe('when story {later} is built, together with story\u00a0{earlier}');
  });
});
