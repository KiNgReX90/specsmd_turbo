/**
 * AI-DLC Turbo - Code Scaffold, the layout.
 *
 * Turns the design model (scripts/lib/design-model.cjs) into geometry: a
 * band per start, the blocks with their module tag, and the links with their
 * labels. Pure: no DOM, no text measuring. The page inlines it
 * (window.TdLayout) after the router, the labels, the flow order, the channel
 * router and the places; Node loads it for the tests.
 *
 * First it reads the flow (flowOf): where it starts (a part nothing calls,
 * a scheduled task or a screen before the rest) and the order of the steps,
 * following the calls from the start; calling a contract runs the parts that
 * build on it. Then it places flow first (design-place.js): a column per call
 * depth, read from left to right, a later start in a band of its own. The
 * module of a part is a tag inside it, at the bottom (a part without a module
 * shows its lane there). A call that only reads or looks something up is drawn quiet: thin,
 * light, only its number, and its target sits close to its reader. A few
 * variants are drawn and the calmest is kept: fewest crossings, arrows
 * against the reading direction, lines on top of each other and bends, at a
 * size that still reads on a 1920 x 1080 screen.
 *
 * Routing the lines takes seconds on a large drawing, so a page brings the
 * lines of what it can show (model.routes, scripts/lib/design-routes.cjs,
 * worked out where the page is made): the lines kept under the key of a
 * routing (the router's own code and everything it reads) are used as they
 * are, only what the page did not bring is routed. layout(model, { keep })
 * hands the lines it routes to `keep`, for the page to bring.
 */
