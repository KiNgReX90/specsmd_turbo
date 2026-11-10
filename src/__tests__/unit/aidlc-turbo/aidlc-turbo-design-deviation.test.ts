/**
 * Unit tests for how a deviation of the build shows on the Code Scaffold (the overview after the build):
 * - one vocabulary for a part built otherwise: "Different from the design", on the part "different";
 * - a part that already existed, drawn to be used and not used, says "not used"; a new or changed part
 *   not built says "not built"; the legend names both in one line, the line on stdout counts both;
 * - a deviating part or module chosen: its details say it in one block under the description (what was
 *   planned, what was built and why: aidlc-turbo-design-about.test.ts), the head says it in its pill;
 * - no table of deviations under the drawing, in the code or the style;
 * - the details read at a comfortable size;
 * - the mark of the build on a part's corner is large and stands out on the white page.
 * Every text comes from the string table (templates/lang/en.json).
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
const { buildLine } = req(path.join(FLOW, 'scripts/lib/design-build.cjs'));
const FIT = req(path.join(DESIGN, 'design-fit.js'));
const EN = req(path.join(FLOW, 'scripts/lib/lang.cjs')).load('en');
const T = EN.design;

/** A script of the page, run again in this test's fake document. */
function load(f: string) {
  const file = path.join(DESIGN, f);
  delete req.cache[file];
  return req(file);
}

let d: ReturnType<typeof fakeDom>;
let B: any;
/** A node the drawing code can draw into (it appends with appendChild). */
const drawable = (n: any) => Object.assign(n, { appendChild: (c: any) => { n.append(c); return c; } });
beforeEach(() => {
  d = fakeDom();
  d.doc.createDocumentFragment = () => d.node('#fragment');
  d.doc.createElementNS = (_ns: string, tag: string) => drawable(d.node(tag));
  (globalThis as any).TdKit = load('design-kit.js');
  B = load('design-built.js');
  (globalThis as any).TdBuild = B;
  delete (globalThis as any).localStorage;
});
const text = (e: any) => (e ? e.textContent : null);

const existing = { status: 'existing', build: { state: 'gone' } };
const fresh = { status: 'new', build: { state: 'gone' } };
const changed = { status: 'changed', build: { state: 'gone' } };

describe('aidlc-turbo Code Scaffold: different from the design', () => {
  it('the table holds one word for each, in English', () => {
    expect(T.built.pills).toEqual({ different: 'different', added: 'added', gone: 'not built' });
    expect(T.built.unused).toBe('not used');
    expect(T.built.legend).toEqual({ different: 'Different from the design', added: 'Added during the build', gone: 'Not built or not used', module: 'Module different from the design' });
    expect(T.mark).toEqual({ different: 'Different from the design', added: 'Added during the build', gone: 'Not built', unused: 'Not used' });
  });

  it('names a part built otherwise "Different from the design" in the legend, the details and its mark, "different" on the part', () => {
    expect(B.PILLS).toEqual(T.built.pills);
    expect(load('design-about.js').devOf({ build: { state: 'different' } }).title).toBe(T.about.different);
    const lg = B.legendItem(['different', 'added', 'gone'], true);
    for (const t of Object.values(T.built.legend) as string[]) expect(lg).toContain(t);
    expect(FIT.pillsOf({ kind: 'class', build: { state: 'different' } }, true).map((x: any) => x.text)).toEqual(['class', 'different']);
    const E = load('design-engine.js');
    expect(E.buildTitle({ build: { state: 'different' } })).toBe('Different from the design');
    expect(B.NOTE.built).toContain('blue is different from the design, green is added, grey is not built or not used.');
  });

  it('prints the one line after the build in the same words', () => {
    expect(buildLine({ stories: [], different: 2, extra: 2, gone: 1 })).toBe('Code Scaffold: 2 different from the design, 2 added, 1 not built or used');
    expect(buildLine({ stories: [], different: 1, extra: 0, gone: 0 })).toBe('Code Scaffold: 1 different from the design, 0 added');
    expect(buildLine({ stories: [], different: 0, extra: 0, gone: 0 })).toBe('Code Scaffold: built as planned');
  });
});

