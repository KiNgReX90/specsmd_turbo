/**
 * Unit tests for the marks of the build on the code level of the C4 model (templates/overview-v5, js/02-build.js):
 * - after the build a file whose build deviated from the approved Code Scaffold carries a coloured border and a sign
 *   on its corner: different from the design, added at the build, not built, or not used for a file that already
 *   existed; a file built as drawn carries no mark, and before the build no file does;
 * - the deviation is the part's own build, else what the build block says of it;
 * - the lines to a file that was not built or not used go quiet, as its card does;
 * - the legend has a sample of each sign after the build, in the words of the marks;
 * - the inspector says how many files deviated and how to read the marks, and for such a file shows the card of its
 *   deviation: Planned, Built, Why;
 * - while a change is open (model.plan) the drawings show the plan: no marks, no file the build added, the legend and
 *   the inspector in the words of the plan.
 */

import { describe, it, expect } from 'vitest';
import { boot, clone, BUILT, TEXT, planned, all, text } from './aidlc-turbo-v5-boot';

/** The built model with a deviation of every kind: its own (different, added, gone), one only the build block names
 *  (orders-table) and a file that already existed and was not used. */
function deviated() {
  const m = clone(BUILT);
  m.parts['payment-client'].build = { state: 'gone', story: '002', plan: 'Charges the rest of the order.', built: null, why: null };
  return m;
}
/** The built model while a change is open: the file the build added stands apart in build.parts, undrawn. */
function open() {
  const m = deviated();
  m.plan = true;
  m.build.parts = { 'giftcard-cache': m.parts['giftcard-cache'] };
  delete m.parts['giftcard-cache'];
  m.components['k-giftcards'].parts = m.components['k-giftcards'].parts.filter((p: string) => p !== 'giftcard-cache');
  return m;
}

// each page booted once: every boot compiles and runs the whole kit
const once = <T,>(f: () => T) => { let v: T | null = null; return () => (v = v || f()); };
const after = once(() => boot(deviated()));
const before = once(() => boot(planned()));
const plan = once(() => boot(open()));

const cls = (e: any) => String((e.attrs && e.attrs.class) || e.className || '').split(' ');
const code = (b: any, k: string) => b.C4.layout.viewOf('code:' + k);
const marks = (v: any) => v.nodes.filter((n: any) => n.part).map((n: any) => [n.id, n.dev || null, n.devTitle || null]);
const item = (b: any, k: string) => all(b.byId('legend')).find((e: any) => e.dataset && String(e.dataset.k) === k);
const CODE = ['k-checkout', 'k-status', 'k-giftcards', 'k-orders', 'k-payments', 'k-tables'];

describe('aidlc-turbo v5: the marks of the build on the cards', () => {
  it('a file that deviated carries its state and the words of its mark; one built as drawn none', () => {
    expect(marks(code(after(), 'k-giftcards'))).toEqual([
      ['giftcard-controller', null, null],
      ['giftcard-service', 'different', 'Different from the design'],
      ['giftcard-cache', 'added', 'Added at the build'],
    ]);
    // orders-table has no build of its own: the build block names its deviation
    expect(marks(code(after(), 'k-tables'))).toEqual([
      ['giftcards-table', null, null],
      ['orders-table', 'different', 'Different from the design'],
      ['migration', 'gone', 'Not built'],
    ]);
    expect(marks(code(after(), 'k-payments'))).toEqual([['payment-client', 'gone', 'Not used']]);
  });

  it('the card draws its border and its sign and says the mark in its label', () => {
    const { C4, d } = after();
    const v = code(after(), 'k-giftcards');
    const drawn = (id: string) => {
      const n = v.nodes.find((x: any) => x.id === id);
      const layer = d.node('g');
      C4.shapes.draw(layer, n, C4.shapes.measure(n), 0, 0);
      return layer.children[0];
    };
    const card = drawn('giftcard-service');
    expect(cls(card)).toContain('bs-different');
    expect(card.attrs['aria-label']).toMatch(/, different from the design(, |\.|$)/);
    const sign = all(card).find((e) => cls(e).includes('bmark'));
    expect(cls(sign)).toContain('bmark-different');
    expect(all(sign).filter((e) => e.tag === 'title').map(text)).toEqual(['Different from the design']);
    expect(all(card).some((e) => cls(e).includes('bline'))).toBe(true);
    const as = drawn('giftcard-controller');
    expect(cls(as).some((c) => c.startsWith('bs-'))).toBe(false);
    expect(all(as).some((e) => cls(e).includes('bmark') || cls(e).includes('bline'))).toBe(false);
  });

  it('a line to a file that was not built or not used goes quiet with its card', () => {
    const quiet = (k: string) => code(after(), k).edges.map((e: any) => [e.from, e.to, !!e.gone]);
    expect(quiet('k-payments')).toEqual([['k-orders', 'payment-client', true], ['payment-client', 's-pay', true]]);
    expect(quiet('k-giftcards').every(([, , g]: any) => !g)).toBe(true);
  });

  it('before the build no file carries a mark', () => {
    const b = before();
    expect(b.C4.kit.built).toBe(false);
    for (const k of CODE) expect(code(b, k).nodes.filter((n: any) => n.dev)).toEqual([]);
  });
});

