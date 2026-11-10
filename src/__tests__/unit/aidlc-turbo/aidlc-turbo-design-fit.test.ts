/**
 * Unit tests for templates/design/design-fit.js, how a text of the Code
 * Scaffold drawing fits its room. Pure: the engine hands it a measure (text,
 * font size) -> width; here a fixed width per character stands in. What the
 * drawing promises:
 * - a name stays on one line while it fits at 14 px, else it splits at a
 *   sensible break into two lines, and only a line that still does not fit
 *   is cut, in the middle, so a file name keeps its extension;
 * - a summary takes a second line before it gets smaller or cut, and gets
 *   smaller (to 13 px on one line, 12 px on two) before it is cut;
 * - a module tag gets smaller before it is cut, and keeps both ends;
 * - no cut lands right after a full stop, a comma or a space, and no
 *   result is wider than its room.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const { nameFit, subFit, tagFit, lineFit, cutEnd, cutMiddle } = req(path.join(FLOW, 'templates/design/design-fit.js'));

/** Every character 0.6 of the font size wide. */
const m = (s: string, fs: number) => [...s].length * fs * 0.6;
const ROOM = 200;
const fits = (r: { fs: number; lines: string[] }) => r.lines.every((l) => m(l, r.fs) <= ROOM);
// a cut never lands right after a full stop, a comma, a colon or a space
const BAD_CUT = /[.,;: ]…/;

describe('design fit: a part name', () => {
  it('keeps a short name on one line at its own size', () => {
    expect(nameFit('Product', m, ROOM, 17)).toEqual({ fs: 17, lines: ['Product'] });
  });

  it('keeps a name on one line down to 14 px before it splits it', () => {
    // 23 characters: too wide at 15 px, fits at 14 px
    expect(nameFit('ORDER_STATUS_TRANSITION', m, ROOM, 17)).toEqual({ fs: 14, lines: ['ORDER_STATUS_TRANSITION'] });
  });

  it('splits a long name at the break that gives two lines closest in length, at its own size', () => {
    const r = nameFit('ProcessIncomingParcelsTask', m, ROOM, 17);
    expect(r.lines).toEqual(['ProcessIncoming', 'ParcelsTask']);
    // two lines of a name are as large as one: the box has the room since it grew (NH 128)
    expect(r.fs).toBe(17);
  });

  it('cuts a file name that does not fit on two lines in the middle, keeping its extension', () => {
    const r = nameFit('01_shopfront_ord_shipment_changes_statusdomain.tbl.sql', m, ROOM, 17);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toBe('01_shopfront_ord_shipment_');
    expect(r.lines[1]).toMatch(/^changes.*….*\.tbl\.sql$/);
    expect(r.lines.join('')).not.toMatch(BAD_CUT);
    expect(fits(r)).toBe(true);
  });

  it('with room for one line only, gets smaller down to 12.5 px and is cut in the middle', () => {
    // 26 characters: too wide at 13 px, fits at 12.5 px
    expect(nameFit('IncomingParcelProcessorABC', m, ROOM, 17, 1)).toEqual({ fs: 12.5, lines: ['IncomingParcelProcessorABC'] });
    const r = nameFit('LedgerAccountShipmentProcessorFactoryImpl', m, ROOM, 17, 1);
    expect(r.fs).toBe(12.5);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatch(/^Ledger.*….*FactoryImpl$/);
    expect(fits(r)).toBe(true);
  });

  it('cuts one long word without a break in the middle, never wider than its room', () => {
    const r = nameFit('X'.repeat(60), m, ROOM, 17);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toContain('…');
    expect(fits(r)).toBe(true);
  });
});

