/**
 * AI-DLC Turbo - Code Scaffold, the router.
 *
 * Routes the links of the drawing as orthogonal lines through the channels
 * between the blocks. Pure: geometry in, geometry out, no DOM. The page
 * inlines it (window.TdRoute); Node loads it for the tests.
 *
 * The router lays a sparse grid over the drawing: the channel tracks the
 * layout hands in (between columns, rows and lanes) plus a short straight
 * stub in front of every port of every block. Grid points inside a block
 * (with a margin), a status icon or a title are left out, so a line can never
 * run through them. Each link is an A* search from any port of its first
 * block to any port of its second. It pays for length (more close to a
 * block or along a frame border), for a bend, for crossing another line and,
 * a lot, for sharing a stretch with a line that does not start at the same
 * block; lines from one block may share their first stretch. Two rounds of
 * rip-up and reroute let later lines push earlier ones aside.
 *
 * A large drawing runs hundreds of searches over a grid of a few hundred
 * thousand states, so the search works from tables: the grid knows every
 * step and its cost before other lines once, who uses a point or a step is
 * looked up by its index, and the heap and the distances are typed arrays
 * that every search reuses. The sums and the heap's order are those of the
 * plain version, so the lines are the same to the last point.
 */
(function router(root) {
  'use strict';

  const INFLATE = 12;
  const STUB = 16;
  const CLEAR = 30;
  const COST = { bend: 30, cross: 150, overlap: 900, port: 260, near: 1.6, border: 1.6, friend: 220, side: 60, left: 0.35 };
  const STEP = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const OPP = [1, 0, 3, 2];
  const TOP = [0.5, 0.35, 0.65, 0.2];
  const BOTTOM = [0.5, 0.35, 0.65, 0.2, 0.8];
  const SIDE = [0, -18, 18, -36, 36];

  const grow = (r, m) => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
  const within = (x, y, r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
  const uniq = (list) => [...new Set(list.map((v) => Math.round(v * 2) / 2))].sort((a, b) => a - b);
  /** Distance from a point to a rectangle, 0 inside. */
  function gap(x, y, r) {
    const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
    const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
    return Math.hypot(dx, dy);
  }
  /** The first index of the sorted `vals` above `v`. */
  function above(vals, v) {
    let lo = 0;
    let hi = vals.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (vals[mid] > v) hi = mid; else lo = mid + 1;
    }
    return lo;
  }

  /** Every place a line may leave or enter a block: on the edge, and the stub point in front of it. */
  function portsOf(b, half) {
    const out = [];
    const mid = b.y + (b.half || half || b.h / 2);
    TOP.forEach((f, rank) => {
      const x = Math.round(b.x + b.w * f);
      out.push({ px: x, py: b.y, sx: x, sy: b.y - STUB, dir: 3, rank });
    });
    BOTTOM.forEach((f, rank) => {
      const x = Math.round(b.x + b.w * f);
      out.push({ px: x, py: b.y + b.h, sx: x, sy: b.y + b.h + STUB, dir: 2, rank });
    });
    SIDE.forEach((o, rank) => {
      const y = Math.round(mid + o);
      out.push({ px: b.x, py: y, sx: b.x - STUB, sy: y, dir: 1, rank });
      out.push({ px: b.x + b.w, py: y, sx: b.x + b.w + STUB, sy: y, dir: 0, rank });
    });
    return out;
  }

  /**
   * The grid: its points, which are free, and for every point the steps it
   * may take (a bit per way) with what each costs before other lines
   * (length, near a block, along a frame border, against the reading
   * direction). A rectangle or a block marks only the points it covers or
   * comes near, found in the sorted tracks. With it the buffers every
   * search reuses: per state (a point and the way it was entered) its
   * distance and where it came from, side by side.
   */
  function buildGrid(geo, ports) {
    const xs = uniq([...geo.tracks.xs, ...ports.map((p) => p.sx)]);
    const ys = uniq([...geo.tracks.ys, ...ports.map((p) => p.sy)]);
    const nx = xs.length;
    const ny = ys.length;
    const n = nx * ny;
    const hard = [...geo.blocks.map((b) => grow(b, INFLATE)), ...geo.obstacles];
    // the points inside a rectangle, and the steps across one that has no grid line of its own
    const inside = new Uint8Array(n);
    const cutH = new Uint8Array(n);
    const cutV = new Uint8Array(n);
    for (const r of hard) {
      const i0 = above(xs, r.x);
      const j0 = above(ys, r.y);
      for (let j = j0; j < ny && ys[j] < r.y + r.h; j += 1) {
        for (let i = i0; i < nx && xs[i] < r.x + r.w; i += 1) inside[j * nx + i] = 1;
        for (let i = Math.max(0, i0 - 1); i + 1 < nx && xs[i] < r.x + r.w; i += 1) cutH[j * nx + i] = 1;
      }
      for (let i = i0; i < nx && xs[i] < r.x + r.w; i += 1) {
        for (let j = Math.max(0, j0 - 1); j + 1 < ny && ys[j] < r.y + r.h; j += 1) cutV[j * nx + i] = 1;
      }
    }
    // the distance to the nearest block, only where it is under CLEAR: farther off it costs nothing extra
    const near = new Float64Array(n).fill(Infinity);
    for (const b of geo.blocks) {
      for (let j = above(ys, b.y - CLEAR - 1); j < ny && ys[j] < b.y + b.h + CLEAR + 1; j += 1) {
        for (let i = above(xs, b.x - CLEAR - 1); i < nx && xs[i] < b.x + b.w + CLEAR + 1; i += 1) {
          const d = gap(xs[i], ys[j], b);
          if (d < near[j * nx + i]) near[j * nx + i] = d;
        }
      }
    }
    const ok = new Uint8Array(n);
    const weight = new Float32Array(n);
    const borderH = new Uint8Array(n);
    const borderV = new Uint8Array(n);
    const X = new Float64Array(n);
    const Y = new Float64Array(n);
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const p = j * nx + i;
        const x = xs[i];
        const y = ys[j];
        X[p] = x;
        Y[p] = y;
        if (x < 0 || y < 0 || x > geo.width || y > geo.height || inside[p]) continue;
        ok[p] = 1;
        weight[p] = 1 + Math.max(0, (CLEAR - near[p]) / CLEAR) * COST.near;
        if (x < geo.inner.x0 || x > geo.inner.x1) weight[p] *= 2;
        for (const f of geo.frames) {
          if (x >= f.x - 7 && x <= f.x + f.w + 7 && (Math.abs(y - f.y) < 7 || Math.abs(y - f.y - f.h) < 7)) borderH[p] = 1;
          if (y >= f.y - 7 && y <= f.y + f.h + 7 && (Math.abs(x - f.x) < 7 || Math.abs(x - f.x - f.w) < 7)) borderV[p] = 1;
        }
      }
    }
    const ways = new Uint8Array(n);
    const plain = new Float64Array(n * 4);
    for (let p = 0; p < n; p += 1) {
      if (!ok[p]) continue;
      const i = p % nx;
      const j = (p - i) / nx;
      for (let d = 0; d < 4; d += 1) {
        const ni = i + STEP[d][0];
        const nj = j + STEP[d][1];
        if (ni < 0 || nj < 0 || ni >= nx || nj >= ny || !ok[nj * nx + ni]) continue;
        // a step between two free points may still cross a small rectangle that has no grid line of its own
        if (d < 2 ? cutH[d === 0 ? p : p - 1] : cutV[d === 2 ? p : p - nx]) continue;
        const q = nj * nx + ni;
        const len = Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]);
        const c = stepCost(len, weight, borderH, borderV, p, q, d);
        ways[p] |= 1 << d;
        plain[p * 4 + d] = d === 1 ? c + len * COST.left : c;
      }
    }
    const xi = new Map(xs.map((x, i) => [x, i]));
    const yi = new Map(ys.map((y, j) => [y, j]));
    const at = (x, y) => {
      const i = xi.get(Math.round(x * 2) / 2);
      const j = yi.get(Math.round(y * 2) / 2);
      return i === undefined || j === undefined ? -1 : j * nx + i;
    };
    const xy = (p) => [xs[p % nx], ys[Math.floor(p / nx)]];
    const dp = new Float64Array(n * 8);
    for (let k = 0; k < dp.length; k += 2) { dp[k] = Infinity; dp[k + 1] = -1; }
    return { xs, ys, nx, n, ok, X, Y, weight, borderH, borderV, ways, plain, at, xy, dp,
      goal: new Uint8Array(n), open: heap(), touched: new Int32Array(n * 4) };
  }
  /** What a step of `len` from p to q, way d, costs for its length, near a block and along a frame border. */
  function stepCost(len, weight, borderH, borderV, p, q, d) {
    const c = len * (weight[p] + weight[q]) / 2;
    return (d < 2 ? borderH[p] && borderH[q] : borderV[p] && borderV[q]) ? c * COST.border : c;
  }

  /**
   * A binary min-heap of a priority and a value, in two typed arrays that
   * grow. It moves its entries exactly as a heap of [priority, value] pairs
   * that swaps them would, so equal priorities come out in the same order.
   */
  const heap = () => ({ key: new Float64Array(4096), val: new Int32Array(4096), len: 0 });
  function push(hp, pr, v) {
    if (hp.len === hp.key.length) {
      const key = new Float64Array(hp.len * 2);
      const val = new Int32Array(hp.len * 2);
      key.set(hp.key);
      val.set(hp.val);
      Object.assign(hp, { key, val });
    }
    const { key, val } = hp;
    let i = hp.len;
    hp.len += 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (key[up] <= pr) break;
      key[i] = key[up];
      val[i] = val[up];
      i = up;
    }
    key[i] = pr;
    val[i] = v;
  }
  /** The value with the lowest priority, off the heap (its priority is key[0] before). */
  function pop(hp) {
    const { key, val } = hp;
    const top = val[0];
    const len = hp.len - 1;
    hp.len = len;
    if (len > 0) {
      const pk = key[len];
      const pv = val[len];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= len) break;
        let m = i;
        let mk = pk;
        if (key[l] < mk) { m = l; mk = key[l]; }
        if (l + 1 < len && key[l + 1] < mk) m = l + 1;
        if (m === i) break;
        key[i] = key[m];
        val[i] = val[m];
        i = m;
      }
      key[i] = pk;
      val[i] = pv;
    }
    return top;
  }

  /**
   * Who already uses which grid point, grid edge and port: per point the
   * links through it flat (h) and upright (v), per grid edge (two a point:
   * to the right and down) the links along it, per port the links on it.
   */
  function occupancy(grid) {
    return { edge: new Array(2 * grid.n), h: new Array(grid.n), v: new Array(grid.n), port: new Map(), nx: grid.nx };
  }
  /** The slot of the grid edge between neighbours p and q; -1 for two points that are no neighbours, which no search asks for. */
  function edgeSlot(nx, p, q) {
    const lo = p < q ? p : q;
    const dq = p < q ? q - p : p - q;
    if (dq === nx) return 2 * lo + 1;
    return dq === 1 && (lo + 1) % nx !== 0 ? 2 * lo : -1;
  }
  function mark(occ, li, route, on) {
    const put = (list) => { if (on) list.push(li); else list.splice(list.indexOf(li), 1); };
    const at = (store, key) => { if (key >= 0) put(store[key] || (store[key] = [])); };
    const { cells, ports } = route;
    for (let k = 0; k < cells.length; k += 1) {
      const [p, d] = cells[k];
      if (k > 0) at(occ.edge, edgeSlot(occ.nx, cells[k - 1][0], p));
      at(d < 2 ? occ.h : occ.v, p);
      const nd = k + 1 < cells.length ? cells[k + 1][1] : d;
      if ((nd < 2) !== (d < 2)) at(nd < 2 ? occ.h : occ.v, p);
    }
    for (const key of ports) {
      if (!occ.port.has(key)) occ.port.set(key, []);
      put(occ.port.get(key));
    }
  }

  /** The cheapest path between any port of `a` and any port of `b`, or null. `fr[l]`: link l may share with this one. */
  function search(grid, occ, fr, a, b, portsA, portsB) {
    const { ok, X, Y, weight, borderH, borderV, ways, plain, xy, dp, goal, open, touched, nx } = grid;
    const { edge, h: flatOf, v: uprightOf } = occ;
    const delta = [1, -1, nx, -nx];
    let tn = 0;
    const startPort = new Map();
    const others = (key) => (occ.port.get(key) || []).reduce((c, l) => Math.max(c, fr[l] ? COST.friend : COST.port), 0);
    const targets = new Map();
    // between lanes a line reads best leaving at the bottom or the top, so a side costs a little
    const side = (a.band !== undefined ? a.band !== b.band : a.lane !== b.lane) ? COST.side : 0;
    for (const port of portsB) {
      const p = grid.at(port.sx, port.sy);
      if (p < 0 || !ok[p]) continue;
      const extra = port.rank * 4 + others(`${port.px},${port.py}`) + (port.dir < 2 ? side : 0);
      if (!targets.has(p)) targets.set(p, []);
      targets.get(p).push({ port, extra, inward: OPP[port.dir] });
      goal[p] = 1;
    }
    // the distance to the box around the goals: never more than to the nearest goal
    const goals = [...targets.keys()].map(xy);
    const gx0 = Math.min(...goals.map((g) => g[0]));
    const gx1 = Math.max(...goals.map((g) => g[0]));
    const gy0 = Math.min(...goals.map((g) => g[1]));
    const gy1 = Math.max(...goals.map((g) => g[1]));
    const h = (p) => {
      const x = X[p];
      const y = Y[p];
      return Math.max(0, gx0 - x, x - gx1) + Math.max(0, gy0 - y, y - gy1);
    };
    for (const port of portsA) {
      const p = grid.at(port.sx, port.sy);
      if (p < 0 || !ok[p]) continue;
      const s = p * 4 + port.dir;
      const c = port.rank * 4 + others(`${port.px},${port.py}`) + (port.dir < 2 ? side : 0);
      if (c < dp[2 * s]) {
        if (dp[2 * s] === Infinity) touched[tn++] = s;
        dp[2 * s] = c;
        startPort.set(s, port);
        push(open, c + h(p), s);
      }
    }
    let best = Infinity;
    let bestState = -1;
    let bestTarget = null;
    const crossFriend = COST.cross * 0.6;
    while (open.len) {
      const f = open.key[0];
      const s = pop(open);
      if (f >= best) break;
      const p = s >> 2;
      const d = s & 3;
      const g = dp[2 * s];
      if (f - h(p) > g + 1e-6) continue;
      if (goal[p]) {
        for (const t of targets.get(p)) {
          if (d === t.port.dir) continue;
          const total = g + t.extra + (d === t.inward ? 0 : COST.bend);
          if (total < best) { best = total; bestState = s; bestTarget = t.port; }
        }
      }
      const w = ways[p];
      for (let nd = 0; nd < 4; nd += 1) {
        if (nd === OPP[d] || !(w & (1 << nd))) continue;
        const q = p + delta[nd];
        // the sums of the plain version, in its order: only a step along another line is worked out here
        let c;
        const along = edge[2 * (nd & 1 ? q : p) + (nd >> 1)];
        if (along !== undefined && along.length) {
          const len = Math.abs(X[q] - X[p]) + Math.abs(Y[q] - Y[p]);
          c = stepCost(len, weight, borderH, borderV, p, q, nd);
          for (const l of along) c += fr[l] ? COST.friend : COST.overlap;
          // against the reading direction costs a little more
          if (nd === 1) c += len * COST.left;
        } else c = plain[p * 4 + nd];
        const across = nd < 2 ? uprightOf[q] : flatOf[q];
        if (across !== undefined) for (const l of across) c += fr[l] ? crossFriend : COST.cross;
        if (nd !== d) c += COST.bend;
        const ns = q * 4 + nd;
        const gn = g + c;
        if (gn < dp[2 * ns]) {
          if (dp[2 * ns] === Infinity) touched[tn++] = ns;
          dp[2 * ns] = gn;
          dp[2 * ns + 1] = s;
          push(open, gn + h(q), ns);
        }
      }
    }
    let out = null;
    if (bestState >= 0) {
      const cells = [];
      let s = bestState;
      while (s >= 0) { cells.unshift([s >> 2, s & 3]); s = dp[2 * s + 1]; }
      const first = startPort.get(cells[0][0] * 4 + cells[0][1]);
      const points = [[first.px, first.py], ...cells.map(([p]) => xy(p)), [bestTarget.px, bestTarget.py]];
      out = { cells, points: simplify(points), ports: [`${first.px},${first.py}`, `${bestTarget.px},${bestTarget.py}`], cost: best };
    }
    // the buffers back as they were, for the next search
    for (let k = 0; k < tn; k += 1) { dp[2 * touched[k]] = Infinity; dp[2 * touched[k] + 1] = -1; }
    for (const p of targets.keys()) goal[p] = 0;
    open.len = 0;
    return out;
  }

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
   * Route every link. `geo` has width, height, blocks, frames, obstacles,
   * tracks { xs, ys }, inner { x0, x1 } and half (where the side ports sit); `links` are { id, from, to }.
   * Returns a Map from link id to its points, first on `from`, last on `to`.
   */
  function routeLinks(geo, links, fixed) {
    const byId = new Map(geo.blocks.map((b) => [b.id, b]));
    const set = fixed || new Map();
    // the lines already drawn need their corners on the grid
    const tracks = { xs: [...geo.tracks.xs], ys: [...geo.tracks.ys] };
    for (const pts of set.values()) for (const [x, y] of pts) { tracks.xs.push(x); tracks.ys.push(y); }
    geo = { ...geo, tracks };
    // a port under a tag or an icon is no port
    const free = (pt) => !geo.obstacles.some((r) => within(pt.px, pt.py, grow(r, 3)) || within(pt.sx, pt.sy, grow(r, 1)));
    const portMap = new Map(geo.blocks.map((b) => [b.id, portsOf(b, geo.half).filter(free)]));
    const ports = [...portMap.values()].flat();
    const grid = buildGrid(geo, ports);
    const occ = occupancy(grid);
    const center = (b) => [b.x + b.w / 2, b.y + b.h / 2];
    const span = (l) => {
      const [ax, ay] = center(byId.get(l.from));
      const [bx, by] = center(byId.get(l.to));
      return Math.abs(ax - bx) + Math.abs(ay - by);
    };
    const order = links.map((l, i) => i).sort((i, j) => (links[i].prio || 0) - (links[j].prio || 0) || span(links[i]) - span(links[j]) || i - j);
    const routes = new Array(links.length).fill(null);
    links.forEach((l, i) => {
      if (!set.has(l.id)) return;
      const pts = set.get(l.id);
      routes[i] = { cells: cellsOf(grid, pts), points: pts, ports: [pts[0].join(','), pts[pts.length - 1].join(',')], fixed: true };
      mark(occ, i, routes[i], true);
    });
    for (let round = 0; round < 3; round += 1) {
      for (const i of order) {
        const link = links[i];
        if (routes[i] && routes[i].fixed) continue;
        // a fallback line never took grid points, so it has none to give back
        if (routes[i] && routes[i].cells) mark(occ, i, routes[i], false);
        // the lines this one may share a stretch with: its own, and those from the same block
        const fr = links.map((x, l) => (l === i || x.from === link.from ? 1 : 0));
        const r = search(grid, occ, fr, byId.get(link.from), byId.get(link.to), portMap.get(link.from), portMap.get(link.to));
        routes[i] = r || routes[i] || fallback(byId.get(link.from), byId.get(link.to));
        if (routes[i].cells) mark(occ, i, routes[i], true);
      }
    }
    return new Map(links.map((l, i) => [l.id, routes[i].points]));
  }

  /** The grid points a drawn line passes, with the way it goes. */
  function cellsOf(grid, pts) {
    const cells = [];
    for (let k = 0; k + 1 < pts.length; k += 1) {
      const [x1, y1] = pts[k];
      const [x2, y2] = pts[k + 1];
      const flat = y1 === y2;
      const d = flat ? (x2 > x1 ? 0 : 1) : (y2 > y1 ? 2 : 3);
      const vals = flat ? grid.xs : grid.ys;
      const lo = Math.min(flat ? x1 : y1, flat ? x2 : y2);
      const hi = Math.max(flat ? x1 : y1, flat ? x2 : y2);
      const hits = [];
      vals.forEach((v, i) => { if (v >= lo && v <= hi) hits.push(i); });
      if ((flat ? x2 < x1 : y2 < y1)) hits.reverse();
      for (const i of hits) {
        const p = flat ? grid.at(grid.xs[i], y1) : grid.at(x1, grid.ys[i]);
        if (p >= 0 && grid.ok[p] && !(cells.length && cells[cells.length - 1][0] === p)) cells.push([p, d]);
      }
    }
    return cells;
  }

  /** Only when the grid has no way through: down from one block, across, down into the other. */
  function fallback(a, b) {
    const ax = Math.round(a.x + a.w / 2);
    const bx = Math.round(b.x + b.w / 2);
    const down = b.y >= a.y + a.h;
    const ay = down ? a.y + a.h : a.y;
    const by = down ? b.y : b.y + b.h;
    const my = Math.round((ay + by) / 2);
    return { cells: null, points: simplify([[ax, ay], [ax, my], [bx, my], [bx, by]]), ports: [] };
  }

  // `text`: the router's own code, so lines kept with a page (design-layout.js) hold only for the router that drew them
  const api = { routeLinks, portsOf, INFLATE, STUB, text: () => router.toString() };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdRoute = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
