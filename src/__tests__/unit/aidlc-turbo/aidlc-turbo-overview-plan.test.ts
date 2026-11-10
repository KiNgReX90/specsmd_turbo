/**
 * Unit tests for the overview page while a change the user asked for is still open (intent-overview.cjs --plan):
 * the page stays the page of the build, with its Review, but its drawing shows the plan with that change in it.
 * - the page data says `plan`, and every part the build added moves out of the drawing into design.build.parts;
 * - the script prints no build line with --plan;
 * - the drawing of templates/design carries no mark of the build while plan: no pill or state on a block
 *   (design-engine.js), no "After the build" group in the legend (design-keys.js), and the note says a change is open
 *   (design-built.js, design-panel.js);
 * - Review still lists every deviation, a part that stands apart as a file outside the drawing with no way into it
 *   (design-review-list.js, design-review.js).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';
import { fakeDom } from './aidlc-turbo-design-fake-dom';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const DESIGN_DIR = path.join(FLOW, 'templates/design');
const SCRIPT = path.join(FLOW, 'scripts/intent-overview.cjs');
const req = createRequire(import.meta.url);
const overview = req(SCRIPT);
const render = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const paths = req(path.join(FLOW, 'scripts/lib/paths.cjs'));
const { designModel } = req(path.join(FLOW, 'scripts/lib/design-model.cjs'));
const ENGINE = readFileSync(path.join(DESIGN_DIR, 'design-engine.js'), 'utf8');
const PANEL = readFileSync(path.join(DESIGN_DIR, 'design-panel.js'), 'utf8');
const REVIEW = readFileSync(path.join(DESIGN_DIR, 'design-review.js'), 'utf8');
const DRAWING = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');
const DATA = /<script id="overview-data" type="application\/json">([\s\S]*?)<\/script>/;

/** The template intent with the order status drawing, story 001 built: it changed its parts and added a file. */
function built() {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-plan-')), '.specs-aidlc-turbo');
  const dir = path.join(root, 'docs', 'user-auth', 'user-auth');
  mkdirSync(path.join(root, 'repo'), { recursive: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(root, 'repo', 'config.yaml'), 'mode: sandbox\n');
  const record = render.parseYaml(readFileSync(path.join(FLOW, 'templates/inception/record-template.yaml'), 'utf8'));
  const src = render.parseYaml(readFileSync(DRAWING, 'utf8'));
  record.technical_design = { ...(record.technical_design || {}), drawing: src.technical_design.drawing };
  record.stories[0].drawing = src.stories[0].drawing;
  const model = designModel(record);
  const files = Object.keys(model.stories[0].builds).map((id: string) => model.parts.find((p: any) => p.id === id))
    .filter(Boolean).map((p: any) => p.path);
  // the files of the drawing it built, and one of its own in a drawn module: that one the build adds to the drawing
  const java = files.find((f: string) => f.endsWith('.java')) || files[0];
  record.stories[0].changed_files = [...files, `${path.posix.dirname(java)}/Cache.java`];
  writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
  const intent = paths.findIntent(root, 'user-auth');
  render.applyPlan(intent, render.planRender(intent));
  const file = path.join(intent.stories, readdirSync(intent.stories).find((n: string) => n.startsWith('001-'))!);
  writeFileSync(file, readFileSync(file, 'utf8').replace(/\n### Build notes\n[\s\S]*$/, '')
    + '\n### Build notes\n\n- **Built**: The API.\n- **Outside the Code Scaffold**: none.\n- **Different from the Code Scaffold**: none.\n- **Not built**: none.\n');
  return { root, intent };
}

describe('aidlc-turbo overview with --plan: the page data', () => {
  it('moves every part the build added out of the drawing, into the build Review reads', () => {
    const { root, intent } = built();
    const whole = overview.buildData(root, intent, 'construction').page;
    const added = whole.design.parts.filter((p: any) => p.build && p.build.state === 'added');
    expect(added.length).toBeGreaterThan(0);
    const plan = overview.buildData(root, intent, 'construction', { plan: true }).page;
    expect(plan.plan).toBe(true);
    // the drawing is mounted on page.design: the flag has to be there too, or the marks stay
    expect(plan.design.plan).toBe(true);
    expect(whole.design.plan).toBeUndefined();
    expect(whole.plan).toBeUndefined();
    expect(plan.design.parts.some((p: any) => p.build && p.build.state === 'added')).toBe(false);
    expect(Object.keys(plan.design.build.parts)).toEqual(added.map((p: any) => p.id));
    expect(plan.design.parts.map((p: any) => p.id)).toEqual(whole.design.parts.filter((p: any) => !added.includes(p)).map((p: any) => p.id));
    // the rest of the build is the same block: Review loses nothing
    expect({ ...plan.design.build, parts: undefined }).toEqual(whole.design.build);
  });

  it('is on the page the script writes, and it prints no build line', () => {
    const { root, intent } = built();
    const r = spawnSync(process.execPath, [SCRIPT, 'user-auth', '--no-open', '--root', root, '--phase', 'construction', '--plan'], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual([`Overview: ${intent.overview}`]);
    const page = JSON.parse(DATA.exec(readFileSync(intent.overview, 'utf8'))![1].replace(/<\\!--/g, '<!--'));
    expect(page.plan).toBe(true);
    expect(Object.keys(page.design.build.parts).length).toBeGreaterThan(0);
    // without --plan the page is the build itself, and the line comes
    const full = spawnSync(process.execPath, [SCRIPT, 'user-auth', '--no-open', '--root', root, '--phase', 'construction'], { encoding: 'utf8' });
    expect(full.status, full.stderr).toBe(0);
    expect(full.stdout).toContain('Code Scaffold:');
    expect(JSON.parse(DATA.exec(readFileSync(intent.overview, 'utf8'))![1].replace(/<\\!--/g, '<!--')).plan).toBeUndefined();
  });
});

describe('aidlc-turbo overview with --plan: the drawing', () => {
  const G = globalThis as any;
  let d: ReturnType<typeof fakeDom>;
  const load = (f: string) => { const file = path.join(DESIGN_DIR, f); delete req.cache[file]; return req(file); };
  const drawable = (n: any) => Object.assign(n, {
    appendChild: (c: any) => { n.append(c); return c; }, style: {}, after: () => {},
    getComputedTextLength: () => String(n.textContent || '').length * 7,
  });
  const fresh = () => designModel(render.parseYaml(readFileSync(DRAWING, 'utf8')));
  /** The drawing with one part built elsewhere and one the build added, as a plan and as the build itself. */
  function models() {
    const m = fresh();
    const p = m.parts.find((x: any) => x.layer);
    p.build = { state: 'different', story: '001', built: null, why: null };
    const loose = { id: 'cache', name: 'Cache', path: 'shop/src/Cache.java', module: p.module, layer: p.layer,
      status: 'new', kind: 'class', build: { state: 'added', story: '001', built: null, why: null } };
    const build = { stories: [], different: 1, extra: 1, gone: 0, changes: {}, diffs: {} };
    return {
      part: p, loose,
      whole: { ...m, parts: [...m.parts, loose], build },
      plan: { ...m, plan: true, build: { ...build, parts: { cache: loose } } },
    };
  }

  beforeEach(() => {
    d = fakeDom();
    d.doc.createElementNS = (_ns: string, tag: string) => drawable(d.node(tag));
    G.getComputedStyle = () => ({ fontSize: '14px' });
    G.TdKit = load('design-kit.js');
    G.TdBuild = load('design-built.js');
    G.TdFit = load('design-fit.js');
    G.TdDiff = load('design-diff.js');
    G.TdLabels = load('design-labels.js');
    G.TdEngine = load('design-engine.js');
    G.TdLayout = load('design-layout.js');
    G.TdReviewList = load('design-review-list.js');
    load('design-keys.js');
    delete G.localStorage;
  });

  it('carries no mark of the build: the engine marks a block only when the drawing is the build itself', () => {
    expect(ENGINE).toContain('const marks = built && !(model && model.plan);');
    expect(ENGINE).toContain('F.pillsOf(p, marks)');
    expect(ENGINE).toContain('drawBlock(gn, defs, b, parts.get(b.id), SIZE, built, marks)');
    // a part built elsewhere keeps its pill on the page of the build, and has none on the plan
    const { part } = models();
    expect(G.TdFit.pillsOf(part, true).map((x: any) => x.text)).toContain('different');
    expect(G.TdFit.pillsOf(part, false).map((x: any) => x.text)).not.toContain('different');
  });

  it('has no "After the build" group in its legend while a change is open', () => {
    const { whole, plan } = models();
    expect(G.TdKeys.legend(whole, true, false).innerHTML).toContain('After the build');
    expect(G.TdKeys.legend(plan, true, false).innerHTML).not.toContain('After the build');
    // the rest of the legend stays as it is
    for (const w of ['>Status<', '>Lines<', '>Other<']) expect(G.TdKeys.legend(plan, true, false).innerHTML).toContain(w);
  });

  it('shows no card of a deviation in the details of a block while a change is open, Review keeps it', () => {
    G.TdAbout = load('design-about.js');
    const { part, whole, plan } = models();
    expect(G.TdAbout.create(whole, { built: whole.build, order: [] }).deviation(part)).not.toBeNull();
    expect(G.TdAbout.create(plan, { built: plan.build, order: [] }).deviation(part)).toBeNull();
  });

  it('says above it that a change is open, where the page of the build says nothing', () => {
    expect(G.TdBuild.note('construction', true).textContent).toBe(G.TdBuild.NOTE.open);
    expect(G.TdBuild.NOTE.open).toMatch(/^A change is open\. This drawing shows the plan/);
    expect(G.TdBuild.NOTE.open).toContain('Review shows what is built already.');
    expect(G.TdBuild.note('construction', false).textContent).toBe(G.TdBuild.NOTE.built);
    expect(PANEL).toContain('const plan = !!built && !!model.plan;');
    expect(PANEL).toContain('if (!built || plan) rootEl.append(B().note(o.phase, plan));');
  });
});

describe('aidlc-turbo overview with --plan: Review', () => {
  const G = globalThis as any;
  const load = (f: string) => { const file = path.join(DESIGN_DIR, f); delete req.cache[file]; return req(file); };
  const fresh = () => designModel(render.parseYaml(readFileSync(DRAWING, 'utf8')));
  const ids = (rows: any[]) => rows.map((r) => r.id);

  beforeEach(() => {
    const d = fakeDom();
    d.doc.createElementNS = (_ns: string, tag: string) => d.node(tag);
    G.TdKit = load('design-kit.js');
    G.TdBuild = load('design-built.js');
    G.TdDiff = load('design-diff.js');
    G.TdLayout = load('design-layout.js');
    G.TdReviewList = load('design-review-list.js');
  });

  it('lists the part the build added as a file outside the drawing, with no way into it', () => {
    const m = fresh();
    const p = m.parts.find((x: any) => x.layer);
    p.build = { state: 'different', story: '001', built: null, why: null };
    const loose = { id: 'cache', name: 'Cache', path: 'shop/src/Cache.java', module: p.module, layer: p.layer,
      status: 'new', kind: 'class', build: { state: 'added', story: '001', built: null, why: null } };
    const build = { stories: [], different: 1, extra: 1, gone: 0, changes: {}, diffs: {} };
    const whole = G.TdReviewList.rows({ ...m, parts: [...m.parts, loose], build }, { built: true });
    const plan = G.TdReviewList.rows({ ...m, plan: true, build: { ...build, parts: { cache: loose } } }, { built: true });
    expect(ids(whole)).toContain('cache');
    expect(ids(plan).sort()).toEqual(ids(whole).sort());
    expect(plan.find((r: any) => r.id === 'cache').drawn).toBe(false);
    expect(plan.find((r: any) => r.id === p.id).drawn).toBe(true);
    expect(whole.find((r: any) => r.id === 'cache').drawn).toBe(true);
    // "View in the flow" only for a file the drawing holds
    expect(REVIEW).toContain("if (typeof o.onFlow === 'function' && r.drawn !== false && drawn.has(r.part.layer)) {");
  });
});