(function (root) {
  'use strict';

  const node = typeof module !== 'undefined' && module.exports;
  const route = node ? require('./design-route.js') : root.TdRoute;
  const labels = node ? require('./design-labels.js') : root.TdLabels;
  const place = node ? require('./design-place.js') : root.TdPlace;
  const channel = node ? require('./design-channel.js') : root.TdChannel;
  const TX = node ? require('./design-text.js') : root.TdText;

  /** The measures of the drawing. */
  const SIZE = {
    BW: 236, NH: 128, BAND: 30, START: 34, ZB: 8, X0: 28, LANE_GAP: 12, GAP_Y: 32, STACK_GAP: 30, STACK_NUM: 46, DGAP: 20,
    TOP: 30, FOOT: 22, BAND_GAP: 40, GAP_MIN: 72, GAP_MAX: 260, ROUNDS: 16, STACK_X: 76,
    // the body of a part (NH) holds a name and a summary on one line each, and grows a line for each that needs two
    LINE2: 20,
    // the module tag: a row at the bottom of the body, its text size, and the room right of it for the story number
    TAG_H: 20, TAG_PAD: 12, TAG_FS: 13, TAG_NB: 24,
    // the labels of a part: the room on their row, left of the status icon, and a second row when they do not fit
    PILLS: 144, PILL2: 27,
    // the room the page has for the drawing on a 1920 x 1080 screen
    SW: 1760, SH: 1040,
  };
  /** What reads or looks up: a call whose label starts with one of these words (design.readWords, in the page's language) is quiet. */
  const reads = (label) => {
    const words = [].concat(TX.t('design.readWords')).filter((w) => typeof w === 'string' && w && w !== 'design.readWords');
    const first = String(label || '').trim().toLowerCase();
    return words.some((w) => first === w.toLowerCase() || first.startsWith(`${w.toLowerCase()} `));
  };
  const DATA = ['enum', 'table', 'view'];

  /** What sets a flow going, best first, and how the start marker names it (design.trigger, in the page's language). */
  const TRIGGER = [
    [(p) => p.kind === 'job', 'job'],
    [(p) => p.kind === 'endpoint' || p.kind === 'servlet' || /command|api/i.test(p.kind || ''), 'call'],
    [(p) => p.layer === 'screen' || ['JSP', 'HTML', 'web component', 'JS module'].includes(p.kind), 'screen'],
    [(p) => p.kind === 'queue', 'queue'],
    [(p) => p.kind === 'migration' || p.kind === 'SQL script', 'install'],
    [() => true, 'start'],
  ];
  const rankOf = (p) => TRIGGER.findIndex(([test]) => test(p));

  /**
   * Where the flow starts and the order of its steps. Returns
   * { starts: [{ id, trigger, n }], steps: Map(link id -> number),
   *   order: [link ids], visit: [part ids in reading order] }.
   */
  function flowOf(model) {
    const calls = model.links.filter((l) => l.kind !== 'builds_on' && l.from !== l.to);
    const base = model.links.filter((l) => l.kind === 'builds_on');
    const parts = new Map(model.parts.map((p) => [p.id, p]));
    const called = new Set(calls.map((l) => l.to));
    const implementer = new Set(base.map((l) => l.from));
    const steps = new Map();
    const order = [];
    const seen = new Set();
    const visit = [];
    const walk = (id) => {
      if (seen.has(id) || !parts.has(id)) return;
      seen.add(id);
      visit.push(id);
      for (const l of calls) {
        if (l.from !== id || steps.has(l.id)) continue;
        steps.set(l.id, order.length + 1);
        order.push(l.id);
        walk(l.to);
      }
      // calling a contract runs what builds on it
      for (const l of base) if (l.to === id) walk(l.from);
    };
    const reach = (id) => {
      const out = new Set();
      const go = (x) => {
        if (out.has(x)) return;
        out.add(x);
        for (const l of calls) if (l.from === x) go(l.to);
        for (const l of base) if (l.to === x) go(l.from);
      };
      go(id);
      return out.size;
    };
    const candidates = model.parts
      .filter((p) => !called.has(p.id) && !implementer.has(p.id) && calls.some((l) => l.from === p.id))
      .map((p, i) => ({ p, i, rank: rankOf(p), reach: reach(p.id) }))
      .sort((a, b) => a.rank - b.rank || b.reach - a.reach || a.i - b.i);
    const starts = [];
    for (const c of candidates) {
      const before = order.length;
      walk(c.p.id);
      if (order.length > before || !starts.length) starts.push({ id: c.p.id, trigger: TX.t(`design.trigger.${TRIGGER[c.rank][1]}`), first: before + 1 });
    }
    // what no start reaches still gets its number, from where it begins
    for (const l of calls) if (!steps.has(l.id)) { seen.delete(l.from); walk(l.from); }
    for (const p of model.parts) if (!seen.has(p.id)) { seen.add(p.id); visit.push(p.id); }
    starts.forEach((s, i) => { s.n = starts.length > 1 ? i + 1 : null; });
    return { starts, steps, order, visit };
  }

  /**
   * The quiet calls: to a part that calls nothing and nothing builds on, that
   * is read by more than one part, holds data or is only read. A start's own
   * calls stay bold.
   */
  function quietOf(model, links, flow) {
    const calls = links.filter((l) => l.kind !== 'builds_on');
    const busy = new Set([...calls.map((l) => l.from), ...links.filter((l) => l.kind === 'builds_on').map((l) => l.to)]);
    const callers = new Map();
    for (const l of calls) callers.set(l.to, (callers.get(l.to) || 0) + 1);
    const parts = new Map(model.parts.map((p) => [p.id, p]));
    const starts = new Set(flow.starts.map((s) => s.id));
    return new Set(calls.filter((l) => !starts.has(l.from) && !busy.has(l.to)
      && (callers.get(l.to) > 1 || DATA.includes(parts.get(l.to).kind) || reads(l.label))).map((l) => l.id));
  }

  /** The module of a part, as a tag inside it at the bottom of its body, and the frame it belongs to. */
  function tagsOf(geo, model) {
    const parts = new Map(model.parts.map((p) => [p.id, p]));
    const names = new Map(model.modules.map((m) => [m.id, m.name]));
    const frameOf = new Map();
    for (const f of model.frames) for (const id of f.parts) frameOf.set(id, f.id);
    const out = [];
    const lanes = new Map(model.lanes.map((l) => [l.id, l.name]));
    for (const b of geo.blocks) {
      const p = parts.get(b.id);
      // no module: the lane says where it lives
      const name = p.module ? names.get(p.module) || p.module : lanes.get(p.layer);
      if (!name) continue;
      const x = b.x + SIZE.ZB + 14;
      const w = Math.min(b.x + SIZE.BW - 14 - SIZE.TAG_NB - x, Math.ceil(labels.textWidth(name, SIZE.TAG_FS, true) + 16));
      out.push({ id: frameOf.get(b.id) || p.module || p.layer, module: p.module || null, lane: !p.module, part: b.id, name,
        x, y: b.y + b.top + b.body - SIZE.TAG_PAD - SIZE.TAG_H, w, h: SIZE.TAG_H });
    }
    return out;
  }

  /** What a line may not cross and a label may not cover: the status icon and the story number on a part's top edge, titles. */
  function obstaclesOf(geo, model) {
    const tw = labels.textWidth;
    const out = [];
    const marked = new Set(((model && model.parts) || []).filter((p) => p.build && ['different', 'added', 'gone'].includes(p.build.state)).map((p) => p.id));
    for (const b of geo.blocks) {
      out.push({ x: b.x + b.w - 38, y: b.y - 14, w: 28, h: 28 }, { x: b.x + b.w - 67, y: b.y - 11, w: 22, h: 22 });
      if (marked.has(b.id)) out.push({ x: b.x - 11, y: b.y - 16, w: 32, h: 32 });
    }
    for (const l of geo.lanes) if (l.name) out.push({ x: 24, y: l.y + 8, w: tw(l.name, 15.5) * 1.05 + 10, h: 24 });
    return out;
  }

  /** How calm a routed drawing is: lower is better. */
  function unrest(geo, points) {
    const segs = [];
    let bends = 0;
    let back = 0;
    let length = 0;
    [...points.values()].forEach((p, e) => {
      bends += Math.max(0, p.length - 2);
      if (p[p.length - 1][0] < p[0][0] - 4) back += 1;
      for (let k = 0; k + 1 < p.length; k += 1) {
        const a = p[k];
        const b = p[k + 1];
        length += Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
        segs.push({ e, a, b, hor: a[1] === b[1] });
      }
    });
    const inside = (v, lo, hi) => v > Math.min(lo, hi) + 1 && v < Math.max(lo, hi) - 1;
    const span = (a1, a2, b1, b2) => Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2));
    let cross = 0;
    let shared = 0;
    for (let i = 0; i < segs.length; i += 1) {
      for (let j = i + 1; j < segs.length; j += 1) {
        const p = segs[i];
        const q = segs[j];
        if (p.e === q.e) continue;
        if (p.hor !== q.hor) {
          const h = p.hor ? p : q;
          const v = p.hor ? q : p;
          if (inside(v.a[0], h.a[0], h.b[0]) && inside(h.a[1], v.a[1], v.b[1])) cross += 1;
        } else if (p.hor ? p.a[1] === q.a[1] : p.a[0] === q.a[0]) {
          if ((p.hor ? span(p.a[0], p.b[0], q.a[0], q.b[0]) : span(p.a[1], p.b[1], q.a[1], q.b[1])) > 12) shared += 1;
        }
      }
    }
    // shrunk to fit the screen it reads worse: every per cent costs
    const fit = Math.min(1, SIZE.SW / geo.width, SIZE.SH / geo.height);
    const small = Math.max(0, 0.9 - fit) * 3000 + (1 - fit) * 600;
    return { score: cross * 100 + back * 80 + shared * 100 + bends * 14 + length * 0.004 + small, cross, back, shared, bends, fit };
  }

  /** A 53-bit hash of a text, in base 36 (cyrb53). */
  function hash(s) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  let router = null;
  /** The key of a routing: the router's own code, and everything route.routeLinks reads of the drawing and the links. */
  function routeKey(geo, links) {
    router = router || hash(route.text());
    const box = (r) => [r.x, r.y, r.w, r.h];
    return router + '.' + hash(JSON.stringify([geo.width, geo.height, geo.half, geo.inner, geo.tracks,
      geo.blocks.map((b) => [b.id, ...box(b), b.half, b.band, b.lane]), geo.obstacles.map(box), geo.frames.map(box),
      links.map((l) => [l.id, l.from, l.to, l.prio || 0]), [...geo.fixed]]));
  }
  /** The lines of a variant: those the model brings for it, else routed (and handed to `keep`). */
  function routesOf(model, geo, links, keep) {
    const key = routeKey(geo, links);
    const brought = model.routes && model.routes[key];
    if (brought) return new Map(brought.map(([id, pts]) => [id, pts.map((pt) => pt.slice())]));
    const points = route.routeLinks(geo, links, geo.fixed);
    if (keep) keep[key] = [...points];
    return points;
  }

  /** The variants worth drawing: how many parts a column may hold, and whether a later band may sit under what it points at. */
  const CAPS = [
    (n) => Math.max(3, Math.ceil(Math.sqrt(1.4 * n))),
    (n) => Math.max(3, Math.ceil(Math.sqrt(1.4 * n)) + 1),
    (n) => Math.max(3, Math.ceil(Math.sqrt(1.4 * n)) + 2),
    () => Infinity,
  ];
  const VARIANTS = CAPS.flatMap((cap) => [{ cap, hard: true, across: 1 }, { cap, hard: true, across: 0 }]);

  /** The whole drawing for a design model; `opts.keep` collects the lines it routes, by their key. */
  function layout(model, opts) {
    const flow = flowOf(model);
    const laneIds = new Set(model.lanes.map((l) => l.id));
    const ids = model.parts.filter((p) => laneIds.has(p.layer)).map((p) => p.id);
    const known = new Set(ids);
    const links = model.links.filter((l) => known.has(l.from) && known.has(l.to) && l.from !== l.to);
    const quiet = quietOf(model, links, flow);
    const rank = new Map(flow.order.map((id, i) => [id, i]));
    const prio = (l) => (quiet.has(l.id) ? 1 : 0);
    const ordered = links.slice().sort((a, b) => prio(a) - prio(b) || (rank.has(a.id) ? rank.get(a.id) : 1e6) - (rank.has(b.id) ? rank.get(b.id) : 1e6));
    // every variant with the lines from left to right; the grid router only for the two calmest
    const ends = new Map(links.map((l) => [l.id, [l.from, l.to]]));
    const seen = new Set();
    const tried = [];
    for (const v of VARIANTS) {
      const geo = place.arrange(model, flow, ids, links, quiet, v, SIZE);
      const key = JSON.stringify(geo.blocks.map((b) => [b.x, b.y]));
      if (seen.has(key)) continue;
      seen.add(key);
      geo.tags = tagsOf(geo, model);
      geo.obstacles = obstaclesOf(geo, model);
      channel.straighten(geo.fixed, geo.blocks, geo.obstacles, ends, ordered.map((l) => l.id));
      geo.inner = { x0: 14, x1: geo.width - 14 };
      geo.half = SIZE.NH / 2;
      tried.push({ geo, pre: unrest(geo, geo.fixed).score + 150 * (links.length - geo.fixed.size) });
    }
    let best = null;
    for (const { geo } of tried.sort((a, b) => a.pre - b.pre).slice(0, 2)) {
      const points = routesOf(model, geo, ordered.map((l) => ({ ...l, prio: prio(l) })), opts && opts.keep);
      const u = unrest(geo, points);
      if (!best || u.score < best.u.score) best = { geo, points, u };
    }
    const { geo, points } = best;
    const texts = new Map(links.map((l) => [l.id, { text: quiet.has(l.id) ? null : l.label, n: flow.steps.get(l.id) || null }]));
    const placed = labels.placeLabels(geo, links, points, texts, flow.order);
    const fill = (box) => {
      const cy = box.y + box.h / 2;
      const cx = box.x + box.w / 2;
      const lane = geo.lanes.slice().reverse().find((r) => cy >= r.y && cy <= r.y + r.h && cx >= r.x && cx <= r.x + r.w);
      return lane ? lane.fill : 'page';
    };
    return {
      width: geo.width,
      height: geo.height,
      lanes: geo.lanes,
      frames: [],
      tags: geo.tags,
      blocks: geo.blocks,
      flow,
      calm: best.u,
      links: links.map((l) => {
        const label = placed.get(l.id);
        return { id: l.id, from: l.from, to: l.to, kind: l.kind, quiet: quiet.has(l.id), step: flow.steps.get(l.id) || null,
          points: points.get(l.id), label: label ? { ...label, bg: fill(label.box) } : null };
      }),
    };
  }

  const api = { layout, flowOf, quietOf, SIZE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
