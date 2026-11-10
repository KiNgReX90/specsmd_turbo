/* The four C4 levels as views, and their layout. Levels 1 to 3 come from the page data; level 4 (the code of one
   component) is built here from the drawing's parts and proven calls, its neighbours summed per component or system.
   Every view is laid out once by ELK (layered, orthogonal lines, each text on its own line), top to bottom and left
   to right, and the one that fits the window best is kept. */
(function () {
  'use strict';
  const C4 = window.C4;
  const { wrap, width, FONT, KIND, PART_KIND, capFirst, joinLabels, OWN } = C4.kit;
  const { measure, stretch } = C4.shapes;

  let M = null;
  let compOf = new Map();
  // each container's own view (level 3) and the other way round, from the model alone: no id is known beforehand
  let zoomOf = new Map();
  let holder = new Map();
  const views = new Map();
  const laid = new Map();
  const elk = typeof ELK === 'function' ? new ELK() : null;

  const LEVEL = { context: 1, containers: 2 };
  function init(model) {
    M = model;
    compOf = new Map(Object.values(M.components || {}).flatMap((k) => (k.parts || []).map((id) => [id, k.id])));
    // a container zooms into its own view: the one under its zoom key, else under its id
    const vs = M.views || {};
    zoomOf = new Map(Object.entries(M.containers || {}).map(([id, c]) => [c.id || id, c.zoom || c.id || id])
      .filter(([, key]) => vs[key] && !LEVEL[key] && !String(key).startsWith('code:')));
    holder = new Map([...zoomOf].map(([cid, key]) => [key, cid]));
  }

  const levelOf = (key) => (String(key).startsWith('code:') ? 4 : holder.has(key) ? 3 : LEVEL[key] || 1);
  /** The view of a container's components, or null when it has none. */
  const viewOfContainer = (cid) => zoomOf.get(cid) || null;
  /** The intent's own system as the system context draws it (C4.kit.OWN), when the model has the containers to zoom into. */
  const ownSystem = () => (M.views && M.views.containers ? (M.views.containers.boundary || {}).id || OWN : null);

  /** One level up, and the element there that holds this view: a component's code in its container's view, a
   *  container's components in the containers with that container, the containers in the system context with the
   *  own system. */
  function parentOf(key) {
    if (String(key).startsWith('code:')) { const k = M.components[key.slice(5)]; return k && viewOfContainer(k.c) ? { key: viewOfContainer(k.c), at: k.id } : null; }
    if (holder.has(key)) return { key: 'containers', at: holder.get(key) };
    if (key === 'containers') return { key: 'context', at: ownSystem() };
    return null;
  }

  function viewOf(key) {
    if (views.has(key)) return views.get(key);
    let v = null;
    if (String(key).startsWith('code:')) v = codeView(key.slice(5));
    else if (M.views && M.views[key]) v = { ...M.views[key], nodes: M.views[key].nodes.map(enrich) };
    if (!v) return null;
    v.key = key;
    v.level = levelOf(key);
    // from level 2 on a person is one line: level 1 already said who they are
    if (v.level >= 2) v.nodes = v.nodes.map((n) => (n.kind === 'person' ? { ...n, compact: true } : n));
    views.set(key, v);
    return v;
  }
  /** A card's way in: the own system to the containers, a container to its components, a component to its code. */
  function enrich(n) {
    const out = { ...n };
    delete out.zoom;
    if (n.id === ownSystem()) out.zoom = 'containers';
    else if (n.kind === 'component') out.zoom = 'code:' + n.id;
    else if (!n.ext && viewOfContainer(n.id)) out.zoom = viewOfContainer(n.id);
    return out;
  }

  // ---------- level 4: the code of one component ----------
  const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');
  function partIcon(p) {
    if (p.kind === 'job') return 'clock';
    if (p.layer === 'screen' || p.kind === 'web component') return 'screen';
    if (p.kind === 'table' || p.kind === 'view') return 'table';
    if (p.kind === 'SQL script') return 'script';
    if (p.kind === 'endpoint') return 'plug';
    return 'code';
  }
  function partNode(pid) {
    const p = M.parts[pid];
    return { id: pid, kind: 'code', name: p.name, desc: cap(p.sub), tech: PART_KIND[p.kind] || KIND.code, status: p.status, stories: p.stories, icon: partIcon(p), part: true,
      ...C4.shapes.buildOf(p) };
  }
  function refNode(oid) {
    const k = M.components[oid];
    if (k) return { id: oid, kind: 'ref', name: k.name, tech: k.tech, desc: '', status: k.status, stories: k.stories, icon: k.icon, zoom: 'code:' + oid };
    const s = M.systems[oid] || M.containers[oid] || { name: oid };
    return { id: oid, kind: 'ref', name: s.name, tech: s.tech, desc: '', ext: !!s.ext, status: s.status || 'existing', db: s.kind === 'db', icon: s.ext ? 'globe' : 'system' };
  }
  function codeView(kid) {
    const k = M.components[kid];
    if (!k) return null;
    const inside = new Set(k.parts);
    const near = new Map();
    const sums = new Map();
    const add = (from, to, l) => {
      const key = from + '>' + to;
      const e = sums.get(key) || { from, to, labels: [], calls: [], intent: false };
      if (l.label && !e.labels.includes(l.label)) e.labels.push(l.label);
      e.calls.push(l);
      e.intent = e.intent || !!l.intent;
      sums.set(key, e);
    };
    for (const l of M.links) {
      const a = inside.has(l.from), b = inside.has(l.to);
      if (a && b) { add(l.from, l.to, l); continue; }
      if (!a && !b) continue;
      const other = a ? l.to : l.from;
      const oid = M.outside[other] || compOf.get(other);
      if (!oid || oid === kid) continue;
      if (!near.has(oid)) near.set(oid, refNode(oid));
      if (a) add(l.from, oid, l); else add(oid, l.to, l);
    }
    // a line to a system that the system context draws as stopping (dashed) stops here too
    const ending = new Set((((M.views || {}).context || {}).edges || []).filter((e) => e.ends).map((e) => e.to));
    const nodes = [...k.parts.map(partNode), ...near.values()];
    // a line to a file the build did not make, or did not use, goes quiet with its card
    const gone = new Set(nodes.filter((n) => n.dev === 'gone').map((n) => n.id));
    const edges = [...sums.values()].map((e) => ({ ...e, label: joinLabels(e.labels), ends: ending.has(e.to), gone: gone.has(e.from) || gone.has(e.to) }));
    return { title: k.name, level: 4, of: kid, container: k.c,
      boundary: { id: kid, name: k.name, type: `[${KIND.component}: ${k.tech}]`, children: k.parts }, nodes, edges };
  }

  /** What a view is about: the elements inside its boundary, or the own system in the system context. */
  const aboutOf = (v) => (v.boundary ? v.boundary.children : v.nodes.filter((n) => n.id === OWN).map((n) => n.id));

  // ---------- layout ----------
  /** C4's reading order: persons, and any outside caller from level 3 on, on top; what the view is about in the middle;
   *  what it calls below. A line from below is laid out the other way round and drawn with its arrow at the start. */
  function rankOf(v) {
    const inside = new Set(aboutOf(v));
    const calls = new Set(v.edges.map((e) => e.from)), called = new Set(v.edges.map((e) => e.to));
    const byId = new Map(v.nodes.map((n) => [n.id, n]));
    return (id) => {
      const n = byId.get(id);
      if (!n) return 1;
      if (n.kind === 'person' || n.top) return 0;
      if (inside.has(id)) return 1;
      if ((!n.ext || v.level >= 3) && calls.has(id) && !called.has(id)) return 0;
      return 2;
    };
  }
  const OPTS = {
    'elk.algorithm': 'layered', 'elk.edgeRouting': 'ORTHOGONAL', 'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.layered.spacing.nodeNodeBetweenLayers': '44', 'elk.spacing.nodeNode': '32', 'elk.spacing.edgeNode': '20',
    'elk.spacing.edgeEdge': '18', 'elk.spacing.edgeLabel': '4', 'elk.layered.spacing.edgeNodeBetweenLayers': '22',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '16', 'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'elk.layered.crossingMinimization.thoroughness': '40', 'elk.padding': '[top=20,left=20,bottom=20,right=20]',
    'elk.edgeLabels.inline': 'true', 'elk.layered.mergeEdges': 'true',
  };
  /** Every card measured, and the cards of one kind in one row made as tall as the tallest of them. The code cards of
   *  a view are as wide as the longest name among them, so no class name breaks in two. */
  function specsOf(v, rank) {
    const codes = v.nodes.filter((n) => n.kind === 'code');
    const codeW = codes.length ? Math.min(340, Math.max(244, ...codes.map((n) => Math.ceil(width(n.name, FONT.code)) + 66))) : 0;
    const specs = new Map(v.nodes.map((n) => [n.id, measure(n, n.kind === 'code' ? codeW : 0)]));
    const row = (n) => `${rank(n.id)}:${n.kind === 'person' ? 'p' : n.ext ? 'x' : n.kind === 'ref' ? 'r' : 'c'}`;
    const tall = new Map();
    for (const n of v.nodes) tall.set(row(n), Math.max(tall.get(row(n)) || 0, specs.get(n.id).h));
    for (const n of v.nodes) stretch(specs.get(n.id), tall.get(row(n)));
    return specs;
  }
  function graphOf(v, dir) {
    const rank = rankOf(v);
    const specs = specsOf(v, rank);
    const leaf = (n) => ({ id: n.id, width: specs.get(n.id).w, height: specs.get(n.id).h });
    const inside = new Set(v.boundary ? v.boundary.children : []);
    const children = v.nodes.filter((n) => !inside.has(n.id)).map(leaf);
    // the boundary's name sits inside at the bottom left, as C4 draws it
    if (v.boundary) children.push({ id: '__b', layoutOptions: { 'elk.padding': '[top=26,left=26,bottom=58,right=26]' }, children: v.nodes.filter((n) => inside.has(n.id)).map(leaf) });
    // calls both ways between two elements are drawn as one line
    const edges = pairs(v.edges).map((e, i) => {
      const up = rank(e.from) > rank(e.to);
      let labels = [], lab = null;
      if (!e.quiet && e.label) {
        const text = capFirst(e.label);
        const lines = e.back ? [...wrap(text, FONT.label, 196, 2), ...wrap(capFirst(e.back), FONT.label, 196, 1)] : wrap(text, FONT.label, 196, 2);
        const tech = e.tech ? `[${e.tech}]` : null;
        const w = Math.ceil(Math.max(...lines.map((t) => width(t, FONT.label)), tech ? width(tech, FONT.tech) : 0)) + 20;
        labels = [{ id: 'l' + i, text, width: w, height: lines.length * 15.5 + (tech ? 14 : 0) + 10 }];
        lab = { lines, tech };
      }
      return { id: 'e' + i, sources: [up ? e.to : e.from], targets: [up ? e.from : e.to], labels, _lab: lab, _up: up, _meta: e };
    });
    return { specs, graph: { id: 'root', layoutOptions: { ...OPTS, 'elk.direction': dir }, children, edges } };
  }

  /** Calls that go both ways between two elements are one line with an arrow at each end: the text one way on the
   *  pill's first lines, the other way's below it. Each view's own list of relations stays as it is. */
  function pairs(list) {
    const out = [], at = new Map();
    for (const e of list) {
      const back = at.get(e.to + '>' + e.from);
      if (!back) { const m = { ...e }; at.set(e.from + '>' + e.to, m); out.push(m); continue; }
      back.both = true;
      back.intent = back.intent || e.intent;
      back.ends = back.ends || e.ends;
      back.quiet = back.quiet && e.quiet;
      if (e.label && e.label !== back.label) { if (back.label) back.back = e.label; else back.label = e.label; }
    }
    return out;
  }
  /** The scale a view opens at: whole when that keeps its text near full size, else at 80% to scroll or drag. */
  const opening = (fit) => (fit >= 0.75 ? Math.min(1, fit) : 0.8);
  /** What a layout costs in the room it gets: how far it runs out of the window at the scale it would be shown at,
   *  sideways counting heavier than down. */
  function cost(l, room) {
    const s = opening(Math.min(room.w / l.res.width, room.h / l.res.height));
    return Math.max(0, l.res.width * s - room.w) * 1.6 + Math.max(0, l.res.height * s - room.h);
  }
  /** The laid-out view, from ELK once, then from memory: top to bottom as C4 reads, unless left to right runs out of
   *  the window less (a long chain, or many neighbours on one side). */
  function layout(key, room) {
    if (laid.has(key)) return laid.get(key);
    const v = viewOf(key);
    if (!v) return Promise.reject(new Error('no view'));
    if (!elk) return Promise.reject(new Error('no layout'));
    const run = (dir) => { const { specs, graph } = graphOf(v, dir); return elk.layout(graph).then((res) => ({ v, res, specs, gedges: graph.edges, dir })); };
    const r = room || { w: 1200, h: 800 };
    const p = Promise.all([run('DOWN'), run('RIGHT')]).then(([down, right]) => (cost(right, r) < cost(down, r) * 0.85 ? right : down));
    laid.set(key, p);
    p.catch(() => laid.delete(key));
    return p;
  }

  C4.layout = { init, viewOf, layout, graphOf, levelOf, parentOf, opening, compOf: (id) => compOf.get(id), viewOfContainer, aboutOf };
})();

