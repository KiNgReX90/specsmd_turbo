/**
 * Unit tests for source-register.cjs, the numbered register of every
 * statement the docs-reader found in an inception's pulled pages. Spec-lint
 * counts coverage against it, so its ids have to hold still:
 * - --status names the pages to read (new, or a changed version) and reports
 *   an unchanged page as "skip", so it is never read twice;
 * - --merge numbers statements S-001, S-002, ... keyed on page id plus the
 *   hash of the whitespace-normalised quote, so a rerun keeps every id;
 * - a new page version turns the statements that did not come back stale,
 *   and one that comes back later keeps its id and is current again;
 * - a page that is no longer synced turns its statements stale;
 * - invalid candidates and an old-layout root are refused.
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync, mkdirSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';
import yaml from 'js-yaml';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const SCRIPT = path.join(FLOW, 'scripts/source-register.cjs');
const req = createRequire(import.meta.url);
const reg = req(SCRIPT);
const paths = req(path.join(FLOW, 'scripts/lib/paths.cjs'));

function run(root: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

function fixture() {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-register-')), '.specs-aidlc-turbo');
  const inc = path.join(root, 'docs', 'user-auth');
  mkdirSync(path.join(inc, 'pages'), { recursive: true });
  mkdirSync(path.join(inc, 'register-candidates'), { recursive: true });
  writeFileSync(path.join(inc, 'pages', 'index.md'), '# Log in\n');
  writeFileSync(path.join(inc, 'pages', 'guide.md'), '# Guide\n');
  return { root, inc };
}

function sync(inc: string, versions: Record<string, number>) {
  const rows = Object.entries(versions).map(([id, v]) => ({ path: `docs/user-auth/pages/${id === '100' ? 'index' : 'guide'}.md`, page_id: id, version: v }));
  writeFileSync(path.join(inc, 'sync.yaml'), yaml.dump({ confluence: { pages: rows } }));
}

function candidates(inc: string, id: string, version: number, quotes: string[]) {
  const file = path.join(inc, 'register-candidates', `${id}.yaml`);
  const statements = quotes.map((quote, i) => `  - { quote: ${JSON.stringify(quote)}, line: ${i + 1}, kind: requirement }`);
  writeFileSync(file, [`page: { id: "${id}", title: Page ${id}, version: ${version}, file: docs/user-auth/pages/x.md }`, 'statements:', ...statements].join('\n'));
  return file;
}

const register = (inc: string) => yaml.load(readFileSync(path.join(inc, 'register.yaml'), 'utf8'), { schema: yaml.CORE_SCHEMA }) as any;
const byQuote = (inc: string) => Object.fromEntries(register(inc).items.map((it: any) => [it.quote, it]));

describe('aidlc-turbo source-register', () => {
  it('names the pages to read, and skips a page whose version the register already read', () => {
    const { root, inc } = fixture();
    sync(inc, { 100: 3, 200: 1 });
    const first = JSON.parse(run(root, 'user-auth', '--status', '--json').out);
    expect(first.pages.map((p: any) => [p.id, p.action, p.reason])).toEqual([['100', 'read', 'new'], ['200', 'read', 'new']]);

    run(root, 'user-auth', '--merge', candidates(inc, '100', 3, ['An expired password opens the reset screen.']));
    const second = JSON.parse(run(root, 'user-auth', '--status', '--json').out);
    expect(second.pages.map((p: any) => [p.id, p.action])).toEqual([['100', 'skip'], ['200', 'read']]);
    expect(run(root, 'user-auth', '--status').out).toMatch(/^skip\s+100/m);

    sync(inc, { 100: 4, 200: 1 });
    const third = JSON.parse(run(root, 'user-auth', '--status', '--json').out);
    expect(third.pages[0]).toMatchObject({ id: '100', action: 'read', reason: 'changed', read_version: 3 });
  });

  it('counts a local page without a sync row, versioned by the hash of its text', () => {
    const { root, inc } = fixture();
    const pages = reg.listPages(root, 'user-auth');
    expect(pages.map((p: any) => p.id)).toEqual(['file-guide', 'file-index']);
    expect(pages[0].version).toMatch(/^[0-9a-f]{12}$/);
    expect(pages[0].file).toBe(path.join(inc, 'pages', 'guide.md').split(path.sep).join('/'));
    writeFileSync(path.join(inc, 'pages', 'guide.md'), '# Guide, new\n');
    expect(reg.listPages(root, 'user-auth')[0].version).not.toBe(pages[0].version);
  });

  it('skips a project page whose digest has the same version', () => {
    const { root, inc } = fixture();
    writeFileSync(path.join(inc, 'sync.yaml'), yaml.dump({ confluence: { pages: [
      { path: 'project/pages/architecture.md', page_id: '900', title: 'Architecture', version: 12 },
      { path: 'project/pages/glossary.md', page_id: '901', title: 'Glossary', version: 3 },
    ] } }));
    mkdirSync(path.join(root, 'project', 'digests'), { recursive: true });
    writeFileSync(path.join(root, 'project', 'digests', '900.yaml'), 'source: { page: "900", title: Architecture, version: 12 }\nfacts: []\n');
    writeFileSync(path.join(root, 'project', 'digests', '901.yaml'), 'source: { page: "901", title: Glossary, version: 2 }\nfacts: []\n');
    const pages = JSON.parse(run(root, 'user-auth', '--status', '--json').out).pages;
    const row = (id: string) => pages.find((p: any) => p.id === id);
    expect(row('900')).toMatchObject({ action: 'skip', reason: 'digest', scope: 'project', file: `${root.split(path.sep).join('/')}/project/pages/architecture.md` });
    expect(row('901')).toMatchObject({ action: 'read', reason: 'new', scope: 'project' });
  });

  it('keeps ids stable across runs, keyed on the page and the normalised quote', () => {
    const { root, inc } = fixture();
    sync(inc, { 100: 3, 200: 1 });
    expect(run(root, 'user-auth', '--merge', candidates(inc, '100', 3, ['Rule one.', 'Rule two.'])).code).toBe(0);
    expect(run(root, 'user-auth', '--merge', candidates(inc, '200', 1, ['Rule one.'])).code).toBe(0);
    const ids = register(inc).items.map((it: any) => [it.id, it.page, it.status]);
    expect(ids).toEqual([['S-001', '100', 'current'], ['S-002', '100', 'current'], ['S-003', '200', 'current']]);

    // Same page, whitespace changed, order changed: same ids.
    const out = run(root, 'user-auth', '--merge', candidates(inc, '100', 3, ['Rule   two.', ' Rule\none. ']));
    expect(out.out).toContain('0 new, 2 kept');
    expect(register(inc).items.map((it: any) => it.id)).toEqual(['S-001', 'S-002', 'S-003']);
    expect(register(inc).pages['100']).toMatchObject({ version: 3, read_version: 3 });
  });

  it('turns statements of a changed page stale, and gives a quote that comes back its old id', () => {
    const { root, inc } = fixture();
    sync(inc, { 100: 3 });
    run(root, 'user-auth', '--merge', candidates(inc, '100', 3, ['Old.', 'Stays.']));
    sync(inc, { 100: 4 });
    const r = JSON.parse(run(root, 'user-auth', '--merge', candidates(inc, '100', 4, ['Stays.', 'New.']), '--json').out);
    expect(r.pages[0]).toMatchObject({ added: ['S-003'], kept: ['S-002'], stale: ['S-001'] });
    expect(byQuote(inc)['Old.']).toMatchObject({ id: 'S-001', status: 'stale', version: 3 });
    expect(byQuote(inc)['Stays.']).toMatchObject({ id: 'S-002', status: 'current', version: 4 });

    sync(inc, { 100: 5 });
    const back = JSON.parse(run(root, 'user-auth', '--merge', candidates(inc, '100', 5, ['Old.', 'Stays.', 'New.']), '--json').out);
    expect(back.pages[0].revived).toEqual(['S-001']);
    expect(byQuote(inc)['Old.']).toMatchObject({ id: 'S-001', status: 'current', version: 5 });
    expect(back).toMatchObject({ total: 3, current: 3, stale: 0 });
  });

  it('turns statements of a page that is no longer synced stale, and merges a folder of candidates', () => {
    const { root, inc } = fixture();
    sync(inc, { 100: 1, 200: 1 });
    candidates(inc, '100', 1, ['A.']);
    candidates(inc, '200', 1, ['B.']);
    expect(run(root, 'user-auth', '--merge', path.join(inc, 'register-candidates')).code).toBe(0);
    sync(inc, { 100: 1 });
    expect(JSON.parse(run(root, 'user-auth', '--status', '--json').out).gone.map((g: any) => g.id)).toEqual(['200']);
    const r = JSON.parse(run(root, 'user-auth', '--merge', candidates(inc, '100', 1, ['A.']), '--json').out);
    expect(r.gone_stale).toEqual(['S-002']);
  });

  it('refuses invalid candidates, a bad call and the old layout', () => {
    const { root, inc } = fixture();
    const bad = path.join(inc, 'register-candidates', 'bad.yaml');
    writeFileSync(bad, 'page: { title: x }\nstatements:\n  - { quote: "", kind: wish }\n');
    const r = run(root, 'user-auth', '--merge', bad);
    expect(r.code).toBe(1);
    expect(r.out).toContain('page.id is missing');
    expect(r.out).toContain('statements[0].quote is missing');
    expect(reg.candidateProblems({ page: { id: 1, version: 1 }, statements: [{ quote: 'q', kind: 'wish' }] })[0]).toContain('kind must be one of');
    expect(run(root, 'user-auth').code).toBe(2);
    expect(run(root, 'user-auth', '--status', '--merge', bad).code).toBe(2);

    const legacy = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-register-legacy-')), '.specs-aidlc-turbo');
    mkdirSync(path.join(legacy, 'intents'), { recursive: true });
    const l = run(legacy, 'user-auth', '--status');
    expect(l.code).toBe(1);
    expect(l.out).toContain(paths.legacyMessage(legacy));
  });

  it('keys a statement on its page and the whitespace-normalised quote', () => {
    expect(reg.normaliseQuote('  a \n\t b ')).toBe('a b');
    expect(reg.quoteKey('100', 'a  b')).toBe(reg.quoteKey('100', 'a b'));
    expect(reg.quoteKey('100', 'a b')).not.toBe(reg.quoteKey('200', 'a b'));
  });
});
