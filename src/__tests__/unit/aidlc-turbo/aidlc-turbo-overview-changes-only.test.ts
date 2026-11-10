/**
 * Unit tests for the overview of an intent without a drawing (an intent built before the Code Scaffold: the
 * design model has `drawing: false`, its changed files as the parts and no lanes), shown after the build by the
 * page's tabs (design-tabs.js) and its Review (design-review-list.js, design-review.js):
 * - Functional and Review, no Code Scaffold;
 * - every link that would open the drawing opens Review, and so does the page when no link says otherwise;
 * - Review lists every changed file, has no way to the drawing, and its first order is the order of the build, not
 *   of a flow it has not.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { reviewModel, reviewDom, mountReview, load } from './aidlc-turbo-design-review-fixture';

const G = globalThis as any;
let d: any;

/** The fixture as an intent built without a drawing: no lanes, no links, the build with its diffs. */
function changesOnly() {
  const m: any = reviewModel();
  m.drawing = false;
  m.lanes = [];
  m.links = [];
  return m;
}
beforeEach(() => {
  d = reviewDom();
  G.history = { replaceState() {} };
});
const T = () => load('design-tabs.js');

describe('aidlc-turbo overview without a drawing: the tabs', () => {
  it('Functional and Review, no Code Scaffold; with a drawing the Code comes before Review', () => {
    const main = d.node('main');
    const rv = d.node('section');
    main.append(rv);
    const t = T().create({ page: main, flow: null, review: rv, built: true });
    expect(t.el.children.filter((b: any) => b && b.tag === 'button').map((b: any) => b.getAttribute('data-view'))).toEqual(['functional', 'review']);
    expect(T().views(true, true, true).map(([v]: string[]) => v)).toEqual(['functional', 'flow', 'review']);
    // before the build there is no Review
    expect(T().views(false, false, false).map(([v]: string[]) => v)).toEqual(['functional']);
  });

  it('a link to the drawing, a part or nothing at all opens Review; with a drawing the page starts on the Code', () => {
    const at = (hash: string, o: any = {}) => T().route(hash, { review: true, built: true, flow: false, drawing: (h: string) => h === 'loop', func: () => false, ...o }).view;
    expect(['#flow', '#loop', ''].map((h) => at(h))).toEqual(['review', 'review', 'review']);
    expect(at('#functional')).toBe('functional');
    expect(at('', { flow: true })).toBe('flow');
  });
});

describe('aidlc-turbo overview without a drawing: Review', () => {
  it('orders by the build first, its other orders as ever', () => {
    const L = G.TdReviewList;
    expect(L.ordersOf({ drawing: false }).map((o: string[]) => o[1])).toEqual(['Order of the build', 'Name (A-Z)', 'Folders', 'Largest change']);
    expect(L.ordersOf(changesOnly())[0]).toEqual(['flow', 'Order of the build']);
    expect(L.ordersOf(reviewModel())).toEqual(L.ORDERS);
  });

  it('lists every changed file, and no way to the drawing even when the page offers one', () => {
    const v = mountReview(d, { model: changesOnly() });
    expect(v.optIds().length).toBeGreaterThan(0);
    for (const id of v.optIds()) {
      v.api.open(id);
      expect(v.q('td-rv-flow'), id).toHaveLength(0);
    }
    // with its lanes the same file has the way into the drawing
    const drawn = mountReview(d);
    drawn.api.open('loop');
    expect(drawn.q('td-rv-flow').length).toBeGreaterThan(0);
  });
});
