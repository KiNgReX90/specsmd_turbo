/**
 * Unit tests for scripts/tooling.cjs, the code tooling of a project.
 *
 * The choice lives in repo/tooling.yaml and is written by the script only,
 * so a malformed choice is refused before it lands. `check` tells a missing
 * choice from a declined one and names what this machine lacks, without ever
 * running a tool. `brief` is what every subagent starts with. `run` runs the
 * analysis and lint tools on a change and keeps only the findings on lines
 * the change adds. `facts` recognises what a project already has and the
 * language server plugins its extensions can use.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const SCRIPT = path.join(FLOW, 'scripts/tooling.cjs');
const req = createRequire(import.meta.url);
const tooling = req(SCRIPT);
const { facts } = req(path.join(FLOW, 'scripts/lib/tooling-facts.cjs'));
const { globToRegExp, matches } = req(path.join(FLOW, 'scripts/lib/tooling-run.cjs'));

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'turbo-tooling-'));
  made.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body, 'utf8');
  }
  return dir;
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

/** A Claude Code config folder with one marketplace that offers a Java language server. */
function claudeHome(installed: boolean, enabled: boolean | null = null): string {
  const home = tree({
    'plugins/marketplaces/official/.claude-plugin/marketplace.json': JSON.stringify({
      name: 'official',
      plugins: [
        { name: 'jdtls-lsp', description: 'Java', lspServers: { jdtls: { command: 'jdtls', extensionToLanguage: { '.java': 'java' } } } },
        { name: 'gopls-lsp', lspServers: { gopls: { command: 'gopls', extensionToLanguage: { '.go': 'go' } } } },
        { name: 'no-lsp' },
      ],
    }),
    'plugins/installed_plugins.json': JSON.stringify({ version: 2, plugins: installed ? { 'jdtls-lsp@official': [{ scope: 'user' }] } : {} }),
    'settings.json': JSON.stringify(enabled === null ? {} : { enabledPlugins: { 'jdtls-lsp@official': enabled } }),
  });
  return home;
}

/** A folder with fake programs, to put on the PATH. */
function programs(...names: string[]): string {
  const dir = tree({});
  for (const name of names) {
    const file = path.join(dir, name);
    writeFileSync(file, '#!/bin/sh\nexit 0\n');
    chmodSync(file, 0o755);
  }
  return dir;
}

const env = (home: string, bin: string) => ({ ...process.env, CLAUDE_CONFIG_DIR: home, PATH: `${bin}${path.delimiter}/usr/bin${path.delimiter}/bin` });

const JDTLS = { name: 'jdtls', kind: 'language-server', plugin: 'jdtls-lsp@official', extensions: ['.java'], needs: ['jdtls'] };
const PMD = { name: 'pmd', kind: 'analysis', run: 'pmd check -d {files_comma}', files: ['**/*.java'], needs: ['pmd'], install: 'brew install pmd' };

describe('tooling.cjs write', () => {
  it('writes a configured choice with its header, and a declined one', () => {
    const dir = tree({});
    const res = tooling.write(dir, { status: 'configured', tools: [JDTLS, PMD], declined: ['semgrep'] }, new Date('2026-11-03T10:00:00Z'));
    expect(res.written).toBe(true);
    const text = readFileSync(path.join(dir, '.specs-aidlc-turbo/repo/tooling.yaml'), 'utf8');
    expect(text).toMatch(/^# Code tooling of this repo/);
    expect(text).toContain('decided_at: "2026-11-03T10:00:00Z"');
    expect(tooling.load(dir).data.declined).toEqual([{ name: 'semgrep' }]);

    const no = tree({});
    expect(tooling.write(no, { status: 'declined', tools: [] }).written).toBe(true);
    expect(tooling.load(no).state).toBe('declined');
  });

  it('refuses a malformed choice and writes nothing', () => {
    const dir = tree({});
    const bad = [
      { status: 'maybe', tools: [] },
      { status: 'configured', tools: [] },
      { status: 'declined', tools: [PMD] },
      { status: 'configured', tools: [{ ...JDTLS, plugin: undefined }] },
      { status: 'configured', tools: [{ ...JDTLS, extensions: [] }] },
      { status: 'configured', tools: [{ ...PMD, run: '' }] },
      { status: 'configured', tools: [{ ...PMD, needs: [] }] },
      { status: 'configured', tools: [{ ...PMD, kind: 'formatter' }] },
      { status: 'configured', tools: [PMD, PMD] },
    ];
    for (const data of bad) {
      const res = tooling.write(dir, data);
      expect(res.written, JSON.stringify(data)).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);
    }
    expect(existsSync(path.join(dir, '.specs-aidlc-turbo/repo/tooling.yaml'))).toBe(false);
  });
});

