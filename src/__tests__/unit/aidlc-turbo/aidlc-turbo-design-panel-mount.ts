/**
 * The Code Scaffold panel (design-panel.js) as the page mounts it, in the
 * fake document of aidlc-turbo-design-fake-dom.ts: the real walk, play, the
 * details, what they show, their stories, the walk between the parts, the
 * block in an arrow's direction, what the pointer and the keys do, what
 * lights up, the room of the view and the details panel; the drawing, the
 * view and the legend stubbed. For the tests of what the panel shows and what the arrows
 * walk.
 */

import { createRequire } from 'module';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const DESIGN = path.join(FLOW, 'templates/design');
const req = createRequire(import.meta.url);
const G = globalThis as any;

/** A script of the page, run again in the test's fake document (it reads its globals when it loads). */
export function load(f: string) {
  const file = path.join(DESIGN, f);
  delete req.cache[file];
  return req(file);
}

/** The document as the panel needs it: remove and insertBefore, buttons with an icon and a label (play reads them), keys aimed at elements. */
export function dress(d: any) {
  const make = d.doc.createElement;
  d.doc.createElement = (t: string) => {
    const e = make(t);
    e.remove = () => { if (e.parent) e.parent.children = e.parent.children.filter((c: any) => c !== e); };
    e.insertBefore = (x: any, ref: any) => { const i = e.children.indexOf(ref); e.children.splice(i < 0 ? e.children.length : i, 0, x); x.parent = e; };
    if (t === 'button') { const i = make('svg'), s = make('span'); Object.defineProperty(e, 'firstChild', { get: () => i }); Object.defineProperty(e, 'lastChild', { get: () => s }); }
    return e;
  };
  G.Element = { [Symbol.hasInstance]: (x: any) => !!(x && x.tag) };
  Object.assign(G, { requestAnimationFrame: () => 0, cancelAnimationFrame() {} });
  G.TdKit = load('design-kit.js');
  delete G.localStorage;
}

/**
 * Mounts the panel for `model` drawn as `geo`; `phase` 'construction' with model.build is the page after the
 * build. `start` is what a drawing made again takes over (snap()); `onReview` hears "See the change".
 */
export function mountPanel(d: any, model: any, geo: any, o: { phase?: string; start?: any; stories?: any; onReview?: (id: string) => void } = {}) {
  for (const f of ['design-steps.js', 'design-play.js']) load(f);
  G.TdBuild = load('design-built.js');
  G.TdDiff = load('design-diff.js');
  G.TdAbout = load('design-about.js');
  G.TdStories = load('design-stories.js');
  G.TdShow = load('design-show.js');
  G.TdChosen = load('design-chosen.js');
  G.TdBrowse = load('design-browse.js');
  G.TdPane = load('design-pane.js');
  G.TdSwap = load('design-swap.js');
  G.TdLight = load('design-light.js');
  G.TdRoom = load('design-room.js');
  G.TdNear = load('design-near.js');
  G.TdStepBox = load('design-stepbox.js');
  G.TdInput = load('design-input.js');
  G.TdLayout = { layout: () => geo, SIZE: {} };
  const drawn: any = {};
  const box = () => Object.assign(d.node('g'), { getBoundingClientRect: () => ({ top: 10, bottom: 20, left: 0, right: 10, width: 10, height: 10 }) });
  G.TdEngine = {
    ...load('design-engine.js'), kindOf: (k: string) => k,
    draw: () => {
      // a block: it has the class the page gives it, and closest() finds it as the block it is
      const block = () => { const g = box(); g.className = 'td-node'; g.matches = (sel: string) => (sel.split(',').some((x) => x.trim() === '.td-node') ? g : null); return g; };
      drawn.nodes = model.parts.map((p: any) => ({ p, g: block(), nb: d.node('text') }));
      drawn.edges = geo.links.map((l: any) => ({ l, g: box(), lg: box() }));
      drawn.frames = [];
      drawn.steps = G.TdSteps.create(model, geo, d.node('svg'), drawn.edges, drawn.nodes);
      return drawn;
    },
  };
  G.TdKeys = { legend: () => d.node('div'), asks: () => d.node('div') };
  G.TdView = { touchy: () => false, create: () => ({ isOpen: () => false, open() {}, close() {}, reveal() {}, roomFor() {}, focus() {}, refit() {} }) };
  delete G.TdFilter;
  Object.assign(G, { innerWidth: 1800, innerHeight: 1000, addEventListener() {}, location: { hash: '' } });
  load('design-detail.js');
  load('design-panel.js');
  const root = d.node('div');
  const api = G.CodeScaffold.mount(root, model, { titles: {}, phase: o.phase || 'inception', start: o.start, stories: o.stories || {}, onReview: o.onReview });
  const first = (cls: string) => d.all(root, cls)[0] || null;
  const detail = first('td-detail');
  const node = (id: string) => drawn.nodes.find((n: any) => n.p.id === id).g;
  return {
    api, root, drawn, steps: drawn.steps, detail, node,
    pane: first('td-dpane'),
    /** The step box over the drawing (design-stepbox.js). */
    box: () => first('td-sbox'),
    chosen: (id: string) => node(id).classList.contains('td-sel'),
    line: (id: string) => drawn.edges.find((e: any) => e.l.id === id).g.click(),
    blank: () => first('td-dz').click(),
    play: () => first('td-steps-play').click(),
    /** The details shown now (not the old ones fading out), or null while the panel shows its calm word. */
    shown: () => (detail.hidden ? null : (detail.children.filter((c: any) => c && c.classList && !c.classList.contains('td-dgone'))[0] || null)),
  };
}
