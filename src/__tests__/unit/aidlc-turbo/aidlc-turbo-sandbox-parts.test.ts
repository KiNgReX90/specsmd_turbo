/**
 * The two parts a sandbox can leave out, in `.specs-aidlc-turbo/repo/config.yaml`:
 *
 *   sandbox:
 *     code_scaffold: true         # the Code Scaffold, drawn in the inception
 *     scaffold_after_build: true  # the Code Scaffold updated as built, at finish
 *
 * Both are on by default and production always makes both.
 * - the installer writes the block, with comments, only in sandbox mode, and
 *   never an update after the build without the scaffold;
 * - the wizard asks the two right after the mode, only for a sandbox, and
 *   the second only with the Code Scaffold; a sandbox is asked nothing about
 *   Confluence or Jira;
 * - a part that is off is never checked or demanded: spec-lint skips the
 *   drawing, the overview has no drawing, and after the build no update of it;
 * - the skills, the config command and the docs say so, and a part that is
 *   off is reported missing nowhere.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const yaml = require('js-yaml');
const { renderTurboConfig, turboQuestionSections } = require('../../../lib/flow-config');

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const render = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const lint = req(path.join(FLOW, 'scripts/spec-lint.cjs'));
const paths = req(path.join(FLOW, 'scripts/lib/paths.cjs'));
const OVERVIEW = path.join(FLOW, 'scripts/intent-overview.cjs');
const read = (rel: string) => readFileSync(path.join(FLOW, rel), 'utf8');
const flat = (rel: string) => read(rel).replace(/\s+/g, ' ');
const DATA = /<script[^>]*id="overview-data"[^>]*>([\s\S]*?)<\/script>/;

const questions = () => turboQuestionSections().flatMap((section: any) => section.questions);
const question = (name: string) => questions().find((q: any) => q.name === name);
const asked = (name: string, values: object) => {
  const type = question(name).type;
  return typeof type === 'function' ? type(undefined, values) : type;
};
const PARTS = ['code_scaffold', 'scaffold_after_build'];

const OFF = 'sandbox:\n  code_scaffold: false\n  scaffold_after_build: false\n';

/** A small drawing: one new module and part, one existing part, story 001 builds the new ones. */
function draw(r: any) {
  r.technical_design = {
    ...(r.technical_design || {}),
    drawing: {
      summary: 'The login code gets a check.',
      modules: [{ id: 'auth', name: 'auth', status: 'new', path: 'src/auth' }],
      parts: [
        { id: 'login', name: 'login.ts', module: 'auth', layer: 'server', status: 'new', kind: 'nonsense', path: 'src/auth/login.ts' },
      ],
      links: [],
    },
  };
  r.stories[0].drawing = { summary: 'The check.', builds: { auth: 'new', login: 'new' }, uses: [] };
}