describe('design fit: a summary', () => {
  it('keeps a summary that fits as it is', () => {
    expect(subFit('three statuses added', m, ROOM, 2, 15)).toEqual({ fs: 15, lines: ['three statuses added'] });
  });

  it('takes a second line before it gets smaller, split where both lines come out closest in length', () => {
    const r = subFit('mark a stuck shipment as failed', m, ROOM, 2, 15);
    expect(r).toEqual({ fs: 15, lines: ['mark a stuck', 'shipment as failed'] });
  });

  it('on one line gets smaller down to 13 px before it is cut', () => {
    // 25 characters: too wide at 13.5 px, fits at 13 px
    expect(subFit('request, statuses and ans', m, ROOM, 1, 15)).toEqual({ fs: 13, lines: ['request, statuses and ans'] });
  });

  it('is cut at the end only when it does not fit at 13 px, and never right after a full stop or a comma', () => {
    for (const s of ['a comment with 25 values. After that comes more text', 'request, statuses, answers, errors and much more besides']) {
      const r = subFit(s, m, ROOM, 1, 15);
      expect(r.fs).toBe(13);
      expect(r.lines).toHaveLength(1);
      expect(r.lines[0].endsWith('…'), s).toBe(true);
      expect(r.lines[0], s).not.toMatch(BAD_CUT);
      expect(fits(r), s).toBe(true);
    }
  });

  it('on two lines gets smaller down to 12 px, then cuts the second line, never wider than its room', () => {
    const s = 'sets a shipment that hangs too long to failed, with a waiting time per carrier and country and much more';
    const r = subFit(s, m, ROOM, 2, 15);
    expect(r.fs).toBe(12);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[1].endsWith('…')).toBe(true);
    expect(fits(r)).toBe(true);
  });

  it('breaks one long word at its separators instead of running out of the part', () => {
    const r = subFit('Refuses_also_an_empty_list_of_changes_in_the_answer_package', m, ROOM, 2, 15);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0].endsWith('_')).toBe(true);
    expect(fits(r)).toBe(true);
  });
});

describe('design fit: a module tag and a cut', () => {
  it('keeps a tag that fits, and gets smaller before it cuts', () => {
    expect(tagFit('shop-invoices/core', m, 176, 13)).toEqual({ fs: 13, lines: ['shop-invoices/core'] });
    expect(tagFit('shop-invoices/core-impl', m, 176, 13).fs).toBeLessThan(13);
  });

  it('cuts a long module name in the middle at 11 px, keeping both ends', () => {
    const r = tagFit('shop-invoices-shipmentprocessing/core-implementation', m, 176, 13);
    expect(r.fs).toBe(11);
    expect(r.lines[0]).toMatch(/^shop-.*….*implementation$/);
    expect(m(r.lines[0], 11)).toBeLessThanOrEqual(176);
  });

  it('a line of a band or a plate gets smaller down to its minimum, then is cut at the end', () => {
    expect(lineFit('Still open: short', m, 180, 13.5, 11)).toEqual({ fs: 13.5, lines: ['Still open: short'] });
    const r = lineFit('Still open: which chart library the screen uses for the charts', m, 180, 13.5, 11);
    expect(r.fs).toBe(11);
    expect(r.lines[0].endsWith('…')).toBe(true);
    expect(m(r.lines[0], 11)).toBeLessThanOrEqual(180);
  });

  it('never ends a cut on a full stop, a comma or a space, and never returns more than its room', () => {
    const w = (s: string) => m(s, 10);
    for (const s of ['statusdomain.tbl.sql', 'a, b, c, d, e, f, g, h', 'one_two_three_four_five']) {
      for (let max = 30; max <= 120; max += 6) {
        const e = cutEnd(s, max, w);
        const c = cutMiddle(s, max, w, 8);
        expect(w(e), `${s} ${max}`).toBeLessThanOrEqual(Math.max(max, w('…')));
        expect(w(c), `${s} ${max}`).toBeLessThanOrEqual(Math.max(max, w('…')));
        expect(e, `${s} ${max}`).not.toMatch(BAD_CUT);
        expect(c, `${s} ${max}`).not.toMatch(BAD_CUT);
      }
    }
  });
});
