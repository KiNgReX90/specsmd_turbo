/**
 * Unit tests for scripts/migrate-layout.cjs.
 *
 * An artifact root from before repo/, project/ and docs/ is moved once to the
 * layout of scripts/lib/paths.cjs. The fixture is a realistic old tree: the
 * config with a Jira board link, a project.yaml with a codebase scan and a
 * live_test block, standards, digests, the pulled project pages, one intent
 * with its brief, stories, Confluence pages and sync.yaml, and its test cases.
 * A dry run moves nothing, --write moves everything, a second run does
 * nothing, and nothing that already exists is ever overwritten.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const SCRIPT = path.join(FLOW, 'scripts/migrate-layout.cjs');
const req = createRequire(import.meta.url);
const migrateLayout = req(SCRIPT);
const paths = req(path.join(FLOW, 'scripts/lib/paths.cjs'));

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const CONFIG = [
  'mode: production',
  'branching:',
  '  project_key: "shop"',
  'sync:',
  '  docs: confluence',
  '  issues: jira',
  '  jira_project_url: "https://example.atlassian.net/jira/software/projects/SHOP/boards/1"',
  '',
].join('\n');

const PROJECT = [
  'project_type: full-stack-web',
  'initialized_at: 2026-09-01T10:00:00Z',
  'codebase:',
  '  scanned_at: 2026-09-01T10:00:00Z',
  '  languages: [java]',
  '  commands:',
  '    build: "mvn -q -DskipTests package"',
  '    test: "mvn -q test"',
  'live_test:',
  '  start_command: "mvn -q spring-boot:run"',
  '  url: "http://localhost:8080"',
  '',
].join('\n');

const SYNC = [
  'confluence:',
  '  pages:',
  '    - path: intents/a/docs/index.md',
  '      page_id: "1"',
  '    - path: project-docs/architecture/index.md',
  '      page_id: "2"',
  'jira:',
  '  epic: SHOP-100',
  '',
].join('\n');

/** A project with the old layout, returning its artifact root. */
function legacyTree(): string {
  const project = mkdtempSync(path.join(tmpdir(), 'turbo-migrate-'));
  made.push(project);
  const root = path.join(project, '.specs-aidlc-turbo');
  const files: Record<string, string> = {
    'config.yaml': CONFIG,
    'project.yaml': PROJECT,
    'standards/tech-stack.md': '# Tech stack\n',
    'standards/coding-standards.md': '# Coding standards\n',
    'digests/architecture.yaml': 'source: project-docs/architecture\n',
    'project-docs/architecture/index.md': '# Architecture\n',
    'intents/a/brief.md': '---\nid: a\nstatus: done\n---\n\n## Intent\n',
    'intents/a/overview.html': '<html></html>\n',
    'intents/a/stories/001-login.md': '---\nid: "001"\nstatus: done\n---\n',
    'intents/a/docs/index.md': '# A - Documentation\n',
    'intents/a/docs/open-questions.md': '# Open questions\n',
    'intents/a/sync.yaml': SYNC,
    'tests/a/US-001 - Login.md': '# US-001 - Login\n',
  };
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body, 'utf8');
  }
  return root;
}

