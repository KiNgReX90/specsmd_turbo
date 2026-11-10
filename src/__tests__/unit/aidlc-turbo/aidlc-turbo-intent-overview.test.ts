/**
 * Unit tests for intent-overview.cjs, the overview page the user approves at the end of inception and reads again
 * at finish, in the language of the record (English here). The generator builds one `page` blob for the template:
 * - the intent with a one-sentence summary and the rest, plain text;
 * - per story the user story, why it exists, the criteria, the code (new or changed, decided by git, else by the
 *   Code Scaffold and the disk), the test files count and, in construction with the tester on, the test cases;
 * - the lifecycle, the layers and slices, and the integration tests from the record's overview fields, with
 *   fallbacks for a record without them; a slice cell is new, changes (a used layer whose files the story touches
 *   or whose parts its drawing builds) or uses, with what it builds there;
 * - what the intent leaves out, with the register quote;
 * - the story markdown, in the headings of the record's language, as the fallback when the record has no product
 *   half.
 * The CLI writes the page into the intent folder with nothing loaded over the network and no story text able to
 * close its data block; the tabs follow the record (Functional always, the Code Scaffold with a drawing), the two
 * tabs of the v5 kit ride along embedded when the record has something for them; it names every piece of new data
 * the record lacks, one line each, and invents none; an old-layout root stops with the migration message.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { overview, render, paths, run, embedOf, modelOf, pageOf, pageTabs, v5Model, missing, OVERVIEW, fixture, git, write } from './aidlc-turbo-intent-overview-fixture';

/** The data of the page, as buildData gives it. */
const pageData = (root: string, intent: any, phase = 'inception') => overview.buildData(root, intent, phase).page;
/** The lines the CLI printed. */
const lines = (out: string) => out.trim().split('\n');

