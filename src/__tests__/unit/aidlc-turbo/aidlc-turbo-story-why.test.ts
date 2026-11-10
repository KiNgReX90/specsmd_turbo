/**
 * Unit tests for a story's reason, `product.why` in the record: an optional
 * text in the record's language on why the story exists, for a reader who was
 * not in the conversation.
 * - render-specs puts it under its own heading (`md.why` of the string table,
 *   in English "Why this story"), between the user story line and the
 *   criteria, and writes no heading without it; spec-lint takes the story as
 *   it is;
 * - the overview page takes it from the record, or from the story file when
 *   the record has no product-team half, in both phases (the page data of
 *   intent-overview.cjs buildData), and the page before the build carries
 *   it in its own data block.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const render = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const overview = req(path.join(FLOW, 'scripts/intent-overview.cjs'));
const storiesOf = (root: string, intent: any, phase: string) => overview.buildData(root, intent, phase).page.stories;
const lint = req(path.join(FLOW, 'scripts/spec-lint.cjs'));
const paths = req(path.join(FLOW, 'scripts/lib/paths.cjs'));
const read = (f: string) => readFileSync(f, 'utf8');

const HEADING = '### Why this story';
const WHY = 'The service desk gets dozens of requests for a **new** password every Monday.\nThose go away when users can do it themselves.';
const WHY_PLAIN = 'The service desk gets dozens of requests for a new password every Monday. Those go away when users can do it themselves.';

/** The template intent, its record edited first, its stories rendered. */
function fixture(edit: (record: any) => void) {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-why-')), '.specs-aidlc-turbo');
  const dir = path.join(root, 'docs', 'user-auth', 'user-auth');
  mkdirSync(path.join(root, 'repo'), { recursive: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(root, 'repo', 'config.yaml'), 'mode: sandbox\n');
  const record = render.parseYaml(read(path.join(FLOW, 'templates/inception/record-template.yaml')));
  edit(record);
  writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
  const intent = paths.findIntent(root, 'user-auth');
  render.applyPlan(intent, render.planRender(intent));
  return { root, dir, intent, record };
}
const storyText = (intent: any) => read(path.join(intent.stories, '001-login-expired-password.md'));

describe('aidlc-turbo story reason: the story file', () => {
  it('renders the reason under its heading, between the user story and the criteria', () => {
    const { intent } = fixture((r) => { r.stories[0].product.why = WHY; });
    const story = storyText(intent);
    const asA = story.indexOf('\n**As** user with an expired password');
    const head = story.indexOf(`\n${HEADING}\n`);
    const crit = story.indexOf('\n### Acceptance criteria\n');
    expect(asA).toBeGreaterThan(0);
    expect(head).toBeGreaterThan(asA);
    expect(crit).toBeGreaterThan(head);
    expect(story.slice(head, crit)).toContain('The service desk gets dozens of requests for a **new** password every Monday.\nThose go away');
  });

  it('writes no reason heading for a story without a reason, or with an empty one', () => {
    const { intent } = fixture((r) => { delete r.stories[0].product.why; });
    expect(storyText(intent)).not.toContain(HEADING);
    const blank = fixture((r) => { r.stories[0].product.why = '  '; });
    expect(storyText(blank.intent)).not.toContain(HEADING);
  });

  it('passes spec-lint with a reason, its headings complete and in order', () => {
    const { root, intent } = fixture((r) => { r.stories[0].product.why = WHY; });
    const about = lint.lintIntent(intent, root).findings
      .filter((f: any) => f.file.includes('001-') && (f.rule === 'heading' || /\bwhy\b/i.test(f.message)));
    expect(about).toEqual([]);
  });
});

describe('aidlc-turbo story reason: the overview page', () => {
  it('takes the reason from the record, as plain text', () => {
    const { root, intent } = fixture((r) => { r.stories[0].product.why = WHY; });
    for (const phase of ['inception', 'construction']) {
      const [first] = storiesOf(root, intent, phase);
      expect(first.why).toBe(WHY_PLAIN);
    }
  });

  it('has no reason for a story without one', () => {
    const { root, intent } = fixture((r) => { delete r.stories[0].product.why; });
    expect(storiesOf(root, intent, 'inception')[0].why).toBeNull();
  });

  it('reads the reason from the story file when the record has no product half, and keeps it out of the criteria', () => {
    const { root, dir, intent, record } = fixture((r) => { r.stories[0].product.why = WHY; });
    const story = storyText(intent);
    delete record.stories[0].product;
    writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
    writeFileSync(path.join(intent.stories, '001-login-expired-password.md'), story);
    const [first] = storiesOf(root, intent, 'inception');
    expect(first.why).toBe(WHY_PLAIN);
    expect(first.story).toEqual({ asA: 'user with an expired password', iWant: 'to choose a new password right when I log in', soThat: 'I can go on working without the service desk.' });
    expect(JSON.stringify(first.criteria)).not.toContain('service desk gets');
    expect(first.criteria[0]).toEqual({ given: 'an account with an expired password', when: 'I log in with that password', then: 'I see the screen to choose a new password' });
  });

  it('the page before the build carries it in its data', () => {
    const { root, intent } = fixture((r) => { r.stories[0].product.why = WHY; });
    const script = path.join(FLOW, 'scripts/intent-overview.cjs');
    const r = spawnSync(process.execPath, [script, 'user-auth', '--no-open', '--root', root, '--phase', 'inception'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const data = /<script id="overview-data" type="application\/json">([\s\S]*?)<\/script>/.exec(read(intent.overview))![1];
    expect(JSON.parse(data).stories[0].why).toBe(WHY_PLAIN);
  });
});
