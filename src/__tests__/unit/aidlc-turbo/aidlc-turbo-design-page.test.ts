/**
 * Unit tests for the Code Scaffold on the overview page that
 * intent-overview.cjs writes:
 * - the page carries the drawing of the record in its data block, or null when
 *   the record has no drawing, and the v5 model of the tabs it embeds keys the
 *   same drawing (lib/v5-model.cjs scaffoldOf); the drawing's kit is inlined
 *   once, its layout engine with it, and no inlined file closes its tag early;
 * - the Code Scaffold tab shows with a drawing only (the tabs:
 *   aidlc-turbo-design-tabs.test.ts);
 * - light only: no theme switch, no saved theme, no dark set, and the Turbo
 *   logo inline in the masthead;
 * - the note under the heading of the drawing in templates/design: a starting
 *   point before the build, never redrawn after it;
 * - after the build (construction) only: the build of every built story next
 *   to the drawing, the "different" pill on the drawing, one card of the
 *   deviation in the details (no rows) and one line on stdout;
 * - a click in the drawing: an arrow opens its step with the mouse too, and
 *   the full-screen view pans what was chosen out from under its details.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';
import { pageTabs } from './aidlc-turbo-intent-overview-fixture';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const SCRIPT = path.join(FLOW, 'scripts/intent-overview.cjs');
const req = createRequire(import.meta.url);
const overview = req(SCRIPT);
const render = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const paths = req(path.join(FLOW, 'scripts/lib/paths.cjs'));
const { designModel } = req(path.join(FLOW, 'scripts/lib/design-model.cjs'));
const { applyBuild, buildLine } = req(path.join(FLOW, 'scripts/lib/design-build.cjs'));
const TdBuild = req(path.join(FLOW, 'templates/design/design-built.js'));
const ENGINE = readFileSync(path.join(FLOW, 'templates/design/design-engine.js'), 'utf8');
const FIT = req(path.join(FLOW, 'templates/design/design-fit.js'));
const PANEL = readFileSync(path.join(FLOW, 'templates/design/design-panel.js'), 'utf8');
const INPUT = readFileSync(path.join(FLOW, 'templates/design/design-input.js'), 'utf8');
const CSS = readFileSync(path.join(FLOW, 'templates/design/design.css'), 'utf8');
const VIEW = readFileSync(path.join(FLOW, 'templates/design/design-view.js'), 'utf8');
const KEYS = readFileSync(path.join(FLOW, 'templates/design/design-keys.js'), 'utf8');
const DETAIL = readFileSync(path.join(FLOW, 'templates/design/design-detail.js'), 'utf8');

const { scaffoldOf, v5Model } = req(path.join(FLOW, 'scripts/lib/v5-model.cjs'));
const { designAssets } = req(path.join(FLOW, 'scripts/lib/design-assets.cjs'));
const EN = req(path.join(FLOW, 'scripts/lib/lang.cjs')).load('en');

/** The data block of the page the script writes (templates/overview). */
const DATA = /<script id="overview-data" type="application\/json">([\s\S]*?)<\/script>/;
const DESIGN = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');

function run(root: string, extra: string[] = []) {
  const r = spawnSync(process.execPath, [SCRIPT, 'user-auth', '--no-open', '--root', root, ...extra], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr, stdout: r.stdout };
}

const pageOf = (intent: any) => JSON.parse(DATA.exec(readFileSync(intent.overview, 'utf8'))![1].replace(/<\\!--/g, '<!--'));

/**
 * The template intent with a second story. With `drawing` the record and its
 * two stories carry the order status drawing of the fixture.
 */
