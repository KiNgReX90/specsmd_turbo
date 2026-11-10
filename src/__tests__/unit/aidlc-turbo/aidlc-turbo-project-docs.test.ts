/**
 * Unit tests for lib/project-docs.cjs of the AI-DLC Turbo flow.
 *
 * The project's rules for code are the standards (repo/standards/) and the
 * Project Documentation (project/pages/, nested folders). Every story is
 * reviewed against all of them by one docs reviewer, more only for a really
 * large documentation set:
 * - every markdown file, the standards first, then the pages in path order, so
 *   the pages of one folder stay together;
 * - batches of at most the word budget each (about twenty thousand words, so a
 *   normal project has one); a page bigger than the budget is a batch of its own;
 * - the root index.md, the map of where every rule lives, is in no batch: every
 *   docs reviewer reads it;
 * - no standards and no pages: no index and no batches.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const docs = createRequire(import.meta.url)(path.join(FLOW, 'scripts/lib/project-docs.cjs'));

const bases: string[] = [];
afterAll(() => bases.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A project with these files under .specs-aidlc-turbo, each `n` words long. */
function project(files: Record<string, number>) {
  const app = mkdtempSync(path.join(tmpdir(), 'turbo-docs-'));
  bases.push(app);
  for (const [rel, n] of Object.entries(files)) {
    const file = path.join(app, '.specs-aidlc-turbo', rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${Array.from({ length: n }, (_, i) => `w${i}`).join(' ')}\n`);
  }
  const rel = (f: string) => path.relative(path.join(app, '.specs-aidlc-turbo'), f);
  return { app, rel };
}

describe('aidlc-turbo project docs', () => {
  it('batches the standards and the nested pages in path order, within the word budget, the root index apart', () => {
    const p = project({
      'repo/standards/coding-standards.md': 30,
      'project/pages/index.md': 40,
      'project/pages/a/one.md': 100,
      'project/pages/a/two.md': 100,
      'project/pages/b/three.md': 150,
      'project/pages/c.md': 50,
      'project/pages/a/plaatje.png': 999,
    });
    const out = docs.projectDocs('.specs-aidlc-turbo', p.app, 200);
    expect(p.rel(out.index)).toBe('project/pages/index.md');
    expect(out.batches.map((b: string[]) => b.map(p.rel))).toEqual([
      ['repo/standards/coding-standards.md', 'project/pages/a/one.md'],
      ['project/pages/a/two.md'],
      ['project/pages/b/three.md', 'project/pages/c.md'],
    ]);
  });

  it('gives a page bigger than the budget a batch of its own', () => {
    const p = project({ 'project/pages/a.md': 50, 'project/pages/groot.md': 500, 'project/pages/z.md': 50 });
    const out = docs.projectDocs('.specs-aidlc-turbo', p.app, 200);
    expect(out.index).toBeNull();
    expect(out.batches.map((b: string[]) => b.map(p.rel))).toEqual([
      ['project/pages/a.md'], ['project/pages/groot.md'], ['project/pages/z.md'],
    ]);
  });

  it('has no index and no batches without standards and pages', () => {
    const p = project({ 'repo/config.yaml': 3 });
    expect(docs.projectDocs('.specs-aidlc-turbo', p.app)).toEqual({ index: null, batches: [] });
  });

  it('gives a normal project one batch: about twenty thousand words by default', () => {
    expect(docs.MAX_WORDS).toBe(20000);
    const p = project({ 'project/pages/index.md': 300, 'project/pages/a/rules.md': 9000, 'project/pages/b/more.md': 9000 });
    expect(docs.projectDocs('.specs-aidlc-turbo', p.app).batches).toHaveLength(1);
  });
});
