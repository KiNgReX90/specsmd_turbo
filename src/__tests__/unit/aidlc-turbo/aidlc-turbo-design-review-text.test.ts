/**
 * Unit tests for what the details say of a block chosen in Review after the build (design-detail.js,
 * design-about.js, design-built.js, lib/design-build.cjs):
 * - the head has no word of the build any more ("different", "added", "not built", "not used"): the
 *   drawing keeps its own marks;
 * - the description is short sections in plain words: "What it does" (what, a few sentences) and,
 *   after the build, for a part a story built or changed, "What changed": per story what its
 *   builder wrote under **What changed** in the build notes, else what the story's drawing says it
 *   builds there; the builder's text of one story alone, else each under its story's number and short
 *   title;
 *   a deviation and "In the flow" after them;
 * - the build notes' **What changed** item is read, and matched to a part by its path, by its name or
 *   by the name of its file, also a part that came in during the build;
 * - a deviation is one calm card: the icon of the legend and a heading, then Planned, Built and
 *   Why, each a paragraph with its label in semibold; Planned is what the story's drawing says it
 *   builds there;
 * - the plan page shows neither the change nor a card;
 * - the flow's instructions ask for it: what in a few sentences at inception, **What changed** in
 *   the build notes.
 * The texts of the page are the English string table's (design.* of templates/lang/en.json).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fakeDom } from './aidlc-turbo-design-fake-dom';
import { load, dress, mountPanel } from './aidlc-turbo-design-panel-mount';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const DESIGN = path.join(FLOW, 'templates/design');
const req = createRequire(import.meta.url);
const read = (f: string) => readFileSync(path.join(DESIGN, f), 'utf8');
const flow = (rel: string) => readFileSync(path.join(FLOW, rel), 'utf8').replace(/\s+/g, ' ');
const dm = req(path.join(FLOW, 'scripts/lib/design-model.cjs'));
const { buildNotesOf, applyBuild } = req(path.join(FLOW, 'scripts/lib/design-build.cjs'));
const { parseYaml } = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const { layout } = req(path.join(DESIGN, 'design-layout.js'));
const FIXTURE = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');
const EN = JSON.parse(readFileSync(path.join(FLOW, 'templates/lang/en.json'), 'utf8')).design;
const fresh = (built = false) => dm.designModel(parseYaml(readFileSync(FIXTURE, 'utf8')), { built });
const ORDER: string[] = layout(fresh()).flow.order;
const G = globalThis as any;

const ADAPTERS = 'shop-orderstatus-adapters/src/main/java/com/acme/shop/orderstatus/adapters';
const TREND = `${ADAPTERS}/outbound/db/OrderTrendQuery.java`;
const CTRL = `${ADAPTERS}/inbound/web/OrderStatusController.java`;
/** The build notes of a story: the Built line, the given What changed item and the three lines after it. */
const notes = (changed: string, more = '') => `## For the agent\n\n### Build notes\n\n- **Files changed**: x\n- **Built**: Built.\n- **What changed**:${changed}\n`
  + `- **Outside the Code Scaffold**: none.\n- **Different from the Code Scaffold**: none.\n- **Not built**: none.\n${more}`;
/** The fixture after the build of story 2 and 3, which both build `trend`, with these notes. */
const built = (n2: string, n3: string | null = null) => applyBuild(fresh(true), [
  { id: '002', files: [TREND, CTRL], notes: n2 },
  ...(n3 === null ? [] : [{ id: '003', files: [TREND, CTRL], notes: n3 }]),
]);
const part = (m: any, id: string) => m.parts.find((p: any) => p.id === id);
/** The notes with trend built otherwise than drawn. */
const DIFFERENT = (n: string) => n.replace('- **Different from the Code Scaffold**: none.', `- **Different from the Code Scaffold**:\n  - \`${TREND}\`: Counts per day. Why: per hour was too fine.`);
/** The labels of the lines of a deviation card. */
const P = EN.built.planned, B = EN.built.builtLabel, W = EN.built.why;

let d: ReturnType<typeof fakeDom>;
beforeEach(() => {
  d = fakeDom();
  G.TdKit = load('design-kit.js');
  G.TdBuild = load('design-built.js');
  delete G.TdEngine;
});
const text = (e: any) => (e ? e.textContent : null);
const first = (e: any, cls: string) => (e ? d.all(e, cls)[0] || null : null);
const about = (m: any, b: any = null) => load('design-about.js').create(m, { built: b, order: ORDER });
const cls = (e: any) => String(e.className || '').split(' ')[0];

