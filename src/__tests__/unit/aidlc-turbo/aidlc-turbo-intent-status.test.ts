/**
 * Unit tests for intent-status.cjs of the AI-DLC Turbo flow.
 *
 * The construction agent reads only this script's --json output, never the
 * story bodies, so it has to carry everything the build loop decides on:
 * - every key it had before (brief_status, stories with status, depends_on,
 *   tester_verifiable, branch, stack_on and merge_in, frontier, blocked);
 * - per story break_test, so finish knows which stories the breaker attacks;
 * - per story observed_via, where a tester checks each criterion, or null for
 *   a story rendered before that field;
 * - the brief frontmatter and the commands of the brief's ## Verification;
 * - per story complexity and touches;
 * - shared_files: every file that more than one story touches or changed;
 * - project_docs: the project's rules for code, for the docs reviewers of a
 *   fix at finish.
 * The intent is found by slug under docs/{inception}/, and the old layout
 * stops with the move instruction.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const SCRIPT = path.join(FLOW, 'scripts/intent-status.cjs');
const status = createRequire(import.meta.url)(SCRIPT);

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const BRIEF = [
  '---', 'id: auth', 'title: Auth', 'status: building', 'mode: production',
  'branch: shop/intent-auth/intent', 'lane: full', '---', '',
  '## Intent', '', 'Log in.', '',
  '## Verification', '', '- **Build**: `npm run build`', '- **Test**: `npm test -- --run`', '',
  '## Lessons', '', 'None.', '',
].join('\n');

function story(id: string, fm: Record<string, string>) {
  const lines = Object.entries({ id: `"${id}"`, title: `T${id}`, status: 'todo', depends_on: '[]', ...fm })
    .map(([k, v]) => `${k}: ${v}`);
  return ['---', ...lines, '---', '', `# S${id}`, ''].join('\n');
}

/** A project root with one intent under docs/auth/auth/. */
function fixture(stories: Record<string, Record<string, string>>): string {
  const cwd = mkdtempSync(path.join(tmpdir(), 'turbo-status-'));
  dirs.push(cwd);
  const intent = path.join(cwd, '.specs-aidlc-turbo/docs/auth/auth');
  mkdirSync(path.join(intent, 'stories'), { recursive: true });
  writeFileSync(path.join(intent, 'brief.md'), BRIEF);
  for (const [id, fm] of Object.entries(stories)) {
    writeFileSync(path.join(intent, 'stories', `${id}-s${id}.md`), story(id, fm));
  }
  return cwd;
}

const run = (cwd: string, ...args: string[]) =>
  spawnSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8' });

