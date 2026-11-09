/**
 * Unit tests for story-complete.cjs of the AI-DLC Turbo flow.
 *
 * The completion gate is the only way a story reaches done:
 * - it refuses an empty --tests, a story that is not building or review, and a
 *   story that is already done;
 * - it writes done, the date, the commit, the branch (story branches on, so a
 *   dependent can stack on it) and the changed files (for shared_files);
 * - it finds the intent under docs/{inception}/ by slug.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import { tmpdir } from 'os';
import path from 'path';
import yaml from 'js-yaml';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const COMPLETE = path.join(FLOW, 'scripts/story-complete.cjs');
const STATUS = path.join(FLOW, 'scripts/intent-status.cjs');

const cwd = mkdtempSync(path.join(tmpdir(), 'turbo-complete-'));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

const stories = path.join(cwd, '.specs-aidlc-turbo/docs/x/x/stories');
mkdirSync(stories, { recursive: true });
writeFileSync(path.join(cwd, '.specs-aidlc-turbo/docs/x/x/brief.md'), '---\nstatus: building\n---\n');
const story = (id: string, status: string, deps: string) =>
  writeFileSync(
    path.join(stories, `${id}-s.md`),
    `---\nid: "${id}"\ntitle: T${id}\nstatus: ${status}\ndepends_on: [${deps}]\ncommit: null\nbranch: null\n---\n\n# S${id}\n`,
  );
story('001', 'review', '');
story('002', 'todo', '');
story('003', 'todo', '"001"');
story('004', 'todo', '"003", "002"');

const run = (...args: string[]) => spawnSync('node', [COMPLETE, ...args], { cwd, encoding: 'utf8' });
const fm = (id: string) => yaml.load(readFileSync(path.join(stories, `${id}-s.md`), 'utf8').split('---')[1]) as any;

describe('aidlc-turbo story-complete', () => {
  it('refuses an empty test summary and a story that is not building or review', () => {
    expect(run('x', '001', '--tests', ' ').status).toBe(1);
    const todo = run('x', '002', '--tests', '3 passed');
    expect(todo.status).toBe(1);
    expect(todo.stderr).toContain('has status "todo"');
    expect(run('x').status).toBe(2);
  });

  it('records done, commit, branch, changed files and the test summary, and the plan stacks on that branch', () => {
    execFileSync('node', [COMPLETE, 'x', '1', '--tests', '3 passed', '--commit', 'abc',
      '--branch', 'shop/intent-x/story-001-s', '--files', 'src/a.ts, src/b.ts'], { cwd, encoding: 'utf8' });
    const done = fm('001');
    expect(done).toMatchObject({ status: 'done', commit: 'abc', branch: 'shop/intent-x/story-001-s', changed_files: ['src/a.ts', 'src/b.ts'], tests: '3 passed' });
    expect(done.completed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(readFileSync(path.join(stories, '001-s.md'), 'utf8')).toContain('\n# S001\n');

    const out = JSON.parse(execFileSync('node', [STATUS, 'x', '--json'], { cwd, encoding: 'utf8' }));
    const byId = Object.fromEntries(out.stories.map((s: any) => [s.id, s]));
    expect(byId['001'].branch).toBe('shop/intent-x/story-001-s');
    expect(byId['003']).toMatchObject({ stack_on: '001', merge_in: [] });
    expect(byId['004']).toMatchObject({ stack_on: '003', merge_in: ['002'] });
    expect(out.frontier).toEqual(['002', '003']);
  });

  it('refuses a story that is already done', () => {
    const again = run('x', '001', '--tests', '3 passed');
    expect(again.status).toBe(1);
    expect(again.stderr).toContain('already done');
  });
});