/** The template intent, with a broken drawing, in this mode and config. */
function project(config: string, opts: { built?: boolean } = {}) {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-parts-')), '.specs-aidlc-turbo');
  const dir = path.join(root, 'docs', 'user-auth', 'user-auth');
  mkdirSync(path.join(root, 'repo'), { recursive: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(root, 'repo', 'config.yaml'), config);
  const record = render.parseYaml(read('templates/inception/record-template.yaml'));
  draw(record);
  if (opts.built) record.stories[0].changed_files = ['src/auth/login.ts', 'src/auth/extra.ts'];
  writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
  const intent = paths.findIntent(root, 'user-auth');
  render.applyPlan(intent, render.planRender(intent));
  return { root, dir, intent };
}

const rulesOf = (p: { root: string; intent: any }) => lint.lintIntent(p.intent, p.root).findings.map((f: any) => f.rule);
const run = (script: string, root: string, ...args: string[]) =>
  spawnSync(process.execPath, [script, 'user-auth', '--no-open', '--root', root, ...args], { encoding: 'utf8' });
const pageOf = (file: string) => JSON.parse(DATA.exec(readFileSync(file, 'utf8'))![1]);

describe('the sandbox parts in the config the installer writes', () => {
  it('writes the block in sandbox mode only, both on by default, each with its comment', () => {
    const sandbox = renderTurboConfig({ mode: 'sandbox' });
    expect((yaml.load(sandbox) as any).sandbox).toEqual({ code_scaffold: true, scaffold_after_build: true });
    for (const key of PARTS) expect(sandbox).toMatch(new RegExp(`^ {2}${key}: true +# \\S`, 'm'));
    for (const answers of [{}, { mode: 'production', code_scaffold: false }]) {
      const production = renderTurboConfig(answers);
      expect((yaml.load(production) as any).sandbox, JSON.stringify(answers)).toBeUndefined();
      expect(production).not.toMatch(/code_scaffold|scaffold_after_build/);
    }
  });

  it('writes the answers, and no update after the build without the Code Scaffold', () => {
    const parts = (answers: object) => (yaml.load(renderTurboConfig({ mode: 'sandbox', ...answers })) as any).sandbox;
    expect(parts({ code_scaffold: true, scaffold_after_build: false })).toEqual({ code_scaffold: true, scaffold_after_build: false });
    expect(parts({ code_scaffold: false, scaffold_after_build: true })).toEqual({ code_scaffold: false, scaffold_after_build: false });
    expect(parts({ code_scaffold: 'yes' })).toEqual({ code_scaffold: true, scaffold_after_build: true });
  });

  it('the shipped template documents the block, both on', () => {
    const example = yaml.load(read('templates/config.example.yaml')) as any;
    expect(example.sandbox).toEqual({ code_scaffold: true, scaffold_after_build: true });
    expect(flat('templates/config.example.yaml')).toContain('nothing reports it as missing');
  });
});

describe('the sandbox parts in the install wizard', () => {
  it('asks the two right after the mode, only for a sandbox, Yes first', () => {
    const git = turboQuestionSections()[0].questions.map((q: any) => q.name);
    expect(git.slice(git.indexOf('mode') + 1, git.indexOf('mode') + 3)).toEqual(PARTS);
    expect(git.indexOf('sandbox_finish')).toBe(git.indexOf('mode') + 3);
    for (const name of PARTS) {
      expect(asked(name, { mode: 'production' }), name).toBeNull();
      expect(asked(name, { mode: 'sandbox', code_scaffold: true }), name).toBe('select');
      const q = question(name);
      expect(q.choices.map((c: any) => c.value), name).toEqual([true, false]);
      expect(q.initial, name).toBe(0);
      expect(q.message.length, name).toBeLessThanOrEqual(40);
    }
    expect(question('code_scaffold').message).toBe('Code Scaffold?');
    expect(question('scaffold_after_build').message).toBe('Update the scaffold after the build?');
    expect(questions().map((q: any) => q.name)).not.toContain('functional_design');
  });

  it('asks nothing about Confluence or Jira in a sandbox', () => {
    const sync = turboQuestionSections().filter((section: any) =>
      section.questions.some((q: any) => /^sync_/.test(q.name)));
    expect(sync.length).toBeGreaterThan(0);
    for (const section of sync) {
      expect(typeof section.when).toBe('function');
      expect(section.when({ mode: 'sandbox' })).toBe(false);
      expect(section.when({ mode: 'production' })).toBe(true);
    }
  });

  it('asks the update after the build only with the Code Scaffold', () => {
    expect(asked('scaffold_after_build', { mode: 'sandbox', code_scaffold: true })).toBe('select');
    expect(asked('scaffold_after_build', { mode: 'sandbox', code_scaffold: false })).toBeNull();
  });
});

describe('a part that is off is never checked or demanded', () => {
  it('spec-lint skips the drawing a sandbox switched off, and checks it otherwise', () => {
    for (const config of ['mode: production\n', `mode: production\n${OFF}`, 'mode: sandbox\n']) {
      expect(rulesOf(project(config)), config).toContain('drawing');
    }
    expect(rulesOf(project(`mode: sandbox\n${OFF}`))).not.toContain('drawing');
    expect(rulesOf(project('mode: sandbox\nsandbox:\n  code_scaffold: false\n'))).not.toContain('drawing');
  });

  it('the brief\'s mode snapshot wins: an approved production intent keeps both', () => {
    const p = project(`mode: sandbox\n${OFF}`);
    const brief = readFileSync(p.intent.brief, 'utf8').replace(/^mode: .*$/m, 'mode: production');
    writeFileSync(p.intent.brief, brief);
    expect(rulesOf(p)).toContain('drawing');
  });

  it('the overview has no drawing in a sandbox without the Code Scaffold, and after the build no update of it without the update', () => {
    const off = project('mode: sandbox\nsandbox:\n  code_scaffold: false\n', { built: true });
    expect(run(OVERVIEW, off.root).status).toBe(0);
    expect(pageOf(off.intent.overview).design).toBeNull();

    const noUpdate = project('mode: sandbox\nsandbox:\n  scaffold_after_build: false\n', { built: true });
    const r = run(OVERVIEW, noUpdate.root, '--phase', 'construction');
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/^Code Scaffold:/m);
    const page = pageOf(noUpdate.intent.overview);
    expect(page.design).not.toBeNull();
    expect(page.design.build).toBeUndefined();

    const updated = project('mode: sandbox\n', { built: true });
    expect(run(OVERVIEW, updated.root, '--phase', 'construction').status).toBe(0);
    expect(pageOf(updated.intent.overview).design.build).toBeTruthy();
  });
});

