/**
 * Unit tests for what the details of a part or module show, and the marks of Certainty:
 * - before the build (the plan page) a part says its Certainty, the legend explains the colours and
 *   every block carries its colour: the reviewer checks those parts before approving;
 * - after the build there is no Certainty: no row in the details, no group in the legend (nor its
 *   note "Fixed rules ..."), no colour bar on the blocks, no "certainty" in a block's name;
 * - the kind ("class", "enum", "job") is a label in the head beside the state pill, as on the block,
 *   on both pages; there is no "Kind" row any more; a module shows its kind the same way when it has one;
 * - after the build the details have no rows at all: what it does and where it deviated say it (the
 *   change beside them names the file); before the build "Looks like" and "Where in the code" stay, for a
 *   part and a module.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fakeDom } from './aidlc-turbo-design-fake-dom';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const DESIGN = path.join(FLOW, 'templates/design');
const req = createRequire(import.meta.url);
const read = (f: string) => readFileSync(path.join(DESIGN, f), 'utf8');
const dm = req(path.join(FLOW, 'scripts/lib/design-model.cjs'));
const { parseYaml } = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const FIXTURE = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');
const fresh = () => dm.designModel(parseYaml(readFileSync(FIXTURE, 'utf8')));

/** A script of the page, run again in this test's fake document. */
function load(f: string) {
  const file = path.join(DESIGN, f);
  delete req.cache[file];
  return req(file);
}
const G = globalThis as any;
let d: ReturnType<typeof fakeDom>;
const drawable = (n: any) => Object.assign(n, {
  appendChild: (c: any) => { n.append(c); return c; }, style: {}, after: () => {},
  getComputedTextLength: () => String(n.textContent || '').length * 7,
});
beforeEach(() => {
  d = fakeDom();
  d.doc.createElementNS = (_ns: string, tag: string) => drawable(d.node(tag));
  G.getComputedStyle = () => ({ fontSize: '14px' });
  G.TdKit = load('design-kit.js');
  G.TdBuild = load('design-built.js');
  G.TdDiff = load('design-diff.js');
  G.TdEngine = load('design-engine.js');
  load('design-detail.js');
  load('design-keys.js');
  delete G.localStorage;
});
const text = (e: any) => (e ? e.textContent : null);
/** The names of the rows of a details list. */
/** The names of the rows; none where the details have no rows (after the build). */
const terms = (dl: any): string[] => (dl ? dl.children || [] : []).filter((c: any) => c && c.tag === 'dt').map(text);

const mod = { id: 'core', name: 'shop-core', status: 'changed', path: 'shop/core', follows: { file: 'shop/other', note: 'just the same' } };
const part = (extra: object = {}) => ({ id: 'p', name: 'Parser', status: 'changed', kind: 'class', module: 'core', path: 'shop/core/src/Parser.java', lines: '37-68',
  follows: { file: 'shop/core/src/Other.java', lines: '29-109', note: 'just the same' },
  confidence: { level: 'orange', reasons: ['Only known from the documentation.'] }, ...extra });
const DIFF = { text: '@@ -1,1 +1,2 @@\n a\n+b\n', added: 1, removed: 0 };
const facts = (p: any, built: any) => G.TdDetail.create({ parts: [p], modules: [mod], stories: [], links: [] }, { built, titleOf: (s: any) => s.title, order: [] });