function fixture(drawing = false) {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-design-')), '.specs-aidlc-turbo');
  const dir = path.join(root, 'docs', 'user-auth', 'user-auth');
  mkdirSync(path.join(root, 'repo'), { recursive: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(root, 'repo', 'config.yaml'), 'mode: sandbox\n');
  const record = render.parseYaml(readFileSync(path.join(FLOW, 'templates/inception/record-template.yaml'), 'utf8'));
  const second = JSON.parse(JSON.stringify(record.stories[0]));
  Object.assign(second, { id: '002', slug: 'reset-mail', title: 'Send the reset mail', depends_on: ['001'] });
  record.stories.push(second);
  if (drawing) {
    const src = render.parseYaml(readFileSync(DESIGN, 'utf8'));
    record.technical_design = { ...(record.technical_design || {}), drawing: src.technical_design.drawing };
    record.stories[0].drawing = src.stories[0].drawing;
    record.stories[1].drawing = src.stories[1].drawing;
  }
  writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
  const intent = paths.findIntent(root, 'user-auth');
  render.applyPlan(intent, render.planRender(intent));
  return { root, dir, intent };
}

describe('aidlc-turbo overview: the Code Scaffold before the build', () => {
  it('carries the drawing of the record, and the v5 keys of the tabs it embeds follow it', () => {
    const { root, dir, intent } = fixture(true);
    const { design } = overview.buildData(root, intent, 'inception').page;
    const record = render.parseYaml(readFileSync(path.join(dir, 'record.yaml'), 'utf8'));
    expect(design).toEqual(designModel(record));
    expect(design.parts).toHaveLength(20);
    expect(design.stories.map((s: any) => s.id)).toEqual(['001', '002']);
    expect(run(root).code).toBe(0);
    expect(pageOf(intent).design.parts).toHaveLength(20);
    const model = v5Model(root, intent, 'inception');
    expect({ parts: model.parts, links: model.links, modules: model.modules }).toEqual(scaffoldOf(design));
    // every part with a layer is drawn; the rest sit near the part they belong to
    expect(Object.keys(model.parts)).toEqual(design.parts.filter((p: any) => p.layer).map((p: any) => p.id));
    expect(model.links.length).toBeGreaterThan(0);
  });

  it('inlines the kit once, its layout engine and its style with it, and no file closes its tag early', () => {
    const { root, intent } = fixture(true);
    expect(run(root).code).toBe(0);
    const html = readFileSync(intent.overview, 'utf8');
    const { css, js } = designAssets();
    expect(html.split(css)).toHaveLength(2);
    expect(html.split(js)).toHaveLength(2);
    for (const marker of ['TdLayout', 'TdRoute', 'TdEngine', '--td-lane-1']) expect(html, marker).toContain(marker);
    // every text of the table is filled in
    expect(html).not.toMatch(/\{\{[\w.]+\}\}/);
    expect(html.match(/<script\b/g)!.length).toBe(html.match(/<\/script>/g)!.length);
    expect(html.match(/<style\b/g)!.length).toBe(html.match(/<\/style>/g)!.length);
    expect(html).not.toMatch(/__DESIGN_[A-Z]+__|__OVERVIEW_DATA__|__TURBO_LOGO__|__TURBO_TEXT__/);
  });

  it('shows the Code Scaffold tab with a drawing, and a record without one gets no design and no tab', () => {
    const drawn = fixture(true);
    expect(run(drawn.root).code).toBe(0);
    expect(pageTabs(pageOf(drawn.intent))).toEqual(['Functional', 'Code Scaffold']);
    const { root, intent } = fixture();
    expect(overview.buildData(root, intent, 'inception').page.design).toBeNull();
    expect(run(root).code).toBe(0);
    const page = pageOf(intent);
    expect(page.design).toBeNull();
    expect(pageTabs(page)).toEqual([]);
    expect(readFileSync(intent.overview, 'utf8')).not.toContain('TdLayout');
  });

  it('is light only: no theme switch, no saved theme, no dark set, the Turbo logo in the masthead', () => {
    const { root, intent } = fixture();
    expect(run(root).code).toBe(0);
    const html = readFileSync(intent.overview, 'utf8');
    for (const t of ['system', 'dark', 'light']) expect(html).not.toContain(`data-t="${t}"`);
    expect(html).not.toMatch(/class="theme"|localStorage\.(get|set)Item\('[\w-]*theme'/);
    expect(html).not.toMatch(/data-theme|prefers-color-scheme: dark|color-scheme: dark/);
    expect(html).toMatch(/color-scheme: light/);
    const mast = (/<header class="mast">([\s\S]*?)<\/header>/.exec(html) || [])[1] ?? '';
    expect(mast).toMatch(/<svg class="logo"[^>]*aria-label="AI-DLC Turbo"/);
    expect(mast).not.toContain('<img');
  });
});

/** The fixture after story 001 was built: one part elsewhere with a reason, one missing without, one extra file. */
function built() {
  const f = fixture(true);
  const record = render.parseYaml(readFileSync(path.join(f.dir, 'record.yaml'), 'utf8'));
  const model = designModel(record);
  const story = model.stories[0];
  const files = Object.keys(story.builds).map((id) => model.parts.find((p: any) => p.id === id)).filter(Boolean)
    .filter((p: any) => p.id !== 'gw').map((p: any) => p.path);
  record.stories[0].changed_files = [...files, 'shop-orderstatus-core/src/main/java/com/acme/Cache.java', 'src/test/java/com/acme/CacheTest.java'];
  writeFileSync(path.join(f.dir, 'record.yaml'), render.dumpYaml(record));
  const prov = model.parts.find((p: any) => p.id === 'prov').path;
  const dir = f.intent.stories;
  const file = path.join(dir, readdirSync(dir).find((n: string) => n.startsWith('001-'))!);
  // the builder writes the build notes, the last section of the story file
  const md = readFileSync(file, 'utf8');
  expect(md).toMatch(/\n### Build notes\n/);
  writeFileSync(file, md.replace(/\n### Build notes\n[\s\S]*$/, '') + `\n### Build notes\n\n- Built the API.\n- **Outside the Code Scaffold**: none.\n- **Different from the Code Scaffold**:\n  - \`${prov}\`: put in the existing service, because it was there already.\n`);
  return f;
}

/** Just enough of a document for design-built.js: elements with a class, text and children. */
function fakeDom() {
  const node = (tag: string): any => {
    const e: any = { tag, className: '', children: [] as any[], attrs: {} as Record<string, string>, own: '' };
    Object.defineProperty(e, 'textContent', {
      get: () => e.own + e.children.map((c: any) => (typeof c === 'string' ? c : c.textContent)).join(''),
      set: (v: string) => { e.own = v; e.children = []; },
    });
    e.append = (...xs: any[]) => { e.children.push(...xs); };
    e.setAttribute = (k: string, v: string) => { e.attrs[k] = v; };
    e.prepend = (...xs: any[]) => { e.children.unshift(...xs); };
    e.dataset = {};
    return e;
  };
  (globalThis as any).document = { createElement: node, createTextNode: (t: string) => ({ textContent: t }),
    createElementNS: (_ns: string, tag: string) => node(tag) };
  const all = (e: any, cls: string): any[] => [...(String(e.className).split(' ').includes(cls) ? [e] : []), ...e.children.filter((c: any) => c && c.children).flatMap((c: any) => all(c, cls))];
  const tags = (e: any, tag: string): any[] => [...(e.tag === tag ? [e] : []), ...e.children.filter((c: any) => c && c.children).flatMap((c: any) => tags(c, tag))];
  return { node, all, tags };
}

describe('aidlc-turbo overview: the Code Scaffold note', () => {
  it('says the drawing is a starting point before the build, and is not redrawn after it', () => {
    fakeDom();
    expect(TdBuild.note('inception').textContent).toBe('This is the starting point of the code: roughly how it will be built. The build can differ in the details. You will see every difference on this drawing afterwards. A new permission, a new table or a new module is put to you first, before it is built.');
    expect(TdBuild.note(undefined).textContent).toBe(TdBuild.NOTE.plan);
    expect(TdBuild.note('construction').textContent).toBe(TdBuild.NOTE.built);
    expect(TdBuild.NOTE.built).toMatch(/^This is how it was built\. .*blue is different from the design, green is added, grey is not built or not used\./);
  });

  it('sits on top of the drawing before the build', () => {
    // after the build the masthead says what was built: the drawing starts right away
    expect(PANEL).toContain('if (!built || plan) rootEl.append(B().note(o.phase, plan));');
  });

  it('draws at its own size: fewer parts never make the blocks bigger, a wide drawing scrolls', () => {
    expect(ENGINE).toContain('width: geo.width, height: geo.height');
    const rule = /\.td-dz svg\.td-svg \{([^}]*)\}/.exec(CSS)![1];
    expect(rule).not.toMatch(/(^|[^-])width:/);
    expect(rule).toContain('max-width: none');
    expect(CSS).toMatch(/\.td-scroll \{ overflow-x: auto;/);
  });

  it('keeps its own width on a wider page: the bands never stretch into an empty strip beside it', () => {
    const { fitTo } = req(path.join(FLOW, 'templates/design/design-engine.js'));
    const fake = () => ({ attrs: {} as Record<string, unknown>, setAttribute(k: string, v: unknown) { this.attrs[k] = v; } });
    const svg = fake();
    // the first band spans the drawing, a later one only its own columns
    const lanes = [{ el: fake(), x: 0, w: 628 }, { el: fake(), x: 300, w: 200 }];
    const geo = { width: 628, height: 900 };
    for (const width of [1300.6, 400]) {
      fitTo(svg, lanes, geo, width);
      expect(svg.attrs).toEqual({ width: 628, viewBox: '0 0 628 900' });
      expect(lanes.map((l) => l.el.attrs.width)).toEqual([628, 200]);
    }
    // a band without its own width runs to the right edge of the drawing
    const lone = [{ el: fake(), x: 28 }];
    fitTo(svg, lone, geo, 1300);
    expect(lone[0].el.attrs.width).toBe(600);
    // the panel sizes the drawing to its box, now and on every resize
    expect(PANEL).toMatch(/new ResizeObserver\(/);
  });

  it('is named the same everywhere a person reads it: the tab, the drawing label and the approval steer', () => {
    expect(EN.design.tabs.flow).toBe('Code Scaffold');
    expect(req(path.join(FLOW, 'templates/design/design-tabs.js')).views(false, true, false).map((v: string[]) => v[1])).toContain('Code Scaffold');
    expect(ENGINE).toContain("'aria-label': 'Code Scaffold'");
    expect(KEYS).toContain("<b>${a('option')}</b>");
    expect(EN.design.legend.asks.option).toBe('The Code Scaffold is wrong');
  });
});

describe('aidlc-turbo overview: the build next to the Code Scaffold', () => {
  it('in the inception phase carries no build, prints no line and shows no deviation', () => {
    const { root, intent } = built();
    const r = run(root, ['--phase', 'inception']);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain('Code Scaffold:');
    const { design } = pageOf(intent);
    expect(design).not.toHaveProperty('build');
    expect(design.parts.every((p: any) => p.build === undefined && p.changed === undefined)).toBe(true);
    // the panel shows the deviations only in construction, with a build
    expect(PANEL).toContain("const built = o.phase === 'construction' && model.build ? model.build : null;");
    expect(ENGINE).toContain('F.pillsOf(p, marks)');
    expect(FIT.pillsOf({ kind: 'class', build: { state: 'different' } }, false).map((x: any) => x.text)).toEqual(['class']);
  });

  it('in the construction phase carries the build of every built story, test files left out', () => {
    const { root, intent } = built();
    const { design } = overview.buildData(root, intent, 'construction').page;
    expect(design.build.stories.map((s: any) => s.id)).toEqual(['001']);
    const [s] = design.build.stories;
    expect(s.different.map((d: any) => [d.id, d.why])).toEqual([
      ['gw', null],
      ['prov', 'put in the existing service, because it was there already.'],
    ]);
    expect(s.extra).toEqual([{ file: 'shop-orderstatus-core/src/main/java/com/acme/Cache.java', name: 'Cache', built: null, why: null }]);
    expect(design.parts.find((p: any) => p.id === 'prov').build).toMatchObject({ state: 'different', story: '001', built: null, why: 'put in the existing service, because it was there already.' });
    expect(design.parts.find((p: any) => p.id === 'ctrl').build.state).toBe('as_planned');
    // a changed file off the scaffold, in a drawn module, gets a part of its own
    expect(design.parts.find((p: any) => p.path === 'shop-orderstatus-core/src/main/java/com/acme/Cache.java').build.state).toBe('added');
    // the rest of the drawing stays as approved, its reasons told in the past
    const record = render.parseYaml(readFileSync(intent.record, 'utf8'));
    const added = new Set(design.parts.filter((p: any) => p.build && p.build.state === 'added').map((p: any) => p.id));
    const keep = (ids: string[]) => ids.filter((id) => !added.has(id));
    expect({
      ...design, build: undefined,
      parts: design.parts.filter((p: any) => !added.has(p.id)).map(({ build: _b, ...p }: any) => p),
      modules: design.modules.map(({ build: _b, ...m }: any) => m),
      frames: design.frames.map((f: any) => ({ ...f, parts: keep(f.parts) })),
      stories: design.stories.map((s: any) => ({ ...s, parts: keep(s.parts),
        builds: Object.fromEntries(Object.entries(s.builds).filter(([k]) => !added.has(k))) })),
    }).toEqual({ ...designModel(record, { built: true }), build: undefined });
  });

  it('prints one line on stdout after the build', () => {
    const { root, intent } = built();
    const r = run(root, ['--phase', 'construction']);
    expect(r.code).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual([`Overview: ${intent.overview}`, 'Code Scaffold: 2 different from the design, 1 added']);
    expect(pageOf(intent).design.build.different).toBe(2);
  });

  it('prints "built as planned" when nothing deviated, and nothing when no story was built', () => {
    expect(buildLine({ stories: [], different: 0, extra: 0 })).toBe('Code Scaffold: built as planned');
    const { root } = fixture(true);
    expect(run(root, ['--phase', 'construction']).stdout).not.toContain('Code Scaffold:');
  });

  it('shows the pill and the rows from the build', () => {
    const { root, intent } = built();
    const { design } = overview.buildData(root, intent, 'construction').page;
    fakeDom();
    // the one block of a deviation in the details (design-about.js): nothing for a part built as planned
    const A = req(path.join(FLOW, 'templates/design/design-about.js'));
    expect(A.devOf(design.parts.find((p: any) => p.id === 'ctrl'))).toBeNull();
    expect(A.devOf(design.parts.find((p: any) => p.id === 'prov')).title).toBe(EN.design.about.different);
    expect(A.devOf(design.parts.find((p: any) => p.id === 'prov')).lines).toContainEqual([EN.design.built.why, 'put in the existing service, because it was there already.']);
    expect(A.devOf(design.parts.find((p: any) => p.id === 'gw')).lines).toContainEqual([EN.design.built.why, EN.design.built.noReason]);
    expect(A.devOf({})).toBeNull();
    // the pill on the drawing and in the details, explained in the legend, a token
    expect(FIT.pillsOf({ kind: 'class', build: { state: 'different' } }, true).map((x: any) => x.text)).toEqual(['class', 'different']);
    // after the build the details have no rows: the head says it all; the plan page keeps its Certainty
    expect(DETAIL).toContain('if (built) return [hd, null];');
    expect(TdBuild.legendItem(['different'], false)).toContain('Different from the design');
    expect(CSS.match(/--td-built-bg:/g)).toHaveLength(1);
  });
});

describe('aidlc-turbo overview: a click in the Code Scaffold', () => {
  it('an arrow clicked with the mouse pins its step, as a tap does', () => {
    expect(INPUT).toContain("for (const g of [e.g, e.lg]) g.addEventListener('click', () => o.clicked('link', e.l.id));");
    expect(PANEL).not.toMatch(/if \(view\.touched\(\)\) pick\('link'/);
  });

  it('in the full-screen view the chosen part or module comes out from under the details, an arrow is brought into sight', () => {
    expect(PANEL).toMatch(/function clicked\(kind, id\) \{[\s\S]*?ch\.mark\(kind, id\); \}\s*\}\);\s*if \(kind !== 'link' && view\.isOpen\(\)\) \{ view\.roomFor\(\); view\.reveal\(\{ \[kind\]: id \}\)/);
    expect(PANEL).toMatch(/function holdStep\(id\) \{[^}]*view\.reveal\(\{ link: id \}\)/);
    expect(INPUT).toContain("g.addEventListener('click', () => o.clicked('part', id));");
    // a sheet or a drawer counts as covered, from whichever side it comes
    expect(VIEW).toContain('root.TdKit.covers(');
  });

  it('the page places the steps by the shared rule, folded where the drawing would get too small', () => {
    expect(PANEL).toContain('root.TdKit.fit(');
  });
});
