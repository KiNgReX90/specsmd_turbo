/**
 * Unit tests for lib/c4-lint.cjs, spec-lint's check of the C4 model
 * (technical_design.c4) and the plain texts (intent.plain,
 * stories[].plain) in record.yaml:
 * - a record holding both is clean, and so is one without either: what is
 *   absent is the missing report's (lib/v5-missing.cjs), not the lint's;
 * - ids filled and unique over the four element lists, without @;
 * - every status, kind, flag and element reference a known value;
 * - a component names parts the Code Scaffold draws, a part sits in one;
 * - every edge names elements that exist, every story a story of the record;
 * - a system with ext holds no container;
 * - the plain texts: all there once one is, plain words (no code, no
 *   markdown), the template's length, no em-dash;
 * - spec-lint.cjs reports it all under its own rule, c4, in the same shape;
 * - the template's worked example lints clean and is complete.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const LIB = path.join(FLOW, 'scripts/lib/c4-lint.cjs');
const SCRIPT = path.join(FLOW, 'scripts/spec-lint.cjs');
const TEMPLATE = path.join(FLOW, 'templates/inception/record-template.yaml');
const req = createRequire(import.meta.url);
const { lintC4 } = req(LIB);
const { missing } = req(path.join(FLOW, 'scripts/lib/v5-missing.cjs'));
const render = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const paths = req(path.join(FLOW, 'scripts/lib/paths.cjs'));

const D = 'technical_design.c4';
const DASH = '\u2014';
const INTENT_PLAIN = 'Someone who logs in with an expired password picks a new one right away and simply goes on working. '
  + 'Today such a person gets stuck and calls the service desk to have the password renewed. '
  + 'Those requests go away, because users sort it out themselves on the screen that is already there.';
const STORY_PLAIN = 'Logging in notices an expired password and takes the user to the screen to choose a new one. So users go on by themselves, without the service desk.';

const template = () => render.parseYaml(readFileSync(TEMPLATE, 'utf8'));

/** The template record with a Code Scaffold, the C4 block and every plain text. */
function good() {
  const r = template();
  r.intent.plain = INTENT_PLAIN;
  r.stories[0].plain = STORY_PLAIN;
  r.technical_design.drawing = {
    modules: [{ id: 'auth', name: 'auth', status: 'changed', path: 'src/auth' }],
    parts: [
      { id: 'login', name: 'login.ts', module: 'auth', layer: 'server', status: 'changed', kind: 'JS module', path: 'src/auth/login.ts', lines: '1-9' },
      { id: 'login-test', name: 'login.test.ts', module: 'auth', status: 'new', kind: 'file', near: 'login' },
      { id: 'users', name: 'USERS', layer: 'database', status: 'existing', kind: 'table', path: 'db/users.sql', lines: '1-3' },
      { id: 'smtp', name: 'SMTP', layer: 'external', status: 'existing', kind: 'endpoint' },
    ],
    links: [{ from: 'login', to: 'users' }, { from: 'login', to: 'smtp' }],
  };
  r.technical_design.c4 = {
    persons: [{ id: 'p-user', name: 'User', desc: 'Logs in to the application' }],
    systems: [{ id: 's-app', name: 'App', status: 'changed' }, { id: 's-mail', name: 'Mail', ext: true, tech: 'SMTP' }],
    containers: [
      { id: 'c-web', name: 'Web', kind: 'container', tech: 'TypeScript', desc: 'The login route' },
      { id: 'c-db', name: 'Database', kind: 'db', system: 's-app', tech: 'PostgreSQL', desc: 'Keeps the users' },
    ],
    components: [
      { id: 'k-login', container: 'c-web', name: 'Log in', parts: ['login'], stories: ['001'] },
      { id: 'k-users', container: 'c-db', name: 'Users', parts: ['users'], status: 'existing' },
    ],
    edges: [
      { from: 'p-user', to: 's-app', label: 'Logs in', intent: false },
      { from: 'k-login', to: 's-mail', label: 'Mails', tech: 'SMTP', intent: true, ends: false },
    ],
    outside: { smtp: 's-mail' },
  };
  return r;
}

function lint(r: any) {
  const out: Array<{ file: string; rule: string; message: string }> = [];
  lintC4(r, (file: string, rule: string, message: string) => out.push({ file, rule, message }));
  return out;
}
const messages = (r: any) => lint(r).map((f) => f.message);
const c4 = (r: any) => r.technical_design.c4;