describe('tooling.cjs check', () => {
  it('tells a missing choice from a declined one and an invalid file', () => {
    const dir = tree({});
    expect(tooling.check(dir).tooling).toBe('missing');
    tooling.write(dir, { status: 'declined' });
    expect(tooling.check(dir)).toEqual({ tooling: 'declined' });
    writeFileSync(path.join(dir, '.specs-aidlc-turbo/repo/tooling.yaml'), 'status: configured\ntools: []\n');
    expect(tooling.check(dir).tooling).toBe('invalid');
  });

  it('is ok when every program is on the PATH and the plugin is on', () => {
    const dir = tree({});
    tooling.write(dir, { status: 'configured', tools: [JDTLS, PMD] });
    const e = env(claudeHome(true), programs('jdtls', 'pmd'));
    expect(tooling.check(dir, e)).toEqual({ tooling: 'ok', tools: ['jdtls', 'pmd'], language_servers: [{ name: 'jdtls', extensions: ['.java'] }] });
  });

  it('names a missing program, a plugin not installed and a plugin switched off, with the install hint', () => {
    const dir = tree({});
    tooling.write(dir, { status: 'configured', tools: [JDTLS, PMD] });
    const missing = tooling.check(dir, env(claudeHome(false), programs('jdtls')));
    expect(missing.tooling).toBe('incomplete');
    expect(missing.missing).toEqual([
      { name: 'jdtls', kind: 'language-server', plugin: 'jdtls-lsp@official', plugin_state: 'not installed' },
      { name: 'pmd', kind: 'analysis', programs: ['pmd'], install: 'brew install pmd' },
    ]);
    expect(missing.language_servers).toBeUndefined();
    const off = tooling.check(dir, env(claudeHome(true, false), programs('jdtls', 'pmd')));
    expect(off.missing).toEqual([{ name: 'jdtls', kind: 'language-server', plugin: 'jdtls-lsp@official', plugin_state: 'switched off' }]);
    const noPmd = tooling.check(dir, env(claudeHome(true), programs('jdtls')));
    expect(noPmd.language_servers).toEqual([{ name: 'jdtls', extensions: ['.java'] }]);
  });

  it('lets the project settings switch a plugin back on over the user settings', () => {
    const dir = tree({ '.claude/settings.json': JSON.stringify({ enabledPlugins: { 'jdtls-lsp@official': true } }) });
    tooling.write(dir, { status: 'configured', tools: [JDTLS] });
    expect(tooling.check(dir, env(claudeHome(true, false), programs('jdtls'))).tooling).toBe('ok');
  });
});