describe('aidlc-turbo Code Scaffold: Certainty only before the build', () => {
  it('the details of a part say their Certainty on the plan page, not after the build', () => {
    const [, plan] = facts(part(), null).part(part());
    expect(terms(plan)).toContain('Certainty');
    expect(text(plan)).toContain('Only known from the documentation.');
    const [head, after] = facts(part(), { stories: [] }).part(part());
    expect(after).toBeNull();
    expect(d.all(head, 'td-zkb')).toEqual([]);
    expect(text(head)).not.toContain('Only known from the documentation.');
  });

  it('the legend explains the colours before the build, and has no Certainty after it', () => {
    const m = fresh();
    const before = G.TdKeys.legend(m, false, false).innerHTML;
    for (const w of ['>Certainty<', 'Checked or beyond doubt', 'Doubt, or only from docs', 'Choice open', 'Fixed rules', 'for the reason', 'td-zkb']) expect(before).toContain(w);
    const after = G.TdKeys.legend(m, true, false).innerHTML;
    for (const w of ['Certainty', 'Checked', 'Doubt', 'Choice open', 'Fixed rules', 'for the reason', 'td-zkb', 'td-lg-note']) expect(after).not.toContain(w);
    // the rest of the legend stays
    for (const w of ['>Status<', '>Lines<', '>Other<']) expect(after).toContain(w);
  });

  it('a block carries its colour bar and says its certainty before the build, neither after it', () => {
    G.TdLabels = load('design-labels.js');
    const { layout, SIZE } = load('design-layout.js');
    const block = (built: boolean) => {
      const m = fresh();
      const p = m.parts.find((x: any) => x.status === 'existing');
      if (built) p.build = { state: 'as_planned' };
      const drawn = G.TdEngine.draw(drawable(d.node('div')), m, { ...layout(m), tags: [] }, SIZE, { built });
      return drawn.nodes.find((x: any) => x.p.id === p.id);
    };
    const zk = (g: any): string[] => (g.children || []).flatMap((c: any) => [
      ...(c && c.attrs && /^td-zk-/.test(c.attrs.class || '') ? [c.attrs.class] : []), ...(c && c.children ? zk(c) : [])]);
    const before = block(false), after = block(true);
    expect(zk(before.g)).toEqual(expect.arrayContaining(['td-zk-sep']));
    expect(zk(before.g).some((c) => /^td-zk-(green|orange|red)$/.test(c))).toBe(true);
    expect(before.g.getAttribute('aria-label')).toMatch(/, certainty (green|orange|red)$/);
    expect(zk(after.g)).toEqual([]);
    expect(after.g.getAttribute('aria-label')).not.toMatch(/certainty/);
  }, 30000); // two whole drawings: slow while the rest of the suite runs beside it
});

describe('aidlc-turbo Code Scaffold: the kind is a label in the head', () => {
  it('shows the kind beside the state pill on both pages, and no Kind row', () => {
    for (const built of [null, { stories: [] }]) {
      const [head, dl] = facts(part(), built).part(part());
      const pills = d.all(head, 'td-pills')[0];
      const kind = d.all(head, 'td-kind');
      expect(kind.map(text)).toEqual([G.TdEngine.kindOf('class')]);
      // beside the state pill, in the same row, and not a pill of its own
      expect(kind[0].parent).toBe(pills);
      expect(pills.children[0].className).toMatch(/\btd-pill\b/);
      expect(kind[0].className).not.toMatch(/\btd-pill\b/);
      expect(terms(dl)).not.toContain('Kind');
    }
  });

  it('says a kind in the words of the drawing, and shows no label without a kind', () => {
    const [head] = facts(part({ kind: 'job' }), null).part(part({ kind: 'job' }));
    expect(d.all(head, 'td-kind').map(text)).toEqual(['job']);
    const [bare] = facts(part({ kind: '' }), null).part(part({ kind: '' }));
    expect(d.all(bare, 'td-kind')).toEqual([]);
  });

  it('a module shows its kind the same way when it has one', () => {
    const f = facts(part(), null);
    expect(d.all(f.mod(mod)[0], 'td-kind')).toEqual([]);
    expect(d.all(f.mod({ ...mod, kind: 'JS module' })[0], 'td-kind').map(text)).toEqual(['JS module']);
  });

  it('styles the label like the kind label on the block, from the drawing\'s tokens', () => {
    const css = read('design.css');
    const rule = /\.td-kind \{([^}]*)\}/.exec(css);
    expect(rule, '.td-kind rule').not.toBeNull();
    expect(rule![1]).toMatch(/background: var\(--td-chip-old-bg\)/);
    expect(rule![1]).toMatch(/color: var\(--td-old-chip-t\)/);
    expect(rule![1]).toMatch(/border-radius: 6px/);
    // the tokens it reads are set once: the page is light only
    for (const t of ['--td-chip-old-bg', '--td-old-chip-t']) expect(css.split(t + ':').length - 1).toBe(1);
  });
});

describe('aidlc-turbo Code Scaffold: "Looks like" and "Where in the code" before the build only', () => {
  it('the plan page keeps both rows, for a part and a module', () => {
    const f = facts(part(), null);
    expect(terms(f.part(part())[1])).toEqual(expect.arrayContaining(['Where in the code', 'Looks like']));
    expect(terms(f.mod(mod)[1])).toEqual(expect.arrayContaining(['Where in the code', 'Looks like']));
  });

  it('after the build no rows at all, with a change shown beside the details or without one, for a part and a module', () => {
    const p = part();
    expect(G.TdDiff.side({ stories: [], diffs: { [p.path]: DIFF } }, p)).not.toBeNull();
    for (const built of [{ stories: [], diffs: { [p.path]: DIFF } }, { stories: [], diffs: {} }, { stories: [] }]) {
      expect(facts(p, built).part(p)[1]).toBeNull();
      expect(facts(p, built).mod(mod)[1]).toBeNull();
    }
  });
});
