/**
 * AI-DLC Turbo - a record renders in the language it is written in.
 *
 * The record carries intent.language; the brief, the stories and the overview
 * page take every fixed text from the string table of that language:
 * - an en record renders the English headings, and spec-lint passes it;
 * - a record in a language the flow does not ship reads the project's own
 *   table (.specs-aidlc-turbo/repo/lang/{code}.json), every key the table
 *   lacks in English, and spec-lint checks the headings of that table. The
 *   tests use an invented language, `xx`, whose table is English in capitals;
 * - a language without any table renders English;
 * - the overview page says the language it is written in.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const render = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const lint = req(path.join(FLOW, 'scripts/spec-lint.cjs'));
const paths = req(path.join(FLOW, 'scripts/lib/paths.cjs'));
const OVERVIEW = path.join(FLOW, 'scripts/intent-overview.cjs');

/** The xx table: the md words of English in capitals, `none` and `tester` left out so they come from English. */
const XX_MD = {
  product: 'FOR THE PRODUCT TEAM',
  asA: 'AS',
  iWant: 'I WANT',
  soThat: 'SO THAT',
  why: 'WHY THIS STORY',
  criteria: 'ACCEPTANCE CRITERIA',
  given: 'GIVEN',
  when: 'WHEN',
  then: 'THEN',
  outOfScope: 'OUT OF SCOPE',
  via: { ui: 'SCREEN' },
};

/** An intent from the record template, in `language` (none: the template's own), with an optional project table and edit. */
function fixture(language: string | null, { table, edit }: { table?: Record<string, unknown>; edit?: (record: any) => void } = {}) {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-record-lang-')), '.specs-aidlc-turbo');
  const dir = path.join(root, 'docs', 'user-auth', 'user-auth');
  mkdirSync(path.join(root, 'repo', 'lang'), { recursive: true });
  mkdirSync(dir, { recursive: true });
  if (table && language) writeFileSync(path.join(root, 'repo', 'lang', `${language}.json`), JSON.stringify(table));
  const record = render.parseYaml(readFileSync(path.join(FLOW, 'templates/inception/record-template.yaml'), 'utf8'));
  if (language) record.intent.language = language;
  if (edit) edit(record);
  writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
  const intent = paths.findIntent(root, 'user-auth');
  render.applyPlan(intent, render.planRender(intent));
  return { root, dir, intent };
}

const storyOf = (intent: any) => readFileSync(path.join(intent.dir, 'stories', readdirSync(path.join(intent.dir, 'stories'))[0]), 'utf8');

function overviewOf(f: { root: string; intent: any }) {
  const r = spawnSync(process.execPath, [OVERVIEW, 'user-auth', '--no-open', '--root', f.root], { encoding: 'utf8' });
  expect(r.status, r.stdout + r.stderr).toBe(0);
  return readFileSync(f.intent.overview, 'utf8');
}

describe('aidlc-turbo record language: the markdown', () => {
  it('the record template is written in English and says so', () => {
    const record = render.parseYaml(readFileSync(path.join(FLOW, 'templates/inception/record-template.yaml'), 'utf8'));
    expect(record.intent.language).toBe('en');
    expect(record.purpose).toMatch(/^Users with an expired password/);
    expect(record.stories[0].product).toMatchObject({ as_a: 'user with an expired password' });
    expect(record.stories[0].product.why).toBeTruthy();
  });

  it('an en record renders the English headings, and spec-lint passes it', () => {
    const f = fixture('en');
    const story = storyOf(f.intent);
    expect(story).toContain('## For the product team');
    expect(story).toMatch(/\*\*As\*\* .+, \*\*I want\*\* .+, \*\*so that\*\* /);
    expect(story).toContain('### Why this story');
    expect(story).toContain('### Acceptance criteria');
    expect(story).toContain('- **Given** an account with an expired password **when** I log in with that password **then** I see the screen to choose a new password *(tester: screen)*');
    expect(story).toContain('### Out of scope');
    expect(lint.lintIntent(f.intent, f.root).findings).toEqual([]);
  });

  it('a story without a why renders no Why heading, and spec-lint passes it', () => {
    const f = fixture('en', { edit: (r) => { delete r.stories[0].product.why; } });
    expect(storyOf(f.intent)).not.toContain('### Why this story');
    expect(lint.lintIntent(f.intent, f.root).findings).toEqual([]);
  });

  it('a project table renders its own words, English where it has none, and spec-lint passes it', () => {
    const f = fixture('xx', { table: { md: XX_MD } });
    const story = storyOf(f.intent);
    expect(story).toContain('## FOR THE PRODUCT TEAM');
    expect(story).toMatch(/\*\*AS\*\* .+, \*\*I WANT\*\* .+, \*\*SO THAT\*\* /);
    expect(story).toContain('### WHY THIS STORY');
    expect(story).toContain('### ACCEPTANCE CRITERIA');
    expect(story).toContain('- **GIVEN** an account with an expired password **WHEN** I log in with that password **THEN** I see the screen to choose a new password *(tester: SCREEN)*');
    expect(story).toContain('*(tester: none, code level, a tester sees no difference here)*');
    expect(story).toContain('### OUT OF SCOPE');
    expect(story).not.toContain('## For the product team');
    expect(lint.lintIntent(f.intent, f.root).findings).toEqual([]);
  });

  it('spec-lint reads the headings of the record language: English headings fail an xx record', () => {
    const f = fixture('xx', { table: { md: XX_MD } });
    const file = path.join(f.intent.stories, readdirSync(f.intent.stories)[0]);
    writeFileSync(file, readFileSync(file, 'utf8').replace('### ACCEPTANCE CRITERIA', '### Acceptance criteria'));
    const rules = lint.lintIntent(f.intent, f.root).findings.map((x: any) => `${x.rule}: ${x.message}`).join('\n');
    expect(rules).toContain('heading: "### ACCEPTANCE CRITERIA" is missing');
  });

  it('a language without a table renders English', () => {
    const story = storyOf(fixture('fi').intent);
    expect(story).toContain('## For the product team');
    expect(story).toContain('### Acceptance criteria');
  });

  it('the agent half keeps its English section names in every language', () => {
    const story = storyOf(fixture('xx', { table: { md: XX_MD } }).intent);
    for (const h of ['## For the agent', '### Context to read', '### Implementation notes', '### Test plan', '### Build notes']) expect(story).toContain(h);
  });

  it('the brief keeps its English headings and renders the purpose under ## Intent', () => {
    const f = fixture('xx', { table: { md: XX_MD } });
    const brief = readFileSync(f.intent.brief, 'utf8');
    expect(brief).toMatch(/## Intent\n\nUsers with an expired password/);
    expect(brief).toContain('## Requirements');
  });
});

describe('aidlc-turbo record language: the overview page', () => {
  it('an en record gets a page with lang="en"', () => {
    expect(overviewOf(fixture('en'))).toMatch(/<html lang="en"/);
  });

  it('a record without a language is English', () => {
    expect(overviewOf(fixture(null, { edit: (r) => { delete r.intent.language; } }))).toMatch(/<html lang="en"/);
  });

  it('a language with a project table gets a page in that language', () => {
    expect(overviewOf(fixture('xx', { table: { md: XX_MD } }))).toMatch(/<html lang="xx"/);
  });
});
