/**
 * Unit tests for spec-lint.cjs, the hard gate before the inception approval.
 * It replaces the consistency pass the inception agent used to run by hand:
 * - a freshly rendered record template is clean;
 * - form: frontmatter values, file names and ids, depends_on targets and
 *   cycles, the Story map against the files, requirements both ways, empty
 *   headings, TBD/TODO, touches, and two stories that can build at the same
 *   time touching the same file;
 * - a hand edit away from the record is a finding (render --check);
 * - coverage against the register: every current id cited or deliberately
 *   not done with a reason, no unknown or stale id cited; without a register
 *   coverage is skipped with a note while form still runs;
 * - break_test is true or false, and true only on a story with a criterion a
 *   tester checks on a screen or an API: the breaker attacks the running
 *   application, nothing else. A story from before observed_via keeps the old
 *   rule, a ui or api surface;
 * - every criterion of the record says where a tester checks it, none with
 *   exactly one reason, covered_by naming another story a tester can check;
 *   a tester_verifiable the record still gives matches the derived one; the
 *   frontmatter list has one value per criterion; no story names a path
 *   under aidlc-twins/, the test writer's folder;
 * - the overview data: layer ids unique, every slice on a layer with new or
 *   used, every integration test with an earlier story the story reaches
 *   through depends_on (one per story, test filled), the
 *   lifecycle's step ids unique and its lanes, steps and stories existing,
 *   short at most 24 characters. A record without any of it is clean;
 * - what a sandbox finish writes into the brief (pushed_to_base) is no
 *   finding;
 * - the Code Scaffold: a rendered one passes every other rule, and its
 *   places are checked on the disk of the project spec-lint runs in; a
 *   sandbox that switched it off is neither checked nor asked for it;
 * - findings print as "file: message", or as JSON with --json;
 * - an old-layout root stops with the migration message.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, renameSync } from 'fs';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const SCRIPT = path.join(FLOW, 'scripts/spec-lint.cjs');
const req = createRequire(import.meta.url);
const render = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const lint = req(SCRIPT);
const paths = req(path.join(FLOW, 'scripts/lib/paths.cjs'));
const fm = req(path.join(FLOW, 'scripts/frontmatter.cjs'));

function run(root: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** Render the template record plus a second story, after an optional edit of the record. */
function fixture(edit?: (record: any) => void) {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-lint-')), '.specs-aidlc-turbo');
  const dir = path.join(root, 'docs', 'user-auth', 'user-auth');
  mkdirSync(dir, { recursive: true });
  const record = render.parseYaml(readFileSync(path.join(FLOW, 'templates/inception/record-template.yaml'), 'utf8'));
  record.stories.push({
    ...record.stories[0],
    id: '002', slug: 'reset-link', title: 'Reset link', depends_on: ['001'], requirements: ['FR-1'],
    touches: ['src/auth/reset.ts'], sources: [],
  });
  if (edit) edit(record);
  writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
  const intent = paths.findIntent(root, 'user-auth');
  render.applyPlan(intent, render.planRender(intent));
  return { root, dir, intent };
}

function registerFile(root: string, items: Array<[string, string]>) {
  const lines = items.map(([id, status]) => `  - { id: ${id}, page: "100", version: 1, line: 1, kind: rule, quote: "Quote ${id}", key: "100:${id}", status: ${status} }`);
  writeFileSync(path.join(root, 'docs', 'user-auth', 'register.yaml'), ['pages:', '  "100": { title: Policy, version: 1, file: x.md, read_version: 1 }', 'items:', ...lines].join('\n'));
}

const findings = (intent: any, root: string) => lint.lintIntent(intent, root).findings as Array<{ file: string; rule: string; message: string }>;
const rules = (intent: any, root: string) => findings(intent, root).map((f) => f.rule);

