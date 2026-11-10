/**
 * Unit tests for the v5 page kit (templates/overview-v5) on any ids, not only the fixture's:
 * - the own system is the system without ext (C4.kit.SYSTEM) and zooms into the containers; a container zooms into
 *   its own view (its zoom key, else its id), a component view zooms out to the containers with that container
 *   chosen, the containers out to the system context with the own system chosen (js/03-layout.js);
 * - the zoom path names each container by its name and its buttons reach every container's view (js/08-path.js);
 * - the inspector counts the own system as what the system context is about (js/05-panel.js);
 * - so the Acme Shop model with every id of its C4 half renamed, once with zoom keys of their own and once without
 *   zoom keys, walks the same way as on its own ids: in and out through every C4 level, the path and the inspector;
 * - no module names an id of the fixture or compares a view key to one.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync } from 'fs';
import path from 'path';
import { KIT, kit, clone, BUILT, boot, all, text, until } from './aidlc-turbo-v5-boot';

const MODULES = readdirSync(path.join(KIT, 'js')).filter((f) => f.endsWith('.js')).sort();

/** The model with every id of its C4 half renamed; with `zoom` each container's view gets a key of its own, without
 *  it the containers lose their zoom keys and each component view goes under its container's new id. Gives the model
 *  and the way back to the fixture's ids. */
function renamed(m: any, zoom = true) {
  const out = clone(m);
  const ids = new Map<string, string>();
  const n: Record<string, number> = {};
  const put = (list: string[], prefix: string) => list.forEach((id) => {
    if (!ids.has(id)) ids.set(id, `${prefix}.${(n[prefix] = (n[prefix] || 0) + 1)}`);
  });
  put(Object.keys(out.systems), 'system');
  put(Object.keys(out.containers), 'box');
  put(Object.keys(out.components), 'piece');
  put(Object.keys(out.persons || {}), 'who');
  const id = (x: string) => ids.get(x) ?? x;
  const keyed = (o: any, f: (e: any) => void) => Object.fromEntries(Object.entries(o).map(([k, e]: [string, any]) => { f(e); return [id(k), e]; }));
  // the view of each container: a key of its own, or its new id
  const viewKey = new Map<string, string>();
  Object.values(out.containers).forEach((c: any, i: number) => { if (c.zoom) viewKey.set(c.zoom, zoom ? `view-${i + 1}` : id(c.id)); });
  const node = (x: any) => {
    x.id = id(x.id);
    if (x.c) x.c = id(x.c);
    if (x.system) x.system = id(x.system);
    if (x.zoom && viewKey.has(x.zoom)) { if (zoom) x.zoom = viewKey.get(x.zoom); else delete x.zoom; }
  };
  out.systems = keyed(out.systems, node);
  out.containers = keyed(out.containers, node);
  out.components = keyed(out.components, node);
  out.persons = keyed(out.persons || {}, node);
  out.outside = Object.fromEntries(Object.entries(out.outside || {}).map(([p, s]) => [p, id(s as string)]));
  out.views = Object.fromEntries(Object.entries(out.views).map(([k, v]: [string, any]) => {
    v.nodes.forEach(node);
    for (const e of v.edges) { e.from = id(e.from); e.to = id(e.to); }
    if (v.of) v.of = id(v.of);
    if (v.boundary) { v.boundary.id = id(v.boundary.id); v.boundary.children = v.boundary.children.map(id); }
    return [viewKey.get(k) ?? k, v];
  }));
  const idBack = new Map([...ids].map(([a, b]) => [b, a]));
  const keyBack = new Map([...viewKey].map(([a, b]) => [b, a]));
  /** A view key and a choice in the fixture's ids. */
  const back = (key: string | null, sel: string | null) => [
    key && (keyBack.get(key) ?? (key.startsWith('code:') ? 'code:' + (idBack.get(key.slice(5)) ?? key.slice(5)) : key)),
    sel && (idBack.get(sel) ?? sel),
  ];
  return { model: out, back };
}
const same = (key: string | null, sel: string | null) => [key, sel];

