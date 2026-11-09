/**
 * Shared fixture of the intent-overview tests of the AI-DLC Turbo flow
 * (aidlc-turbo-intent-overview.test.ts): a project with the user-auth intent
 * and its record, register and test case, the script run through its CLI,
 * the page's own data and the v5 model of the C4 model it carries read back,
 * the tabs the page shows for its data, and small git and file helpers.
 */

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

export const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
export const SCRIPT = path.join(FLOW, 'scripts/intent-overview.cjs');
export const req = createRequire(import.meta.url);
export const overview = req(SCRIPT);
export const render = req(path.join(FLOW, 'scripts/render-specs.cjs'));
export const paths = req(path.join(FLOW, 'scripts/lib/paths.cjs'));
export const { v5Model } = req(path.join(FLOW, 'scripts/lib/v5-model.cjs'));
export const { missing } = req(path.join(FLOW, 'scripts/lib/v5-missing.cjs'));

/** The model block of a v5 page: `<script>window.C4 = { model: ... };</script>`, every `<` in it escaped. */
export const MODEL = /<script>window\.C4 = \{ model: ([\s\S]*?) \};<\/script>/;

/** The data block of the page the script writes (templates/overview). */
export const PAGE = /<script id="overview-data" type="application\/json">([\s\S]*?)<\/script>/;

/** The embed block of that page: the v5 page of the C4 model it carries, as one JSON string. */
export const EMBED = /<script type="application\/json" id="v5-embed">([\s\S]*?)<\/script>/;

/** The v5 page a written page carries, or null when it carries none. */
export function embedOf(html: string): string | null {
  const m = EMBED.exec(html);
  return m ? JSON.parse(m[1]) : null;
}

/** The data of the page the CLI wrote into overview.html. */
export function pageOf(intent: any) {
  const m = PAGE.exec(readFileSync(intent.overview, 'utf8'));
  return JSON.parse(m![1].replace(/<\\!--/g, '<!--'));
}

export function run(root: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--no-open', '--root', root], {
    encoding: 'utf8',
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env || {}) },
  });
  return { code: r.status, out: r.stdout + r.stderr, stdout: r.stdout };
}

/** The v5 model of the tabs the CLI wrote into overview.html: from its embed block, else from a v5 page itself. */
export function modelOf(intent: any) {
  return modelIn(readFileSync(intent.overview, 'utf8'));
}

/** The v5 model of a written page: the embed block it carries, else the page itself when it is a v5 one. */
export function modelIn(html: string) {
  const m = MODEL.exec(embedOf(html) ?? html);
  return JSON.parse(m![1]);
}

/**
 * The titles of the tabs the old page shows for its data: its own switch (templates/design/design-tabs.js) on it,
 * as the page builds it (review and the word Code after the build, the drawing's tab only with a drawing).
 */
export function pageTabs(page: any): string[] {
  const TdTabs = req(path.join(FLOW, 'templates/design/design-tabs.js'));
  if (!page || !page.design) return [];
  const built = page.phase === 'construction';
  return TdTabs.views(built, page.design.drawing !== false, built).map((v: string[]) => v[1]);
}