describe('aidlc-turbo v5: the marks in the legend and the inspector', () => {
  it('the legend has a sample of each sign after the build; before it none', () => {
    const a = after();
    expect(['b-different', 'b-added', 'b-gone'].map((k) => text(item(a, k))))
      .toEqual(['Different from the design', 'Added at the build', 'Not built or not used']);
    expect(cls(all(item(a, 'b-added')).find((e) => cls(e).includes('bmark')))).toContain('bmark-added');
    expect(item(before(), 'b-different')).toBeUndefined();
  });

  it('with nothing chosen the inspector counts the marks and says how to read them', () => {
    const a = after();
    a.C4.app.panel.idle(code(a, 'k-tables'), '');
    const t = text(a.byId('side'));
    expect(t).toContain('1 different from the design, 1 not built or not used');
    expect(t).toContain('a coloured border and a sign on its corner');
    const b = before();
    b.C4.app.panel.idle(code(b, 'k-tables'), '');
    expect(text(b.byId('side'))).not.toContain('sign on its corner');
  });

  it('a file that deviated shows the card of its deviation: Planned, Built, Why', () => {
    const a = after();
    const side = () => text(a.byId('side'));
    const show = (k: string, id: string) => { const v = code(a, k); a.C4.app.panel.node(v, v.nodes.find((x: any) => x.id === id)); };
    show('k-giftcards', 'giftcard-service');
    for (const w of ['Different from the design', 'Planned', 'Reads the balance in one query.', 'Built',
      'Reads the balance through GiftCardCache.', 'Why', 'The table is read on every checkout.']) expect(side()).toContain(w);
    show('k-tables', 'orders-table');
    expect(side()).toContain(TEXT.build.noReason);
    show('k-tables', 'migration');
    expect(side()).toContain('Not built');
    expect(side()).toContain('Creates the table and its index.');
    expect(all(a.byId('side')).filter((e) => e.tag === 'b').map(text)).toEqual(['Planned', 'Why']);
    show('k-payments', 'payment-client');
    expect(side()).toContain('Not used');
    show('k-giftcards', 'giftcard-controller');
    expect(all(a.byId('side')).some((e) => cls(e).includes('bdev'))).toBe(false);
  });
});

describe('aidlc-turbo v5: while a change is open the drawings show the plan', () => {
  it('no card carries a mark of the build, no line goes quiet, and the file the build added is not drawn', () => {
    const p = plan();
    expect([p.C4.kit.built, p.C4.kit.plan]).toEqual([true, true]);
    for (const k of CODE) {
      expect(code(p, k).nodes.filter((n: any) => n.dev)).toEqual([]);
      expect(code(p, k).edges.filter((e: any) => e.gone)).toEqual([]);
    }
    expect(code(p, 'k-giftcards').nodes.map((n: any) => n.id)).not.toContain('giftcard-cache');
  });

  it('the legend has no marks of the build and speaks of the plan; the inspector says a change is open', () => {
    const p = plan();
    expect(item(p, 'b-different')).toBeUndefined();
    expect([text(item(p, 'new')), text(item(p, 'story'))]).toEqual([TEXT.status.plan.new, '3' + TEXT.legend.story.plan]);
    p.C4.app.panel.idle(code(p, 'k-tables'), '');
    const t = text(p.byId('side'));
    expect(t).toContain(TEXT.build.planOpen);
    expect(t).not.toContain('sign on its corner');
  });
});