describe('tooling.cjs brief', () => {
  it('tells the agents to use the language server first and how to run the checks', () => {
    const dir = tree({});
    git(dir, 'init', '-q');
    tooling.write(dir, { status: 'configured', tools: [JDTLS, PMD] });
    const text = tooling.brief(dir, env(claudeHome(true), programs('jdtls', 'pmd')));
    expect(text).toMatch(/^## Code tooling/);
    expect(text).toContain('Language server jdtls for .java: the LSP tool answers');
    expect(text).toContain('`findReferences`');
    expect(text).toContain('Analysis pmd (**/*.java): `pmd check -d {files_comma}`');
    expect(text).toContain(`tooling.cjs" run --project "${dir}" --code-root <code root>`);
    expect(text).toContain('Git history, read-only');
  });

  it('says what this machine lacks, and what a declined project means', () => {
    const dir = tree({});
    tooling.write(dir, { status: 'configured', tools: [JDTLS, PMD] });
    const text = tooling.brief(dir, env(claudeHome(false), programs()));
    expect(text).toContain('Language server jdtls for .java: not installed on this machine. Grep and read instead.');
    expect(text).toContain('Analysis pmd: not installed on this machine, skip it.');
    expect(text).not.toContain('run --code-root');
    expect(text).not.toContain('Git history');

    const no = tree({});
    tooling.write(no, { status: 'declined' });
    expect(tooling.brief(no)).toContain('this project chose none');
  });

  it('says the tooling is not set up yet, so an agent never looks for it', () => {
    const text = tooling.brief(tree({}));
    expect(text).toContain('Not set up for this project yet');
    expect(text).not.toContain('Git history');
  });
});

describe('tooling.cjs run', () => {
  function repo(): string {
    const dir = tree({ 'src/A.java': 'a\nb\nc\n', 'docs/x.md': 'x\n' });
    git(dir, 'init', '-q');
    git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
    git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
    writeFileSync(path.join(dir, 'src/A.java'), 'a\nB\nc\nd\n');
    writeFileSync(path.join(dir, 'src/New.java'), 'n\n');
    writeFileSync(path.join(dir, 'docs/x.md'), 'y\n');
    const lint = path.join(dir, 'lint.sh');
    writeFileSync(lint, [
      '#!/bin/sh',
      'for f in "$@"; do echo "$f:1: old or new"; echo "$f:2: second line"; done',
      'echo "other/Old.java:5: someone else\'s"',
      'exit 1',
      '',
    ].join('\n'));
    chmodSync(lint, 0o755);
    return dir;
  }

  it('keeps only the findings on lines the change adds, on the files the tool judges', () => {
    const dir = repo();
    tooling.write(dir, { status: 'configured', tools: [{ name: 'lint', kind: 'lint', run: 'sh lint.sh {files}', files: '**/*.java', needs: ['sh'] }] });
    const out = JSON.parse(execFileSync('node', [SCRIPT, 'run'], { cwd: dir }).toString());
    const [r] = out.results;
    expect(r.command).toBe("sh lint.sh 'src/A.java' 'src/New.java'");
    expect(r.status).toBe('findings');
    expect(r.touched).toEqual(['src/A.java:2: second line', 'src/New.java:1: old or new']);
    expect(r.elsewhere_in_changed_files).toBe(2);
    expect(r.other_lines).toBe(1);
  });

  it('skips a tool without a changed file or without its program, and shows a broken command', () => {
    const dir = repo();
    tooling.write(dir, {
      status: 'configured',
      tools: [
        { name: 'py', kind: 'lint', run: 'ruff {files}', files: '**/*.py', needs: ['sh'] },
        { name: 'ghost', kind: 'analysis', run: 'ghost', needs: ['ghost-not-on-path'] },
        { name: 'broken', kind: 'analysis', run: 'sh -c "echo boom; exit 3"', files: ['*.md'], needs: ['sh'] },
      ],
    });
    const out = JSON.parse(execFileSync('node', [SCRIPT, 'run'], { cwd: dir }).toString());
    expect(out.results[0]).toEqual({ tool: 'py', status: 'skipped', reason: 'no changed file for this tool' });
    expect(out.results[1]).toEqual({ tool: 'ghost', status: 'skipped', reason: 'not on this machine: ghost-not-on-path' });
    expect(out.results[2].status).toBe('exit_nonzero');
    expect(out.results[2].exit).toBe(3);
    expect(out.results[2].tail).toContain('boom');
  });

  it('runs nothing for a declined project', () => {
    const dir = repo();
    tooling.write(dir, { status: 'declined' });
    const out = JSON.parse(execFileSync('node', [SCRIPT, 'run'], { cwd: dir }).toString());
    expect(out.results).toEqual([]);
  });

  it('matches globs the way a project writes them', () => {
    expect(globToRegExp('**/*.java').test('a/b/C.java')).toBe(true);
    expect(globToRegExp('**/*.java').test('C.java')).toBe(true);
    expect(globToRegExp('src/*.{pks,pkb}').test('src/x.pkb')).toBe(true);
    expect(globToRegExp('src/*.{pks,pkb}').test('src/a/x.pkb')).toBe(false);
    expect(matches('deep/x.sql', ['*.sql'])).toBe(true);
    expect(matches('deep/x.sql', undefined)).toBe(true);
  });
});

describe('tooling.cjs facts', () => {
  it('recognises the languages, the build, the linters already there and the language servers that fit', () => {
    const dir = tree({
      'pom.xml': '<project><build><plugin><artifactId>maven-pmd-plugin</artifactId></plugin></build></project>\n',
      'src/main/java/A.java': 'class A {}\n',
      'src/main/java/B.java': 'class B {}\n',
      'db/pkg_a.pkb': 'create package body a as end;\n',
      'checkstyle.xml': '<module/>\n',
      '.gitlab-ci.yml': 'lint:\n  script: mvn spotbugs:check\n',
      'node_modules/x/eslint.config.js': '',
      'README.md': 'eslint\n',
    });
    git(dir, 'init', '-q');
    const f = facts(dir, env(claudeHome(true), programs('jdtls')));
    expect(f.extensions['.java']).toBe(2);
    expect(f.extensions['.pkb']).toBe(1);
    expect(f.build_files).toEqual(['pom.xml']);
    expect(f.tool_configs).toEqual(['checkstyle.xml']);
    expect(f.tool_mentions.map((m: { file: string; line: number }) => `${m.file}:${m.line}`)).toEqual(['pom.xml:1', '.gitlab-ci.yml:1', '.gitlab-ci.yml:2']);
    expect(f.language_servers).toEqual([
      { plugin: 'jdtls-lsp@official', description: 'Java', programs: ['jdtls'], extensions: ['.java'], plugin_state: 'on', on_path: true },
    ]);
    expect(f.git).toBe(true);
  });

  it('prints its facts as JSON from the command line', () => {
    const dir = tree({ 'a.go': 'package a\n' });
    const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, 'facts'], { cwd: dir, env: env(claudeHome(false), programs()) }).toString());
    expect(out.language_servers.map((s: { plugin: string }) => s.plugin)).toEqual(['gopls-lsp@official']);
    expect(out.language_servers[0].plugin_state).toBe('not installed');
  });
});