describe('the skills and the docs honour the sandbox parts', () => {
  it('plan draws no Code Scaffold when it is off', () => {
    const plan = flat('skills/inception/plan.md');
    expect(plan).toContain('`code_scaffold: false` means no Code Scaffold (step 4c is skipped');
    expect(plan).toContain('Skip this step in sandbox mode with `sandbox.code_scaffold: false`: write no `technical_design.drawing` and no story `drawing`');
  });

  it('review asks no Code Scaffold question when it is off', () => {
    const review = flat('skills/inception/review.md');
    expect(review).toContain('a sandbox with `sandbox.code_scaffold: false` has none, so this option and the open choices below are left out');
    expect(review).toContain('a part that is off is not reported');
  });

  it('the builders, the reviewers and the cross-checker never miss a Code Scaffold that was not drawn', () => {
    for (const rel of ['skills/construction/build-story.md', 'commands/aidlc-turbo-builder.md', 'commands/aidlc-turbo-builder-low.md']) {
      expect(flat(rel), rel).toContain('A story without a `### Code Scaffold` (none was drawn) never blocks on the third: build what the story needs.');
    }
    expect(flat('skills/construction/review.md')).toContain('A story without one (none was drawn) skips this item: its absence is no finding.');
    expect(flat('commands/aidlc-turbo-cross-checker.md')).toContain('A brief without a `### Code Scaffold` (a sandbox that switched it off) skips the drawing check: its absence is no finding.');
    expect(flat('skills/inception/cross-check.md')).toContain('it skips that check, and reports nothing missing');
  });

  it('finish makes no update of the Code Scaffold when it is off, and reports nothing', () => {
    const finish = flat('skills/construction/finish.md');
    expect(finish).toContain('In sandbox mode with `sandbox.scaffold_after_build: false` (or `sandbox.code_scaffold: false`), the Code Scaffold gets no update after the build');
    expect(finish).toContain('That is no gap: nothing reports it');
  });

  it('the config command asks and edits the two, in sandbox only', () => {
    const config = flat('commands/aidlc-turbo-config.md');
    expect(config).toContain('**The parts of a sandbox intent** (the `sandbox` block)');
    expect(config).toContain('*(sandbox only, default: on, on)*');
    expect(config).toContain('**The sandbox parts follow the sandbox mode too.**');
    expect(config).toContain('Write the answers as `sandbox.code_scaffold` and `sandbox.scaffold_after_build`.');
    expect(config).toContain('The `sandbox` block is written in sandbox mode only');
  });

  it('the README, the quick start, memory-bank.yaml and the PRD name them', () => {
    const readme = read('README.md');
    const block = readme.slice(readme.indexOf('```yaml'), readme.indexOf('```', readme.indexOf('```yaml') + 7));
    for (const key of PARTS) expect(block).toMatch(new RegExp(`^ {2}${key}: true`, 'm'));
    expect(block).not.toContain('functional_design');
    expect(flat('README.md')).toContain('**The sandbox parts**');
    expect(flat('quick-start.md')).toContain('**Which parts a sandbox intent makes**, only in sandbox, right after the mode');
    const bank = yaml.load(read('memory-bank.yaml')) as any;
    const fields = Object.assign({}, ...bank.flow_config.fields);
    expect(fields.sandbox).toMatch(/code_scaffold.*scaffold_after_build/);
    expect(fields.sandbox).toMatch(/Production always makes both/);
    expect(flat('PRD.md')).toContain('`sandbox.code_scaffold`, `sandbox.scaffold_after_build`');
  });

  it('no story file of the template intent names the Code Scaffold when a sandbox switched it off', () => {
    const root = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-parts-')), '.specs-aidlc-turbo');
    const dir = path.join(root, 'docs', 'user-auth', 'user-auth');
    mkdirSync(dir, { recursive: true });
    // plan writes no drawing then, so render writes no ### Code Scaffold for a builder to follow
    const record = render.parseYaml(read('templates/inception/record-template.yaml'));
    delete record.technical_design?.drawing;
    for (const s of record.stories) delete s.drawing;
    writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
    const intent = paths.findIntent(root, 'user-auth');
    render.applyPlan(intent, render.planRender(intent));
    for (const f of readdirSync(intent.stories)) expect(readFileSync(path.join(intent.stories, f), 'utf8')).not.toContain('### Code Scaffold');
    expect(readFileSync(intent.brief, 'utf8')).not.toContain('### Code Scaffold');
  });
});