describe('lintC4: the C4 block', () => {
  it('passes a record that holds the C4 model and the plain texts, every finding on record.yaml under the rule c4', () => {
    expect(lint(good())).toEqual([]);
    const r = good();
    c4(r).systems[0].status = 'novel';
    expect(lint(r)).toEqual([{ file: 'record.yaml', rule: 'c4', message: `${D}.systems[0].status: system s-app has status "novel", expected one of new, changed, existing` }]);
  });

  it('is clean for a record without the C4 block and without plain texts, as a record from before them', () => {
    expect(lint(template())).toEqual([]);
    expect(lint({})).toEqual([]);
    expect(lint({ technical_design: { modules: ['auth'] }, stories: [{ id: '001' }] })).toEqual([]);
    const blockOnly = good();
    delete blockOnly.intent.plain;
    delete blockOnly.stories[0].plain;
    expect(lint(blockOnly)).toEqual([]);
    const plainOnly = good();
    delete plainOnly.technical_design.c4;
    expect(lint(plainOnly)).toEqual([]);
  });

  it('leaves what is absent to the missing report: a part in no component, no outside entry, an empty component', () => {
    const r = good();
    c4(r).components.pop();
    delete c4(r).outside;
    c4(r).components.push({ id: 'k-empty', container: 'c-web', name: 'Empty', parts: [] });
    expect(lint(r)).toEqual([]);
    expect(missing(r).map((g: any) => g.kind).sort()).toEqual(['no-component', 'no-outside', 'no-parts']);
  });

  it('wants the block a map, its lists lists, outside a map and every entry a map', () => {
    const notMap = good();
    c4(notMap).persons = { a: 1 };
    c4(notMap).edges = 'p-user -> s-app';
    c4(notMap).outside = ['smtp'];
    c4(notMap).systems.push('Mail');
    c4(notMap).components[0].parts = 'login';
    const m = messages(notMap);
    expect(m).toContain(`${D}.persons: must be a list`);
    expect(m).toContain(`${D}.edges: must be a list`);
    expect(m).toContain(`${D}.outside: must be a map of external part id to system id`);
    expect(m).toContain(`${D}.systems[2]: is not a map: give it an id and a name`);
    expect(m).toContain(`${D}.components[0].parts: component k-login: parts must be a list of part ids`);
    const block = good();
    block.technical_design.c4 = ['persons'];
    expect(messages(block)).toEqual([`${D}: must be a map of persons, systems, containers, components, edges and outside`]);
  });

  it('wants ids filled and unique over persons, systems, containers and components, without @', () => {
    const r = good();
    c4(r).containers[0].id = 's-app';
    c4(r).persons[0].id = 'p@user';
    delete c4(r).components[1].id;
    const m = messages(r);
    expect(m).toContain(`${D}.containers[0].id: id s-app appears twice: persons, systems, containers and components share one set of ids`);
    expect(m).toContain(`${D}.persons[0].id: id p@user holds an @, which the v5 page leaves out: pick another id`);
    expect(m).toContain(`${D}.components[1].id: component 2 has no id`);
  });

  it('wants every status, kind and flag a known value', () => {
    const r = good();
    c4(r).systems[0].status = 'novel';
    c4(r).systems[0].kind = 'app';
    c4(r).containers[1].kind = 'table';
    c4(r).containers[0].status = 'modified';
    c4(r).components[0].status = 'done';
    c4(r).systems[1].ext = 'yes';
    c4(r).edges[0].intent = 'yes';
    c4(r).edges[1].ends = 1;
    const m = messages(r);
    expect(m).toContain(`${D}.systems[0].status: system s-app has status "novel", expected one of new, changed, existing`);
    expect(m).toContain(`${D}.systems[0].kind: system s-app has kind "app", expected system or db`);
    expect(m).toContain(`${D}.containers[1].kind: container c-db has kind "table", expected container or db`);
    expect(m).toContain(`${D}.containers[0].status: container c-web has status "modified", expected one of new, changed, existing`);
    expect(m).toContain(`${D}.components[0].status: component k-login has status "done", expected one of new, changed, existing`);
    expect(m).toContain(`${D}.systems[1].ext: system s-mail has ext "yes", expected true or false`);
    expect(m).toContain(`${D}.edges[0].intent: edge p-user->s-app has intent "yes", expected true or false`);
    expect(m).toContain(`${D}.edges[1].ends: edge k-login->s-mail has ends "1", expected true or false`);
  });

  it('wants every element reference to name an element of the right sort', () => {
    const r = good();
    c4(r).containers[0].system = 's-nope';
    c4(r).components[1].container = 'c-nope';
    c4(r).outside.smtp = 'c-web';
    delete c4(r).components[0].container;
    const m = messages(r);
    expect(m).toContain(`${D}.containers[0].system: container c-web belongs to system s-nope, which the C4 model does not have`);
    expect(m).toContain(`${D}.components[1].container: component k-users sits in container c-nope, which the C4 model does not have`);
    expect(m).toContain(`${D}.components[0].container: component k-login names no container`);
    expect(m).toContain(`${D}.outside.smtp: part smtp stands for system c-web, which the C4 model does not have`);
  });

  it('wants every component to name drawn parts, and no part in two components', () => {
    const r = good();
    c4(r).components[0].parts = ['login', 'nope', 'login-test'];
    c4(r).components[1].parts = ['users', 'login'];
    const m = messages(r);
    expect(m).toContain(`${D}.components[0].parts: component k-login holds part nope, which the Code Scaffold does not draw`);
    expect(m).toContain(`${D}.components[0].parts: component k-login holds part login-test, which the Code Scaffold does not draw`);
    expect(m).toContain(`${D}.components[1].parts: part login sits in component k-login and in component k-users: a part sits in one component`);
    const noDrawing = good();
    delete noDrawing.technical_design.drawing;
    delete c4(noDrawing).outside;
    expect(messages(noDrawing)).toContain(`${D}.components[1].parts: component k-users holds part users, which the Code Scaffold does not draw`);
  });

  it('wants every edge to name elements that exist', () => {
    const r = good();
    c4(r).edges[1].from = 'k-nope';
    delete c4(r).edges[0].to;
    c4(r).edges.push('k-login -> s-mail');
    const m = messages(r);
    expect(m).toContain(`${D}.edges[1].from: edge k-nope->s-mail starts or ends at k-nope, which the C4 model does not have`);
    expect(m).toContain(`${D}.edges[0].to: edge p-user->? has no to`);
    expect(m).toContain(`${D}.edges[2]: is not a map: give it from, to and label`);
  });

  it('wants every story an element names to be a story of the record', () => {
    const r = good();
    c4(r).components[0].stories = ['009'];
    c4(r).systems[0].stories = '001';
    c4(r).containers[0].stories = [1];
    const m = messages(r);
    expect(m).toContain(`${D}.components[0].stories: component k-login names story 009, which is not a story of this intent`);
    expect(m).toContain(`${D}.systems[0].stories: system s-app: stories must be a list of story ids`);
    expect(m.filter((x: string) => x.startsWith(`${D}.containers[0]`))).toEqual([]);
  });

  it('keeps a system with ext outside the application: it holds no container', () => {
    const r = good();
    c4(r).containers[1].system = 's-mail';
    expect(messages(r)).toEqual([
      `${D}.containers[1].system: container c-db sits in system s-mail, which is outside the application (ext): a system with ext holds no containers, give c-db a system of the application or drop ext`,
    ]);
  });
});

