/**
 * AI-DLC Turbo - Code Scaffold, the places.
 *
 * Gives one variant of the drawing its geometry, flow first: the columns,
 * bands and heights from design-order.js, the lines that run from left to
 * right from design-channel.js, then the x of every column, as wide as the
 * turns in its corridor need. Returns the blocks, the lanes, the tracks for
 * the grid router and the lines already drawn. Pure: no DOM. The page
 * inlines it (window.TdPlace) before the layout; Node loads it for the tests.
 */
(function (root) {
  'use strict';

  const node = typeof module !== 'undefined' && module.exports;
  const order = node ? require('./design-order.js') : root.TdOrder;
  const channel = node ? require('./design-channel.js') : root.TdChannel;
  const labels = node ? require('./design-labels.js') : root.TdLabels;
  const fit = node ? require('./design-fit.js') : root.TdFit;

  const bandsOf = (p) => [p.open ? 'open' : null, p.right ? 'right' : null].filter(Boolean);

  /**
   * The body of a part: a line taller when its name needs two lines (it has
   * a break and is too wide at 14 px, the estimate kept on the wide side),
   * and a line taller when its summary does (too wide at its own 15 px, or
   * at 13 px under a two-line name), and a row taller when its labels do
   * not fit on one row beside the status icon. The engine fits the texts in
   * what it gets, so an estimate off by a little costs a cut, never an
   * overflow.
   */
  function bodyOf(p, SIZE) {
    const room = SIZE.BW - SIZE.ZB - 28;
    // bold labels run up to 5 % wider than the estimate
    const rows = fit.pillRows(fit.pillsOf(p, true), SIZE.PILLS, (x) => labels.textWidth(x.text, x.fs) * 1.05);
    const name = String(p.name || '');
    const twoNames = /[_.\-/ ]|[a-z0-9][A-Z]/.test(name) && labels.textWidth(name, 14) * 1.05 > room;
    const twoSubs = !!p.sub && labels.textWidth(p.sub, twoNames ? 13 : 15) > room;
    return SIZE.NH + SIZE.LINE2 * ((twoNames ? 1 : 0) + (twoSubs ? 1 : 0)) + (rows.includes(1) ? SIZE.PILL2 : 0);
  }

  /** Tracks every 12 px from the middle of a free stretch, at most `max` to a side, for the router. */
  function zone(out, a, b, max) {
    const mid = (a + b) / 2;
    for (let k = 0; mid - k * 12 > a + 4 && k <= (max === undefined ? 99 : max); k += 1) {
      out.push(mid - k * 12);
      if (k) out.push(mid + k * 12);
    }
  }

  /** Columns, bands, heights and the lines from left to right, for one variant. */
  function arrange(model, flow, ids, links, quiet, variant, SIZE) {
    const parts = new Map(model.parts.map((p) => [p.id, p]));
    // a part the build marked carries a round mark on its top left corner: no line ends there
    const marked = new Set(model.parts.filter((p) => p.build && ['different', 'added', 'gone'].includes(p.build.state)).map((p) => p.id));
    const laneIx = new Map(model.lanes.map((l, i) => [l.id, i]));
    const laneOf = (id) => laneIx.get(parts.get(id).layer);
    const visit = new Map(flow.visit.map((id, i) => [id, i]));
    const visitIx = (id) => (visit.has(id) ? visit.get(id) : 1e6);
    const calls = links.filter((l) => l.kind !== 'builds_on');
    const base = links.filter((l) => l.kind === 'builds_on');
    const group = order.groupsOf(ids, flow.starts, calls, base);
    const groupOf = (id) => group.get(id);
    const { head, members } = order.unitsOf(ids, laneOf, groupOf, calls, base, visitIx);
    const heads = [...members.keys()];
    const start = new Map(flow.starts.map((s) => [s.id, s]));
    const edgesOf = () => {
      const out = [];
      for (const l of links) {
        const u = head.get(l.from);
        const v = head.get(l.to);
        if (u === v) continue;
        out.push({ id: l.id, u, v, from: l.from, to: l.to, step: groupOf(l.from) === groupOf(l.to) ? 1 : variant.across, quiet: quiet.has(l.id),
          w: quiet.has(l.id) ? 1 : l.kind === 'builds_on' ? 1.5 : 2.5 });
      }
      return out;
    };
    let edges = edgesOf();
    const col = order.columnsOf(heads, edges, groupOf, visitIx, new Set(start.keys()));
    const bandOf = (h) => groupOf(h);
    const size = (h) => members.get(h).length;
    const sats = order.balance(heads, edges, col, bandOf, size, variant.cap, visitIx, new Set(start.keys()));
    // a lookup under its reader joins the reader's unit
    for (const [v, u] of sats) {
      members.get(head.get(u)).push(v);
      members.delete(v);
      head.set(v, head.get(u));
      heads.splice(heads.indexOf(v), 1);
    }
    if (sats.size) edges = edgesOf();
    // what joins a unit goes below and above it in turn, so two of them still touch the part they belong to
    for (const [h, ms] of members) {
      if (ms.length < 3) continue;
      const below = ms.slice(1).filter((_, k) => k % 2 === 0);
      const above = ms.slice(1).filter((_, k) => k % 2 === 1);
      members.set(h, [...above.reverse(), h, ...below]);
    }
    const c0 = Math.min(...heads.map((h) => col.get(h)));
    for (const h of heads) col.set(h, col.get(h) - c0);
    // a part with a line to a band below drifts down, to a band above up
    const drift = new Map();
    for (const e of edges) {
      const d = Math.sign(groupOf(e.v) - groupOf(e.u));
      if (d) drift.set(e.u, (drift.get(e.u) || 0) + d);
      if (d) drift.set(e.v, (drift.get(e.v) || 0) - d);
    }

    // a band per start, flow first: the lanes of the model live on in the tags
    const rowBands = [...new Set(heads.map(bandOf))].sort((x, y) => x - y)
      .map((b) => [{ g: b, heads: heads.filter((h) => bandOf(h) === b) }]);

    const body = new Map(ids.map((id) => [id, bodyOf(parts.get(id), SIZE)]));
    const memberH = (id) => body.get(id) + SIZE.BAND * bandsOf(parts.get(id)).length + (start.has(id) ? SIZE.START : 0);
    // two stacked parts joined by a numbered call keep room for the number and the arrow head between them
    const numbered = (a, b) => links.some((l) => l.kind !== 'builds_on' && ((l.from === a && l.to === b) || (l.from === b && l.to === a)));
    const offsets = new Map();
    const unitH = new Map();
    for (const [h, ms] of members) {
      let y = 0;
      ms.forEach((id, k) => {
        offsets.set(id, y);
        y += memberH(id) + (k + 1 < ms.length ? (numbered(id, ms[k + 1]) ? SIZE.STACK_NUM : SIZE.STACK_GAP) : 0);
      });
      unitH.set(h, y);
    }
    const anchor = (id) => offsets.get(id) + (start.has(id) ? SIZE.START : 0) + body.get(id) / 2;
    const sizeOf = (it) => ({ h: it.dummy ? 0 : unitH.get(it.head) });
    // two parts above each other with a numbered call between them keep room for its number and its head
    const gapOf = (a, b) => (a.dummy && b.dummy ? 14 : a.dummy || b.dummy ? SIZE.DGAP
      : edges.some((e) => ((e.u === a.head && e.v === b.head) || (e.u === b.head && e.v === a.head)) && numbered(e.from, e.to)) ? SIZE.STACK_NUM : SIZE.GAP_Y);
    const anchorOf = (it, member) => (it.dummy ? 0 : anchor(member || it.head));
    for (const list of rowBands) {
      for (const rb of list) {
        rb.band = order.orderBand(rb.heads, edges, col, visitIx, drift, variant.hard);
        rb.top = order.heights(rb.band, sizeOf, gapOf, anchorOf, SIZE.ROUNDS, variant.slack || 1.08, drift);
        rb.h = Math.max(...[...rb.band.layers.values()].flat().map((it) => rb.top.get(it.key) + sizeOf(it).h));
      }
    }

    // the bands: the first on top; a later one tucks in under the columns it uses when there is room, else below
    const absY = new Map();
    const laneBox = [];
    const itemsOf = (i) => [...rowBands[i][0].band.layers.values()].flat();
    // the bottom of a column over the bands placed before band n
    const lowOf = (c, n) => Math.max(laneBox[0].top + SIZE.TOP,
      ...rowBands.slice(0, n).flatMap((_, j) => itemsOf(j)).filter((it) => it.c === c).map((it) => absY.get(it.key) + sizeOf(it).h));
    const shift = (i, d) => {
      for (const it of itemsOf(i)) absY.set(it.key, absY.get(it.key) + d);
      laneBox[i].top += d;
      laneBox[i].bottom += d;
    };
    // the bands that went below the first: the first growing around a band tucked in later pushes them down
    const below = [];
    let y = 0;
    rowBands.forEach((list, i) => {
      const rb = list[0];
      const cs = rb.band.cols;
      let t = y + SIZE.TOP;
      let tucked = false;
      if (i > 0) {
        const under = Math.max(...cs.map((c) => lowOf(c, i))) + SIZE.BAND_GAP + 16;
        if (under + rb.h <= laneBox[0].bottom - SIZE.FOOT + 40) { t = under; tucked = true; }
      }
      for (const it of itemsOf(i)) absY.set(it.key, t + rb.top.get(it.key));
      if (tucked) {
        laneBox.push({ top: t - 16, bottom: t + rb.h + 16, lo: Math.min(...cs), hi: Math.max(...cs) });
        const grow = t + rb.h + 16 + SIZE.FOOT - laneBox[0].bottom;
        if (grow > 0) {
          laneBox[0].bottom += grow;
          for (const j of below) shift(j, grow);
          y += grow;
        }
      } else {
        laneBox.push({ top: y, bottom: t + rb.h + SIZE.FOOT });
        if (i > 0) below.push(i);
        y = t + rb.h + SIZE.FOOT + SIZE.LANE_GAP;
      }
    });
    // a band tucked under its columns goes down to the bottom, so no empty room stays under it
    for (let i = rowBands.length - 1; i > 0; i -= 1) {
      const box = laneBox[i];
      if (box.lo === undefined) continue;
      const tops = laneBox.filter((o, j) => j > i && o.lo !== undefined && o.lo <= box.hi && box.lo <= o.hi && o.top >= box.bottom).map((o) => o.top - SIZE.BAND_GAP);
      const floor = Math.min(laneBox[0].bottom - SIZE.FOOT, ...tops);
      const d = Math.floor(floor - box.bottom);
      if (d > 0) shift(i, d);
    }
    const height = y - SIZE.LANE_GAP;
    const partY = (id) => absY.get(head.get(id)) + offsets.get(id);

    // the lines from left to right, and the dashed brackets of a stack past its first implementation
    const brackets = [];
    const stacked = [];
    for (const [h, ms] of members) {
      ms.forEach((id, k) => {
        if (id === h) return;
        // what holds it in the unit: the contract it builds on, or the part that reads it
        const l = sats.has(id) ? links.find((x) => x.from === sats.get(id) && x.to === id)
          : links.find((x) => x.kind === 'builds_on' && x.from === id && head.get(x.to) === h);
        if (!l) return;
        const at = ms.indexOf(sats.has(id) ? l.from : l.to);
        if (Math.abs(at - k) === 1) stacked.push({ id: l.id, from: l.from, to: l.to });
        else brackets.push({ id: l.id, from: l.from, to: l.to, c: col.get(h), up: ms.indexOf(l.from) > ms.indexOf(l.to) });
      });
    }
    const chains = rowBands.flat().flatMap((rb) => rb.band.chains);
    const lines = channel.plan({ chains, brackets, NH: SIZE.NH, yOf: (it) => absY.get(it.key),
      blockOf: (id) => ({ y: partY(id), top: start.has(id) ? SIZE.START : 0, body: body.get(id), mark: marked.has(id) }) });

    // the corridors: wide enough for their turns, and for what the grid router still has to draw there
    const cols = Math.max(...heads.map((h) => col.get(h))) + 1;
    const extra = new Array(cols).fill(0);
    const routed = new Set(chains.filter((c) => !c.reversed).map((c) => c.e.id).concat(brackets.map((b) => b.id), stacked.map((s) => s.id)));
    for (const l of links) if (!routed.has(l.id)) extra[Math.min(cols - 1, col.get(head.get(l.from)))] += 1;
    const gaps = [];
    for (let c = 0; c + 1 < cols; c += 1) {
      const n = (lines.turns.get(c) || 0) + extra[c];
      gaps.push(Math.max(SIZE.GAP_MIN, Math.min(SIZE.GAP_MAX, 2 * channel.MARGIN + 8 + channel.TRACK * 2 * Math.max(0, n - 1) + (n ? 8 : 0))));
    }
    // room for the labels of the bold arrows, as far as the screen allows: the height already sets the scale
    const plate = (t) => {
      const two = labels.twoLines(t);
      return Math.min(labels.plateOf([t], 1).w, two ? labels.plateOf(two, 1).w : Infinity);
    };
    const want = gaps.map(() => 0);
    for (const l of links) {
      if (quiet.has(l.id) || !l.label || l.kind === 'builds_on') continue;
      const c = col.get(head.get(l.from));
      if (c < cols - 1 && col.get(head.get(l.to)) > c) want[c] = Math.max(want[c], plate(l.label) + 34);
    }
    const natural = SIZE.X0 * 2 + cols * SIZE.BW + gaps.reduce((t, g) => t + g, 0);
    const budget = Math.max(SIZE.SW, SIZE.SW * height / SIZE.SH) - natural;
    const short = want.map((w, c) => Math.max(0, w - gaps[c]));
    const total = short.reduce((t, v) => t + v, 0);
    if (total > 0 && budget > 0) short.forEach((v, c) => { gaps[c] += Math.floor(v * Math.min(1, budget / total)); });
    const left = SIZE.X0 + (lines.turns.get(-1) ? channel.TRACK * 2 * lines.turns.get(-1) : 0);
    const xOf = [left];
    for (let c = 1; c < cols; c += 1) xOf.push(xOf[c - 1] + SIZE.BW + gaps[c - 1]);
    const width = xOf[cols - 1] + SIZE.BW + SIZE.X0;

    const blocks = [];
    for (const id of ids) {
      const p = parts.get(id);
      const s = start.get(id) || null;
      blocks.push({ id, lane: p.layer, band: groupOf(id), col: col.get(head.get(id)), x: xOf[col.get(head.get(id))], y: partY(id), w: SIZE.BW,
        h: memberH(id), body: body.get(id), bands: bandsOf(p), start: s, top: s ? SIZE.START : 0, half: (s ? SIZE.START : 0) + body.get(id) / 2 });
    }
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const fixed = lines.points(xOf, SIZE.BW);
    // the first implementation of a stack: straight up into its contract, right of its tag
    for (const s of stacked) {
      const a = byId.get(s.from);
      const b = byId.get(s.to);
      const x = a.x + SIZE.BW - SIZE.STACK_X;
      fixed.set(s.id, a.y > b.y ? [[x, a.y], [x, b.y + b.h]] : [[x, a.y + a.h], [x, b.y]]);
    }
    const lanes = rowBands.map((rbs, i) => {
      const box = laneBox[i];
      const x = box.lo === undefined ? 0 : xOf[box.lo] - 16;
      const w = box.lo === undefined ? width : xOf[box.hi] + SIZE.BW + 16 - x;
      return { id: `band-${rbs[0].g}`, name: '', x, y: box.top, w, h: box.bottom - box.top, fill: i % 2 ? 'lane-2' : 'lane-1' };
    });

    // the free tracks for the grid router: between the columns, between the blocks of a column
    const xs = [7, width - 7];
    for (let c = 0; c + 1 < cols; c += 1) zone(xs, xOf[c] + SIZE.BW + 12, xOf[c + 1] - 12, 6);
    const ys = [];
    lanes.forEach((l) => {
      ys.push(l.y + 40, l.y + l.h - 10);
      for (let c = 0; c < cols; c += 1) {
        const here = blocks.filter((b) => b.col === c && b.y >= l.y && b.y < l.y + l.h).sort((a, b) => a.y - b.y);
        let prev = null;
        for (const b of here) {
          if (prev === null) ys.push(b.y - 22, b.y - 34);
          else if (b.y - prev > 120) ys.push(prev + 22, prev + 34, b.y - 22, b.y - 34);
          else zone(ys, prev, b.y - 8, 2);
          prev = b.y + b.h;
        }
        if (prev !== null) ys.push(prev + 22, prev + 34);
      }
    });
    return { width, height, lanes, blocks, frames: [], tracks: { xs, ys }, fixed };
  }

  const api = { arrange, bandsOf, bodyOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdPlace = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