describe('the flow uses the code tooling', () => {
  const read = (rel: string) => readFileSync(path.join(FLOW, rel), 'utf8');
  const CHECK = 'node .specsmd/aidlc-turbo/scripts/tooling.cjs check';

  it('every phase command checks the tooling at its start, starts the language servers early and sends a gap to the tooling skill', () => {
    for (const rel of ['commands/aidlc-turbo.md', 'commands/aidlc-turbo-inception.md', 'commands/aidlc-turbo-construction.md', 'commands/aidlc-turbo-review-fix.md']) {
      const text = read(rel);
      expect(text, rel).toContain(CHECK);
      expect(text, rel).toMatch(/When it lists `language_servers`, start them now: one LSP call/);
      expect(text, rel).toContain('.specsmd/aidlc-turbo/skills/master/tooling.md');
    }
    expect(read('commands/aidlc-turbo-config.md')).toContain('follow **Change** in `.specsmd/aidlc-turbo/skills/master/tooling.md`');
  });

  it('the agents that read code reach the language server and are told how to use it', () => {
    for (const role of ['explorer', 'cross-checker', 'builder', 'builder-low', 'reviewer', 'intent-reviewer', 'debugger']) {
      const text = read(`commands/aidlc-turbo-${role}.md`);
      expect(text, role).toMatch(/^tools: .*\bLSP$/m);
      expect(text, role).toContain('## Code tooling');
      expect(text, role).toContain('`.specs-aidlc-turbo/repo/tooling.yaml`');
      expect(text, role).toContain('try it once more later in your work, then leave it');
    }
  });

  it('the builder and the quality lens run the analysis and lint tools on the change only', () => {
    const run = 'node .specsmd/aidlc-turbo/scripts/tooling.cjs run --project {project root} --code-root {code root}';
    expect(read('commands/aidlc-turbo-builder.md')).toContain(run);
    expect(read('skills/construction/review.md')).toContain(run);
  });

  it('the tooling skill keeps no list of tools and never writes the file by hand', () => {
    const text = read('skills/master/tooling.md');
    expect(text).toContain('Turbo keeps no list of tools.');
    expect(text).toContain('node .specsmd/aidlc-turbo/scripts/tooling.cjs write');
    expect(text).toContain('Never write `tooling.yaml` by hand');
  });
});

describe('the tooling choice travels with the repo', () => {
  it('the inception commit takes tooling.yaml along', () => {
    const text = readFileSync(path.join(FLOW, 'skills/inception/review.md'), 'utf8');
    expect(text).toContain('Add `.specs-aidlc-turbo/repo/tooling.yaml` to that `git add` when it exists');
  });
});