describe('lintC4: the plain texts', () => {
  it('wants the intent\'s and every story\'s plain text once the record carries one', () => {
    const story = good();
    delete story.stories[0].plain;
    expect(messages(story)).toEqual(['stories[0].plain: story 001 has no plain text: once the record carries plain texts, the intent and every story have one']);
    const intent = good();
    intent.intent.plain = '  ';
    expect(messages(intent)).toEqual(['intent.plain: the intent has no plain text: once the record carries plain texts, the intent and every story have one']);
  });

  it('wants plain words: no code, no markdown', () => {
    const say = (edit: (r: any) => void) => { const r = good(); edit(r); return messages(r); };
    const code = 'story 001: the plain text holds code (backticks, a file name, an identifier or a call): say it in the words of the people who use it';
    for (const t of ['The check sits in `login.ts` and looks at the date.', 'The check sits in login.ts and looks at the date.', 'The column password_expires holds the date.', 'The function isExpired() looks at the date.']) {
      expect(say((r) => { r.stories[0].plain = t; }), t).toEqual([`stories[0].plain: ${code}`]);
    }
    const markup = 'story 001: the plain text holds markdown (bold, a heading, a list or a link): write plain sentences';
    for (const t of ['**Note**: the user picks a new password.', 'The user:\n- picks a new password\n- goes on working', 'See [the screen](http://x) for the user.']) {
      expect(say((r) => { r.stories[0].plain = t; }), t).toEqual([`stories[0].plain: ${markup}`]);
    }
  });

  it('holds the intent to three to five sentences and 700 characters, a story to 450, without an em-dash', () => {
    const say = (edit: (r: any) => void) => { const r = good(); edit(r); return messages(r); };
    const long = `The user${' and the admin'.repeat(14)} picks a new password.`;
    const four = [long, long, long, long].join(' ');
    expect(say((r) => { r.intent.plain = four; })).toEqual([`intent.plain: the intent: the plain text is ${Array.from(four).length} characters, at most 700`]);
    expect(say((r) => { r.intent.plain = 'The user picks a new password. That happens at login.'; }))
      .toEqual(['intent.plain: the intent: the plain text is 2 sentences, expected three to five']);
    const six = 'The user logs in. The password has expired. The screen asks for a new one. The user picks it. The login goes on. The service desk hears nothing of it.';
    expect(say((r) => { r.intent.plain = six; })).toEqual(['intent.plain: the intent: the plain text is 6 sentences, expected three to five']);
    const five = 'The user logs in, e.g. on a Monday. The password has expired. The screen asks for a new one. The user picks it. The login goes on.';
    expect(say((r) => { r.intent.plain = five; })).toEqual([]);
    const story = `Logging in notices an expired password${' and the admin sees that'.repeat(18)}.`;
    expect(say((r) => { r.stories[0].plain = story; })).toEqual([`stories[0].plain: story 001: the plain text is ${Array.from(story).length} characters, at most 450`]);
    expect(say((r) => { r.stories[0].plain = `Logging in notices it ${DASH} the user then picks a new one.`; }))
      .toEqual(['stories[0].plain: story 001: the plain text holds an em-dash: use a comma, a colon or a full stop']);
  });
});