/** The page walked through every C4 level and back, then the path's buttons; each stop in the fixture's ids, with
 *  the text of the path and of the inspector. */
async function walk(m: any, back: (k: string | null, s: string | null) => any[]) {
  const { C4, byId } = boot(m, { timers: true });
  const A = C4.app;
  const M = C4.model;
  const stops: any[] = [];
  const stop = (what: string) => {
    const s = A.state();
    stops.push([what, ...back(s.key, s.sel), text(byId('path')), text(byId('side'))]);
  };
  const own = (Object.values(M.systems) as any[]).find((s) => !s.ext);
  await A.go('context');
  stop('begin');
  await A.zoomInto(own.id);
  stop('into the system');
  for (const c of Object.values(M.containers) as any[]) {
    await A.zoomInto(c.id);
    stop('into ' + c.name);
    const k = (Object.values(M.components) as any[]).find((x) => x.c === c.id);
    await A.zoomInto(k.id);
    stop('into ' + k.name);
    await A.zoomOut();
    stop('out of ' + k.name);
    await A.zoomOut();
    stop('out of ' + c.name);
  }
  await A.zoomOut();
  stop('out of the system');
  // the path's container buttons, from the system context
  for (const b of all(byId('path')).filter((x) => x.tag === 'button' && !x.className)) {
    b.click();
    await until(() => A.state().key !== 'context');
    stop('path ' + text(b));
    await A.go('context');
  }
  return stops;
}

// each walk lays out every view with ELK: about a second alone, more beside the suite
const SLOW = 20000;

describe('aidlc-turbo v5 kit: zoom on the fixture\'s own ids', () => {
  it('zooms in through every level and out onto the element it came from', async () => {
    const stops = await walk(BUILT, same);
    expect(stops.slice(0, 15).map((s) => [s[0], s[1], s[2]])).toEqual([
      ['begin', 'context', null],
      ['into the system', 'containers', null],
      ['into Shop web app', 'c-web', null],
      ['into Checkout', 'code:k-checkout', null],
      ['out of Checkout', 'c-web', 'k-checkout'],
      ['out of Shop web app', 'containers', 'c-web'],
      ['into Shop server', 'c-server', null],
      ['into Gift cards', 'code:k-giftcards', null],
      ['out of Gift cards', 'c-server', 'k-giftcards'],
      ['out of Shop server', 'containers', 'c-server'],
      ['into Shop database', 'c-db', null],
      ['into Order tables', 'code:k-tables', null],
      ['out of Order tables', 'c-db', 'k-tables'],
      ['out of Shop database', 'containers', 'c-db'],
      ['out of the system', 'context', 's-shop'],
    ]);
  }, SLOW);

  it('the path names each container by its name and opens its view', async () => {
    const stops = await walk(BUILT, same);
    const path = stops.filter((s) => s[0].startsWith('path '));
    expect(path.map((s) => [s[0], s[1]])).toEqual([['path Shop web app', 'c-web'], ['path Shop server', 'c-server'], ['path Shop database', 'c-db']]);
    expect(path[0][3]).toContain('Shop web appShop serverShop database');
  }, SLOW);

  it('the inspector of the system context counts the own system as what it is about, whatever its id', async () => {
    /** The inspector's groups with nothing chosen: each heading and the names on its chips. */
    const groups = async (m: any) => {
      const { C4, byId } = boot(m, { timers: true });
      await C4.app.go('context');
      const out: [string, string[]][] = [];
      for (const x of all(byId('side')).filter((e) => e.tag === 'h3' || (e.tag === 'ul' && e.className === 'chips'))) {
        if (x.tag === 'h3') out.push([x.own, []]); else if (out.length) out[out.length - 1][1].push(...x.children.map(text));
      }
      return out;
    };
    const mine = await groups(BUILT);
    const own = mine.find(([, names]) => names.includes('Acme Shop'));
    expect(own && own[0]).toMatch(/^(New|Changed|Existing)$/);
    expect(await groups(renamed(BUILT).model)).toEqual(mine);
  }, SLOW);
});

