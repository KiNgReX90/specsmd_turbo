/**
 * Unit tests for a file the build changed that the drawing leaves out (a test, a data script, a small helper):
 * a part outside the lanes, with `near` the drawn part it belongs to.
 * - the record carries `near` through to the model (design-model.cjs);
 * - the Review tab lists it, and in the order of the flow it comes right after the part it belongs to,
 *   several of them by name;
 * - it has no "View in the flow": the drawing does not show it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import { reviewDom, reviewModel, mountReview, load, LIFECYCLE } from './aidlc-turbo-design-review-fixture';

const G = globalThis as any;
const req = createRequire(import.meta.url);
const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const ids = (rows: any[]) => rows.map((r) => r.id);
const DIFF = { text: '@@ -0,0 +1,2 @@\n+a\n+b', added: 2, removed: 0, truncated: 0 };

/** The fixture with two tests of IncomingProcessor and a data script of the factory, none of them drawn. */
function withLoose() {
  const m: any = reviewModel();
  const P = (id: string, name: string, p: string, near: string) => ({
    id, name, path: p, status: 'new', kind: 'file', layer: null, module: 'm', build: null, what: null, stories: ['001'],
    confidence: { level: 'green', reasons: [] }, near,
  });
  m.parts.push(
    P('t2', 'ProcessorZTest.java', 'shop/src/test/ProcessorZTest.java', 'loop'),
    P('t1', 'ProcessorATest.java', 'shop/src/test/ProcessorATest.java', 'loop'),
    P('fx', '02_factory.sql', 'sql/seeds/2026/02_factory.sql', 'factory'),
  );
  for (const p of ['shop/src/test/ProcessorZTest.java', 'shop/src/test/ProcessorATest.java', 'sql/seeds/2026/02_factory.sql']) m.build.diffs[p] = DIFF;
  return m;
}

describe('aidlc-turbo Review: a file outside the drawing', () => {
  let L: any;
  beforeEach(() => {
    G.TdBuild = load('design-built.js');
    L = load('design-review-list.js');
  });

  it('the record carries near through to the model', () => {
    const { designModel } = req(path.join(FLOW, 'scripts/lib/design-model.cjs'));
    const m = designModel({ technical_design: { drawing: { modules: [{ id: 'm', name: 'shop', status: 'changed' }],
      parts: [{ id: 'a', name: 'A', module: 'm', layer: 'server', status: 'new' }, { id: 't', name: 'ATest', module: 'm', status: 'new', near: 'a' }], links: [] } } });
    expect(m.parts.find((p: any) => p.id === 't').near).toBe('a');
    expect(m.parts.find((p: any) => p.id === 'a').near).toBeNull();
  });

  it('is listed, and in the order of the flow comes right after the part it belongs to, several by name', () => {
    const order = ids(L.order(L.rows(withLoose(), { built: true }), 'flow'));
    const at = LIFECYCLE.indexOf('loop') + 1;
    expect(order.slice(0, at + 2)).toEqual([...LIFECYCLE.slice(0, at), 't1', 't2']);
    // the factory has no row of its own (the build left it alone): its data script stands where it would
    expect(order.indexOf('fx')).toBe(order.indexOf('cache') + 1);
    expect(order.filter((id) => !['t1', 't2', 'fx'].includes(id))).toEqual(LIFECYCLE);
  });

  it('has no "View in the flow"; a drawn part keeps it', () => {
    const v = mountReview(reviewDom(), { model: withLoose() });
    v.api.open('t1');
    expect(v.shownName()).toBe('ProcessorATest.java');
    expect(v.q('td-rv-flow')).toHaveLength(0);
    v.api.open('loop');
    expect(v.q('td-rv-flow')).toHaveLength(1);
  });
});