describe('aidlc-turbo intent overview: the page', () => {
  it('has exactly the page shape, with the intent split into a summary and the rest', () => {
    const { root, intent } = fixture({ overview: true });
    const page = pageData(root, intent);
    expect(Object.keys(page)).toEqual(['lang', 'phase', 'generated', 'source', 'labels', 'intent', 'stories', 'lifecycle', 'groups', 'layers', 'slices', 'integration', 'outOfScope', 'design']);
    expect(page.lang).toBe('en');
    expect(page.phase).toBe('inception');
    expect(page.generated).toMatch(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/);
    expect(page.source).toBe(path.relative(process.cwd(), intent.dir));
    expect(page.intent).toEqual({
      id: 'user-auth',
      title: 'User authentication',
      status: 'draft',
      branch: null,
      summary: 'Users with an expired password renew it themselves when they log in.',
      rest: 'So they keep their account, e.g. after a holiday. The service desk gets fewer reset requests.',
    });
  });

  it('says the intent is built only once it is, never above stories still to build', () => {
    const { root, intent } = fixture({ overview: true });
    const phaseOf = () => pageData(root, intent, 'construction').labels.phase.construction;
    expect(phaseOf()).toBe('Building');
    const files = readdirSync(intent.stories).map((n: string) => path.join(intent.stories, n));
    for (const f of files) writeFileSync(f, readFileSync(f, 'utf8').replace(/^status: \w+$/m, 'status: done'));
    expect(phaseOf()).toBe('Intent built');
    // the brief closed at finish counts too, with a story left on purpose
    writeFileSync(files[0], readFileSync(files[0], 'utf8').replace(/^status: done$/m, 'status: todo'));
    expect(phaseOf()).toBe('Building');
    writeFileSync(intent.brief, readFileSync(intent.brief, 'utf8').replace(/^status: \w+$/m, 'status: done'));
    expect(phaseOf()).toBe('Intent built');
    expect(pageData(root, intent).labels.phase.inception).toBe('Inception done');
  });

  it('carries the labels of the string table, with the lifecycle subject filled in', () => {
    const { root, intent } = fixture({ overview: true });
    const { labels } = pageData(root, intent);
    expect(Object.keys(labels)).toEqual(['phase', 'explain', 'cell', 'storyStatus', 'twinResult', 'more']);
    expect(labels.phase).toEqual({ inception: 'Inception done', construction: 'Intent built' });
    expect(labels.explain.flow).toBe('The life of a password; the numbers are the stories that build a step.');
    expect(Object.keys(labels.explain)).toEqual(['flow', 'slices', 'slicesLink', 'slicesPhone', 'slicesLinkPhone', 'tests']);
    expect(labels.explain.slices).toContain('A vertical slice is one story');
    expect(labels.explain.slicesLink).toContain('is a seam');
    expect(labels.explain.tests).toContain('never against a stub');
    expect(labels.cell).toEqual({
      new: 'new', changes: 'changes', uses: 'uses',
      newTip: 'does not exist yet, the story creates it',
      changesTip: 'exists, the story changes it',
      usesTip: 'the story relies on it, but does not change it',
      seam: 'seam with an earlier story',
    });
    expect(labels.storyStatus.done).toBe('Done');
    expect(labels.twinResult.unreachable).toBe('app unreachable');
    expect(labels.more).toBe('Read more');
  });

  it('tells after the build what happened: the labels of labelsBuilt over the others', () => {
    const { root, intent } = fixture({ overview: true });
    const { labels } = pageData(root, intent, 'construction');
    expect(labels.explain.flow).toBe('The life of a password; the numbers are the stories that built a step.');
    expect(labels.explain.slicesLink).toContain('is a seam');
    expect(labels.cell).toMatchObject({ new: 'new', changes: 'changed', newTip: 'did not exist yet, the story created it' });
  });

  it('reads every story from the record and its frontmatter, as plain text', () => {
    const { root, intent } = fixture({ overview: true });
    const { stories } = pageData(root, intent);
    expect(stories.map((s: any) => s.id)).toEqual(['001', '002']);
    const [first, second] = stories;
    expect(Object.keys(first)).toEqual(['id', 'slug', 'title', 'short', 'status', 'depends_on', 'story', 'why', 'criteria', 'code', 'testFiles', 'tests']);
    expect(first).toMatchObject({ slug: '001-login-expired-password', title: 'Login with expired password', short: 'Expired password', status: 'todo', depends_on: [] });
    expect(first.story).toEqual({ asA: 'user with an expired password', iWant: 'to choose a new password right when I log in', soThat: 'I can go on working without the service desk.' });
    expect(first.why).toMatch(/^The service desk gets requests every week/);
    expect(first.criteria[0]).toEqual({ given: 'an account with an expired password', when: 'I log in with that password', then: 'I see the screen to choose a new password' });
    expect(first.criteria[1].given).toBe('the old check checkPasswordAge in the login code');
    expect(first.criteria).toHaveLength(3);
    expect(second).toMatchObject({ slug: '002-reset-mail', title: 'Send the reset mail', short: 'Reset mail', depends_on: ['001'], why: null });
    expect(second.criteria).toEqual([{ given: 'an expired account', when: 'I log in', then: 'I get a mail' }]);
    // Nothing of an older page is left, and no plain text the record does not hold.
    for (const key of ['requirements', 'criteriaVia', 'surface', 'outOfScope', 'userStory', 'tester_verifiable', 'plain']) {
      expect(first).not.toHaveProperty(key);
    }
  });

  it('a story without the record short name shows its title', () => {
    const { root, intent } = fixture();
    const [story] = pageData(root, intent).stories;
    expect(story.short).toBe(story.title);
  });

  it('carries the intent\'s and every story\'s plain text when the record has them', () => {
    const { root, intent } = fixture({ overview: true, plain: true });
    const page = pageData(root, intent);
    expect(page.intent.plain).toBe('Whoever logs in with an expired password chooses a new one right away. Nobody has to call the service desk.');
    expect(page.stories.map((s: any) => s.plain)).toEqual(['Story 001 lets the user choose a new password.', 'Story 002 lets the user choose a new password.']);
  });

  it('maps the record lifecycle for the template: status lane, rows, band tones, nodes, edges and wrap', () => {
    const { root, intent } = fixture({ overview: true });
    const { lifecycle } = pageData(root, intent);
    expect(lifecycle.subject).toBe('a password');
    expect(lifecycle.lanes).toEqual([
      { id: 'status', label: 'Status', bandOnly: true },
      { id: 'user', label: 'User', rows: 2 },
      { id: 'app', label: 'App', tone: 'strong' },
      { id: 'check', label: 'Check', tone: 'alert' },
    ]);
    expect(lifecycle.band).toEqual([
      { from: 0, to: 1, label: 'Valid', tone: 'a', tip: 'Not expired yet' },
      { from: 1, to: 2, label: 'Expired', tone: 'b' },
      { from: 2, to: 3.5, label: 'Renewed', tone: 'c', end: 'Valid again' },
    ]);
    expect(lifecycle.nodes[0]).toEqual({ id: 'login', lane: 'user', row: 0, col: 0, label: 'Log in', sub: 'with the old password', stories: ['001'], shape: 'process' });
    expect(lifecycle.nodes[2]).toMatchObject({ id: 'expiry', row: 0, shape: 'alert', sub: '' });
    expect(lifecycle.edges).toEqual([
      { from: 'login', to: 'expiry', kind: 'main', label: null, fromSide: null, toSide: null, route: null, fromOff: 0, toOff: 0 },
      { from: 'expiry', to: 'reset', kind: 'reject', label: 'expired', fromSide: 'top', toSide: 'bottom', route: null, fromOff: -36, toOff: 12 },
      { from: 'reset', to: 'mail', kind: 'write', label: null, fromSide: null, toSide: null, route: 'h', fromOff: 0, toOff: 0 },
    ]);
    expect(lifecycle.wrap).toEqual({ story: '001', label: 'User table', tip: 'Every step reads the table' });
  });

  it('the end word of the band starts with a capital and names the end states as their steps do', () => {
    const { root, dir, intent, record } = fixture({ overview: true });
    record.overview = JSON.parse(JSON.stringify(OVERVIEW));
    record.overview.lifecycle.steps.push(
      { id: 'done', lane: 'app', col: 3, label: 'Processed', shape: 'state', stories: [] },
      { id: 'failed', lane: 'check', col: 3, label: 'Failed', shape: 'state', stories: [] },
    );
    record.overview.lifecycle.states[2].end = 'processed or failed';
    writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
    expect(pageData(root, intent).lifecycle.band[2].end).toBe('Processed or Failed');
    // a word that only looks like a state inside another word stays as it is
    record.overview.lifecycle.states[2].end = 'unprocessed';
    writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
    expect(pageData(root, intent).lifecycle.band[2].end).toBe('Unprocessed');
  });

  it('band tones: two states without an end are a and b, a last state with an end is c; no states, no band', () => {
    const { root, dir, intent, record } = fixture({ overview: true });
    record.overview = JSON.parse(JSON.stringify(OVERVIEW));
    record.overview.lifecycle.states = [{ label: 'Open', from: 0, to: 1 }, { label: 'Closed', from: 1, to: 2 }];
    writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
    expect(pageData(root, intent).lifecycle.band.map((b: any) => b.tone)).toEqual(['a', 'b']);
    record.overview.lifecycle.states[1].end = 'gone';
    writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
    expect(pageData(root, intent).lifecycle.band.map((b: any) => b.tone)).toEqual(['a', 'c']);
    delete record.overview.lifecycle.states;
    writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
    const { lifecycle } = pageData(root, intent);
    expect(lifecycle.band).toEqual([]);
    expect(lifecycle.lanes[0].id).toBe('user');
  });

  it('gives groups, layers and slices from the record: a cell per layer of the slice, new or uses', () => {
    const { root, intent } = fixture({ overview: true });
    const { groups, layers, slices } = pageData(root, intent);
    expect(groups).toEqual([{ id: 'tables', label: 'Tables' }, { id: 'code', label: 'Code' }]);
    expect(layers).toEqual([
      { id: 't-users', group: 'tables', label: 'Users', tip: 'Table users' },
      { id: 'login', group: 'code', label: 'Log in', tip: 'src/auth/login.ts' },
      { id: 'mail', group: 'code', label: 'Mail', tip: '' },
    ]);
    const cell = (role: string) => ({ role, note: '' });
    expect(slices).toEqual({
      '001': { delivers: '', cells: { 't-users': cell('new'), login: cell('new') } },
      '002': { delivers: '', cells: { 't-users': cell('uses'), login: cell('uses'), mail: cell('new') } },
    });
  });

  it('gives each integration test the later story, the earlier story and its text, plain', () => {
    const { root, intent } = fixture({ overview: true });
    expect(pageData(root, intent).integration).toEqual([{
      id: 'T1',
      later: '002',
      earlier: '001',
      full: 'An expired account gets the reset mail after logging in',
      expect: 'An expired account gets the reset mail after logging in',
      code: [],
      codeFrom: '',
    }]);
  });

  it('shows what the intent leaves out: the short name, else the register quote or the text, the reason as tip', () => {
    const { root, intent } = fixture();
    expect(pageData(root, intent).outOfScope).toEqual([
      { text: 'Two-step verification', tip: 'Comes in an intent of its own' },
      { text: 'Log in with a passkey', tip: '' },
    ]);
  });

  it('shows the reason for a long register quote, with the quotes in the tip, and the same chip once', () => {
    const { root, intent } = fixture();
    const recordFile = path.join(intent.dir, 'record.yaml');
    const record = render.parseYaml(readFileSync(recordFile, 'utf8'));
    const long = 'Existing gift cards of partner shops and their open balance stay where they are for now, untouched';
    record.deliberately_not = [
      { id: 'S-004', reason: 'Later' },
      { id: long, reason: 'Partner cards come in a later intent (D-1)' },
      { id: `${long}, also after the import`, reason: 'Partner cards come in a later intent (D-1)' },
      { id: long, reason: 'Partner cards come in a later intent (D-1)' },
    ];
    writeFileSync(recordFile, render.dumpYaml(record));
    expect(pageData(root, intent).outOfScope).toEqual([
      { text: 'Log in with two-step verification', tip: 'Later' },
      { text: 'Partner cards come in a later intent', tip: `${long}\n${long}, also after the import` },
    ]);
  });
});

