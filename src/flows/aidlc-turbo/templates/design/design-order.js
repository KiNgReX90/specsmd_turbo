/**
 * AI-DLC Turbo - Code Scaffold, the flow order.
 *
 * Decides where every part goes, flow first: a column per call depth from
 * its start, read from left to right. Pure: no DOM, no pixels beyond the
 * sizes it is handed. The page inlines it (window.TdOrder) before the
 * layout; Node loads it for the tests.
 *
 * - A part belongs to the first start that reaches it; the parts of a later
 *   start get their own band, shifted so their arrows still point right.
 * - An implementation nobody calls stacks under the contract it builds on,
 *   so the dashed arrow points up, never back.
 * - A column holds at most `cap` parts; a part that calls nothing moves on
 *   to the next column first, never the last unit of its column.
 * - Inside a column the order follows the neighbours (barycenter sweeps,
 *   the best of many passes), and the heights line the arrows up straight
 *   (least squares, solved per column by pooling adjacent violators).
 */
(function (root) {
  'use strict';

  const SWEEPS = 24;

  /** The units to place: a contract with the implementations nobody calls stacked under it, or a part on its own. */
  function unitsOf(ids, laneOf, groupOf, calls, base, visitIx) {
    const called = new Set(calls.map((l) => l.to));
    const head = new Map(ids.map((id) => [id, id]));
    const members = new Map(ids.map((id) => [id, [id]]));
    const byVisit = base.slice().sort((a, b) => visitIx(a.from) - visitIx(b.from));
    for (const l of byVisit) {
      const impl = l.from;
      if (!head.has(impl) || !head.has(l.to) || called.has(impl)) continue;
      if (head.get(impl) !== impl || members.get(impl).length > 1) continue;
      if (laneOf(impl) !== laneOf(l.to) || groupOf(impl) !== groupOf(l.to)) continue;
      const h = head.get(l.to);
      if (h === impl) continue;
      members.get(h).push(impl);
      members.delete(impl);
      head.set(impl, h);
    }
    return { head, members };
  }

  /** The groups: the index of the first start that reaches a part; what no start reaches comes last. */
  function groupsOf(ids, starts, calls, base) {
    const group = new Map();
    const known = new Set(ids);
    starts.forEach((s, g) => {
      const todo = [s.id];
      while (todo.length) {
        const x = todo.pop();
        if (group.has(x) || !known.has(x)) continue;
        group.set(x, g);
        for (const l of calls) if (l.from === x) todo.push(l.to);
        for (const l of base) if (l.to === x) todo.push(l.from);
      }
    });
    for (const id of ids) if (!group.has(id)) group.set(id, starts.length);
    return group;
  }

  /**
   * The columns. Same lane: the callee one column further. Another lane:
   * the same column or further, so the arrow goes straight down. A later
   * start shifts its band so its arrows into earlier bands still point right.
   */
  function columnsOf(heads, edges, groupOf, visitIx, startIds) {
    const col = new Map();
    const groups = [...new Set(heads.map(groupOf))].sort((a, b) => a - b);
    for (const g of groups) {
      const us = heads.filter((h) => groupOf(h) === g).sort((a, b) => visitIx(a) - visitIx(b));
      const inG = new Set(us);
      const own = edges.filter((e) => inG.has(e.u) && inG.has(e.v) && e.u !== e.v);
      // drop the edges that close a circle, found from the start in reading order
      const state = new Map();
      const back = new Set();
      const dfs = (x) => {
        state.set(x, 1);
        for (const e of own) {
          if (e.u !== x) continue;
          const s = state.get(e.v);
          if (s === 1) back.add(e);
          else if (!s) dfs(e.v);
        }
        state.set(x, 2);
      };
      const roots = us.filter((h) => startIds.has(h)).concat(us.filter((h) => !own.some((e) => e.v === h)), us);
      for (const r of roots) if (!state.get(r)) dfs(r);
      for (const e of back) e.back = true;
      const dag = own.filter((e) => !back.has(e));
      const local = new Map(us.map((h) => [h, 0]));
      for (let k = 0; k < us.length + 1; k += 1) {
        let moved = false;
        for (const e of dag) {
          const want = local.get(e.u) + e.step;
          if (local.get(e.v) < want) { local.set(e.v, want); moved = true; }
        }
        if (!moved) break;
      }
      // a later start: as far right as its arrows into the earlier bands allow
      let shift = 0;
      if (col.size) {
        const into = edges.filter((e) => inG.has(e.u) && col.has(e.v));
        if (into.length) shift = Math.max(0, Math.min(...into.map((e) => col.get(e.v) - local.get(e.u))));
      }
      for (const h of us) col.set(h, local.get(h) + shift);
    }
    return col;
  }

  /** At most `cap` parts in a column of a band: what calls nothing moves on first, the latest in reading order first. */
  function balance(heads, edges, col, bandOf, size, cap, visitIx, starts) {
    const sats = new Map();
    const held = new Map();
    const out = new Map();
    for (const e of edges) { if (!out.has(e.u)) out.set(e.u, []); out.get(e.u).push(e); }
    const push = (h) => {
      for (const e of out.get(h) || []) {
        if (e.back) continue;
        const want = col.get(h) + e.step;
        if (col.get(e.v) < want) { col.set(e.v, want); push(e.v); }
      }
    };
    // the fullest band first: the others keep to one row where they can
    const bands = [...new Set(heads.map(bandOf))];
    const count = (b) => heads.filter((h) => bandOf(h) === b).reduce((s, h) => s + size(h), 0);
    bands.sort((x, y) => count(y) - count(x) || x - y);
    let wide = 1;
    for (const b of bands) {
      const mine = heads.filter((h) => bandOf(h) === b);
      const n = mine.reduce((s, h) => s + size(h), 0);
      const limit = b === bands[0] ? cap(n, b) : Math.max(1, Math.ceil(n / Math.max(3, wide)));
      for (let c = 0; c < 64; c += 1) {
        const here = () => mine.filter((h) => col.get(h) === c);
        let rows = here().reduce((s, h) => s + size(h) + (held.get(h) || 0), 0);
        // first a lookup goes under the one part that reads it, in the column before, while that has room
        if (rows > limit && c > 0) {
          for (const v of here().sort((x, y) => visitIx(x) - visitIx(y))) {
            if (rows <= limit) break;
            if (size(v) !== 1 || (out.get(v) || []).length || (starts && starts.has(v))) continue;
            const ins = edges.filter((e) => e.v === v);
            const near = ins.filter((e) => col.get(e.u) === c - 1);
            if (near.length !== 1 || !near[0].quiet || ins.some((e) => col.get(e.u) >= c)) continue;
            const u = near[0].u;
            if (bandOf(u) !== b || (held.get(u) || 0) >= 2) continue;
            const left = mine.filter((h) => col.get(h) === c - 1).reduce((s, h) => s + size(h) + (held.get(h) || 0), 0);
            if (left + 1 > limit) continue;
            sats.set(v, u);
            held.set(u, (held.get(u) || 0) + 1);
            col.set(v, c - 1);
            rows -= 1;
          }
        }
        // a move makes the lines from the column before one longer: the fewest first. A unit alone in its
        // column stays: moving it only moves the same rows one column on (a contract with its stacked
        // implementation is two rows, more than a later band's limit of one, and went on to column 64)
        const longer = (h) => edges.filter((e) => e.v === h && col.get(e.u) === c - 1).reduce((s, e) => s + e.w, 0);
        const leaves = here().filter((h) => !sats.has(h) && !(out.get(h) || []).some((e) => !e.back))
          .sort((x, y) => longer(x) - longer(y) || visitIx(y) - visitIx(x));
        while (rows > limit && leaves.length && here().length > 1) {
          const h = leaves.shift();
          col.set(h, c + 1);
          rows -= size(h);
        }
        if (Math.max(...mine.map((h) => col.get(h))) <= c) break;
      }
      for (const h of mine) push(h);
      if (b === bands[0]) wide = Math.max(...mine.map((h) => col.get(h))) + 1;
    }
    // a later band follows what it points at: as far right as its arrows allow
    for (const b of [...new Set(heads.map(bandOf))].sort((x, y) => x - y).slice(1)) {
      const mine = heads.filter((h) => bandOf(h) === b);
      const into = edges.filter((e) => bandOf(e.u) === b && bandOf(e.v) < b);
      if (!into.length) continue;
      const d = Math.min(...into.map((e) => col.get(e.v) - col.get(e.u)));
      if (d > 0) for (const h of mine) col.set(h, col.get(h) + d);
    }
    return sats;
  }

  /** Crossings between two neighbouring columns: pairs of segments whose ends swap order. */
  function crossingsOf(segs, pos) {
    let n = 0;
    for (let i = 0; i < segs.length; i += 1) {
      const [a, b] = segs[i];
      for (let j = i + 1; j < segs.length; j += 1) {
        const [c, d] = segs[j];
        if ((pos.get(a) - pos.get(c)) * (pos.get(b) - pos.get(d)) < 0) n += 1;
      }
    }
    return n;
  }

  /**
   * The order inside each column of a band, long arrows given a stand-in per
   * column they pass. Returns { layers: Map(c -> [items]), chains: [[items]] }.
   */
  function orderBand(heads, edges, col, visitIx, drift, hard) {
    const items = new Map();
    const layers = new Map();
    const put = (it) => {
      items.set(it.key, it);
      if (!layers.has(it.c)) layers.set(it.c, []);
      layers.get(it.c).push(it);
    };
    for (const h of heads) put({ key: h, head: h, c: col.get(h), order: visitIx(h) });
    const inBand = new Set(heads);
    const segs = [];
    const chains = [];
    for (const e of edges) {
      if (!inBand.has(e.u) || !inBand.has(e.v)) continue;
      const cu = col.get(e.u);
      const cv = col.get(e.v);
      if (cu === cv) continue;
      const [a, b] = cu < cv ? [e.u, e.v] : [e.v, e.u];
      const [ca, cb] = cu < cv ? [cu, cv] : [cv, cu];
      const chain = [items.get(a)];
      for (let c = ca + 1; c < cb; c += 1) {
        const d = { key: `${e.id}#${c}`, dummy: e.id, c, order: visitIx(a) + 0.5, w: e.w };
        put(d);
        chain.push(d);
      }
      chain.push(items.get(b));
      chains.push({ e, chain, reversed: cu > cv });
      for (let k = 0; k + 1 < chain.length; k += 1) segs.push([chain[k].key, chain[k + 1].key, chain[k].c]);
    }
    const cols = [...layers.keys()].sort((x, y) => x - y);
    const side0 = (x) => (hard ? Math.sign((drift && x.head && drift.get(x.head)) || 0) : 0);
    for (const c of cols) layers.get(c).sort((x, y) => side0(x) - side0(y) || x.order - y.order);
    const pos = new Map();
    const index = () => { for (const c of cols) layers.get(c).forEach((it, i) => pos.set(it.key, i)); };
    index();
    const left = new Map();
    const right = new Map();
    for (const [a, b] of segs) {
      if (!right.has(a)) right.set(a, []);
      if (!left.has(b)) left.set(b, []);
      right.get(a).push(b);
      left.get(b).push(a);
    }
    const bySide = new Map(cols.map((c) => [c, segs.filter((s) => s[2] === c)]));
    const total = () => cols.reduce((s, c) => s + crossingsOf(bySide.get(c) || [], pos), 0);
    let best = total();
    let snap = new Map(cols.map((c) => [c, layers.get(c).slice()]));
    for (let it = 0; it < SWEEPS; it += 1) {
      const down = it % 2 === 0;
      const seq = down ? cols.slice(1) : cols.slice(0, -1).reverse();
      for (const c of seq) {
        const nb = down ? left : right;
        // a part with lines to a lane below drifts down, to a lane above up
        const L = layers.get(c);
        const key = new Map(L.map((x) => {
          const ns = nb.get(x.key) || [];
          const d = (drift && x.head && drift.get(x.head)) || 0;
          const sum = ns.reduce((s, k) => s + pos.get(k), 0) + Math.abs(d) * (d > 0 ? L.length : -1);
          const n = ns.length + Math.abs(d);
          return [x.key, n ? sum / n : pos.get(x.key)];
        }));
        const side = side0;
        layers.get(c).sort((x, y) => side(x) - side(y) || key.get(x.key) - key.get(y.key) || pos.get(x.key) - pos.get(y.key));
        layers.get(c).forEach((x, i) => pos.set(x.key, i));
      }
      // swap neighbours while that lowers the crossings
      for (const c of cols) {
        const L = layers.get(c);
        for (let i = 0; i + 1 < L.length; i += 1) {
          if (side0(L[i]) !== side0(L[i + 1])) continue;
          const before = total();
          [L[i], L[i + 1]] = [L[i + 1], L[i]];
          pos.set(L[i].key, i);
          pos.set(L[i + 1].key, i + 1);
          if (total() >= before) {
            [L[i], L[i + 1]] = [L[i + 1], L[i]];
            pos.set(L[i].key, i);
            pos.set(L[i + 1].key, i + 1);
          }
        }
      }
      const t = total();
      if (t < best) { best = t; snap = new Map(cols.map((c) => [c, layers.get(c).slice()])); }
    }
    for (const c of cols) layers.set(c, snap.get(c));
    index();
    return { layers, chains, cols, crossings: best };
  }

  /** Least squares under order: positions >= previous + gap, closest to the wishes (pool adjacent violators). */
  function pav(want, weight, offset) {
    const blocks = [];
    for (let i = 0; i < want.length; i += 1) {
      let b = { sum: weight[i] * (want[i] - offset[i]), w: weight[i], n: 1 };
      b.v = b.sum / b.w;
      while (blocks.length && blocks[blocks.length - 1].v > b.v) {
        const p = blocks.pop();
        b = { sum: p.sum + b.sum, w: p.w + b.w, n: p.n + b.n };
        b.v = b.sum / b.w;
      }
      blocks.push(b);
    }
    const out = [];
    for (const b of blocks) for (let k = 0; k < b.n; k += 1) out.push(b.v + offset[out.length]);
    return out;
  }

  /**
   * The heights inside a band: every item gets a top so the arrows run as
   * straight as they can. `sizeOf(item)` gives { h, anchors: Map(head or
   * member -> y from the top) }; gaps between items come from `gapOf`.
   */
  function heights(band, sizeOf, gapOf, anchorOf, ROUNDS, slack, drift) {
    const { layers, chains, cols } = band;
    const top = new Map();
    const stack = new Map();
    for (const c of cols) {
      let y = 0;
      layers.get(c).forEach((it, i, L) => {
        top.set(it.key, y);
        y += sizeOf(it).h + (i + 1 < L.length ? gapOf(it, L[i + 1]) : 0);
      });
      stack.set(c, y);
    }
    // the band is as high as its fullest column, give or take a little
    const H = Math.max(...stack.values()) * (slack || 1);
    // the pulls: every segment of every chain, weighted
    const pulls = new Map();
    const add = (a, b, ma, mb, w) => {
      if (!pulls.has(a.key)) pulls.set(a.key, []);
      pulls.get(a.key).push({ other: b, mine: ma, theirs: mb, w });
    };
    for (const { e, chain } of chains) {
      for (let k = 0; k + 1 < chain.length; k += 1) {
        const a = chain[k];
        const b = chain[k + 1];
        const ma = a.dummy ? null : (a.head === e.u ? e.from : e.to);
        const mb = b.dummy ? null : (b.head === e.u ? e.from : e.to);
        add(a, b, ma, mb, e.w);
        add(b, a, mb, ma, e.w);
      }
    }
    const at = (it, member) => top.get(it.key) + anchorOf(it, member);
    for (let r = 0; r < ROUNDS; r += 1) {
      const seq = r % 2 === 0 ? cols : cols.slice().reverse();
      for (const c of seq) {
        const L = layers.get(c);
        const want = [];
        const weight = [];
        const offset = [];
        let acc = 0;
        L.forEach((it, i) => {
          const ps = pulls.get(it.key) || [];
          const cand = [[top.get(it.key), 0.02]];
          for (const p of ps) cand.push([at(p.other, p.theirs) - anchorOf(it, p.mine), p.w]);
          const d = (drift && it.head && drift.get(it.head)) || 0;
          if (d) cand.push([d > 0 ? H - sizeOf(it).h : 0, Math.abs(d)]);
          const sw = cand.reduce((t, [, w]) => t + w, 0);
          // first the mean, to settle; then the median, so a part lines up with one neighbour exactly
          let wish = cand.reduce((t, [v, w]) => t + v * w, 0) / sw;
          if (r >= ROUNDS / 2) {
            cand.sort((x, y) => x[0] - y[0]);
            let acc2 = 0;
            for (const [v, w] of cand) { acc2 += w; if (acc2 >= sw / 2) { wish = v; break; } }
          }
          want.push(wish);
          weight.push(sw);
          offset.push(acc);
          acc += sizeOf(it).h + (i + 1 < L.length ? gapOf(it, L[i + 1]) : 0);
        });
        const room = Math.max(0, H - stack.get(c));
        const got = pav(want, weight, offset);
        L.forEach((it, i) => top.set(it.key, Math.max(offset[i], Math.min(offset[i] + room, got[i]))));
      }
    }
    let min = Infinity;
    for (const c of cols) for (const it of layers.get(c)) min = Math.min(min, top.get(it.key));
    for (const [k, v] of top) top.set(k, Math.round(v - min));
    return top;
  }

  const api = { unitsOf, groupsOf, columnsOf, balance, orderBand, heights, pav };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdOrder = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
