/**
 * Unit tests for render-specs.cjs, the script that turns an intent's
 * record.yaml into brief.md and its stories. There is no writer agent any
 * more, so these guards keep the render trustworthy:
 * - the record template is valid YAML and reads the same with the flow's own
 *   reader as with js-yaml, and it renders as it stands;
 * - the story has the fixed headings: a product-team half in the record's
 *   language (here English) with unnumbered Given/when/then criteria and an
 *   optional Why this story, and the English agent half;
 * - the render is deterministic, and a rerun keeps what later steps wrote
 *   (status, dates, commit, branch, Build notes, Lessons, extra keys);
 * - --check names every file that drifted from the record;
 * - a record with a missing key is refused with the key named; break_test is
 *   optional and renders as false;
 * - every criterion says where a tester checks it: the story lists the
 *   observed_via values in its frontmatter, each criterion line ends in its
 *   tester note in the record's language, and tester_verifiable is derived
 *   from the criteria. A
 *   record from before the field still renders with its own tester_verifiable;
 * - a decision with source `assumption` ends in "Assumption: no code backs
 *   it." in the brief, so the cross-checker checks it; any other source
 *   renders as before;
 * - every integration test of a story becomes a line of its test plan,
 *   naming the earlier story; the rest of the overview data (lifecycle,
 *   layers, slices, short names) stays in the record, and a record without
 *   it renders as before; the plain texts stay out of the markdown too;
 * - the Code Scaffold (technical_design.drawing) closes the brief's
 *   Technical design, and a story's drawing follows its Design; a record
 *   without one renders as before; a story whose heading was changed by hand
 *   gets the rendered one back and keeps its Build notes;
 * - a story that already started is never removed by a render;
 * - an old-layout root stops with the migration message.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';
import yaml from 'js-yaml';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const SCRIPT = path.join(FLOW, 'scripts/render-specs.cjs');
const TEMPLATE = path.join(FLOW, 'templates/inception/record-template.yaml');
const req = createRequire(import.meta.url);
const render = req(SCRIPT);
const fm = req(path.join(FLOW, 'scripts/frontmatter.cjs'));
const lang = req(path.join(FLOW, 'scripts/lib/lang.cjs'));
/** An invented language for the table tests: English in capitals. */
const XX = lang.merge(lang.load('en'), { md: { tester: 'TESTER', coveredBy: 'COVERED BY S{id}', via: { ui: 'SCREEN', none: 'NONE' } } });