const run = (root: string, ...args: string[]) => {
  try {
    return { code: 0, out: execFileSync('node', [SCRIPT, '--root', root, ...args], { encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e: any) {
    return { code: e.status as number, out: `${e.stdout}${e.stderr}` };
  }
};

const read = (root: string, rel: string) => readFileSync(path.join(root, rel), 'utf8');

describe('migrate-layout on an old tree', () => {
  it('a dry run prints the moves and moves nothing', () => {
    const root = legacyTree();
    const { code, out } = run(root);
    expect(code).toBe(0);
    expect(out).toContain('move     config.yaml -> repo/config.yaml');
    expect(out).toContain('split    project.yaml -> repo/repo.yaml + project/project.yaml');
    expect(out).toContain('move     intents/a/docs -> docs/a/pages');
    expect(out).toContain('move     tests/a -> docs/a/a/tests');
    expect(out).toContain('Dry run, nothing moved.');
    expect(existsSync(path.join(root, 'config.yaml'))).toBe(true);
    expect(existsSync(path.join(root, 'repo'))).toBe(false);
  });

  it('--write moves every file to the new layout and leaves no old path behind', () => {
    const root = legacyTree();
    const { code } = run(root, '--write');
    expect(code).toBe(0);

    expect(read(root, 'repo/config.yaml')).toBe(CONFIG);
    expect(read(root, 'repo/standards/tech-stack.md')).toBe('# Tech stack\n');
    expect(read(root, 'repo/standards/coding-standards.md')).toBe('# Coding standards\n');
    expect(read(root, 'project/pages/architecture/index.md')).toBe('# Architecture\n');
    expect(read(root, 'project/digests/architecture.yaml')).toContain('source:');
    expect(read(root, 'docs/a/pages/index.md')).toBe('# A - Documentation\n');
    expect(read(root, 'docs/a/pages/open-questions.md')).toBe('# Open questions\n');
    expect(read(root, 'docs/a/a/brief.md')).toContain('status: done');
    expect(read(root, 'docs/a/a/overview.html')).toBe('<html></html>\n');
    expect(read(root, 'docs/a/a/stories/001-login.md')).toContain('id: "001"');
    expect(read(root, 'docs/a/a/tests/US-001 - Login.md')).toBe('# US-001 - Login\n');

    for (const old of ['config.yaml', 'project.yaml', 'standards', 'digests', 'project-docs', 'intents', 'tests']) {
      expect(existsSync(path.join(root, old)), old).toBe(false);
    }
    expect(paths.isLegacy(root)).toBe(false);
    expect(paths.findIntent(root, 'a')?.dir).toBe(path.join(root, 'docs/a/a'));
  });

  it('splits project.yaml: the scan and live_test to repo.yaml, the rest plus the Jira link to project.yaml', () => {
    const root = legacyTree();
    run(root, '--write');
    const repo = read(root, 'repo/repo.yaml');
    expect(repo).toMatch(/^codebase:\n {2}scanned_at:/m);
    expect(repo).toContain('    build: "mvn -q -DskipTests package"');
    expect(repo).toMatch(/^live_test:\n {2}start_command: "mvn -q spring-boot:run"/m);
    expect(repo).not.toContain('project_type');

    const project = read(root, 'project/project.yaml');
    expect(project).toContain('project_type: full-stack-web');
    expect(project).toContain('initialized_at: 2026-09-01T10:00:00Z');
    expect(project).toContain('jira_project_url: "https://example.atlassian.net/jira/software/projects/SHOP/boards/1"');
    expect(project).not.toContain('codebase');
    expect(project).not.toContain('live_test');
  });

  it('moves sync.yaml next to the inception and rewrites its page paths', () => {
    const root = legacyTree();
    run(root, '--write');
    const sync = read(root, 'docs/a/sync.yaml');
    expect(sync).toContain('- path: docs/a/pages/index.md');
    expect(sync).toContain('- path: project/pages/architecture/index.md');
    expect(sync).toContain('epic: SHOP-100');
    expect(existsSync(path.join(root, 'docs/a/a/sync.yaml'))).toBe(false);
  });

  it('a second run moves nothing and says so', () => {
    const root = legacyTree();
    run(root, '--write');
    const before = readdirSync(root, { recursive: true, encoding: 'utf8' }).sort();
    const { code, out } = run(root, '--write');
    expect(code).toBe(0);
    expect(out).toContain('already has the new layout. Nothing to move.');
    expect(readdirSync(root, { recursive: true, encoding: 'utf8' }).sort()).toEqual(before);
  });

  it('never overwrites: an existing destination is kept, the source stays, exit 1', () => {
    const root = legacyTree();
    mkdirSync(path.join(root, 'repo'), { recursive: true });
    writeFileSync(path.join(root, 'repo/config.yaml'), 'mode: sandbox\n');
    const { code, out } = run(root, '--write');
    expect(code).toBe(1);
    expect(out).toContain('kept     config.yaml (repo/config.yaml destination exists)');
    expect(read(root, 'repo/config.yaml')).toBe('mode: sandbox\n');
    expect(read(root, 'config.yaml')).toBe(CONFIG);
    // Everything else still moved.
    expect(existsSync(path.join(root, 'docs/a/a/brief.md'))).toBe(true);
  });

  it('merges into a folder that already exists, file by file', () => {
    const root = legacyTree();
    mkdirSync(path.join(root, 'repo/standards'), { recursive: true });
    writeFileSync(path.join(root, 'repo/standards/tech-stack.md'), '# Newer\n');
    const { code } = run(root, '--write');
    expect(code).toBe(1);
    expect(read(root, 'repo/standards/tech-stack.md')).toBe('# Newer\n');
    expect(read(root, 'repo/standards/coding-standards.md')).toBe('# Coding standards\n');
    expect(read(root, 'standards/tech-stack.md')).toBe('# Tech stack\n');
  });

  it('a usage error exits 2', () => {
    expect(run(legacyTree(), '--nonsense').code).toBe(2);
  });
});

describe('migrate-layout text helpers', () => {
  it('reads the Jira link out of the sync block only', () => {
    expect(migrateLayout.readSyncJiraUrl(CONFIG)).toBe('https://example.atlassian.net/jira/software/projects/SHOP/boards/1');
    expect(migrateLayout.readSyncJiraUrl('mode: sandbox\n')).toBe('');
  });

  it('keeps comments with the key they describe', () => {
    const parts = migrateLayout.splitProjectYaml('# project\nproject_type: cli-tool\n# scan\ncodebase:\n  languages: [go]\n');
    expect(parts.project).toBe('# project\nproject_type: cli-tool\n');
    expect(parts.repo).toBe('# scan\ncodebase:\n  languages: [go]\n');
  });
});