export const OVERVIEW = {
  lifecycle: {
    subject: 'a password',
    lanes: [
      { id: 'user', label: 'User' },
      { id: 'app', label: 'App', tone: 'strong' },
      { id: 'check', label: 'Check', tone: 'alert' },
    ],
    states: [
      { label: 'Valid', from: 0, to: 1, tip: 'Not expired yet' },
      { label: 'Expired', from: 1, to: 2 },
      { label: 'Renewed', from: 2, to: 3.5, end: 'valid again' },
    ],
    steps: [
      { id: 'login', lane: 'user', col: 0, row: 0, label: 'Log in', sub: 'with the `old` password', stories: ['001'] },
      { id: 'reset', lane: 'user', col: 1, row: 1, label: 'Choose a new one', stories: ['001'] },
      { id: 'expiry', lane: 'check', col: 1, label: 'Expiry date', shape: 'alert', stories: ['001'] },
      { id: 'mail', lane: 'app', col: 2, label: 'Reset mail', stories: ['002'] },
    ],
    arrows: [
      { from: 'login', to: 'expiry' },
      { from: 'expiry', to: 'reset', kind: 'reject', label: 'expired', from_side: 'top', to_side: 'bottom', from_offset: -36, to_offset: 12 },
      { from: 'reset', to: 'mail', kind: 'write', route: 'h' },
    ],
    under_all: { story: '001', label: 'User table', tip: 'Every step reads the table' },
  },
  layers: [
    { id: 't-users', group: 'Tables', label: 'Users', tip: 'Table users' },
    { id: 'login', group: 'Code', label: 'Log in', tip: 'src/auth/login.ts' },
    { id: 'mail', group: 'Code', label: 'Mail' },
  ],
};

/** A small Code Scaffold: a screen, a server module and a table, two calls. */
export const DRAWING = {
  summary: 'The login code gets a check on the expiry date.',
  modules: [{ id: 'auth', name: 'auth', status: 'changed', what: 'The login code.', path: 'src/auth' }],
  parts: [
    { id: 'form', name: 'LoginForm', module: 'auth', layer: 'screen', status: 'existing', kind: 'web component', sub: 'the login screen', what: 'The screen.', path: 'src/auth/form.ts', lines: '1-40' },
    { id: 'login', name: 'login.ts', module: 'auth', layer: 'server', status: 'changed', kind: 'JS module', sub: 'checks the expiry date', what: 'The entry point.', path: 'src/auth/login.ts', lines: '18-96' },
    { id: 'users', name: 'USERS', layer: 'database', status: 'existing', kind: 'table', sub: 'every user', what: 'The table.', path: 'db/users.sql', lines: '1-30' },
  ],
  links: [
    { from: 'form', to: 'login', label: 'sends the form', step: 'The user logs in.' },
    { from: 'login', to: 'users', label: 'reads the expiry date', code: 'findByName(name)' },
  ],
};

