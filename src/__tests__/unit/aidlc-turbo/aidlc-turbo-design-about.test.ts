/**
 * Unit tests for what a part's details say in plain words (design-about.js):
 * - the description: what it does (`what`) and, folded into it, what it
 *   does in the flow: the plain sentence of every step it takes part in, in
 *   step order, "In the flow: ... (step n)." for one, a short list for more
 *   (at most four, the numbers of the rest on one line); a step without a
 *   plain sentence is left out, and so is a module's flow;
 * - after the build one card "Different from the design", "Added during the
 *   build", "Not built" or "Not used" that says in short
 *   paragraphs what was planned, what was built and why; nothing for a part
 *   built as planned or before the build (more: aidlc-turbo-design-review-text.test.ts);
 * - after a colon the text goes on in lower case, a name keeps its capital.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fakeDom } from './aidlc-turbo-design-fake-dom';
import { load } from './aidlc-turbo-design-panel-mount';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const DESIGN = path.join(FLOW, 'templates/design');
const req = createRequire(import.meta.url);
const read = (f: string) => { try { return readFileSync(path.join(DESIGN, f), 'utf8'); } catch { return ''; } };
const dm = req(path.join(FLOW, 'scripts/lib/design-model.cjs'));
const { parseYaml } = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const { layout } = req(path.join(DESIGN, 'design-layout.js'));
const FIXTURE = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');
const fresh = () => dm.designModel(parseYaml(readFileSync(FIXTURE, 'utf8')));
const ORDER: string[] = layout(fresh()).flow.order;
const G = globalThis as any;

let d: ReturnType<typeof fakeDom>;
beforeEach(() => {
  d = fakeDom();
  G.TdKit = load('design-kit.js');
  G.TdBuild = load('design-built.js');
});
const text = (e: any) => (e ? e.textContent : null);
const first = (e: any, cls: string) => (e ? d.all(e, cls)[0] || null : null);
/** The model with a plain sentence on the steps named. */
const said = (sentences: Record<string, string>) => {
  const m = fresh();
  for (const l of m.links) if (sentences[l.id]) l.step = sentences[l.id];
  return m;
};
const about = (m: any, built: any = null) => load('design-about.js').create(m, { built, order: ORDER });

describe('aidlc-turbo Code Scaffold: what a part does, in its description', () => {
  it('says what it does', () => {
    const m = fresh();
    const p = m.parts.find((x: any) => x.id === 'trend');
    const el = about(m).about('part', p);
    expect(text(first(el, 'td-dwhat'))).toBe(p.what);
    expect(first(el, 'td-dflow')).toBeNull();
  });

  it('one step with a plain sentence: "In the flow: ... (step n)." in the same description', () => {
    const m = said({ 'uc-trend': 'The use cases ask for the trend of the orders.' });
    const el = about(m).about('part', m.parts.find((x: any) => x.id === 'trend'));
    expect(text(first(el, 'td-dflow'))).toBe('In the flow: the use cases ask for the trend of the orders (step 11).');
  });

  it('more steps: a short list in step order, from the part and to it', () => {
    const m = said({
      'trend-orders': 'The query counts the orders per hour.',
      'uc-trend': 'The use cases ask for the trend.',
      'trend-events': 'The query reads the status changes.',
    });
    const flow = first(about(m).about('part', m.parts.find((x: any) => x.id === 'trend')), 'td-dflow');
    expect(text(flow.children[0])).toBe('In the flow:');
    const items = flow.querySelectorAll('li').map(text);
    expect(items).toEqual(['The use cases ask for the trend (step 11).', 'The query reads the status changes (step 12).', 'The query counts the orders per hour (step 13).']);
  });

  it('code between backticks in a step shows as code, in one step and in the list', () => {
    const one = said({ 'uc-trend': 'The use cases read `ORDER_STATUS_EVENTS`.' });
    const p = first(about(one).about('part', one.parts.find((x: any) => x.id === 'trend')), 'td-dflow');
    expect(text(p)).toBe('In the flow: the use cases read ORDER_STATUS_EVENTS (step 11).');
    expect(text(first(p, 'td-cin'))).toBe('ORDER_STATUS_EVENTS');
    const more = said({ 'uc-trend': 'The use cases ask for the trend.', 'trend-events': 'The query reads the column `ose_status`.' });
    const flow = first(about(more).about('part', more.parts.find((x: any) => x.id === 'trend')), 'td-dflow');
    expect(flow.querySelectorAll('li').map(text)).toEqual(['The use cases ask for the trend (step 11).', 'The query reads the column ose_status (step 12).']);
    expect(d.all(flow, 'td-cin').map(text)).toEqual(['ose_status']);
  });

  it('at most four steps told, the numbers of the rest on one line', () => {
    const m = fresh();
    for (const l of m.links) if (l.from === 'page' || l.to === 'page') l.step = `Step of ${l.id}.`;
    const flow = first(about(m).about('part', m.parts.find((x: any) => x.id === 'page')), 'td-dflow');
    expect(flow.querySelectorAll('li').length).toBe(4);
    const nums = m.links.filter((l: any) => l.from === 'page' || l.to === 'page').map((l: any) => ORDER.indexOf(l.id) + 1).sort((a: number, b: number) => a - b);
    expect(nums.length).toBe(5);
    expect(text(first(flow, 'td-dflow-more'))).toBe(`Also in step ${nums[4]}.`);
    // more than one left: their numbers as a list
    Object.assign(m.links.find((l: any) => l.id === 'menu-host'), { to: 'page', step: 'The menu opens the page.' });
    const more = first(about(m).about('part', m.parts.find((x: any) => x.id === 'page')), 'td-dflow');
    expect(text(first(more, 'td-dflow-more'))).toBe(`Also in steps ${nums[3]} and ${nums[4]}.`);
  });

  it('leaves out a step without a plain sentence, and tells a module no flow', () => {
    const m = said({ 'uc-trend': 'The use cases ask for the trend.' });
    const flow = first(about(m).about('part', m.parts.find((x: any) => x.id === 'trend')), 'td-dflow');
    expect(text(flow)).not.toMatch(/step 12|step 13/);
    const mod = m.modules.find((x: any) => x.id === 'core');
    expect(first(about(m).about('module', mod), 'td-dflow')).toBeNull();
  });

  it('says nothing where there is nothing to say', () => {
    const m = fresh();
    expect(about(m).about('part', { id: 'x', name: 'X' })).toBeNull();
  });
});