describe('aidlc-turbo v5 kit: any ids walk the same', () => {
  it('every id renamed, zoom keys of their own', async () => {
    const r = renamed(BUILT);
    expect(Object.keys(r.model.views)).toEqual(['context', 'containers', 'view-1', 'view-2', 'view-3']);
    expect(await walk(r.model, r.back)).toEqual(await walk(BUILT, same));
  }, SLOW);

  it('every id renamed, no zoom keys: each component view under its container\'s id', async () => {
    const r = renamed(BUILT, false);
    expect(Object.keys(r.model.views)).toEqual(['context', 'containers', 'box.1', 'box.2', 'box.3']);
    expect(await walk(r.model, r.back)).toEqual(await walk(BUILT, same));
  }, SLOW);

  it('the layout knows each container\'s view and the own system, from the model alone', () => {
    const { model } = renamed(BUILT, false);
    const L = boot(model).C4.layout;
    expect(L.viewOfContainer('box.1')).toBe('box.1');
    expect([L.levelOf('context'), L.levelOf('containers'), L.levelOf('box.2'), L.levelOf('code:piece.3')]).toEqual([1, 2, 3, 4]);
    expect(L.parentOf('box.3')).toEqual({ key: 'containers', at: 'box.3' });
    expect(L.parentOf('containers')).toEqual({ key: 'context', at: 'system.1' });
    expect(L.parentOf('code:piece.3')).toEqual({ key: 'box.2', at: 'piece.3' });
    const own = L.viewOf('context').nodes.find((x: any) => x.id === 'system.1');
    expect(own.zoom).toBe('containers');
    expect(L.viewOf('containers').nodes.filter((x: any) => x.zoom).map((x: any) => [x.id, x.zoom]))
      .toEqual([['box.1', 'box.1'], ['box.2', 'box.2'], ['box.3', 'box.3']]);
  });

  it('a container without components has no view to zoom into, and its own system without containers none either', () => {
    const m = clone(BUILT);
    for (const k of Object.values(m.components) as any[]) if (k.c === 'c-db') delete m.components[k.id];
    delete m.views['c-db'];
    delete m.containers['c-db'].zoom;
    const L = boot(m).C4.layout;
    expect(L.viewOfContainer('c-db')).toBe(null);
    expect(L.viewOf('containers').nodes.find((x: any) => x.id === 'c-db').zoom).toBeUndefined();
    const bare = clone(BUILT);
    delete bare.views.containers;
    expect(boot(bare).C4.layout.viewOf('context').nodes.find((x: any) => x.id === 's-shop').zoom).toBeUndefined();
  });
});

describe('aidlc-turbo v5 kit: no id of the fixture in the code', () => {
  const lines = (word: RegExp) => MODULES.flatMap((f) => kit(`js/${f}`).split('\n').map((l, i) => [f, i + 1, l] as const)
    .filter(([, , l]) => word.test(l.replace(/\/\*.*?\*\/|\/\/.*$/g, ''))).map(([f, i, l]) => `${f}:${i}: ${l.trim()}`));

  it('names no id of the fixture\'s elements in a string', () => {
    const ids = [...Object.keys(BUILT.systems), ...Object.keys(BUILT.containers), ...Object.keys(BUILT.components), ...Object.keys(BUILT.persons)];
    const quoted = new RegExp(`['"\`](${ids.map((x) => x.replace(/-/g, '\\-')).join('|')})['"\`]`);
    expect(lines(quoted)).toEqual([]);
  });

  it('compares no view key to a container\'s', () => {
    expect(lines(/(key|zoom)\s*===\s*'c-/)).toEqual([]);
  });
});
