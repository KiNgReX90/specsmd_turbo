/**
 * Unit tests for the small rules around the Code Scaffold drawing
 * (templates/design/design-kit.js):
 * - fit: on a desktop page (1280 wide or more) the steps sit beside the drawing,
 *   open or folded as the viewer chose, without a choice folded where the
 *   drawing beside them open gets less than 640 wide; narrower they go under
 *   it, with a preview where the drawing gets too small to read;
 * - covers: how much of the full-screen view a sheet or a drawer hides, so the
 *   view can pan what was chosen into the part that stays free;
 * - breaks: where a long code name or path may wrap, so it never breaks in
 *   the middle of a word;
 * - lead: the line about the story shows its first sentence whole, the rest
 *   behind "More", never a sentence cut off.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import path from 'path';

const req = createRequire(import.meta.url);
const KIT = req(path.resolve(__dirname, '../../../flows/aidlc-turbo/templates/design/design-kit.js'));

describe('aidlc-turbo Code Scaffold: the steps beside the drawing', () => {
  // the drawing of the live test project, at its own size
  const vb = { w: 1886, h: 1198 };

  it('puts the steps beside the drawing on a desktop page, from 1280 wide (1920, 1440, 1280); never chosen, the page decides', () => {
    expect(KIT.fit({ view: 1920, full: 1766, room: 1048, vb, steps: true, folded: null })).toEqual({ pv: false, side: true, fold: null });
    expect(KIT.fit({ view: 1440, full: 1286, room: 868, vb, steps: true, folded: null })).toEqual({ pv: false, side: true, fold: null });
    expect(KIT.fit({ view: 1280, full: 1131, room: 768, vb, steps: true, folded: null })).toEqual({ pv: false, side: true, fold: null });
  });

  it('never chosen, the legend starts folded where the drawing beside it open gets less than 720 wide', () => {
    expect(KIT.NARROW).toBe(720);
    expect(KIT.narrow(719)).toBe(true);
    expect(KIT.narrow(720)).toBe(false);
    // 1600 wide: the stage 1446, the details 400 beside it: 674 for the drawing at a readable size, so it folds
    expect(KIT.narrow(KIT.drawOpen(1446, 400))).toBe(true);
    // 1440 wide after the build: the stage 1286, the details 640 beside it: 274 for the drawing, so it folds
    expect(KIT.drawOpen(1286, 640)).toBe(274);
    expect(KIT.narrow(KIT.drawOpen(1286, 640))).toBe(true);
    // 1920 wide: 754, it stays open; with the details folded to their rail at 1440 too
    expect(KIT.narrow(KIT.drawOpen(1766, 640))).toBe(false);
    expect(KIT.narrow(KIT.drawOpen(1286, KIT.RAIL))).toBe(false);
    expect(KIT.drawOpen(1286, null)).toBe(930);
    const css = readFileSync(path.resolve(__dirname, '../../../flows/aidlc-turbo/templates/design/design-steps.css'), 'utf8');
    expect(css).toMatch(/\.td-side \.td-stage > \.td-steps \{[^}]*width: 340px;/);
    expect(css).toMatch(/\.td-side \.td-stage > \.td-steps\.td-folded \{ width: 52px;/);
    const panel = readFileSync(path.resolve(__dirname, '../../../flows/aidlc-turbo/templates/design/design-panel.js'), 'utf8');
    expect(panel).toContain('if (side && fold === null) steps.fold(K.narrow(K.drawOpen(full, beside ? (pane.folded() ? K.RAIL : pane.width()) : null)));');
    expect(css).toMatch(/\.td-side \.td-stage \{[^}]*gap: 16px;/);
  });

  it('keeps the viewer\'s own choice, open or folded', () => {
    expect(KIT.fit({ view: 1920, full: 1766, room: 1048, vb, steps: true, folded: false }).fold).toBe(false);
    expect(KIT.fit({ view: 1920, full: 1766, room: 1048, vb, steps: true, folded: true }).fold).toBe(true);
  });

  it('below 1280 puts the steps under the drawing, and shows a preview where the drawing gets too small to read', () => {
    expect(KIT.fit({ view: 1279, full: 1130, room: 768, vb, steps: true, folded: true })).toEqual({ pv: true, side: false, fold: null });
    expect(KIT.fit({ view: 1024, full: 900, room: 736, vb: { w: 800, h: 600 }, steps: true, folded: null })).toEqual({ pv: false, side: false, fold: null });
  });

  it('has no panel without steps', () => {
    expect(KIT.fit({ view: 1920, full: 1766, room: 1048, vb, steps: false, folded: null })).toEqual({ pv: false, side: false, fold: null });
  });
});

describe('aidlc-turbo Code Scaffold: what a sheet or a drawer covers in the full-screen view', () => {
  const view = { left: 0, top: 60, right: 400, bottom: 860, width: 400, height: 800 };
  const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom, width: right - left, height: bottom - top });

  it('counts a sheet from the bottom, a drawer on the right and one on the left', () => {
    expect(KIT.covers(view, [box(0, 380, 400, 860)])).toEqual({ l: 0, r: 0, b: 480 });
    expect(KIT.covers(view, [box(180, 74, 386, 846)])).toEqual({ l: 0, r: 220, b: 0 });
    expect(KIT.covers(view, [box(8, 68, 188, 852)])).toEqual({ l: 188, r: 0, b: 0 });
  });

  it('takes the largest of several, and skips what is hidden or sits beside the view', () => {
    expect(KIT.covers(view, [box(0, 380, 400, 860), box(0, 600, 400, 860), box(0, 0, 0, 0), box(-300, 60, 0, 860)]))
      .toEqual({ l: 0, r: 0, b: 480 });
  });
});

describe('aidlc-turbo Code Scaffold: where a long name may wrap', () => {
  it('breaks a class name between its words', () => {
    expect(KIT.breaks('ProcessIncomingParcelsTask')).toEqual(['Process', 'Incoming', 'Parcels', 'Task']);
    expect(KIT.breaks('HTTPClient')).toEqual(['HTTP', 'Client']);
  });

  it('breaks a path after a slash, a dot or an underscore, and keeps a file name with its extensions', () => {
    expect(KIT.breaks('shop-invoices/core/ShipmentTimeoutPolicy.java'))
      .toEqual(['shop-invoices/', 'core/', 'Shipment', 'Timeout', 'Policy.java']);
    expect(KIT.breaks('01_shopfront_fin.tbl.sql, lines 1-34')).toEqual(['01_', 'shopfront_', 'fin.tbl.sql, lines 1-34']);
    expect(KIT.breaks('com.webshop.shipments.Foo')).toEqual(['com.', 'webshop.', 'shipments.', 'Foo']);
  });

  it('breaks a call after its bracket, and never inside a word in capitals or a short word', () => {
    expect(KIT.breaks('failExpired(customer, new Date())')).toEqual(['fail', 'Expired(', 'customer, new Date())']);
    expect(KIT.breaks('LEDGERACCOUNTS')).toEqual(['LEDGERACCOUNTS']);
    expect(KIT.breaks('')).toEqual([]);
  });
});

describe('aidlc-turbo Code Scaffold: the line about the story', () => {
  // a small stand-in for the browser's elements: text, children, hidden, attributes and clicks
  const node = (tag: string): any => ({
    tag, children: [] as any[], attrs: {} as Record<string, string>, hidden: false, on: {} as Record<string, () => void>, own: '',
    set textContent(t: string) { this.own = t; this.children = []; },
    get textContent(): string { return this.own + this.children.map((c: any) => (typeof c === 'string' ? c : c.textContent)).join(''); },
    append(...xs: any[]) { this.children.push(...xs); },
    setAttribute(k: string, v: string) { this.attrs[k] = v; },
    addEventListener(t: string, fn: () => void) { this.on[t] = fn; },
  });
  (globalThis as any).document = { createElement: node };

  it('shows the first sentence whole, and the rest behind "More"', () => {
    const p = KIT.lead(node('p'), 'The inbox looks for the answer. An empty answer fails. A migration sets the statuses.');
    expect(p.own).toBe('The inbox looks for the answer.');
    const [rest, , more] = p.children;
    expect([rest.hidden, rest.textContent]).toEqual([true, ' An empty answer fails. A migration sets the statuses.']);
    expect([more.textContent, more.attrs['aria-expanded']]).toEqual(['More', 'false']);
    more.on.click();
    expect([rest.hidden, more.textContent, more.attrs['aria-expanded']]).toEqual([false, 'Less', 'true']);
  });

  it('shows one sentence without a button', () => {
    const p = KIT.lead(node('p'), 'Only the answer goes on');
    expect([p.own, p.children.length]).toEqual(['Only the answer goes on', 0]);
  });
});