describe('aidlc-turbo Code Scaffold: not built or not used', () => {
  it('a part that existed and was not used says "not used"; a new or changed one "not built"', () => {
    expect(B.pillOf(existing)).toBe('not used');
    expect(B.pillOf(fresh)).toBe('not built');
    expect(B.pillOf(changed)).toBe('not built');
    expect(B.pillOf({ build: { state: 'different' } })).toBe('different');
    expect(B.pillOf({})).toBeNull();
    expect(FIT.pillsOf({ kind: 'enum', ...existing }, true).map((x: any) => x.text)).toEqual(['enum', 'not used']);
    expect(FIT.pillsOf({ kind: 'class', ...fresh }, true).map((x: any) => x.text)).toEqual(['class', 'not built']);
  });

  it('tells it so in the details and in the title of the mark', () => {
    const A = load('design-about.js');
    expect(A.devOf(existing).title).toBe('Not used');
    expect(A.devOf(fresh).title).toBe('Not built');
    const E = load('design-engine.js');
    expect(E.buildTitle(existing)).toBe('Not used');
    expect(E.buildTitle(fresh)).toBe('Not built');
    const g = E.buildIcon(drawable(d.node('svg')), 0, 0, 'gone', E.buildTitle(existing));
    expect(text(g.children.find((c: any) => c.tag === 'title'))).toBe('Not used');
  });
});

describe('aidlc-turbo Code Scaffold: no table of deviations under the drawing', () => {
  it('builds no table, and offers none', () => {
    const SRC = read('design-built.js');
    for (const gone of ['td-dv', 'td-dev', 'mq-bp', 'mq-slot', 'mq-piece', 'mq-ghost', "'table'"]) expect(SRC, gone).not.toContain(gone);
    expect(B.block).toBeUndefined();
  });

  it('has no style or motion left for it', () => {
    const css = ['design.css', 'design-touch.css', 'maquette.css', 'maquette-built.css', 'maquette-draw.css'].map(read).join('\n');
    for (const gone of ['.td-dv', '.td-dev', '.mq-bp', '.mq-slot', '.mq-piece', '.mq-ghost', '.mq-bay']) expect(css, gone).not.toContain(gone);
    const motion = read('maquette-draw.js');
    for (const gone of ['td-dv', 'td-dev', 'function place']) expect(motion, gone).not.toContain(gone);
    expect(motion).toContain('root.TdMaquette = { dress };');
  });
});

describe('aidlc-turbo Code Scaffold: the details read at a comfortable size', () => {
  const css = read('design-about.css');
  /** The font size in px of the first rule for `sel` outside a query, from font-size or font. */
  const size = (src: string, sel: string) => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&');
    const body = new RegExp(`(?:^|\\n)${esc} \\{([^}]*)\\}`).exec(src);
    if (!body) return 0;
    const m = /font-size: ([\d.]+)px/.exec(body[1]) || /font: (?:\d+ )?([\d.]+)px/.exec(body[1]);
    return m ? parseFloat(m[1]) : 0;
  };

  it('the description, what changed and the deviation 14.5 px or more, the story chips 14 px or more', () => {
    for (const sel of ['.td-dwhat', '.td-dchg-p', '.td-dflow', '.td-ddev-p', '.td-ddev-t']) expect(size(css, sel), sel).toBeGreaterThanOrEqual(14.5);
    for (const sel of ['.td-cs-lead', '.td-cs-s', '.td-cs-name']) expect(size(css, sel), sel).toBeGreaterThanOrEqual(14);
  });
});

describe('aidlc-turbo Code Scaffold: the mark of the build stands out', () => {
  const CSS = read('design.css');
  function lum(hex: string) {
    const c = hex.replace('#', '').match(/../g)!.map((h) => parseInt(h, 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const tokens = (name: string) => [...CSS.matchAll(new RegExp(`${name}: (#[0-9A-Fa-f]{6});`, 'g'))].map((m) => m[1]);

  it('is large: a circle of radius 19 or more, its sign drawn bold', () => {
    const E = load('design-engine.js');
    for (const s of ['different', 'added', 'gone']) {
      const g = E.buildIcon(drawable(d.node('svg')), 0, 0, s);
      expect(Number(g.children.find((c: any) => c.tag === 'circle').attrs.r), s).toBeGreaterThanOrEqual(19);
    }
    expect(CSS).toMatch(/\.td-bi-ic \{[^}]*stroke: var\(--td-bi-ink\);[^}]*stroke-width: 3;/);
  });

  it('has a colour of its own per kind, with its sign readable on it and itself on the white page', () => {
    const ink = tokens('--td-bi-ink');
    expect(ink).toHaveLength(1);
    for (const k of ['different', 'added', 'gone']) {
      const fill = tokens(`--td-bi-${k}`);
      expect(fill, k).toHaveLength(1);
      expect(CSS).toContain(`.td-bi-${k} circle { fill: var(--td-bi-${k}); }`);
      expect(contrast(fill[0], ink[0]), k).toBeGreaterThanOrEqual(4.5);
      expect(contrast(fill[0], '#FFFFFF'), k).toBeGreaterThanOrEqual(4.5);
    }
  });
});