/** The C4 block for DRAWING: every drawn part in a component, every element named by an edge. */
export const C4 = {
  persons: [{ id: 'p-user', name: 'User', desc: 'Logs in with a password' }],
  systems: [{ id: 's-app', name: 'The application', desc: 'Logging in and passwords' }],
  containers: [
    { id: 'c-web', name: 'Web application', tech: 'Node', desc: 'Screens and server' },
    { id: 'c-db', name: 'Database', kind: 'db', tech: 'PostgreSQL', desc: 'The users' },
  ],
  components: [
    { id: 'k-login', container: 'c-web', name: 'Log in', tech: 'TypeScript', desc: 'The login screen and the check', parts: ['form', 'login'] },
    { id: 'k-users', container: 'c-db', name: 'Users', tech: 'table', desc: 'Every user', parts: ['users'] },
  ],
  edges: [
    { from: 'p-user', to: 's-app', label: 'Logs in', intent: true },
    { from: 'c-web', to: 'c-db', label: 'Reads and writes users', tech: 'SQL' },
  ],
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/**
 * An intent rendered from the record template, as today's flow writes it: no
 * C4 block and no plain texts. With `overview` the record gets the overview
 * fields and a second story that builds on the first. With `base` the artifact
 * root sits in that folder (a git repo in one test). `drawing` adds the Code
 * Scaffold DRAWING, `c4` the C4 block, `plain` the intent's and every story's
 * plain text.
 */
export function fixture(opts: { overview?: boolean; base?: string; drawing?: boolean; c4?: boolean; plain?: boolean } = {}) {
  const base = opts.base || mkdtempSync(path.join(tmpdir(), 'turbo-overview-'));
  const root = path.join(base, '.specs-aidlc-turbo');
  const dir = path.join(root, 'docs', 'user-auth', 'user-auth');
  mkdirSync(path.join(root, 'repo'), { recursive: true });
  mkdirSync(path.join(dir, 'tests'), { recursive: true });
  writeFileSync(path.join(root, 'repo', 'config.yaml'), 'mode: sandbox\ntester:\n  enabled: true\n  language: en\n');
  const record = render.parseYaml(readFileSync(path.join(FLOW, 'templates/inception/record-template.yaml'), 'utf8'));
  record.purpose = 'Users with an **expired** password renew it themselves when they log in. So they keep their account, e.g. after a holiday.\nThe service desk gets fewer `reset requests`.';
  record.stories[0].product.criteria.push({ given: 'an account', when: 'I log in', then: 'I see </script> the dashboard', observed_via: 'ui' });
  record.deliberately_not.push({ id: 'Log in with a passkey' });
  // Start from a record without the overview fields and without the new data, whatever the template has.
  delete record.overview;
  delete record.intent.plain;
  if (record.technical_design) { delete record.technical_design.c4; delete record.technical_design.drawing; }
  for (const s of record.stories) { delete s.short; delete s.slice; delete s.integration; delete s.plain; delete s.drawing; }
  if (opts.overview) {
    record.overview = clone(OVERVIEW);
    Object.assign(record.stories[0], { short: 'Expired password', slice: { 't-users': 'new', login: 'new' } });
    const second = clone(record.stories[0]);
    Object.assign(second, {
      id: '002', slug: 'reset-mail', title: 'Send the reset mail', depends_on: ['001'],
      touches: ['src/mail/reset-mail.ts', 'src/mail/reset-mail.test.ts'], db_tables: ['users', 'mail_queue'],
      short: 'Reset mail', slice: { 't-users': 'used', login: 'used', mail: 'new' },
      integration: [{ with: '001', test: 'An **expired** account gets the reset mail after logging in' }],
    });
    second.product = {
      as_a: 'user', i_want: 'a mail with a reset link', so_that: 'I can choose a new password later too',
      criteria: [{ given: 'an expired account', when: 'I log in', then: 'I get a mail', observed_via: 'ui' }],
      out_of_scope: [],
    };
    record.stories.push(second);
  }
  if (opts.drawing) {
    record.technical_design = { ...(record.technical_design || {}), drawing: clone(DRAWING) };
    for (const s of record.stories) s.drawing = { summary: 'The check on the expiry date.', builds: { login: 'the check on the expiry date' } };
  }
  if (opts.c4) record.technical_design = { ...(record.technical_design || {}), c4: clone(C4) };
  if (opts.plain) {
    record.intent.plain = 'Whoever logs in with an expired password chooses a new one right away. Nobody has to call the service desk.';
    for (const s of record.stories) s.plain = `Story ${s.id} lets the user choose a new password.`;
  }
  writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
  const intent = paths.findIntent(root, 'user-auth');
  render.applyPlan(intent, render.planRender(intent));
  writeFileSync(path.join(root, 'docs', 'user-auth', 'register.yaml'), [
    'pages:', '  "100": { title: Policy, version: 1, file: x.md, read_version: 1 }', 'items:',
    '  - { id: S-004, page: "100", version: 1, line: 3, kind: requirement, quote: "Log in with **two-step verification**", key: "100:a", status: current }',
  ].join('\n'));
  writeFileSync(path.join(dir, 'tests', 'US-001 - Log in.md'), [
    '---', 'test_id: US-001', 'story: 001-login-expired-password', 'twin: null', '---', '', '# US-001 - Log in', '',
    '## Preparation', '', '- Account', '', '## Steps', '', '1. Click **Log in**', '',
    '## Notes for the agent', '', '- internal',
  ].join('\n'));
  return { base, root, dir, intent, record };
}

export function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

export function write(file: string, text = 'x\n') {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}