describe('aidlc-turbo spec-lint', () => {
  it('passes a rendered record template, and skips coverage with a note when no docs were synced', () => {
    const { root } = fixture();
    const r = run(root, 'user-auth');
    expect(r.out).toContain('spec-lint user-auth: clean');
    expect(r.out).toContain('note: coverage skipped');
    expect(r.code).toBe(0);
  });

  it('flags a hand edit that drifted away from the record', () => {
    const { root, dir, intent } = fixture();
    const file = path.join(dir, 'stories', '002-reset-link.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace('### Design\n\n', '### Design\n\nHand edit. '));
    const f = findings(intent, root);
    expect(f).toContainEqual(expect.objectContaining({ file: 'stories/002-reset-link.md', rule: 'render-check' }));
  });

  it('checks requirements both ways, the story map and the dependencies', () => {
    const { root, intent } = fixture((r) => {
      r.requirements.push({ id: 'FR-9', text: 'Nobody delivers this', sources: ['user'] });
      r.stories[1].requirements = ['FR-7'];
      r.stories[0].depends_on = ['002'];
    });
    const f = findings(intent, root);
    const msg = f.map((x) => `${x.file}: ${x.message}`);
    expect(msg).toContain('brief.md: FR-9 is delivered by no story');
    expect(msg).toContain('stories/002-reset-link.md: requirement FR-7 is not in the brief');
    expect(f.some((x) => x.rule === 'cycle' && x.message.includes('001 -> 002 -> 001'))).toBe(true);
  });

  it('accepts what a sandbox finish writes into the brief: the branch and pushed_to_base', () => {
    const { root, dir, intent } = fixture();
    const file = path.join(dir, 'brief.md');
    const content = readFileSync(file, 'utf8');
    writeFileSync(file, fm.updateFrontmatter(content, {
      ...fm.extractFrontmatter(content), status: 'done', mode: 'sandbox', branch: 'shop/intent-user-auth/intent',
      pushed_to_base: 'main',
    }));
    expect(readFileSync(file, 'utf8')).toMatch(/^pushed_to_base: main$/m);
    expect(findings(intent, root)).toEqual([]);
  });

  it('flags frontmatter values, file names, empty headings, placeholders and a missing touches', () => {
    const { root, dir, intent } = fixture((r) => {
      r.stories[1].touches = [];
      r.stories[1].agent.design = 'Decide the redirect later, TBD';
    });
    const file = path.join(dir, 'stories', '002-reset-link.md');
    let text = readFileSync(file, 'utf8').replace('complexity: medium', 'complexity: huge').replace('### Test plan\n\n- Unit: isExpired on the boundary date\n- Integration: POST /login with an expired user returns 303\n- Verification command: npm test\n', '### Test plan\n');
    text = text.replace('### Test plan\n', '### Test plan\n\n');
    writeFileSync(file, text);
    renameSync(file, path.join(dir, 'stories', '2-Reset.md'));
    const f = findings(intent, root);
    const has = (rule: string, part: string) => f.some((x) => x.rule === rule && x.message.includes(part));
    expect(has('frontmatter', 'complexity must be one of')).toBe(true);
    expect(has('file-name', '{SSS}-{slug}.md')).toBe(true);
    expect(has('touches', 'touches is empty')).toBe(true);
    expect(has('placeholder', 'TBD')).toBe(true);
    expect(has('empty-heading', 'Test plan')).toBe(true);
  });

  it('wants break_test as true or false, and only on a story a user can reach', () => {
    // The criteria decide, not the surface.
    const { root, dir, intent } = fixture((r) => {
      r.stories[1].break_test = true;
      r.stories[1].product = { ...r.stories[1].product, criteria: [{ given: 'a link', when: 'the job runs', then: 'USERS holds a row for it', observed_via: 'db' }] };
    });
    const file = path.join(dir, 'stories', '001-login-expired-password.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^break_test: .*$/m, 'break_test: maybe'));
    const f = findings(intent, root);
    expect(f).toContainEqual(expect.objectContaining({ file: 'stories/001-login-expired-password.md', message: 'break_test must be true or false' }));
    expect(f).toContainEqual({ file: 'stories/002-reset-link.md', rule: 'break-test', message: 'break_test is true but no criterion is observed via ui or api: the breaker only attacks a screen or an API' });
    expect(f.filter((x) => x.rule === 'break-test')).toHaveLength(1);
    // A job story whose result shows on a screen may be attacked.
    const ok = fixture((r) => { r.stories[1].surface = 'job'; });
    expect(rules(ok.intent, ok.root)).not.toContain('break-test');

    // A story from before observed_via keeps the old rule, on the surface.
    const legacy = fixture((r) => {
      r.stories[1].surface = 'job';
      r.stories[1].tester_verifiable = true;
      r.stories[1].product = { ...r.stories[1].product, criteria: [{ given: 'a link', when: 'I click', then: 'I see the screen' }] };
    });
    const old = findings(legacy.intent, legacy.root);
    expect(old).toContainEqual(expect.objectContaining({ file: 'stories/002-reset-link.md', rule: 'break-test', message: expect.stringContaining('the surface is job') }));
    expect(old).toContainEqual(expect.objectContaining({ file: 'stories/002-reset-link.md', rule: 'criteria-via', message: expect.stringContaining('criterion 1 has no observed_via') }));
  });

  it('wants every criterion to say where a tester checks it, and none with exactly one reason', () => {
    const c = (via: Record<string, unknown>) => ({ given: 'an account', when: 'I log in', then: 'I see something', ...via });
    const { root, intent } = fixture((r) => {
      // Not every criterion carries observed_via, so render wants tester_verifiable from the record.
      r.stories[0].tester_verifiable = true;
      r.stories[0].product = {
        ...r.stories[0].product,
        criteria: [
          c({ observed_via: 'ui' }),
          c({}),
          c({ observed_via: 'screen' }),
          'A free line',
          c({ observed_via: 'none' }),
          c({ observed_via: 'none', why_none: 'codeniveau', covered_by: '002' }),
          c({ observed_via: 'none', covered_by: '009' }),
          c({ observed_via: 'none', covered_by: '001' }),
          c({ observed_via: 'none', covered_by: '002' }),
          c({ observed_via: 'ui', why_none: 'codeniveau' }),
          c({ observed_via: 'none', why_none: 'code level (a refactor)' }),
        ],
      };
      r.stories[1].break_test = false;
      r.stories[1].product = { ...r.stories[1].product, criteria: [c({ observed_via: 'none', why_none: 'codeniveau' })] };
    });
    const msg = findings(intent, root).filter((x) => x.rule === 'criteria-via' && x.file === 'stories/001-login-expired-password.md').map((x) => x.message);
    expect(msg).toEqual([
      'criterion 2 has no observed_via: say where a tester checks it, one of ui, api, db, log, none',
      'criterion 3: observed_via is "screen", expected one of ui, api, db, log, none',
      'criterion 4 is a plain line: write it as given, when and then, with observed_via',
      'criterion 5 is observed via none without why_none or covered_by: give exactly one',
      'criterion 6 has both why_none and covered_by: give exactly one',
      'criterion 6: covered_by names story 002, whose criteria are all none, so no test case of it covers this',
      'criterion 7: covered_by names story 009, which is not a story of this intent',
      'criterion 8: covered_by names this story itself',
      'criterion 9: covered_by names story 002, whose criteria are all none, so no test case of it covers this',
      'criterion 10 is observed via ui: why_none and covered_by go only with none',
      'criterion 11: why_none holds a parenthesis, which ends the tester note on the overview page: write it without one',
    ]);
  });

  it('passes none with a reason or a covering story, and checks the frontmatter list against the criteria', () => {
    const { root, dir, intent } = fixture((r) => {
      r.stories[1].break_test = false;
      r.stories[1].product = {
        ...r.stories[1].product,
        criteria: [
          { given: 'a reset link', when: 'I open it', then: 'I see the reset screen', observed_via: 'none', covered_by: '001' },
          { given: 'a reset link', when: 'the story is built', then: 'the old class is gone', observed_via: 'none', why_none: 'code level' },
        ],
      };
    });
    expect(findings(intent, root)).toEqual([]);
    const file = path.join(dir, 'stories', '002-reset-link.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace('observed_via: [none, none]', 'observed_via: [none]'));
    expect(findings(intent, root)).toContainEqual({ file: 'stories/002-reset-link.md', rule: 'criteria-via', message: 'observed_via has 1 value but there are 2 criteria: one value per criterion, in order' });
  });

  it('wants a tester_verifiable the record still gives to match the criteria', () => {
    const { root, intent } = fixture((r) => {
      r.stories[0].tester_verifiable = true;
      r.stories[1].tester_verifiable = true;
      r.stories[1].break_test = false;
      r.stories[1].product = { ...r.stories[1].product, criteria: [{ given: 'a link', when: 'the story is built', then: 'the class is gone', observed_via: 'none', why_none: 'code level' }] };
    });
    const f = findings(intent, root).filter((x) => x.rule === 'tester-verifiable');
    expect(f).toEqual([{ file: 'stories/002-reset-link.md', rule: 'tester-verifiable', message: 'tester_verifiable is true in the record but the criteria make it false: leave the key out, render-specs.cjs derives it' }]);
  });

  it('keeps every story out of aidlc-twins/, the folder the test writer owns at finish', () => {
    const { root, intent } = fixture((r) => {
      r.stories[0].touches = [...r.stories[0].touches, 'tests/aidlc-twins/user-auth-login.spec.ts'];
      r.stories[1].agent = { ...r.stories[1].agent, test_plan: ['Unit: the link', 'e2e: a Playwright spec at `tests/aidlc-twins/user-auth-reset-link.spec.ts`'] };
    });
    const f = findings(intent, root).filter((x) => x.rule === 'twin-dir');
    expect(f.map((x) => x.file)).toEqual(['stories/001-login-expired-password.md', 'stories/002-reset-link.md']);
    expect(f[0].message).toContain('touches names tests/aidlc-twins/user-auth-login.spec.ts');
    expect(f[1].message).toContain('the test plan names a path under aidlc-twins/');
    const ok = fixture((r) => { r.stories[1].agent = { ...r.stories[1].agent, test_plan: ['e2e: a Playwright spec at tests/e2e/reset-link.spec.ts'] }; });
    expect(rules(ok.intent, ok.root)).not.toContain('twin-dir');
  });

  it('passes a record without any overview data', () => {
    const { root, intent } = fixture((r) => {
      delete r.overview;
      r.stories.forEach((s: any) => { delete s.short; delete s.slice; delete s.integration; });
    });
    expect(findings(intent, root)).toEqual([]);
  });

  it('checks the Code Scaffold against the project it runs in, and a rendered one passes every other rule', () => {
    // A file that exists from where spec-lint runs, as a part the stories only use.
    const real = path.relative(process.cwd(), SCRIPT).split(path.sep).join('/');
    const text = readFileSync(SCRIPT, 'utf8');
    const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    const draw = (lintLines: string) => (r: any) => {
      r.technical_design.drawing = {
        summary: 'The login code gets a check on the expiry date.',
        modules: [{ id: 'auth', name: 'auth', status: 'new', what: 'The login code.', path: 'src/auth' }],
        parts: [
          { id: 'login', name: 'login.ts', module: 'auth', layer: 'server', status: 'new', kind: 'JS module', what: 'The login route.', path: 'src/auth/login.ts' },
          { id: 'lint', name: 'spec-lint.cjs', layer: 'server', status: 'existing', kind: 'JS module', what: 'A script that exists.', path: real, lines: lintLines },
        ],
        links: [{ from: 'login', to: 'lint', label: 'reads', proof: { file: real, lines: '1-10' } }],
      };
      r.stories[0].drawing = { summary: 'The check at login.', builds: { auth: 'new', login: 'new, with the check' }, uses: ['lint'] };
      r.stories[1].drawing = { summary: 'The reset link.', builds: {}, uses: ['login'] };
    };
    const ok = fixture(draw('1-10'));
    expect(readFileSync(path.join(ok.dir, 'stories', '001-login-expired-password.md'), 'utf8')).toContain('### Code Scaffold');
    expect(findings(ok.intent, ok.root)).toEqual([]);
    const bad = fixture((r) => { draw(`1-${lines + 1}`)(r); delete r.stories[1].drawing; });
    const f = findings(bad.intent, bad.root);
    expect(f).toContainEqual({ file: 'record.yaml', rule: 'drawing', message: `technical_design.drawing: part lint: lines 1-${lines + 1} fall outside ${real}, which has ${lines} lines` });
    expect(f).toContainEqual({ file: 'record.yaml', rule: 'drawing', message: 'story 002: no drawing: give it a summary, what it builds and what it uses' });
    expect(f.filter((x) => x.rule === 'drawing')).toHaveLength(2);
    // An arrow into an existing part is proven on the same disk.
    const unproven = fixture((r) => { draw('1-10')(r); r.technical_design.drawing.links[0].proof.file = 'scripts/missing.cjs'; });
    expect(findings(unproven.intent, unproven.root)).toEqual([
      { file: 'record.yaml', rule: 'drawing', message: 'technical_design.drawing: link login -> lint: proof.file scripts/missing.cjs does not exist' },
    ]);
  });

  it('neither checks nor demands the Code Scaffold in a sandbox that switched it off', () => {
    const story = (r: any) => {
      r.technical_design.drawing = {
        summary: 'The login code gets a check on the expiry date.',
        modules: [{ id: 'auth', name: 'auth', status: 'new', what: 'The login code.', path: 'src/auth' }],
        parts: [{ id: 'login', name: 'login.ts', module: 'auth', layer: 'server', status: 'new', kind: 'JS module', what: 'The login route.', path: 'src/auth/login.ts' }],
        links: [],
      };
      r.stories[0].drawing = { summary: 'The check at login.', builds: { auth: 'new', login: 'new' }, uses: [] };
    };
    const off = fixture(story);
    // The second story has no drawing: a finding while the part is on.
    expect(rules(off.intent, off.root)).toContain('drawing');
    mkdirSync(path.join(off.root, 'repo'), { recursive: true });
    writeFileSync(path.join(off.root, 'repo', 'config.yaml'), 'mode: sandbox\nsandbox:\n  code_scaffold: false\n');
    expect(rules(off.intent, off.root)).not.toContain('drawing');
    // Production ignores the sandbox block.
    writeFileSync(path.join(off.root, 'repo', 'config.yaml'), 'mode: production\nsandbox:\n  code_scaffold: false\n');
    expect(rules(off.intent, off.root)).toContain('drawing');
  });

  it('wants unique layer ids, and every slice on layers with new or used', () => {
    const { root, intent } = fixture((r) => {
      r.overview.layers.push({ id: 'login', group: 'Code', label: 'Once more' }, { group: 'Code', label: 'Without an id' });
      r.stories[1].slice = { 't-users': 'used', mail: 'new', 'reset-screen': 'perhaps' };
    });
    const f = findings(intent, root);
    expect(f.filter((x) => x.rule === 'layers')).toEqual([
      { file: 'record.yaml', rule: 'layers', message: 'overview.layers: id login appears twice' },
      { file: 'record.yaml', rule: 'layers', message: 'overview.layers[5] has no id' },
    ]);
    expect(f.filter((x) => x.rule === 'slice')).toEqual([
      { file: 'stories/002-reset-link.md', rule: 'slice', message: 'slice names mail, which is not a layer id in overview.layers' },
      { file: 'stories/002-reset-link.md', rule: 'slice', message: 'slice reset-screen is "perhaps", expected new or used' },
    ]);
    const list = fixture((r) => { r.stories[1].slice = ['t-users']; });
    expect(findings(list.intent, list.root)).toContainEqual({ file: 'stories/002-reset-link.md', rule: 'slice', message: 'slice must be a map of layer id to new or used' });
    // The template's layers and slices pass.
    const ok = fixture();
    expect(rules(ok.intent, ok.root).filter((x) => x === 'layers' || x === 'slice')).toEqual([]);
  });

  it('holds short to 24 characters', () => {
    const { root, intent } = fixture((r) => {
      r.stories[0].short = 'Cancelling all the gift cards';
      r.stories[1].short = 'Gift cards café closing!';
    });
    expect(findings(intent, root).filter((x) => x.rule === 'short')).toEqual([
      { file: 'stories/001-login-expired-password.md', rule: 'short', message: 'short is 29 characters, at most 24: it names the story in the pictures on the overview page' },
    ]);
  });

  it('holds a deliberately_not short to 60 characters', () => {
    const { root, intent } = fixture((r) => {
      r.deliberately_not = [{ id: 'S-004', short: 'Two-step verification with a code by text message, an app or key', reason: 'Later' }];
    });
    expect(findings(intent, root).filter((x) => x.rule === 'short')).toEqual([
      { file: 'record.yaml', rule: 'short', message: 'deliberately_not S-004: short is 64 characters, at most 60: it is the chip under Out of scope on the overview page' },
    ]);
  });

  it('wants every integration test with an earlier story this story reaches through depends_on, one per story, with test', () => {
    const third = (r: any) => r.stories.push({
      ...r.stories[0], id: '003', slug: 'reset-mail', title: 'Reset mail', depends_on: ['002'], requirements: ['FR-1'],
      touches: ['src/auth/mail.ts'], sources: [],
    });
    const entry = (w: unknown, extra: Record<string, unknown> = {}) => ({ with: w, test: 'Runs against the real code', ...extra });
    // Directly and through another story: both land first.
    const ok = fixture((r) => {
      third(r);
      r.stories[1].integration = [entry('001')];
      r.stories[2].integration = [entry('002'), entry(1)];
    });
    expect(findings(ok.intent, ok.root)).toEqual([]);

    const { root, intent } = fixture((r) => {
      third(r);
      r.stories[0].integration = [entry('002')];
      r.stories[1].integration = [entry('002'), entry('009'), entry('001'), entry('001', { test: '' }), { test: 'x' }, 'Reads the users table'];
    });
    const f = findings(intent, root).filter((x) => x.rule === 'integration');
    expect(f).toEqual([
      { file: 'stories/001-login-expired-password.md', rule: 'integration', message: 'integration 1: with names story 002, which this story does not reach through depends_on: add the dependency so it lands first, or drop the test' },
      { file: 'stories/002-reset-link.md', rule: 'integration', message: 'integration 1: with names this story itself' },
      { file: 'stories/002-reset-link.md', rule: 'integration', message: 'integration 2: with names story 009, which is not a story of this intent' },
      { file: 'stories/002-reset-link.md', rule: 'integration', message: 'integration 4: story 001 has an integration test here already: one per earlier story' },
      { file: 'stories/002-reset-link.md', rule: 'integration', message: 'integration 4 has no test: the test the builder writes, in a line the overview page shows' },
      { file: 'stories/002-reset-link.md', rule: 'integration', message: 'integration 5 has no with: name the earlier story it tests with' },
      { file: 'stories/002-reset-link.md', rule: 'integration', message: 'integration 6 is not a map: give with and test' },
    ]);
  });

  it('wants the lifecycle\'s step ids unique, and its lanes, steps and stories to exist', () => {
    const { root, intent } = fixture((r) => {
      const life = r.overview.lifecycle;
      life.steps.push(
        { id: 'check', lane: 'app', col: 3, label: 'Once more', stories: [] },
        { id: 'mail', lane: 'system', col: 3, label: 'Send the mail', stories: ['002', '007'] },
        { lane: 'app', col: 4, label: 'Without an id' },
      );
      life.arrows.push({ from: 'reset', to: 'done' }, { to: 'login' });
      life.under_all = { story: '008', label: 'Table' };
    });
    const msg = findings(intent, root).filter((x) => x.rule === 'lifecycle').map((x) => `${x.file}: ${x.message}`);
    expect(msg).toEqual([
      'record.yaml: overview.lifecycle: step id check appears twice',
      'record.yaml: overview.lifecycle: step mail is on lane system, which is not a lane id',
      'record.yaml: overview.lifecycle: step mail names story 007, which is not a story of this intent',
      'record.yaml: overview.lifecycle: steps[5] has no id',
      'record.yaml: overview.lifecycle: arrow reset -> done: done is not a step id',
      'record.yaml: overview.lifecycle: arrow ? -> login has no from',
      'record.yaml: overview.lifecycle: under_all names story 008, which is not a story of this intent',
    ]);
    // The template's lifecycle passes, with a story under every step.
    const ok = fixture((r) => { r.overview.lifecycle.under_all = { story: '001', label: 'User table' }; });
    expect(rules(ok.intent, ok.root)).not.toContain('lifecycle');
  });

  it('holds the quick lane to at most 2 stories, none hard', () => {
    const { root, intent } = fixture((r) => { r.lane = 'quick'; r.stories[1].complexity = 'hard'; });
    expect(rules(intent, root)).toContain('lane');
    const ok = fixture((r) => { r.lane = 'quick'; });
    expect(rules(ok.intent, ok.root)).not.toContain('lane');
  });

  it('flags two stories that can build at the same time and touch the same file', () => {
    const { root, intent } = fixture((r) => {
      r.stories[1].depends_on = [];
      r.stories[1].touches = ['./src/auth/login.ts'];
    });
    const f = findings(intent, root).filter((x) => x.rule === 'parallel-touches');
    expect(f).toHaveLength(1);
    expect(f[0].message).toContain('story 001');
    expect(f[0].message).toContain('src/auth/login.ts');
    // With the dependency back, they build one after the other: no finding.
    const again = fixture((r) => { r.stories[1].touches = ['src/auth/login.ts']; });
    expect(rules(again.intent, again.root)).not.toContain('parallel-touches');
  });

  it('checks coverage against the register: cited, deliberately not, unknown and stale', () => {
    const { root, intent } = fixture((r) => {
      r.deliberately_not = [{ id: 'S-004', reason: 'Later' }, { id: 'S-009', reason: '' }];
      r.stories[1].sources = ['S-005'];
    });
    registerFile(root, [['S-001', 'current'], ['S-002', 'current'], ['S-003', 'current'], ['S-004', 'current'], ['S-005', 'stale'], ['S-006', 'stale']]);
    const msg = findings(intent, root).map((x) => `${x.file}: ${x.message}`);
    expect(msg.some((m) => m.startsWith('register.yaml: S-003 (rule, page 100) is cited by no requirement or story'))).toBe(true);
    expect(msg.some((m) => m.includes('S-001 (') || m.includes('S-002 (') || m.includes('S-004 ('))).toBe(false);
    expect(msg).toContain('record.yaml: deliberately_not S-009 has no reason');
    expect(msg).toContain('record.yaml: deliberately_not names S-009, which is not in the register');
    expect(msg.some((m) => m.startsWith('stories/002-reset-link.md: story 002 cites S-005, which is stale'))).toBe(true);
    expect(msg.some((m) => m.includes('S-006'))).toBe(false);
  });

  it('prints one "file: message" line per finding, or JSON with --json', () => {
    const { root } = fixture((r) => { r.stories[1].requirements = ['FR-7']; });
    registerFile(root, [['S-001', 'current'], ['S-002', 'current'], ['S-004', 'current']]);
    const text = run(root, 'user-auth');
    expect(text.code).toBe(1);
    expect(text.out).toContain('stories/002-reset-link.md: requirement FR-7 is not in the brief\n');
    expect(text.out).toMatch(/spec-lint user-auth: \d+ findings?\n$/);
    const json = run(root, 'user-auth', '--json');
    expect(json.code).toBe(1);
    const parsed = JSON.parse(json.out);
    expect(parsed[0]).toEqual({ file: expect.any(String), rule: expect.any(String), message: expect.any(String) });
  });

  it('stops on the old layout and on a bad call', () => {
    const root = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-lint-legacy-')), '.specs-aidlc-turbo');
    mkdirSync(path.join(root, 'intents'), { recursive: true });
    writeFileSync(path.join(root, 'config.yaml'), 'mode: sandbox\n');
    const r = run(root, 'user-auth');
    expect(r.code).toBe(1);
    expect(r.err).toContain(paths.legacyMessage(root));
    expect(run(root).code).toBe(2);
  });

  it('finds empty headings and cycles as pure functions', () => {
    expect(lint.emptyHeadings('# T\n\n## A\n\ntext\n\n## B\n\n## C\n\n### D\n\nx\n')).toEqual(['B']);
    expect(lint.findCycle(new Map([['001', ['002']], ['002', ['001']]]))).toEqual(['001', '002', '001']);
    expect(lint.findCycle(new Map([['001', []], ['002', ['001']]]))).toBeNull();
  });
});
