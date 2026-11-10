/**
 * Unit tests for the stories under the details of a part or a module
 * (design-stories.js), the chips the card of the steps had before it went:
 * - a chip per story, number and short title, under "Story" or "Stories";
 * - a chip folds out the story's full title (a way to choose it in the
 *   drawing), its user story and, after the build, what it built; one at a
 *   time; again folds it in; the chips and the names say what a click does;
 * - the story chosen in the drawing is marked, also on chips already shown.
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
const FIXTURE = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');
const model = dm.designModel(parseYaml(readFileSync(FIXTURE, 'utf8')));
const G = globalThis as any;

let d: ReturnType<typeof fakeDom>;
beforeEach(() => {
  d = fakeDom();
  G.TdKit = load('design-kit.js');
});
const text = (e: any) => (e ? e.textContent : null);
const first = (e: any, cls: string) => (e ? d.all(e, cls)[0] || null : null);
const told = {
  '002': { story: { asA: 'shop manager', iWant: 'an overview', soThat: 'I can step in' }, built: 'The overview with the tiles.' },
  '003': { story: { asA: 'tester', iWant: 'to see the orders', soThat: 'I can follow them' } },
};
const of = (...ns: number[]) => model.stories.filter((s: any) => ns.includes(Number(s.n)));

function stories(o: { built?: any; story?: any; chose?: any[] } = {}) {
  const state = { story: o.story || null };
  const s = load('design-stories.js').create({ model, built: o.built || null, told, titleOf: (x: any) => `${x.title} (full)`,
    story: () => state.story, choose: (x: any) => (o.chose || []).push(x) });
  return { s, state };
}
const chips = (f: any) => d.all(f, 'td-cs-s');
const open = (f: any) => chips(f).map((b: any) => b.getAttribute('aria-expanded'));

describe('aidlc-turbo Code Scaffold: the stories under the details', () => {
  it('a chip per story, number and short title, under Stories; one story: Story', () => {
    const { s } = stories();
    const f = s.foot(of(2, 3));
    expect(text(first(f, 'td-cs-lead'))).toBe('Stories');
    expect(chips(f).map((b: any) => [text(first(b, 'td-badge')), text(first(b, 'td-cs-t'))])).toEqual([['2', 'Overview'], ['3', 'Orders']]);
    for (const b of chips(f)) { expect(b.tag).toBe('button'); expect(b.getAttribute('aria-controls')).toBeTruthy(); }
    expect(text(first(s.foot(of(1)), 'td-cs-lead'))).toBe('Story');
    expect(s.foot([])).toBeNull();
  });

  it('a chip folds out the story: its title, its user story, after the build what it built; one at a time', () => {
    const { s } = stories({ built: { stories: [] } });
    const f = s.foot(of(2, 3));
    expect(open(f)).toEqual(['false', 'false']);
    expect(first(f, 'td-cs-more').hidden).toBe(true);
    chips(f)[0].click();
    expect(open(f)).toEqual(['true', 'false']);
    expect(text(first(f, 'td-cs-name'))).toBe('Overview (full)');
    expect(text(first(f, 'td-cs-us'))).toContain('an overview');
    expect(text(first(f, 'td-cs-built'))).toBe('The overview with the tiles.');
    chips(f)[1].click();
    expect(open(f)).toEqual(['false', 'true']);
    expect(text(first(f, 'td-cs-us'))).toContain('to see the orders');
    chips(f)[1].click();
    expect(open(f)).toEqual(['false', 'false']);
    expect(d.all(f, 'td-cs-us')).toEqual([]);
  });

  it('before the build a story folds out without Built', () => {
    const { s } = stories();
    const f = s.foot(of(2));
    chips(f)[0].click();
    expect(text(f)).not.toContain('Built');
  });

  it('the chips and the names say what a click does; the name of a story not chosen chooses it', () => {
    const chose: any[] = [];
    const { s } = stories({ chose });
    const f = s.foot(of(2));
    expect(chips(f)[0].title).toBe('Show the user story of story 2: Overview (full)');
    chips(f)[0].click();
    expect(chips(f)[0].title).toBe('Fold story 2: Overview (full)');
    const name = first(f, 'td-cs-name');
    expect(name.title).toBe('Choose story 2 in the drawing');
    name.click();
    expect(chose.map((x: any) => Number(x.n))).toEqual([2]);
  });

  it('marks the story chosen in the drawing, also on the chips already shown', () => {
    const { s, state } = stories();
    const f = s.foot(of(2, 3));
    expect(chips(f).map((b: any) => b.classList.contains('td-on'))).toEqual([false, false]);
    state.story = of(3)[0];
    s.sync();
    expect(chips(f).map((b: any) => b.classList.contains('td-on'))).toEqual([false, true]);
  });

  it('keeps a story folded out for the next details that have it too', () => {
    const { s } = stories();
    chips(s.foot(of(2, 3)))[1].click();
    expect(open(s.foot(of(3, 4)))).toEqual(['true', 'false']);
    expect(open(s.foot(of(2, 4)))).toEqual(['false', 'false']);
  });

  it('is inlined before the panel, under 500 lines, without a long dash', () => {
    const assets = req(path.join(FLOW, 'scripts/lib/design-assets.cjs'));
    expect(assets.DESIGN_JS.indexOf('design-stories.js')).toBeGreaterThan(-1);
    expect(assets.DESIGN_JS.indexOf('design-stories.js')).toBeLessThan(assets.DESIGN_JS.indexOf('design-panel.js'));
    const src = read('design-stories.js');
    expect(src.split('\n').length).toBeLessThanOrEqual(500);
    expect(src).not.toMatch(/—/);
  });
});