describe('aidlc-turbo Code Scaffold: the build notes say what changed in each file', () => {
  it('reads the What changed item: the path in backticks first, then its sentences, also where they wrap', () => {
    const md = notes(`\n  - \`${TREND}\`: OrderTrendQuery now counts per hour.\n    It reads the two tables at once.\n  - \`OrderStatusController\`: The controller hands the trends on.`);
    expect(buildNotesOf(md).changed).toEqual([
      { path: TREND, text: 'OrderTrendQuery now counts per hour. It reads the two tables at once.' },
      { path: 'OrderStatusController', text: 'The controller hands the trends on.' },
    ]);
    expect(buildNotesOf(md).built).toBe('Built.');
    expect(buildNotesOf(notes(' none.')).changed).toEqual([]);
    expect(buildNotesOf(notes(` \`${TREND}\`: Counts per hour.`)).changed).toEqual([{ path: TREND, text: 'Counts per hour.' }]);
    // older notes have no such line
    expect(buildNotesOf('### Build notes\n\n- **Built**: x.\n').changed).toEqual([]);
  });

  it('puts the text on the build per part and story, matched by the path, the name of the part or the name of its file', () => {
    const m = built(
      notes(`\n  - \`${TREND}\`: New in story 2. Counts per hour.\n  - \`OrderStatusController\`: Hands the trends on.\n  - \`nowhere/Loose.java\`: Belongs to no part.`),
      notes(`\n  - \`${ADAPTERS}/outbound/db/history/OrderTrendQuery.java\`: Now reads the history too.`),
    );
    expect(m.build.changes.trend).toEqual([{ story: '002', text: 'New in story 2. Counts per hour.' }, { story: '003', text: 'Now reads the history too.' }]);
    expect(m.build.changes.ctrl).toEqual([{ story: '002', text: 'Hands the trends on.' }]);
    expect(Object.keys(m.build.changes).sort()).toEqual(['ctrl', 'trend']);
  });

  it('matches a part that came in during the build, by the path of its file', () => {
    const extra = `${ADAPTERS}/outbound/db/TrendCache.java`;
    const m = applyBuild(fresh(true), [{ id: '002', files: [TREND, extra],
      notes: notes(`\n  - \`${extra}\`: A new cache. Keeps the trend for a minute.`, '').replace('- **Outside the Code Scaffold**: none.', `- **Outside the Code Scaffold**:\n  - \`${extra}\`: Keeps the trend. Why: faster.`) }]);
    const added = m.parts.find((p: any) => p.path === extra);
    expect(added.build.state).toBe('added');
    expect(m.build.changes[added.id]).toEqual([{ story: '002', text: 'A new cache. Keeps the trend for a minute.' }]);
  });

  it('plans a deviation from what the story\'s drawing says it builds there, not from the long description', () => {
    const m = built(DIFFERENT(notes(' none.')));
    expect(part(m, 'trend').build).toMatchObject({ state: 'different', plan: 'new, counts per hour', built: 'Counts per day.', why: 'per hour was too fine.' });
  });
});

describe('aidlc-turbo Code Scaffold: the head after the build has no word of the build', () => {
  function head(p: any) {
    G.TdEngine = { ...load('design-engine.js'), kindOf: (k: string) => k };
    load('design-detail.js');
    const m = { parts: [p], modules: [], stories: [], links: [] };
    return G.TdDetail.create(m, { built: { stories: [] }, titleOf: (s: any) => s.title, order: [] }).part(p)[0];
  }

  it('shows the state and the kind, never different, added, not built or not used', () => {
    for (const [status, state] of [['changed', 'different'], ['new', 'added'], ['new', 'gone'], ['existing', 'gone']]) {
      const h = head({ id: 'p', name: 'Parser', kind: 'class', status, module: 'none', build: { state, plan: 'x', why: 'y' } });
      const pills = first(h, 'td-pills');
      expect(d.all(pills, 'td-built'), state).toEqual([]);
      expect(pills.children.map(cls), state).toEqual(['td-pill', 'td-kind']);
      expect(text(pills), state).not.toMatch(/different|added|not built|not used/i);
    }
  });

  it('keeps the mark on the drawing', () => {
    const FIT = req(path.join(DESIGN, 'design-fit.js'));
    expect(FIT.pillsOf({ kind: 'class', build: { state: 'different' } }, true).map((x: any) => x.text)).toEqual(['class', EN.built.pills.different]);
  });
});