function run(root: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

/** A root with the template record, plus a second story that depends on the first. */
function fixture(edit?: (record: any) => void) {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-render-')), '.specs-aidlc-turbo');
  const dir = path.join(root, 'docs', 'user-auth', 'user-auth');
  mkdirSync(dir, { recursive: true });
  const record = render.parseYaml(readFileSync(TEMPLATE, 'utf8'));
  record.stories.push({
    ...record.stories[0],
    id: '002',
    slug: 'reset-link',
    title: 'Reset link',
    depends_on: ['001'],
    requirements: ['FR-1'],
    touches: ['src/auth/reset.ts'],
  });
  if (edit) edit(record);
  writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
  return { root, dir, record };
}

const read = (file: string) => readFileSync(file, 'utf8');
const DRAWING = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');
const design = req(path.join(FLOW, 'scripts/lib/design-render.cjs'));

describe('aidlc-turbo render-specs', () => {
  it('reads the record template exactly like js-yaml does, and the template renders', () => {
    const text = read(TEMPLATE);
    const ours = render.parseYaml(text);
    expect(ours).toEqual(yaml.load(text, { schema: yaml.CORE_SCHEMA }));
    expect(render.missingKeys(ours)).toEqual([]);
    for (const key of ['intent', 'lane', 'purpose', 'requirements', 'decisions', 'standards_deltas', 'verification', 'deliberately_not', 'stories']) {
      expect(ours).toHaveProperty(key);
    }
    for (const key of ['slug', 'inception', 'title', 'language', 'created']) expect(ours.intent).toHaveProperty(key);
    expect(ours.intent.language).toBe('en');
    for (const key of ['id', 'slug', 'title', 'complexity', 'depends_on', 'touches', 'sources', 'requirements',
      'break_test', 'surface', 'db_tables', 'test_data', 'product', 'agent']) {
      expect(ours.stories[0]).toHaveProperty(key);
    }
    // Render derives tester_verifiable; every criterion says where a tester checks it, and one shows none.
    expect(ours.stories[0]).not.toHaveProperty('tester_verifiable');
    const criteria = ours.stories[0].product.criteria;
    expect(criteria.every((c: any) => render.VIA.includes(c.observed_via))).toBe(true);
    expect(criteria.find((c: any) => c.observed_via === 'none').why_none).toEqual(expect.any(String));
    expect(Object.keys(ours.stories[0].product)).toEqual(['as_a', 'i_want', 'so_that', 'why', 'criteria', 'out_of_scope']);
    expect(Object.keys(ours.stories[0].agent)).toEqual(['context', 'design', 'implementation_notes', 'edge_cases', 'test_plan']);
    // The overview data: the lifecycle and the layers on the record, a short name, a slice and the integration tests per story.
    expect(Object.keys(ours.overview)).toEqual(['lifecycle', 'layers']);
    for (const key of ['subject', 'lanes', 'states', 'steps', 'arrows']) expect(ours.overview.lifecycle).toHaveProperty(key);
    const layers = ours.overview.layers.map((l: any) => l.id);
    expect(Object.keys(ours.stories[0].slice).every((k) => layers.includes(k))).toBe(true);
    expect(ours.stories[0].short.length).toBeLessThanOrEqual(24);
    // The first story has no earlier story to test with; the template shows the shape in a comment.
    expect(ours.stories[0].integration).toEqual([]);
    expect(text).toMatch(/#\s+- with: "001"/);
    expect(text).toMatch(/#\s+test: /);
    // The Code Scaffold is optional: the template shows its shape in comments, for the record and per story.
    expect(ours.technical_design).not.toHaveProperty('drawing');
    expect(text).toMatch(/^  #\s+drawing:/m);
    expect(text).toMatch(/^    #\s+drawing:/m);
    for (const key of ['summary', 'modules', 'parts', 'links', 'builds', 'uses']) expect(text).toMatch(new RegExp(`#\\s+(- )?${key}:`));
    // Every arrow proven: the link example carries its proof, and the comment names adds.
    expect(text).toMatch(/^  #\s+- \{ from: login, to: users,.* proof: \{ file: .+, lines: .+ \} \}$/m);
    expect(text).toMatch(/#.*adds/);
  });

  it('reads the YAML shapes a record uses, and dumps what it reads back', () => {
    const text = [
      'a: "x: \\"y\\""   # comment',
      'b: |', '  one', '  two # kept', '',
      'c: >-', '  folded', '  line',
      'd: [S-001, "S-002", \'it\'\'s\']',
      'e:', '- { quote: "a, b", line: 3, kind: rule }', '- plain: yes',
      'f: long plain', '  continued',
      'g: 001',
    ].join('\n');
    const v = render.parseYaml(text);
    expect(v).toEqual({
      a: 'x: "y"', b: 'one\ntwo # kept\n', c: 'folded line', d: ['S-001', 'S-002', "it's"],
      e: [{ quote: 'a, b', line: 3, kind: 'rule' }, { plain: 'yes' }], f: 'long plain continued', g: 1,
    });
    expect(render.parseYaml(render.dumpYaml(v))).toEqual(v);
    expect(render.storyId(1)).toBe('001');
    expect(() => render.parseYaml('a: [1, 2')).toThrow(/YAML/);
  });

  it('renders the brief and the stories with the fixed headings, deterministically', () => {
    const { root, dir } = fixture();
    expect(run(root, 'user-auth').code).toBe(0);
    const brief = read(path.join(dir, 'brief.md'));
    const story = read(path.join(dir, 'stories', '001-login-expired-password.md'));
    expect(readdirSync(path.join(dir, 'stories')).sort()).toEqual(['001-login-expired-password.md', '002-reset-link.md']);

    const bfm = fm.extractFrontmatter(brief);
    expect(bfm).toMatchObject({ id: 'user-auth', status: 'draft', lane: 'full', created: '2026-09-29', approved: null, branch: null });
    const order = ['## Intent', '## Requirements', '## Design decisions', '## Domain model', '## Technical design',
      '## Codebase reading list', '## Standards deltas', '## Verification', '## Lessons', '## Story map'];
    expect(order.map((h) => brief.indexOf(`\n${h}\n`))).toEqual([...order.map((h) => brief.indexOf(`\n${h}\n`))].sort((a, b) => a - b));
    expect(brief).toContain('## Intent\n\nUsers with an expired password renew it themselves');
    expect(brief).toContain('- **FR-1**: A login with an expired password opens the reset screen instead of failing. Sources: S-001');
    expect(brief).toContain('- **D-1**: Expiry is checked at login. Reason: No scheduler exists in this project. Dropped: A nightly job');
    expect(brief).toContain('- `npm test`');
    expect(brief).toContain('| 002 | Reset link | 001 | FR-1 | yes | users |');
    expect(brief).not.toContain('must hold');

    const sfm = fm.extractFrontmatter(story);
    expect(sfm).toMatchObject({ id: '001', status: 'todo', touches: ['src/auth/login.ts', 'src/auth/login.test.ts'], sources: ['S-001'], surface: 'ui' });
    const headings = ['## For the product team', '### Why this story', '### Acceptance criteria', '### Out of scope', '## For the agent',
      '### Context to read', '### Design', '### Implementation notes', '### Edge cases and errors', '### Test plan', '### Build notes'];
    const at = headings.map((h) => story.indexOf(`\n${h}\n`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(story).toContain('**As** user with an expired password, **I want** to choose a new password right when I log in, **so that** I can go on working without the service desk.');
    expect(story).toContain('### Why this story\n\nThe service desk gets requests every week to renew an expired password');
    expect(story).toContain('- **Given** an account with an expired password **when** I log in with that password **then** I see');
    expect(story).toContain('### Out of scope\n\n- Two-step verification');
    expect(story).not.toMatch(/^\s*1\.\s/m);
    expect(story).toContain('| File | Lines | Why |');

    const before = [brief, story];
    const again = run(root, 'user-auth');
    expect(again.out).toContain('0 written, 3 unchanged');
    expect([read(path.join(dir, 'brief.md')), read(path.join(dir, 'stories', '001-login-expired-password.md'))]).toEqual(before);
    expect(run(root, 'user-auth', '--check').code).toBe(0);
  });

  it('writes break_test into every story, false when the record leaves it out', () => {
    const { root, dir } = fixture((r) => { delete r.stories[1].break_test; });
    expect(render.missingKeys(render.parseYaml(read(path.join(dir, 'record.yaml'))))).toEqual([]);
    expect(run(root, 'user-auth').code).toBe(0);
    const story = (name: string) => fm.extractFrontmatter(read(path.join(dir, 'stories', name)));
    expect(story('001-login-expired-password.md').break_test).toBe(true);
    expect(story('002-reset-link.md').break_test).toBe(false);
  });

  it('marks a decision on an assumption in the brief, and only that one', () => {
    const { root, dir } = fixture((r) => {
      r.decisions.push({ id: 'D-2', answer: 'The reset screen gets a right of its own', why: 'No existing right fits', dropped: 'The login right', source: 'assumption' });
    });
    expect(run(root, 'user-auth').code).toBe(0);
    const brief = read(path.join(dir, 'brief.md'));
    expect(brief).toContain('- **D-2**: The reset screen gets a right of its own. Reason: No existing right fits. Dropped: The login right. Assumption: no code backs it.');
    expect(brief).toMatch(/- \*\*D-1\*\*: Expiry is checked at login\. Reason: No scheduler exists in this project\. Dropped: A nightly job[^\n]*\.\n/);
    expect(brief.match(/Assumption: no code backs it\./g)).toHaveLength(1);
  });

  it('renders where a tester checks each criterion, and derives tester_verifiable from it', () => {
    const { root, dir } = fixture((r) => {
      const line = (then: string, via: Record<string, string>) => ({ given: 'an account', when: 'I log in', then, ...via });
      r.stories[0].product = {
        ...r.stories[0].product,
        criteria: [
          line('I see the reset screen', { observed_via: 'ui' }),
          line('POST /login answers 303', { observed_via: 'api' }),
          line('USERS holds the status Expired', { observed_via: 'db' }),
          line('the login log has a line for it.', { observed_via: 'log' }),
          line('no code calls checkPasswordAge any more', { observed_via: 'none', why_none: 'code level, a tester sees no difference here' }),
        ],
      };
      // The record still says true: render follows the criteria, spec-lint flags the key.
      r.stories[1].tester_verifiable = true;
      r.stories[1].product = {
        ...r.stories[1].product,
        criteria: [
          line('the reset link is valid for an hour', { observed_via: 'none', covered_by: '001' }),
          line('the old table stays empty', { observed_via: 'none', why_none: 'code level' }),
        ],
      };
    });
    expect(run(root, 'user-auth').code).toBe(0);
    const first = read(path.join(dir, 'stories', '001-login-expired-password.md'));
    const second = read(path.join(dir, 'stories', '002-reset-link.md'));
    expect(first).toMatch(/^tester_verifiable: true\nobserved_via: \[ui, api, db, log, none\]\nbreak_test: /m);
    expect(fm.extractFrontmatter(first)).toMatchObject({ tester_verifiable: true, observed_via: ['ui', 'api', 'db', 'log', 'none'] });
    expect(first).toContain('**then** I see the reset screen *(tester: screen)*\n');
    expect(first).toContain('**then** POST /login answers 303 *(tester: API)*\n');
    expect(first).toContain('**then** USERS holds the status Expired *(tester: database)*\n');
    expect(first).toContain('**then** the login log has a line for it. *(tester: log)*\n');
    expect(first).toContain('**then** no code calls checkPasswordAge any more *(tester: none, code level, a tester sees no difference here)*\n');
    expect(fm.extractFrontmatter(second)).toMatchObject({ tester_verifiable: false, observed_via: ['none', 'none'] });
    expect(second).toContain('**then** the reset link is valid for an hour *(tester: none, covered by S001 Login with expired password)*\n');
    expect(second).toContain('**then** the old table stays empty *(tester: none, code level)*\n');
    // The overview page reads the note with this pattern.
    for (const l of [...first.split('\n'), ...second.split('\n')].filter((x) => x.startsWith('- **Given**'))) {
      expect(l).toMatch(/\s\*\(tester: ([^)]*)\)\*\s*$/);
    }
    const brief = read(path.join(dir, 'brief.md'));
    expect(brief).toContain('| 001 | Login with expired password | - | FR-1, NFR-1 | yes | users |');
    expect(brief).toContain('| 002 | Reset link | 001 | FR-1 | no | users |');
    expect(run(root, 'user-auth', '--check').code).toBe(0);
    // The note names the story by its title, in the words of the table of the record's language.
    expect(render.viaSuffix({ observed_via: 'none', covered_by: 3 }, [{ id: '003', title: 'Other story' }], XX)).toBe(' *(TESTER: NONE, COVERED BY S003 Other story)*');
    expect(render.viaSuffix({ observed_via: 'ui' }, [], XX)).toBe(' *(TESTER: SCREEN)*');
    expect(render.viaSuffix({ observed_via: 'api' }, [], XX)).toBe(' *(TESTER: API)*');
    expect(render.viaSuffix({ observed_via: 'ui' }, [])).toBe(' *(tester: screen)*');
    expect(render.viaSuffix({ observed_via: 'none', covered_by: 3 }, [{ id: '003', title: 'Other story' }])).toBe(' *(tester: none, covered by S003 Other story)*');
    // A parenthesis in the title would end the note early on the overview page.
    expect(render.viaSuffix({ observed_via: 'none', covered_by: '003' }, [{ id: '003', title: 'Issue a gift card (physical)' }])).toBe(' *(tester: none, covered by S003 Issue a gift card physical)*');
  });

  it('renders every integration test into the test plan, after its own lines, and keeps the overview data out of the markdown', () => {
    const test = 'Resetting through the link clears the expiry that the login check reads';
    const { root, dir } = fixture((r) => {
      r.intent.plain = 'Plain words for the overview page.';
      r.stories[1].plain = 'Plain story words for the overview page.';
      r.stories[1].short = 'Via the link';
      r.stories[1].slice = { 't-users': 'used', 'reset-screen': 'new' };
      r.stories[1].integration = [{ with: '001', test }];
    });
    expect(run(root, 'user-auth').code).toBe(0);
    const first = read(path.join(dir, 'stories', '001-login-expired-password.md'));
    const second = read(path.join(dir, 'stories', '002-reset-link.md'));
    expect(second).toContain([
      '### Test plan', '',
      '- Unit: isExpired on the boundary date',
      '- Integration: POST /login with an expired user returns 303',
      '- Verification command: npm test',
      `- Integration with S001 Login with expired password: ${test}`, '',
      '### Build notes',
    ].join('\n'));
    expect(first).not.toContain('Integration with S');
    // short, slice, plain and the overview are read by the overview page from the record, never rendered.
    const brief = read(path.join(dir, 'brief.md'));
    for (const text of [first, second, brief]) {
      for (const part of ['Via the link', 'used', 't-users', 'Expiry check', 'Check the expiry date', 'short', 'slice', 'Plain words', 'Plain story words']) {
        expect(text).not.toContain(part);
      }
    }
    expect(run(root, 'user-auth', '--check').code).toBe(0);

    // The integration line belongs to the story, so a changed test makes it differ; the overview data does not.
    const recordFile = path.join(dir, 'record.yaml');
    const record = render.parseYaml(read(recordFile));
    record.stories[1].short = 'Link';
    record.stories[1].slice = { 'reset-screen': 'used' };
    record.overview.layers.pop();
    record.overview.lifecycle.subject = 'an account';
    record.stories[1].plain = 'Other plain words.';
    writeFileSync(recordFile, render.dumpYaml(record));
    expect(run(root, 'user-auth', '--check').code).toBe(0);
    record.stories[1].integration[0].test = 'Another test';
    writeFileSync(recordFile, render.dumpYaml(record));
    const check = run(root, 'user-auth', '--check');
    expect(check.code).toBe(1);
    expect(check.out).toContain('stories/002-reset-link.md: differs');
    expect(check.out).not.toContain('001-login-expired-password.md');
  });

  it('renders integration lines without a test plan of its own, and names a story the record lacks by its id', () => {
    const story = { id: '003', integration: [{ with: 1, test: 'Uses the real table' }, { with: '009', test: 'Reads its rows' }, { with: '001' }, { test: 'No story' }] };
    expect(render.integrationLines(story, [{ id: '001', title: 'Login with\nexpired password' }])).toEqual([
      '- Integration with S001 Login with expired password: Uses the real table',
      '- Integration with S009: Reads its rows',
    ]);
    expect(render.integrationLines({ id: '001' }, [])).toEqual([]);
    const { root, dir } = fixture((r) => {
      r.stories[1].agent = { ...r.stories[1].agent, test_plan: [] };
      r.stories[1].integration = [{ with: '001', test: 'The reset reads the real users table' }];
    });
    expect(run(root, 'user-auth').code).toBe(0);
    expect(read(path.join(dir, 'stories', '002-reset-link.md'))).toContain('### Test plan\n\n- Integration with S001 Login with expired password: The reset reads the real users table\n\n### Build notes');
  });

  it('renders a record without any overview data as before', () => {
    const { root, dir } = fixture((r) => {
      delete r.overview;
      r.stories.forEach((s: any) => { delete s.short; delete s.slice; delete s.integration; });
    });
    expect(render.missingKeys(render.parseYaml(read(path.join(dir, 'record.yaml'))))).toEqual([]);
    expect(run(root, 'user-auth').code).toBe(0);
    expect(read(path.join(dir, 'stories', '002-reset-link.md'))).toContain('- Verification command: npm test\n\n### Build notes');
    expect(run(root, 'user-auth', '--check').code).toBe(0);
  });

  it('closes the Technical design with the Code Scaffold, and puts a story\'s own after its Design', () => {
    const drawing = render.parseYaml(read(DRAWING));
    const { root, dir } = fixture((r) => {
      r.technical_design.drawing = drawing.technical_design.drawing;
      r.stories[0].drawing = drawing.stories[3].drawing;
    });
    expect(run(root, 'user-auth').code).toBe(0);
    const record = render.parseYaml(read(path.join(dir, 'record.yaml')));
    const brief = read(path.join(dir, 'brief.md'));
    expect(brief).toContain(`- **Integration points**: None\n\n${design.briefSection(record)}\n\n## Codebase reading list\n`);
    const first = read(path.join(dir, 'stories', '001-login-expired-password.md'));
    expect(first).toContain(`### Design\n\nHonour D-1. The check lives in the login service, before the session is created.\n\n${design.storySection(record, record.stories[0])}\n\n### Implementation notes\n`);
    expect(first).toContain(`### Code Scaffold\n\n${drawing.stories[3].drawing.summary}`);
    expect(read(path.join(dir, 'stories', '002-reset-link.md'))).not.toContain('Code Scaffold');
    expect(run(root, 'user-auth', '--check').code).toBe(0);

    // A story whose heading was changed by hand gets the rendered one back, and keeps the builder's notes.
    const file = path.join(dir, 'stories', '001-login-expired-password.md');
    const notes = '- **Outside the Code Scaffold**:\n  - `src/auth/TokenCache.ts`: needed for the session.';
    writeFileSync(file, first.replace('### Code Scaffold', '### Code Sketch').replace('### Build notes\n\nNone.', `### Build notes\n\n${notes}`));
    expect(run(root, 'user-auth', '--check').out).toContain('stories/001-login-expired-password.md: differs');
    expect(run(root, 'user-auth').code).toBe(0);
    const again = read(file);
    expect(again).toContain(`### Code Scaffold\n\n${drawing.stories[3].drawing.summary}`);
    expect(again).not.toContain('### Code Sketch');
    expect(again.endsWith(`### Build notes\n\n${notes}\n`)).toBe(true);

    // What a story builds belongs to that story: a change makes it differ, and only it.
    const built = Object.keys(record.stories[0].drawing.builds)[0];
    record.stories[0].drawing.builds[built] = 'adds something else';
    writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
    const check = run(root, 'user-auth', '--check');
    expect(check.out).toContain('stories/001-login-expired-password.md: differs');
    expect(check.out).not.toContain('brief.md');

    // A technical design that is only a drawing shows the drawing alone, never None.
    const only = fixture((r) => { r.technical_design = { drawing: drawing.technical_design.drawing }; });
    expect(run(only.root, 'user-auth').code).toBe(0);
    expect(read(path.join(only.dir, 'brief.md'))).toContain(`## Technical design\n\n### Code Scaffold\n\n${drawing.technical_design.drawing.summary}`);
  });

  it('still renders a record from before observed_via, with its own tester_verifiable', () => {
    const legacy = (r: any) => {
      r.stories.forEach((s: any, i: number) => {
        s.tester_verifiable = i === 0;
        s.product = { ...s.product, criteria: [{ given: 'an account', when: 'I log in', then: 'I see the reset screen' }, 'A free line'] };
      });
    };
    const { root, dir } = fixture(legacy);
    expect(run(root, 'user-auth').code).toBe(0);
    const first = read(path.join(dir, 'stories', '001-login-expired-password.md'));
    expect(fm.extractFrontmatter(first)).toMatchObject({ tester_verifiable: true });
    expect(fm.extractFrontmatter(first)).not.toHaveProperty('observed_via');
    expect(first).toContain('**then** I see the reset screen\n- A free line\n');
    expect(first).not.toContain('*(tester:');
    expect(fm.extractFrontmatter(read(path.join(dir, 'stories', '002-reset-link.md'))).tester_verifiable).toBe(false);
    expect(read(path.join(dir, 'brief.md'))).toContain('| 002 | Reset link | 001 | FR-1 | no | users |');

    // Not every criterion says where a tester checks it, and no tester_verifiable: refused, the key named.
    const refused = fixture((r) => { legacy(r); delete r.stories[1].tester_verifiable; });
    const r = run(refused.root, 'user-auth');
    expect(r.code).toBe(1);
    expect(r.out).toContain('stories[1].tester_verifiable');
    expect(r.out).not.toContain('stories[0].tester_verifiable');
  });

  it('drops an observed_via list on disk that the record no longer gives', () => {
    const { root, dir } = fixture();
    run(root, 'user-auth');
    const storyFile = path.join(dir, 'stories', '002-reset-link.md');
    expect(fm.extractFrontmatter(read(storyFile)).observed_via).toEqual(['ui', 'none']);
    const recordFile = path.join(dir, 'record.yaml');
    const record = render.parseYaml(read(recordFile));
    record.stories[1].tester_verifiable = true;
    record.stories[1].product.criteria = [{ given: 'an account', when: 'I log in', then: 'I see the reset screen' }];
    writeFileSync(recordFile, render.dumpYaml(record));
    expect(run(root, 'user-auth', '--check').out).toContain('stories/002-reset-link.md: differs');
    expect(run(root, 'user-auth').code).toBe(0);
    expect(fm.extractFrontmatter(read(storyFile))).not.toHaveProperty('observed_via');
    expect(run(root, 'user-auth', '--check').code).toBe(0);
  });

  it('keeps what later steps wrote: state fields, Build notes, Lessons and extra keys', () => {
    const { root, dir } = fixture();
    run(root, 'user-auth');
    const storyFile = path.join(dir, 'stories', '001-login-expired-password.md');
    const briefFile = path.join(dir, 'brief.md');
    // As story-complete.cjs does it: a js-yaml rewrite of the frontmatter.
    const story = read(storyFile);
    const data = { ...fm.extractFrontmatter(story), status: 'done', completed: '2026-10-02', commit: '1234567', branch: 'shop/s001', jira: 'SHOP-1' };
    writeFileSync(storyFile, fm.updateFrontmatter(story, data).replace('### Build notes\n\nNone.', '### Build notes\n\n- Changed src/auth/login.ts'));
    const brief = read(briefFile);
    writeFileSync(briefFile, fm.updateFrontmatter(brief, { ...fm.extractFrontmatter(brief), status: 'building', approved: '2026-09-30', mode: 'production', branch: 'shop/intent-user-auth/intent' })
      .replace('## Lessons\n\nNone.', '## Lessons\n\n- Run the tests with TZ=UTC'));

    expect(run(root, 'user-auth', '--check').code).toBe(0);
    expect(run(root, 'user-auth').code).toBe(0);
    const s = fm.extractFrontmatter(read(storyFile));
    expect(s).toMatchObject({ status: 'done', completed: '2026-10-02', commit: '1234567', branch: 'shop/s001', jira: 'SHOP-1', created: '2026-09-29' });
    expect(read(storyFile)).toContain('### Build notes\n\n- Changed src/auth/login.ts');
    expect(fm.extractFrontmatter(read(briefFile))).toMatchObject({ status: 'building', approved: '2026-09-30', mode: 'production', branch: 'shop/intent-user-auth/intent' });
    expect(read(briefFile)).toContain('## Lessons\n\n- Run the tests with TZ=UTC');
  });

  it('--check names every file that differs from the record, and writes nothing', () => {
    const { root, dir } = fixture();
    run(root, 'user-auth');
    const storyFile = path.join(dir, 'stories', '002-reset-link.md');
    writeFileSync(storyFile, read(storyFile).replace('**then** I see', '**then** I perhaps see'));
    const r = run(root, 'user-auth', '--check');
    expect(r.code).toBe(1);
    expect(r.out).toContain('stories/002-reset-link.md: differs');
    expect(r.out).not.toContain('brief.md');
    expect(read(storyFile)).toContain('perhaps');
    const json = JSON.parse(run(root, 'user-auth', '--check', '--json').out);
    expect(json.diffs).toEqual([{ file: 'stories/002-reset-link.md', problem: 'differs' }]);
  });

  it('refuses a record that misses a required key, and names the key', () => {
    const { root, dir } = fixture((r) => {
      delete r.purpose;
      delete r.stories[1].product.so_that;
      r.verification = [];
    });
    const r = run(root, 'user-auth');
    expect(r.code).toBe(1);
    expect(r.out).toContain('purpose');
    expect(r.out).toContain('stories[1].product.so_that');
    expect(r.out).toContain('verification');
    expect(existsSync(path.join(dir, 'brief.md'))).toBe(false);
  });

  it('removes a todo story the record dropped, refuses one that started, and follows a rename', () => {
    const { root, dir } = fixture();
    run(root, 'user-auth');
    const recordFile = path.join(dir, 'record.yaml');
    const record = render.parseYaml(read(recordFile));
    record.stories = record.stories.slice(0, 1);
    writeFileSync(recordFile, render.dumpYaml(record));
    expect(run(root, 'user-auth', '--check').out).toContain('stories/002-reset-link.md: not in the record');
    expect(run(root, 'user-auth').out).toContain('1 removed');
    expect(existsSync(path.join(dir, 'stories', '002-reset-link.md'))).toBe(false);

    const storyFile = path.join(dir, 'stories', '001-login-expired-password.md');
    const story = read(storyFile);
    writeFileSync(storyFile, fm.updateFrontmatter(story, { ...fm.extractFrontmatter(story), status: 'building' }));
    record.stories[0].slug = 'login-expired';
    writeFileSync(recordFile, render.dumpYaml(record));
    expect(run(root, 'user-auth').code).toBe(0);
    expect(readdirSync(path.join(dir, 'stories'))).toEqual(['001-login-expired.md']);
    expect(fm.extractFrontmatter(read(path.join(dir, 'stories', '001-login-expired.md'))).status).toBe('building');

    record.stories = [{ ...record.stories[0], id: '003', slug: 'other' }];
    writeFileSync(recordFile, render.dumpYaml(record));
    const refused = run(root, 'user-auth');
    expect(refused.code).toBe(1);
    expect(refused.out).toContain('stories/001-login-expired.md (building)');
    expect(existsSync(path.join(dir, 'stories', '003-other.md'))).toBe(false);
  });

  it('stops on the old layout and on a bad call', () => {
    const root = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-render-legacy-')), '.specs-aidlc-turbo');
    mkdirSync(path.join(root, 'intents', 'user-auth'), { recursive: true });
    const r = run(root, 'user-auth');
    expect(r.code).toBe(1);
    expect(r.out).toContain(req(path.join(FLOW, 'scripts/lib/paths.cjs')).legacyMessage(root));
    expect(run(root).code).toBe(2);
    expect(run(root, 'user-auth', '--bogus').code).toBe(2);
    const empty = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-render-none-')), '.specs-aidlc-turbo');
    expect(run(empty, 'nope').code).toBe(1);
  });
});