describe('aidlc-turbo intent overview: a record without the overview fields', () => {
  it('has no lifecycle and no integration, and derives the layers from the tables and code modules', () => {
    const { base, root, intent } = fixture();
    // Not a git repo, git not found: existence on disk decides.
    const noGit = { cwd: base, env: { PATH: '', GIT_CEILING_DIRECTORIES: path.dirname(base) } };
    expect(run(root, ['user-auth'], noGit).code).toBe(0);
    let page = pageOf(intent);
    expect(page.lifecycle).toBeNull();
    expect(page.integration).toEqual([]);
    expect(page.groups).toEqual([{ id: 'tables', label: 'Tables' }, { id: 'code', label: 'Code' }]);
    expect(page.layers).toEqual([
      { id: 't-users', group: 'tables', label: 'users', tip: '' },
      { id: 'c-src-auth', group: 'code', label: 'src/auth', tip: '' },
    ]);
    // login.ts is not on disk yet: the story makes it new.
    expect(page.slices).toEqual({ '001': { delivers: '', cells: { 't-users': { role: 'uses', note: '' }, 'c-src-auth': { role: 'new', note: '' } } } });
    expect(page.stories[0].code).toEqual([{ module: 'src/auth', name: 'login', path: 'src/auth/login.ts', kind: 'new' }]);
    expect(page.stories[0].testFiles).toBe(1);

    write(path.join(base, 'src/auth/login.ts'));
    expect(run(root, ['user-auth'], noGit).code).toBe(0);
    page = pageOf(intent);
    expect(page.stories[0].code[0].kind).toBe('changes');
    expect(page.slices['001'].cells['c-src-auth']).toEqual({ role: 'changes', note: '' });
  });
});