describe('aidlc-turbo Code Scaffold: What it does and What changed', () => {
  const N2 = `\n  - \`${TREND}\`: OrderTrendQuery is new. It counts the orders per hour from the two tables.`;
  const N3 = `\n  - \`${TREND}\`: The query now reads the history of an order too. So the Orders tab shows every status change.`;
  const S2 = 'OrderTrendQuery is new. It counts the orders per hour from the two tables.';
  const S3 = 'The query now reads the history of an order too. So the Orders tab shows every status change.';

  it('after the build: the two sections with their heading, then the flow, in that order', () => {
    const m = built(notes(N2));
    m.links.find((l: any) => l.id === 'uc-trend').step = 'The use cases ask for the trend.';
    const el = about(m, m.build).about('part', part(m, 'trend'));
    expect(el.children.map(cls)).toEqual(['td-dsec', 'td-dsec', 'td-dflow']);
    expect(d.all(el, 'td-dsec-t').map(text)).toEqual([EN.about.what, EN.about.changed]);
    expect(d.all(el, 'td-dsec-t').map((h: any) => h.tag)).toEqual(['h4', 'h4']);
    expect(text(first(el, 'td-dwhat'))).toBe(part(m, 'trend').what);
    // one story: its text alone, without a label
    const chg = first(el, 'td-dchg');
    expect(d.all(chg, 'td-dchg-p').map(text)).toEqual([S2]);
    expect(first(chg, 'td-dchg-n')).toBeNull();
  });

  it('several stories: each under its number and short title, in story order', () => {
    const m = built(notes(N2), notes(N3));
    const chg = first(about(m, m.build).about('part', part(m, 'trend')), 'td-dchg');
    const labels = d.all(chg, 'td-dchg-n');
    expect(labels.map((l: any) => text(first(l, 'td-badge')))).toEqual(['2', '3']);
    expect(labels.map((l: any) => text(l.children[1]))).toEqual(['Overview', 'Orders']);
    expect(d.all(chg, 'td-dchg-p').map(text)).toEqual([S2, S3]);
  });

  it('without a text from the builder: what the story\'s drawing says it builds there, per story, so it is never empty', () => {
    const m = built(notes(' none.'), notes(N3));
    const chg = first(about(m, m.build).about('part', part(m, 'trend')), 'td-dchg');
    expect(d.all(chg, 'td-dchg-p').map(text)).toEqual(['New, counts per hour.', S3]);
    // an intent built before the builders wrote it: only the drawing's words
    const old = applyBuild(fresh(true), [{ id: '002', files: [TREND, CTRL], notes: '### Build notes\n\n- **Built**: x.\n' }, { id: '003', files: [TREND, CTRL] }]);
    const was = first(about(old, old.build).about('part', part(old, 'trend')), 'td-dchg');
    expect(d.all(was, 'td-dchg-p').map(text)).toEqual(['New, counts per hour.', 'Adds the history of an order.']);
  });

  it('only for what a built story built or changed: not a story still to build, not a part not built, not a part only used', () => {
    const m = built(notes(' none.'));
    // story 3 is not built yet: story 2 alone, in the words of its drawing, so under its number and title
    const chg = first(about(m, m.build).about('part', part(m, 'trend')), 'td-dchg');
    expect(d.all(chg, 'td-dchg-p').map(text)).toEqual(['New, counts per hour.']);
    expect(d.all(chg, 'td-dchg-n').map((l: any) => [text(first(l, 'td-badge')), text(l.children[1])])).toEqual([['2', 'Overview']]);
    const gone = { ...part(m, 'trend'), build: { state: 'gone', why: 'x' } };
    expect(first(about(m, m.build).about('part', gone), 'td-dchg')).toBeNull();
    // orders: a table the stories only use
    expect(first(about(m, m.build).about('part', part(m, 'orders')), 'td-dchg')).toBeNull();
  });

  it('writes code in the text as code', () => {
    const m = built(notes(`\n  - \`${TREND}\`: Now calls \`countPerHour(from, to)\` instead.`));
    const p = first(first(about(m, m.build).about('part', part(m, 'trend')), 'td-dchg'), 'td-dchg-p');
    expect(text(p)).toBe('Now calls countPerHour(from, to) instead.');
    expect(d.all(p, 'td-cin').map(text)).toEqual(['countPerHour(from, to)']);
    // a name in code stays whole: no break at its capitals
    expect(first(p, 'td-cin').children.filter((c: any) => c.tag === 'wbr')).toEqual([]);
  });

  it('the plan page: only What it does, with the whole what; no change, no card', () => {
    const m = fresh();
    const p = part(m, 'trend');
    p.what = 'OrderTrendQuery counts orders per hour. It reads the two order tables. The use cases hand it to the screen.';
    const el = about(m, null).about('part', p);
    expect(d.all(el, 'td-dsec-t').map(text)).toEqual([EN.about.what]);
    expect(text(first(el, 'td-dwhat'))).toBe(p.what);
    expect(first(el, 'td-dchg')).toBeNull();
    expect(first(el, 'td-ddev')).toBeNull();
  });

  it('in the panel: Review after the build shows both, the plan page only the first', () => {
    dress(d);
    const m = built(notes(N2));
    const after = mountPanel(d, m, layout(m), { phase: 'construction' });
    after.node('trend').click();
    expect(d.all(after.shown(), 'td-dsec-t').map(text)).toEqual([EN.about.what, EN.about.changed]);
    d = fakeDom();
    dress(d);
    const plan = fresh();
    const before = mountPanel(d, plan, layout(plan));
    before.node('trend').click();
    expect(d.all(before.shown(), 'td-dsec-t').map(text)).toEqual([EN.about.what]);
  });
});