describe('aidlc-turbo Code Scaffold: the deviation after the build, in short paragraphs', () => {
  const built = { stories: [] };
  const dev = (build: any, status = 'changed') => {
    const m = fresh();
    return about(m, built).deviation({ id: 'p', name: 'Parser', status, build });
  };
  /** Each paragraph of the card as "Label: text" (the label is a block of its own on the page). */
  const said = (el: any) => d.all(el, 'td-ddev-p').map((p: any) => `${text(first(p, 'td-ddev-k'))}: ${text(p.children[p.children.length - 1])}`);

  it('built otherwise: "Different from the design", then what was planned, what was built and why, each a paragraph', () => {
    const el = dev({ state: 'different', plan: 'The shared base of every parser.', built: 'Also refuses the empty list in ReturnShipmentProcessor.', why: 'The processor read the content before the parser ran.' });
    expect(el.className).toBe('td-ddev td-ddev-different');
    expect(text(first(el, 'td-ddev-t'))).toBe('Different from the design');
    expect(said(el)).toEqual(['Planned: The shared base of every parser.', 'Built: Also refuses the empty list in ReturnShipmentProcessor.', 'Why: The processor read the content before the parser ran.']);
    // no rows, no boxes in the card
    expect(d.all(el, 'td-dl')).toEqual([]);
  });

  it('came in during the build: "Added during the build", without Planned', () => {
    const el = dev({ state: 'added', plan: null, built: 'Keeps the answer per order.', why: 'The answer was read twice.' }, 'new');
    expect(text(first(el, 'td-ddev-t'))).toBe('Added during the build');
    expect(said(el)).toEqual(['Built: Keeps the answer per order.', 'Why: The answer was read twice.']);
  });

  it('not built: "Not built"; an existing part not used: "Not used"', () => {
    expect(text(first(dev({ state: 'gone', plan: 'The applications.', why: 'It is on the order already.' }, 'new'), 'td-ddev-t'))).toBe('Not built');
    const unused = dev({ state: 'gone', plan: 'the applications', why: 'it is on the order already' }, 'existing');
    expect(text(first(unused, 'td-ddev-t'))).toBe('Not used');
    expect(said(unused)).toEqual(['Planned: The applications.', 'Why: It is on the order already.']);
  });

  it('says so when the notes give no reason', () => {
    expect(said(dev({ state: 'added' }, 'new'))).toEqual(['Why: The build notes give no reason.']);
  });

  it('nothing for a part built as planned, or before the build', () => {
    expect(dev({ state: 'as_planned' })).toBeNull();
    const m = fresh();
    expect(about(m, null).deviation({ id: 'p', status: 'changed', build: { state: 'different', why: 'x' } })).toBeNull();
  });

  it('keeps the capital of a name after a colon', () => {
    const A = load('design-about.js');
    const names = ['WarehouseGatewayImpl', 'shop-core'];
    expect(A.low('Refuses the empty list.', names)).toBe('refuses the empty list.');
    expect(A.low('ReturnShipmentProcessor refuses it.', names)).toBe('ReturnShipmentProcessor refuses it.');
    expect(A.low('Warehouse knows the waiting time.', names)).toBe('Warehouse knows the waiting time.');
    expect(A.low('ORDER_STATUS_EVENTS gets a column.', names)).toBe('ORDER_STATUS_EVENTS gets a column.');
  });
});

describe('aidlc-turbo Code Scaffold: the step is no longer told in the details', () => {
  it('has no line of a step: the box over the drawing carries it (design-stepbox.js)', () => {
    expect(about(fresh()).step).toBeUndefined();
  });
});

describe('aidlc-turbo Code Scaffold: the description in the page', () => {
  it('is inlined before the details, and stays under 500 lines without a long dash', () => {
    const assets = req(path.join(FLOW, 'scripts/lib/design-assets.cjs'));
    const at = (f: string) => assets.DESIGN_JS.indexOf(f);
    expect(at('design-about.js')).toBeGreaterThan(at('design-built.js'));
    expect(at('design-about.js')).toBeLessThan(at('design-detail.js'));
    const src = read('design-about.js');
    expect(src.split('\n').length).toBeLessThanOrEqual(500);
    expect(src).not.toMatch(/—/);
  });
});