describe('aidlc-turbo intent overview: code and test files', () => {
  it('kind is changes for a file that existed before the intent, new otherwise, decided by git', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'turbo-overview-git-'));
    git(repo, 'init', '-q');
    write(path.join(repo, 'src/auth/login.ts'));
    write(path.join(repo, 'README.md'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '--no-verify', '-m', 'base');
    const { root, intent } = fixture({ overview: true, base: repo });

    // The record is not committed yet: HEAD is the base.
    expect(run(root, ['user-auth'], { cwd: repo }).code).toBe(0);
    let [first, second] = pageOf(intent).stories;
    expect(first.code).toEqual([{ module: 'src/auth', name: 'login', path: 'src/auth/login.ts', kind: 'changes' }]);
    expect(first.testFiles).toBe(1);
    expect(second.code).toEqual([{ module: 'src/mail', name: 'reset-mail', path: 'src/mail/reset-mail.ts', kind: 'new' }]);

    // The record is committed, then the second story is built: the base is the
    // commit before the record, so the file it made stays new.
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '--no-verify', '-m', 'inception');
    write(path.join(repo, 'src/mail/reset-mail.ts'));
    write(path.join(repo, 'src/mail/templates/reset.html'));
    const storyFile = path.join(intent.stories, '002-reset-mail.md');
    writeFileSync(storyFile, readFileSync(storyFile, 'utf8').replace(/\n---\n/, '\nchanged_files: [src/mail/reset-mail.ts, src/mail/templates/reset.html, src/mail/reset-mail.test.ts, README.md]\n---\n'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '--no-verify', '-m', 'story 002');
    expect(run(root, ['user-auth', '--phase', 'inception'], { cwd: repo }).code).toBe(0);
    [first, second] = pageOf(intent).stories;
    expect(first.code[0].kind).toBe('changes');
    // changed_files wins over touches once the story is built; a file at the top sits in the top folder.
    expect(second.code).toEqual([
      { module: 'src/mail', name: 'reset-mail', path: 'src/mail/reset-mail.ts', kind: 'new' },
      { module: 'src/mail', name: 'reset.html', path: 'src/mail/templates/reset.html', kind: 'new' },
      { module: 'top folder', name: 'README.md', path: 'README.md', kind: 'changes' },
    ]);
    expect(second.testFiles).toBe(1);

    // Without git everything on disk counts as changed.
    expect(run(root, ['user-auth'], { cwd: repo, env: { PATH: '' } }).code).toBe(0);
    expect(pageOf(intent).stories[1].code.map((c: any) => c.kind)).toEqual(['changes', 'changes', 'changes']);
  });

  it('without git the Code Scaffold says new or changed for a file it draws, the disk for the rest, in the slice words', () => {
    const { base, root, dir, intent, record } = fixture({ overview: true });
    record.technical_design = {
      ...(record.technical_design || {}),
      drawing: {
        modules: [{ id: 'auth', name: 'auth', status: 'changed', what: 'The login code.', path: 'src/auth' }],
        parts: [
          { id: 'login', name: 'login.ts', module: 'auth', layer: 'server', status: 'changed', kind: 'JS module', path: 'src/auth/login.ts', lines: '1-9' },
          { id: 'mailer', name: 'reset-mail.ts', layer: 'server', status: 'new', kind: 'JS module', path: './src/mail/reset-mail.ts' },
        ],
      },
    };
    writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
    // reset-mail.ts is on disk, login.ts is not: the drawing still decides for both
    write(path.join(base, 'src/mail/reset-mail.ts'));
    const noGit = { cwd: base, env: { PATH: '', GIT_CEILING_DIRECTORIES: path.dirname(base) } };
    expect(run(root, ['user-auth'], noGit).code).toBe(0);
    const [first, second] = pageOf(intent).stories;
    expect(first.code).toEqual([{ module: 'src/auth', name: 'login', path: 'src/auth/login.ts', kind: 'changes' }]);
    expect(second.code).toEqual([{ module: 'src/mail', name: 'reset-mail', path: 'src/mail/reset-mail.ts', kind: 'new' }]);
  });

  it('counts test files only into testFiles', () => {
    const { root, dir, intent, record } = fixture();
    record.stories[0].touches = [
      'web/src/Login.tsx', 'web/src/Login.test.tsx', 'web/e2e/login.ts', 'api/src/test/java/LoginService.java',
      'api/src/main/java/LoginServiceTest.java', 'api/src/main/java/LoginIT.java', 'svc/login_test.go', 'py/test_login.py',
      'packages/core/lib/auth.ts', 'lib/x/y.ts', 'web/src/__tests__/a.ts', 'web/src/login.spec.ts',
    ];
    writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
    render.applyPlan(intent, render.planRender(intent));
    const [story] = pageData(root, intent).stories;
    expect(story.code.map((c: any) => [c.module, c.name])).toEqual([['web', 'Login'], ['packages/core', 'auth'], ['lib/x', 'y']]);
    expect(story.testFiles).toBe(9);
  });
});

