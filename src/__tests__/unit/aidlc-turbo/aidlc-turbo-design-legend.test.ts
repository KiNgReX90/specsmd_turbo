/**
 * Unit tests for the walk over the Code Scaffold drawing and the legend
 * beside it:
 * - the panel beside the drawing holds only the legend: no switch, no list
 *   of steps; the walk over the drawing (design-steps.js) stays: play, "Choose
 *   a step", previous and next, numbered as the drawing is, over the
 *   chosen story's steps only (the details show where a step goes,
 *   aidlc-turbo-design-flowreview.test.ts);
 * - nothing is left of the list of steps, of the card that told the steps or
 *   of the tabs "Details | Steps", in the code or the style;
 * - the files it touches stay under 500 lines.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fakeDom } from './aidlc-turbo-design-fake-dom';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const DESIGN = path.join(FLOW, 'templates/design');
const req = createRequire(import.meta.url);
const read = (f: string) => { try { return readFileSync(path.join(DESIGN, f), 'utf8'); } catch { return ''; } };
const dm = req(path.join(FLOW, 'scripts/lib/design-model.cjs'));
const { parseYaml } = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const { layout } = req(path.join(DESIGN, 'design-layout.js'));
const FIXTURE = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');

const fresh = () => dm.designModel(parseYaml(readFileSync(FIXTURE, 'utf8')));
const model = fresh();
const geo = layout(model);

/** A script of the page, run again in this test's fake document (it reads its globals when it loads). */
function load(f: string) {
  const file = path.join(DESIGN, f);
  delete req.cache[file];
  return req(file);
}

let d: ReturnType<typeof fakeDom>;
beforeEach(() => {
  d = fakeDom();
  (globalThis as any).TdKit = load('design-kit.js');
  delete (globalThis as any).localStorage;
});

const text = (e: any) => (e ? e.textContent : null);
const first = (e: any, cls: string) => d.all(e, cls)[0] || null;

describe('aidlc-turbo Code Scaffold: the walk over the drawing and the legend beside it', () => {
  function steps() {
    const S = load('design-steps.js') && (globalThis as any).TdSteps;
    const svg = d.node('svg');
    const edges = geo.links.map((l: any) => ({ l, g: d.node('g'), lg: d.node('g') }));
    const nodes = model.parts.map((p: any) => ({ p, g: d.node('g') }));
    return { s: S.create(model, geo, svg, edges, nodes), svg, edges, nodes };
  }
  const at = (s: any) => text(first(s.nav, 'td-steps-at'));

  it('the panel beside the drawing holds only the legend: no switch, no list of steps', () => {
    const { s } = steps();
    const lg = d.node('div');
    lg.className = 'td-lg';
    s.legend(lg);
    expect(d.all(s.box, 'td-lg')).toEqual([lg]);
    for (const cls of ['td-sp', 'td-flow-g', 'td-steps-sw', 'td-sw-b', 'td-steps-sc', 'td-steps-story', 'td-flow-how']) expect(d.all(s.box, cls), cls).toEqual([]);
    expect(text(first(s.box, 'td-steps-t'))).toBe('Legend');
    expect(text(first(s.box, 'td-steps-rail'))).toBe('Legend');
  });

  it('walks the steps in the drawing\'s numbers, and tells the number of a step (with none held how many there are)', () => {
    const { s, edges } = steps();
    expect(at(s)).toBe('17 steps');
    expect(s.walk(1)).toBe(geo.flow.order[0]);
    expect(at(s)).toBe('Step 1 of 17');
    expect(s.number('api-ctrl')).toBe(5);
    s.pin('api-ctrl');
    expect(at(s)).toBe('Step 5 of 17');
    // its line lights up
    expect(edges.find((e: any) => e.l.id === 'api-ctrl').g.classList.contains('td-hot')).toBe(true);
  });

  it('with a story chosen walks only its steps, and lets go of a step it does not have', () => {
    const { s } = steps();
    s.pin('menu-host');
    s.filter(model.stories[0].links);
    expect(s.current()).toBeNull();
    expect(s.ids()).toEqual(geo.flow.order.filter((id: string) => model.stories[0].links.includes(id)));
    expect(s.walk(1)).toBe(s.ids()[0]);
    s.filter(null);
    expect(s.ids()).toEqual(geo.flow.order);
  });
});

describe('aidlc-turbo Code Scaffold: nothing of the list of steps or the card is left', () => {
  it('not in the code', () => {
    const STEPS = read('design-steps.js');
    for (const gone of ['td-sp', 'td-flow', 'td-steps-sw', 'showPane', 'td-steps-more', 'short:', 'how:', 'onClose', 'td-ctl-low', '--td-walk-w']) expect(STEPS, gone).not.toContain(gone);
    const VIEW = read('design-view.js');
    for (const gone of ['td-fs-stepsb', 'stepsOpen', 'closeSteps', 'td-steps-on', 'td-fs-playb', 'card']) expect(VIEW, gone).not.toContain(gone);
    const PANEL = read('design-panel.js');
    for (const gone of ['steps.short', 'steps.how', 'closeSteps', 'STEP_PV', 'STEPS_VIEW', 'TdCard', 'card.']) expect(PANEL, gone).not.toContain(gone);
    expect(read('design-card.js')).toBe('');
  });

  it('not in the style', () => {
    const css = ['design-steps.css', 'design-touch.css', 'maquette-draw.css', 'design.css', 'design-pane.css', 'design-about.css'].map(read).join('\n');
    for (const gone of ['.td-sp', '.td-flow-', '.td-steps-sw', '.td-sw-b', '.td-steps-sc', '.td-steps-more', '.td-steps-story', '.td-fs-stepsb', '.td-fs-playb', '.td-steps-on', '.td-steps-x', '.td-steps-rn',
      '.td-ctl-story', '.td-cs-head', '.td-cs-body', '.td-cs-item', '.td-cs-list', '.td-cs-fold', '.td-cs-route', '.td-cs-stap', '.td-cs-dev', '.td-ptab', '.td-dpane-steps', '.td-dtab-steps']) {
      expect(css, gone).not.toContain(gone);
    }
  });

  it('keeps every file it touches under 500 lines', () => {
    for (const f of ['design-steps.js', 'design-panel.js', 'design-view.js', 'design-play.js', 'design-show.js', 'design-about.js', 'design-stories.js']) {
      const n = read(f).split('\n').length;
      expect(n, f).toBeGreaterThan(1);
      expect(n, f).toBeLessThanOrEqual(500);
    }
  });
});