describe('spec-lint.cjs runs the C4 lint', () => {
  function run(root: string, ...args: string[]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8' });
    return { code: r.status, out: r.stdout };
  }
  /** The rendered template record, plus plain texts and a C4 block without components, after an optional edit. */
  function fixture(edit?: (record: any) => void) {
    const root = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-c4-lint-')), '.specs-aidlc-turbo');
    const dir = path.join(root, 'docs', 'user-auth', 'user-auth');
    mkdirSync(dir, { recursive: true });
    const record = template();
    record.intent.plain = INTENT_PLAIN;
    record.stories[0].plain = STORY_PLAIN;
    record.technical_design.c4 = {
      persons: [{ id: 'p-user', name: 'User' }],
      systems: [{ id: 's-app', name: 'App' }],
      containers: [{ id: 'c-web', name: 'Web', tech: 'TypeScript' }],
      edges: [{ from: 'p-user', to: 'c-web', label: 'Logs in' }],
    };
    if (edit) edit(record);
    writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
    const intent = paths.findIntent(root, 'user-auth');
    render.applyPlan(intent, render.planRender(intent));
    return root;
  }

  it('lints a rendered record with the C4 block and the plain texts clean', () => {
    const r = run(fixture(), 'user-auth');
    expect(r.out).toContain('spec-lint user-auth: clean');
    expect(r.code).toBe(0);
  });

  it('reports its findings in --json under the rule c4, in the shape of every other finding', () => {
    const root = fixture((rec) => { rec.technical_design.c4.systems[0].status = 'novel'; rec.stories[0].plain = `The screen ${DASH} new.`; });
    const json = run(root, 'user-auth', '--json');
    expect(json.code).toBe(1);
    const parsed = JSON.parse(json.out);
    expect(parsed).toEqual([
      { file: 'record.yaml', rule: 'c4', message: `${D}.systems[0].status: system s-app has status "novel", expected one of new, changed, existing` },
      { file: 'record.yaml', rule: 'c4', message: 'stories[0].plain: story 001: the plain text holds an em-dash: use a comma, a colon or a full stop' },
    ]);
  });
});

describe('the record template and c4-lint.cjs', () => {
  /** The template with its commented drawing, C4 block and plain texts switched on. */
  function uncommented() {
    const out: string[] = [];
    let open: string | null = null;
    for (const line of readFileSync(TEMPLATE, 'utf8').split('\n')) {
      const head = /^(\s*)# (drawing|c4|plain):/.exec(line);
      if (head) open = head[1];
      else if (open === null || !line.startsWith(`${open}#   `)) open = null;
      out.push(open === null ? line : line.replace(`${open}# `, open));
    }
    return render.parseYaml(out.join('\n'));
  }

  it('documents the C4 block and the plain texts, and which fields are derived', () => {
    const text = readFileSync(TEMPLATE, 'utf8');
    expect(text).toMatch(/^ {2}# c4:/m);
    expect(text).toMatch(/^ {2}# plain:/m);
    expect(text).toMatch(/^ {4}# plain:/m);
    expect(text).toContain('lib/c4-lint.cjs');
    expect(text).toMatch(/derived/i);
  });

  it('holds a worked example that lints clean and leaves nothing missing', () => {
    const r = uncommented();
    expect(r.technical_design.c4.components.length).toBeGreaterThan(0);
    expect(typeof r.intent.plain).toBe('string');
    expect(typeof r.stories[0].plain).toBe('string');
    expect(lint(r)).toEqual([]);
    expect(missing(r)).toEqual([]);
  });

  it('keeps c4-lint.cjs pure: local libraries only, under 500 lines, without an em-dash', () => {
    const src = readFileSync(LIB, 'utf8');
    expect(src.split('\n').length).toBeLessThanOrEqual(500);
    expect(src).not.toContain(DASH);
    const required = [...src.matchAll(/require\(([^)]*)\)/g)].map((m) => m[1]);
    expect(required.length).toBeGreaterThan(0);
    for (const r of required) expect(r).toMatch(/^'\.\/[\w-]+\.cjs'$/);
    expect(src).not.toMatch(/writeFileSync|readFileSync|process\./);
  });
});