describe('aidlc-turbo Code Scaffold: the deviation as one calm card', () => {
  const dev = (build: any, status = 'changed') => about(fresh(), { stories: [] }).deviation({ id: 'p', name: 'Parser', status, build });
  /** Each line of the card: its label and its text. */
  const lines = (el: any) => d.all(el, 'td-ddev-p').map((p: any) => [text(first(p, 'td-ddev-k')), text(p.children[p.children.length - 1])]);

  it('built otherwise: its heading with the icon of the legend, then Planned, Built and Why, each a paragraph', () => {
    const icons: any[] = [];
    G.TdEngine = { buildIcon: (svg: any, x: number, y: number, s: string, t: string) => icons.push([svg, x, y, s, t]) };
    const el = dev({ state: 'different', plan: 'refuses an empty list too', built: 'Refuses the empty list in `JournalMessageProcessor` too.', why: 'the processor read the content already.' });
    expect(el.className).toBe('td-ddev td-ddev-different');
    expect(el.getAttribute('role')).toBe('group');
    expect(el.getAttribute('aria-label')).toBe(EN.about.different);
    const t = first(el, 'td-ddev-t');
    expect(t.tag).toBe('h4');
    expect(text(t)).toBe(EN.about.different);
    expect(icons.map(([, x, y, s, tip]) => [x, y, s, tip])).toEqual([[0, 0, 'different', '']]);
    expect(String(icons[0][0].className)).toContain('td-ddev-i');
    expect(lines(el)).toEqual([[P, 'Refuses an empty list too.'], [B, 'Refuses the empty list in JournalMessageProcessor too.'], [W, 'The processor read the content already.']]);
    expect(d.all(el, 'td-ddev-k').map((b: any) => b.tag)).toEqual(['b', 'b', 'b']);
    expect(d.all(el, 'td-cin').map(text)).toEqual(['JournalMessageProcessor']);
    // no box in the box
    expect(d.all(el, 'td-dl')).toEqual([]);
  });

  it('only the lines that apply: no Planned for what came in, no Built for what was not built or used', () => {
    const added = dev({ state: 'added', built: 'Keeps the reply per message.', why: 'The reply was read twice.' }, 'new');
    expect(text(first(added, 'td-ddev-t'))).toBe(EN.about.added);
    expect(lines(added).map(([k]) => k)).toEqual([B, W]);
    const gone = dev({ state: 'gone', plan: 'The applications.', built: 'x', why: 'It is on the message already.' }, 'new');
    expect(text(first(gone, 'td-ddev-t'))).toBe(EN.about.gone);
    expect(lines(gone)).toEqual([[P, 'The applications.'], [W, 'It is on the message already.']]);
    expect(text(first(dev({ state: 'gone', why: 'x' }, 'existing'), 'td-ddev-t'))).toBe(EN.about.unused);
    expect(lines(dev({ state: 'added' }, 'new'))).toEqual([[W, EN.built.noReason]]);
  });

  it('leaves out a Planned or Built that only says again what the sections above say, never Why', () => {
    const m = built(DIFFERENT(notes(' none.')));
    // Planned is the story's words "new, counts per hour", which "What changed" already tells for this old notes
    const el = about(m, m.build).about('part', part(m, 'trend'));
    expect(lines(first(el, 'td-ddev'))).toEqual([[B, 'Counts per day.'], [W, 'Per hour was too fine.']]);
    // with the builder's own text the plan says something new and stays
    const told = built(DIFFERENT(notes(`\n  - \`${TREND}\`: OrderTrendQuery now counts per day.`)));
    expect(lines(first(about(told, told.build).about('part', part(told, 'trend')), 'td-ddev')).map(([k]) => k)).toEqual([P, B, W]);
    const same = { ...part(m, 'trend'), build: { state: 'different', plan: 'x', built: part(m, 'trend').what, why: part(m, 'trend').what } };
    expect(lines(first(about(m, m.build).about('part', same), 'td-ddev')).map(([k]) => k)).toEqual([P, W]);
  });

  it('sits after the change and before the flow', () => {
    const m = built(DIFFERENT(notes(' none.')));
    m.links.find((l: any) => l.id === 'uc-trend').step = 'The use cases ask for the trend.';
    expect(about(m, m.build).about('part', part(m, 'trend')).children.map(cls)).toEqual(['td-dsec', 'td-dsec', 'td-ddev', 'td-dflow']);
  });

  it('is styled calm in the page\'s tokens: a tint and a thin line, no dashes, no shadow, no box in it', () => {
    const css = read('design-about.css');
    const rule = (sel: string) => { const m = new RegExp(`(?:^|\\n)${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`).exec(css); return m ? m[1] : ''; };
    expect(rule('.td-ddev')).toMatch(/background: color-mix\(in srgb, var\(--td-dv\) \d+%, var\(--td-surface\)\)/);
    expect(rule('.td-ddev')).toMatch(/border: 1px solid color-mix\(in srgb, var\(--td-dv\) \d+%, transparent\)/);
    expect(css).not.toMatch(/\.td-ddev[^{]*\{[^}]*dashed/);
    expect(rule('.td-ddev-p')).not.toMatch(/border|background/);
    expect(rule('.td-ddev-k')).toMatch(/display: block/);
    expect(rule('.td-ddev-k')).toMatch(/font: 6[05]0 /);
    for (const s of ['added', 'gone']) expect(css).toContain(`.td-ddev.td-ddev-${s} { --td-dv: var(--td-bi-${s}); }`);
    // the Maquette look adds no raised or dashed box of its own
    expect(read('maquette-draw.css')).not.toMatch(/\.td-ddev/);
  });
});

describe('aidlc-turbo Code Scaffold: the flow asks for the texts', () => {
  const BUILDERS = ['commands/aidlc-turbo-builder.md', 'commands/aidlc-turbo-builder-low.md', 'skills/construction/build-story.md'];

  it('inception writes what in two to four plain sentences for every part', () => {
    const plan = flow('skills/inception/plan.md');
    expect(plan).toContain('`what`, two to four plain sentences on what the part is and does and its role in the application, for every part, new, changed or existing');
    expect(plan).not.toContain('`what`, one or two plain sentences');
    const tpl = readFileSync(path.join(FLOW, 'templates/inception/record-template.yaml'), 'utf8');
    const whats = [...tpl.matchAll(/what: "([^"]+)"/g)].map((x) => x[1]);
    expect(whats.length).toBeGreaterThanOrEqual(3);
    for (const w of whats) expect(w.split(/(?<=[.!?])\s+/).length, w).toBeGreaterThanOrEqual(2);
  });

  it('the builder writes per file what changed and why, in a line the overview reads', () => {
    for (const rel of BUILDERS) {
      const t = flow(rel);
      expect(t, rel).toContain('- **Built**: A user with an expired session');
      expect(t, rel).toContain('- **What changed**: - `src/auth/login.ts`:');
      expect(t, rel).toContain('The last five lines are always there, in this order');
      expect(t, rel).toContain('**What changed**: per part of the Code Scaffold the story built or changed, and per file outside it, one sub-bullet: the path in backticks first, as the story\'s `### Code Scaffold` shows it for that part, then two to four plain sentences on what changed in that file and why');
    }
    expect(flow('templates/inception/story-template.md')).toContain('**What changed**');
    expect(flow('skills/construction/review.md')).toContain('**What changed**');
  });
});