describe('aidlc-turbo intent-status', () => {
  const cwd = fixture({
    '001': { status: 'done', complexity: 'low', touches: '[src/a.ts, src/shared.ts]', branch: 'shop/intent-auth/story-001-s001' },
    '002': { complexity: 'medium', touches: '[src/b.ts]', changed_files: '[src/shared.ts]', break_test: 'true', observed_via: '[ui, db, none]' },
    '003': { depends_on: '["001"]', complexity: 'hard', touches: '[src/shared.ts, src/c.ts]' },
    '004': { depends_on: '["003", "002"]', touches: '[src/b.ts]' },
    '005': { status: 'blocked' },
  });

  it('keeps every existing key and adds the brief, the verification and shared_files', () => {
    const out = JSON.parse(execFileSync('node', [SCRIPT, 'auth', '--json'], { cwd, encoding: 'utf8' }));
    expect(out.intent).toBe('auth');
    expect(out.inception).toBe('auth');
    expect(out.brief_status).toBe('building');
    expect(out.brief).toMatchObject({ id: 'auth', branch: 'shop/intent-auth/intent', lane: 'full' });
    expect(out.verification).toEqual(['npm run build', 'npm test -- --run']);
    expect(out.frontier).toEqual(['002', '003']);
    expect(out.blocked).toEqual(['005']);
    const byId = Object.fromEntries(out.stories.map((s: any) => [s.id, s]));
    expect(Object.keys(byId['001']).sort()).toEqual([
      'branch', 'break_test', 'changed_files', 'complexity', 'depends_on', 'file', 'id', 'merge_in', 'misses', 'observed_via', 'slug', 'stack_on', 'status', 'tester_verifiable', 'title', 'touches',
    ]);
    expect(byId['002'].observed_via).toEqual(['ui', 'db', 'none']);
    expect(byId['001'].observed_via).toBeNull();
    expect(byId['001']).toMatchObject({ changed_files: [], misses: 0 });
    expect(byId['002'].changed_files).toEqual(['src/shared.ts']);
    expect(byId['002'].break_test).toBe(true);
    expect(byId['001'].break_test).toBe(false);
    expect(byId['001'].slug).toBe('s001');
    expect(byId['001'].file).toBe('.specs-aidlc-turbo/docs/auth/auth/stories/001-s001.md');
    expect(byId['001']).toMatchObject({ complexity: 'low', touches: ['src/a.ts', 'src/shared.ts'], branch: 'shop/intent-auth/story-001-s001' });
    expect(byId['004'].complexity).toBeNull();
    expect(byId['002']).toMatchObject({ stack_on: 'intent', merge_in: [] });
    expect(byId['003']).toMatchObject({ stack_on: '001', merge_in: [] });
    expect(byId['004']).toMatchObject({ stack_on: '003', merge_in: ['002'], depends_on: ['003', '002'] });
    expect(out.shared_files).toEqual([
      { file: 'src/b.ts', stories: ['002', '004'] },
      { file: 'src/shared.ts', stories: ['001', '002', '003'] },
    ]);
  });

  it('carries the project rules for code, for the docs reviewers of a fix at finish', () => {
    expect(JSON.parse(execFileSync('node', [SCRIPT, 'auth', '--json'], { cwd, encoding: 'utf8' })).project_docs)
      .toEqual({ index: null, batches: [] });
    const app = fixture({ '001': {} });
    const pages = path.join(app, '.specs-aidlc-turbo/project/pages');
    mkdirSync(path.join(pages, 'conventions'), { recursive: true });
    writeFileSync(path.join(pages, 'index.md'), '# Where things are\n');
    writeFileSync(path.join(pages, 'conventions/coding-standards.md'), '# Coding standards\n');
    const out = JSON.parse(execFileSync('node', [SCRIPT, 'auth', '--json'], { cwd: app, encoding: 'utf8' }));
    expect(out.project_docs).toEqual({
      index: path.join(pages, 'index.md'),
      batches: [[path.join(pages, 'conventions/coding-standards.md')]],
    });
  });

  it('prints the table without --json', () => {
    const r = run(cwd, 'auth');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Intent auth');
    expect(r.stdout).toContain('Frontier: 002, 003');
    expect(r.stdout).toContain('Blocked:  005');
  });

  it('exits 2 without a slug and 1 for an unknown intent', () => {
    expect(run(cwd).status).toBe(2);
    const r = run(cwd, 'nope', '--json');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('intent not found: nope');
  });

  it('stops on the old layout with the move instruction', () => {
    const old = mkdtempSync(path.join(tmpdir(), 'turbo-status-old-'));
    dirs.push(old);
    mkdirSync(path.join(old, '.specs-aidlc-turbo/intents/auth/stories'), { recursive: true });
    const r = run(old, 'auth', '--json');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('migrate-layout.cjs --write');
  });
});

describe('aidlc-turbo intent-status helpers', () => {
  it('reads verification commands from bullets and fenced blocks', () => {
    expect(status.parseVerification('## Verification\n\n```bash\nmvn -q package\nmvn -q test\n```\n\n## Lessons\n'))
      .toEqual(['mvn -q package', 'mvn -q test']);
    expect(status.parseVerification('## Verification\n\n- **Test**: pytest -q\n- None.\n')).toEqual(['pytest -q']);
    expect(status.parseVerification('## Intent\n\nx\n')).toEqual([]);
  });

  it('normalises story ids', () => {
    expect(status.normId('3')).toBe('003');
    expect(status.normId(12)).toBe('012');
    expect(status.normId('003')).toBe('003');
  });
});