describe('aidlc-turbo intent overview: the story markdown fallback', () => {
  it('reads the user story, why and the criteria from the product-team section when the record has no product half', () => {
    const { root, dir, intent, record } = fixture();
    delete record.stories[0].product;
    writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
    writeFileSync(path.join(intent.stories, '003-legacy.md'), [
      '---', 'id: 3', 'title: Old story', 'intent: user-auth', 'status: done', 'depends_on: [001]', '---', '',
      '# S003: Legacy', '', '## For the product team', '',
      '**As** an admin, **I want** a gift card to *expire*, **so that** no imported voucher stays forever.', '',
      '### Why this story', '', 'Imported vouchers pile up and nobody can tell which still count.', '',
      '### Acceptance criteria', '',
      '- **Given** a one-off gift card **when** the job runs **then** a row is in `GIFT_CARD_EXPIRY_LOG` *(tester: database)*',
      '- **Given** an account **when** I log in **then** I see the reset screen *(tester: none, covered by S001 Login with expired password)*',
      '- The old class is gone',
      '', '### Out of scope', '', 'None.', '',
    ].join('\n'));
    const [first, legacy] = pageData(root, intent).stories;
    expect(first.story).toEqual({ asA: 'user with an expired password', iWant: 'to choose a new password right when I log in', soThat: 'I can go on working without the service desk.' });
    expect(first.criteria[0]).toEqual({ given: 'an account with an expired password', when: 'I log in with that password', then: 'I see the screen to choose a new password' });
    expect(JSON.stringify(first.criteria)).not.toMatch(/tester:|\*/);
    expect(legacy).toMatchObject({ id: '003', slug: '003-legacy', title: 'Old story', short: 'Old story', status: 'done', depends_on: ['001'] });
    expect(legacy.story).toEqual({ asA: 'an admin', iWant: 'a gift card to expire', soThat: 'no imported voucher stays forever.' });
    expect(legacy.why).toBe('Imported vouchers pile up and nobody can tell which still count.');
    expect(legacy.criteria).toEqual([
      { given: 'a one-off gift card', when: 'the job runs', then: 'a row is in GIFT_CARD_EXPIRY_LOG' },
      { given: 'an account', when: 'I log in', then: 'I see the reset screen' },
      { given: '', when: '', then: 'The old class is gone' },
    ]);
  });

  it('reads it in the headings of a project table: the record\'s own language', () => {
    const { root, dir, intent, record } = fixture();
    record.intent.language = 'xx';
    delete record.stories[0].product;
    writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
    // a project table in a pseudo-language: the English words, upper case
    mkdirSync(path.join(root, 'repo', 'lang'), { recursive: true });
    writeFileSync(path.join(root, 'repo', 'lang', 'xx.json'), JSON.stringify({
      md: { product: 'FOR THE PRODUCT TEAM', asA: 'AS', iWant: 'I WANT', soThat: 'SO THAT', criteria: 'ACCEPTANCE CRITERIA', given: 'GIVEN', when: 'WHEN', then: 'THEN', none: 'NONE.', tester: 'TESTER' },
      overview: { labels: { storyStatus: { done: 'DONE' } } },
    }));
    writeFileSync(path.join(intent.stories, '003-legacy.md'), [
      '---', 'id: 3', 'title: Old story', '---', '', '## FOR THE PRODUCT TEAM', '',
      '**AS** an admin, **I WANT** a report, **SO THAT** I see it.', '',
      '### ACCEPTANCE CRITERIA', '', '- **GIVEN** a shop **WHEN** I open it **THEN** I see the report *(TESTER: screen)*', '- NONE.', '',
    ].join('\n'));
    const page = pageData(root, intent);
    expect(page.lang).toBe('xx');
    expect(page.labels.storyStatus.done).toBe('DONE');
    // a text the project table lacks comes from the English one
    expect(page.labels.storyStatus.todo).toBe('To build');
    const legacy = page.stories.find((s: any) => s.id === '003');
    expect(legacy.story).toEqual({ asA: 'an admin', iWant: 'a report', soThat: 'I see it.' });
    expect(legacy.criteria).toEqual([{ given: 'a shop', when: 'I open it', then: 'I see the report' }]);
  });

  it('a story without a user story line has story null', () => {
    const { root, intent } = fixture();
    writeFileSync(path.join(intent.stories, '004-bare.md'), ['---', 'id: "004"', 'title: Bare', '---', '', '# S004: Bare', ''].join('\n'));
    const bare = pageData(root, intent).stories.find((s: any) => s.id === '004');
    expect(bare.story).toBeNull();
    expect(bare.why).toBeNull();
    expect(bare.criteria).toEqual([]);
    expect(bare.code).toEqual([]);
  });
});

