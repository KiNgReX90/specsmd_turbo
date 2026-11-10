/**
 * AI-DLC Turbo - Code Scaffold, the channel router.
 *
 * Routes the arrows of the flow from column to column: out of the right
 * side of a part, into the left side of a part further on. Every arrow has
 * its own port, spread along the side in the order of where it goes, so the
 * lines of one part never cross each other. Where an arrow changes height it
 * turns once, in the corridor between two columns, on a track of its own; the
 * tracks are ordered so the turns cross as little as they can. A long arrow
 * runs straight through the gap the flow order kept for it. An
 * implementation stacked under its contract gets a dashed bracket on the
 * left. What does not run from left to right (to another lane, back) goes
 * to the grid router (design-route.js). Pure: no DOM. The page inlines it
 * (window.TdChannel) before the layout; Node loads it for the tests.
 */
(function (root) {
  'use strict';

  const node = typeof module !== 'undefined' && module.exports;
  const order = node ? require('./design-order.js') : root.TdOrder;

  const SPACE = 16;
  const EDGE = 14;
  const MARGIN = 18;
  const TRACK = 9;
  const HEAD = 12;

  const inside = (y, j) => y > Math.min(j.y1, j.y2) + 0.5 && y < Math.max(j.y1, j.y2) - 0.5;
  /** Crossings when turn s runs left of turn t in the same corridor. */
  const clash = (s, t) => (inside(t.y1, s) ? 1 : 0) + (inside(s.y2, t) ? 1 : 0);

  /** Drop repeated points and the middle of three points on one line. */
  function simplify(points) {
    const out = [];
    for (const p of points) {
      const last = out[out.length - 1];
      if (last && last[0] === p[0] && last[1] === p[1]) continue;
      const before = out[out.length - 2];
      if (before && last && ((before[0] === last[0] && last[0] === p[0]) || (before[1] === last[1] && last[1] === p[1]))) out.pop();
      out.push(p);
    }
    return out;
  }

  /**
   * ctx: { chains: [{ e, chain, reversed }] from the flow order, brackets:
   * [{ id, from, to, c }], blockOf(id) -> { y, top, body }, NH, yOf(stand-in) }.
   * Returns { turns: Map(corridor -> number of tracks), points(xOf, BW) ->
   * Map(link id -> points) }. Corridor c lies right of column c; -1 is the
   * margin left of the first column.
   */
  function plan(ctx) {
    const { blockOf, NH } = ctx;
    const runs = ctx.chains.filter((c) => !c.reversed);
    const sides = new Map();
    const sideOf = (id, s) => {
      const k = `${id}|${s}`;
      if (!sides.has(k)) sides.set(k, { id, s, ends: [] });
      return sides.get(k).ends;
    };
    for (const r of runs) {
      sideOf(r.e.from, 'R').push({ key: `${r.e.id}|0`, r, end: 0 });
      sideOf(r.e.to, 'L').push({ key: `${r.e.id}|1`, r, end: 1 });
    }
    for (const b of ctx.brackets) {
      sideOf(b.from, 'L').push({ key: `${b.id}|0`, want: b.up === false ? 1e6 : -1e6 });
      sideOf(b.to, 'L').push({ key: `${b.id}|1`, want: b.up === false ? -1e6 : 1e6 });
    }
    const port = new Map();
    const body = (id) => {
      const b = blockOf(id);
      const t = b.y + b.top;
      const h = b.body || NH;
      return [t + EDGE, t + h - EDGE, t + h / 2];
    };
    // where an end heads: the next stand-in, or the port at the other end
    const toward = (x) => {
      if (x.want !== undefined) return x.want;
      const { r, end } = x;
      const it = end === 0 ? r.chain[1] : r.chain[r.chain.length - 2];
      if (it.dummy) return ctx.yOf(it);
      const other = `${r.e.id}|${1 - end}`;
      return port.has(other) ? port.get(other) : body(end === 0 ? r.e.to : r.e.from)[2];
    };
    for (let round = 0; round < 3; round += 1) {
      for (const { id, s, ends } of sides.values()) {
        let [lo, hi] = body(id);
        // the round build mark on the top left corner: a line comes in under it
        if (s === 'L' && blockOf(id).mark) lo = Math.max(lo, blockOf(id).y + 20);
        const want = ends.map(toward);
        const ix = ends.map((_, i) => i).sort((a, b) => want[a] - want[b] || a - b);
        const n = ends.length;
        const space = n > 1 ? Math.min(SPACE, (hi - lo) / (n - 1)) : 0;
        const offset = ix.map((_, j) => j * space);
        const got = order.pav(ix.map((i) => Math.max(lo - 1e3, Math.min(hi + 1e3, want[i]))), ix.map(() => 1), offset);
        ix.forEach((i, j) => {
          const z = Math.max(lo, Math.min(hi - (n - 1) * space, got[j] - offset[j]));
          port.set(ends[i].key, Math.round(z + offset[j]));
        });
      }
    }

    // a line that arrives at the height another one leaves from in the same corridor would run on top of it: nudge it
    const leaves = new Map();
    for (const r of runs) {
      const k = `${r.chain[0].c}|${port.get(`${r.e.id}|0`)}`;
      leaves.set(k, (leaves.get(k) || 0) + 1);
    }
    for (const r of runs) {
      const key = `${r.e.id}|1`;
      const c = r.chain[r.chain.length - 2].c;
      if (!leaves.has(`${c}|${port.get(key)}`) || r.chain.length === 2 && port.get(`${r.e.id}|0`) === port.get(key)) continue;
      const [lo, hi, mid] = body(r.e.to);
      const taken = new Set([...sides.get(`${r.e.to}|L`).ends].map((x) => port.get(x.key)));
      for (const d of port.get(key) < mid ? [10, -10, 20, -20] : [-10, 10, -20, 20]) {
        const y = port.get(key) + d;
        if (y < lo || y > hi || [...taken].some((t) => Math.abs(t - y) < 8) || leaves.has(`${c}|${y}`)) continue;
        port.set(key, y);
        break;
      }
    }

    // the hops of every run, column to column, and the turns per corridor
    const turns = new Map();
    const turn = (c, j) => {
      if (!turns.has(c)) turns.set(c, []);
      turns.get(c).push(j);
    };
    const legs = [];
    for (const r of runs) {
      const last = r.chain.length - 1;
      const ys = r.chain.map((it, k) => (k === 0 ? port.get(`${r.e.id}|0`) : k === last ? port.get(`${r.e.id}|1`) : Math.round(ctx.yOf(it))));
      const hops = [];
      for (let k = 0; k < last; k += 1) {
        const h = { c: r.chain[k].c, y1: ys[k], y2: ys[k + 1] };
        hops.push(h);
        if (h.y1 !== h.y2) turn(h.c, h);
      }
      legs.push({ id: r.e.id, hops });
    }
    const brackets = ctx.brackets.map((b) => {
      const h = { c: b.c - 1, y1: port.get(`${b.id}|0`), y2: port.get(`${b.id}|1`), bracket: true };
      turn(h.c, h);
      return { id: b.id, h };
    });
    // the order of the turns in a corridor: each where it crosses least, then swaps while that helps
    for (const list of turns.values()) {
      const plain = list.filter((j) => !j.bracket).sort((a, b) => a.y1 - b.y1 || a.y2 - b.y2);
      const placed = [];
      for (const j of plain) {
        let at = 0;
        let least = Infinity;
        for (let p = 0; p <= placed.length; p += 1) {
          let k = 0;
          placed.forEach((o, i) => { k += i < p ? clash(o, j) : clash(j, o); });
          if (k < least) { least = k; at = p; }
        }
        placed.splice(at, 0, j);
      }
      for (let pass = 0, swapped = true; swapped && pass < 20; pass += 1) {
        swapped = false;
        for (let i = 0; i + 1 < placed.length; i += 1) {
          if (clash(placed[i + 1], placed[i]) < clash(placed[i], placed[i + 1])) {
            [placed[i], placed[i + 1]] = [placed[i + 1], placed[i]];
            swapped = true;
          }
        }
      }
      // a bracket hugs its own column
      list.splice(0, list.length, ...placed, ...list.filter((j) => j.bracket));
    }
    const width = new Map([...turns].map(([c, l]) => [c, l.length]));

    /** The points, once the columns have their x. */
    function points(xOf, BW) {
      const xj = new Map();
      for (const [c, list] of turns) {
        const L = c < 0 ? 4 : xOf[c] + BW + MARGIN;
        const R = c < 0 ? xOf[0] - 8 : xOf[c + 1] - MARGIN;
        const n = list.length;
        const step = n > 1 ? Math.min(TRACK * 2, (R - L) / (n - 1)) : 0;
        const x0 = (L + R) / 2 - (step * (n - 1)) / 2;
        list.forEach((j, i) => xj.set(j, Math.round(x0 + i * step)));
      }
      const out = new Map();
      for (const { id, hops } of legs) {
        const pts = [];
        for (const h of hops) {
          pts.push([xOf[h.c] + BW, h.y1]);
          if (h.y1 !== h.y2) pts.push([xj.get(h), h.y1], [xj.get(h), h.y2]);
          pts.push([xOf[h.c + 1], h.y2]);
        }
        out.set(id, simplify(pts));
      }
      for (const { id, h } of brackets) {
        const x = xOf[h.c + 1];
        out.set(id, [[x, h.y1], [xj.get(h), h.y1], [xj.get(h), h.y2], [x, h.y2]]);
      }
      return out;
    }
    return { turns: width, points };
  }

  const hitsBox = (p, q, r) => Math.min(p[0], q[0]) < r.x + r.w && Math.max(p[0], q[0]) > r.x
    && Math.min(p[1], q[1]) < r.y + r.h && Math.max(p[1], q[1]) > r.y;
  const segsOf = (pts) => pts.slice(1).map((q, k) => [pts[k], q]);
  /** Crossings and shared stretches of one route with the others. */
  function clashes(pts, others) {
    let n = 0;
    for (const [a, b] of segsOf(pts)) {
      const ha = a[1] === b[1];
      for (const o of others) {
        for (const [c, d] of segsOf(o)) {
          const hc = c[1] === d[1];
          if (ha !== hc) {
            const [h1, h2, v1, v2] = ha ? [a, b, c, d] : [c, d, a, b];
            if (v1[0] > Math.min(h1[0], h2[0]) + 1 && v1[0] < Math.max(h1[0], h2[0]) - 1
              && h1[1] > Math.min(v1[1], v2[1]) + 1 && h1[1] < Math.max(v1[1], v2[1]) - 1) n += 1;
          } else {
            const k = ha ? 1 : 0;
            const j = 1 - k;
            const span = Math.min(Math.max(a[j], b[j]), Math.max(c[j], d[j])) - Math.max(Math.min(a[j], b[j]), Math.min(c[j], d[j]));
            if (Math.abs(a[k] - c[k]) < 10 && span > 1) n += 3;
          }
        }
      }
    }
    return n;
  }

  /**
   * One bend instead of two: a line that turns in a corridor leaves its part
   * through the top or the bottom, or enters the other part there, when that
   * crosses nothing new and runs through nothing. Changes `fixed` in place.
   */
  function straighten(fixed, blocks, obstacles, ends, order) {
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const used = [];
    const free = (pts, a, b) => {
      for (const [p, q] of segsOf(pts)) {
        for (const r of blocks) {
          const own = r === a || r === b;
          const g = own ? { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 } : { x: r.x - 8, y: r.y - 8, w: r.w + 16, h: r.h + 16 };
          if (hitsBox(p, q, g)) return false;
        }
        for (const r of obstacles) if (hitsBox(p, q, { x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 })) return false;
      }
      return !used.some((u) => Math.abs(u[0] - pts[0][0]) < 16 && Math.abs(u[1] - pts[0][1]) < 1)
        && !used.some((u) => Math.abs(u[0] - pts[pts.length - 1][0]) < 16 && Math.abs(u[1] - pts[pts.length - 1][1]) < 1);
    };
    const flat = (p, q) => p[1] === q[1];
    // the moves: leave through the top or bottom of the source, or come in through the top or bottom of the target
    const moves = [];
    for (const id of order) {
      const pts = fixed.get(id);
      if (!pts || pts.length < 4) continue;
      const a = byId.get(ends.get(id)[0]);
      const b = byId.get(ends.get(id)[1]);
      if (!a || !b) continue;
      const n = pts.length;
      if (flat(pts[0], pts[1]) && !flat(pts[1], pts[2]) && flat(pts[2], pts[3])) {
        const y = pts[2][1];
        // nested so they never cross: on the bottom the lowest goes left, on the top the highest
        if (y > a.y + a.h) moves.push({ id, end: 0, blk: a, edge: a.y + a.h, y, key: [a.id, 1, -y] });
        if (y < a.y) moves.push({ id, end: 0, blk: a, edge: a.y, y, key: [a.id, 0, y] });
      }
      if (flat(pts[n - 2], pts[n - 1]) && !flat(pts[n - 3], pts[n - 2]) && flat(pts[n - 4], pts[n - 3])) {
        const y = pts[n - 3][1];
        // the last stretch keeps room for the arrow head
        if (y <= b.y - HEAD) moves.push({ id, end: 1, blk: b, edge: b.y, y, key: [b.id, 2, -y] });
        if (y >= b.y + b.h + HEAD) moves.push({ id, end: 1, blk: b, edge: b.y + b.h, y, key: [b.id, 3, y] });
      }
    }
    const cmp = (p, q) => { for (let k = 0; k < 3; k += 1) if (p.key[k] !== q.key[k]) return p.key[k] < q.key[k] ? -1 : 1; return 0; };
    moves.sort(cmp);
    for (const mv of moves) {
      const pts = fixed.get(mv.id);
      const n = pts.length;
      const a = byId.get(ends.get(mv.id)[0]);
      const b = byId.get(ends.get(mv.id)[1]);
      // the move still fits the route as it is now
      if (mv.end === 0 && !(n >= 4 && flat(pts[0], pts[1]) && pts[2][1] === mv.y && pts[0][0] === a.x + a.w)) continue;
      if (mv.end === 1 && !(n >= 4 && flat(pts[n - 2], pts[n - 1]) && pts[n - 3][1] === mv.y && pts[n - 1][0] === b.x)) continue;
      const others = [...fixed].filter(([k]) => k !== mv.id).map(([, v]) => v);
      const before = clashes(pts, others);
      for (let x = mv.blk.x + 16; x <= mv.blk.x + mv.blk.w - 16; x += 8) {
        const t = mv.end === 0 ? [[x, mv.edge], [x, mv.y], ...pts.slice(3)] : [...pts.slice(0, n - 3), [x, mv.y], [x, mv.edge]];
        if (!free(t, a, b) || clashes(t, others) > before) continue;
        fixed.set(mv.id, simplify(t));
        used.push([x, mv.edge]);
        break;
      }
    }
  }

  const api = { plan, simplify, straighten, clashes, MARGIN, TRACK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdChannel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