describe('aidlc-turbo intent overview: test cases', () => {
  it('shows the test cases only in construction with the tester on', () => {
    const { root, intent } = fixture();
    expect(pageData(root, intent).stories[0].tests).toEqual([]);
    const [story] = pageData(root, intent, 'construction').stories;
    expect(story.tests).toHaveLength(1);
    expect(story.tests[0]).toMatchObject({ testId: 'US-001', title: 'US-001 - Log in', twin: null, twinResult: 'not_run' });
    expect(Object.keys(story.tests[0])).toEqual(['testId', 'title', 'twin', 'twinResult', 'sections']);
    expect(story.tests[0].sections.map((s: any) => s.heading)).toEqual(['Preparation', 'Steps']);
    expect(story.tests[0].sections[1].html).toContain('<strong>Log in</strong>');

    writeFileSync(paths.layout(root).config, 'mode: sandbox\ntester:\n  enabled: false\n');
    expect(pageData(root, intent, 'construction').stories[0].tests).toEqual([]);
  });
});

describe('aidlc-turbo intent overview: the CLI before the build', () => {
  it('writes the page into the intent folder, and no story text can close its data block', () => {
    const { root, intent } = fixture({ overview: true });
    const r = run(root, ['user-auth', '--phase', 'inception']);
    expect(r.code).toBe(0);
    expect(lines(r.stdout)[0]).toBe(`Overview: ${intent.overview}`);
    expect(existsSync(intent.overview)).toBe(true);
    const html = readFileSync(intent.overview, 'utf8');
    expect(html.toLowerCase().startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<script id="overview-data" type="application/json">');
    expect(html).toContain('<script id="turbo-text" type="application/json">');
    expect(html).toContain('<body class="mq">');
    expect(html).not.toMatch(/\{\{[\w.]+\}\}|__[A-Z_]+__/);
    expect(html).not.toContain('</script> the dashboard');
    expect(html.match(/<script\b/g)!.length).toBe(html.match(/<\/script>/g)!.length);
    const page = pageOf(intent);
    expect(page.phase).toBe('inception');
    expect(page.stories[0].criteria[2].then).toBe('I see </script> the dashboard');
    expect(page.stories).toHaveLength(2);
    expect(page.outOfScope).toHaveLength(2);
  });

  it('loads nothing over the network: no script source, the drawing and the Turbo logo inlined', () => {
    const { root, intent } = fixture({ drawing: true });
    expect(run(root, ['user-auth']).code).toBe(0);
    const html = readFileSync(intent.overview, 'utf8');
    expect(html).not.toMatch(/<script\b[^>]*\bsrc\s*=/i);
    expect(html).not.toMatch(/<img\b/i);
    expect(html).toContain('root.TdEngine =');
    expect(html).toContain('<svg class="logo"');
  });

  it('a record of today\'s flow: exit 0, a readable page, one line per missing piece, nothing invented', () => {
    const { root, intent } = fixture({ overview: true });
    const before = readFileSync(intent.record, 'utf8');
    const r = run(root, ['user-auth']);
    expect(r.code).toBe(0);
    expect(lines(r.stdout)[0]).toBe(`Overview: ${intent.overview}`);
    const reported = lines(r.stdout).slice(1);
    // one line per gap missing() finds, by its record path
    expect(reported).toHaveLength(missing(render.parseYaml(before), { intent: 'user-auth' }).length);
    expect(reported.length).toBeGreaterThan(0);
    for (const line of reported) expect(line).toMatch(/^Missing: record\.yaml \S+ \(/);
    expect(reported.join('\n')).toContain('technical_design.c4');
    // the record stays as it was
    expect(readFileSync(intent.record, 'utf8')).toBe(before);
    // nothing for the two embedded tabs: no C4 block, no questions, no decisions, so no embed block at all
    expect(embedOf(readFileSync(intent.overview, 'utf8'))).toBeNull();
  });

  it('a record without a drawing still makes a page: Functional only, no Code Scaffold', () => {
    const { root, intent } = fixture({ overview: true, c4: false });
    expect(run(root, ['user-auth']).code).toBe(0);
    const page = pageOf(intent);
    expect(page.design).toBeNull();
    expect(pageTabs(page)).toEqual([]);
    expect(readFileSync(intent.overview, 'utf8')).toContain('<body class="mq">');
  });

  it('with a drawing the Code Scaffold joins it; with the C4 block the C4 model rides along embedded', () => {
    const drawn = fixture({ overview: true, drawing: true });
    expect(run(drawn.root, ['user-auth']).code).toBe(0);
    const page = pageOf(drawn.intent);
    expect(page.design.parts.map((p: any) => p.id)).toEqual(['form', 'login', 'users']);
    expect(pageTabs(page)).toEqual(['Functional', 'Code Scaffold']);
    // no C4 block and no question: nothing to embed
    expect(embedOf(readFileSync(drawn.intent.overview, 'utf8'))).toBeNull();

    const whole = fixture({ overview: true, drawing: true, c4: true, plain: true });
    const r = run(whole.root, ['user-auth']);
    expect(r.code).toBe(0);
    // a record that holds all the new data has nothing to report
    expect(lines(r.stdout)).toEqual([`Overview: ${whole.intent.overview}`]);
    expect(pageTabs(pageOf(whole.intent))).toEqual(['Functional', 'Code Scaffold']);
    const model = modelOf(whole.intent);
    expect(model.embed).toBe(true);
    expect(model.views.context).toBeTruthy();
    // the whole v5 page is one JSON string with every < escaped: it carries no tag that could close the block
    const html = readFileSync(whole.intent.overview, 'utf8');
    const raw = /<script type="application\/json" id="v5-embed">([\s\S]*?)<\/script>/.exec(html)![1];
    expect(raw).not.toMatch(/<script|<\/script|<!--/i);
    expect(raw).toContain('\\u003c');
    expect(html.match(/<script\b/g)!.length).toBe(html.match(/<\/script>/g)!.length);
    expect(html.indexOf('id="v5-embed"')).toBeLessThan(html.lastIndexOf('</body>'));
    expect(html.indexOf('id="v5-embed"')).toBeGreaterThan(html.indexOf('id="overview-data"'));
  });

  it('names a gap in the C4 block by its record path and its element, as missing() finds it', () => {
    const { root, dir, intent, record } = fixture({ overview: true, drawing: true, c4: true, plain: true });
    record.technical_design.c4.components.push({ id: 'k-mail', container: 'c-web', name: 'Mail', tech: 'TypeScript', desc: 'The mail', parts: ['mailer'] });
    record.technical_design.c4.edges.push({ from: 'p-user', to: 's-gone', label: 'Calls' });
    writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
    const r = run(root, ['user-auth']);
    expect(r.code).toBe(0);
    const reported = lines(r.stdout).slice(1);
    expect(reported).toEqual([
      'Missing: record.yaml technical_design.c4.components[2].parts (k-mail): component k-mail holds part mailer, which the Code Scaffold does not draw',
      'Missing: record.yaml technical_design.c4.edges[2].to (p-user->s-gone): edge p-user->s-gone starts or ends at s-gone, which the C4 model does not have',
    ]);
    expect(reported).toHaveLength(missing(render.parseYaml(readFileSync(intent.record, 'utf8')), { intent: 'user-auth' }).length);
  });

  it('stops on the old layout, a missing intent and a bad call', () => {
    const legacy = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-overview-legacy-')), '.specs-aidlc-turbo');
    mkdirSync(path.join(legacy, 'intents', 'user-auth'), { recursive: true });
    const r = run(legacy, ['user-auth']);
    expect(r.code).toBe(1);
    expect(r.out).toContain(paths.legacyMessage(legacy));
    const { root } = fixture();
    expect(run(root, ['nope']).code).toBe(1);
    const usage = run(root, []);
    expect(usage.code).toBe(2);
    expect(usage.out).toContain('Usage:');
    expect(run(root, ['user-auth', '--phase', 'later']).code).toBe(2);
    expect(run(root, ['user-auth', 'other']).code).toBe(2);
    const bad = run(root, ['user-auth', '--extract', 'x.json']);
    expect(bad.code).toBe(2);
    expect(bad.out).toContain('Unknown option --extract');
    expect(run(root, ['--help']).code).toBe(0);
  });
});

describe('aidlc-turbo intent overview: the v5 model it embeds', () => {
  it('is built from the same record: the stories and the C4 views the embedded tabs show', () => {
    const { root, intent } = fixture({ overview: true, drawing: true, c4: true });
    const model = v5Model(root, intent, 'inception');
    expect(model.stories.map((s: any) => s.id)).toEqual(['001', '002']);
    expect(model.views.context).toBeTruthy();
  });
});
