/**
 * The whole v5 page kit (templates/overview-v5) booted on a model in a stand-in document, as the browser runs it
 * inside the overview's frame: the page's one script (the vendored ELK, then every module in load order,
 * lib/v5-assets.cjs) in a fresh context with real elements where the code builds them (aidlc-turbo-design-fake-dom.ts),
 * a soft stub for the rest, and the English texts in the page's text block. BUILT is the model of the invented Acme
 * Shop gift card intent after the build (fixtures/aidlc-turbo-v5/built.json, made from record.yaml beside it).
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import vm from 'vm';
import { fakeDom } from './aidlc-turbo-design-fake-dom';

export const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
export const KIT = path.join(FLOW, 'templates/overview-v5');
export const FIX = path.resolve(__dirname, '../../fixtures/aidlc-turbo-v5');
const req = createRequire(import.meta.url);
export const kit = (f: string) => readFileSync(path.join(KIT, f), 'utf8');

export const clone = (x: unknown) => JSON.parse(JSON.stringify(x));
export const BUILT = JSON.parse(readFileSync(path.join(FIX, 'built.json'), 'utf8'));
/** The English table's `v5` section, as the page carries it. */
export const TEXT = req(path.join(FLOW, 'scripts/lib/lang.cjs')).load('en').v5;

/** Before the build: the built model with no story merged yet, at the inception, without the build. */
export function planned() {
  const m = clone(BUILT);
  m.phase = 'inception';
  delete m.build;
  for (const u of m.stories) for (const k of ['merged', 'first', 'files', 'tests', 'commits', 'mr', 'url', 'branch']) delete u[k];
  for (const p of Object.values(m.parts) as any[]) delete p.build;
  return m;
}

// ---------- a stand-in document: real elements where the code builds them, a soft stub for the rest ----------
/** Anything: every member another stub, callable, constructible, empty when iterated, '' or 0 as a value. */
export function stub(): any {
  const own: Record<PropertyKey, unknown> = Object.create(null);
  return new Proxy(function () {}, {
    get: (_t, k) => {
      if (k in own) return own[k];
      if (k === Symbol.iterator) return function* () {};
      if (k === Symbol.toPrimitive) return (h: string) => (h === 'number' ? 0 : '');
      if (typeof k === 'symbol') return undefined;
      own[k] = stub();
      return own[k];
    },
    set: (_t, k, v) => { own[k] = v; return true; },
    apply: () => stub(),
    construct: () => stub(),
  });
}

const BODY_IDS = [...kit('body.html').matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
let script: vm.Script | null = null;
/** The page's whole script, compiled once. */
const page = () => (script = script || new vm.Script(req(path.join(FLOW, 'scripts/lib/v5-assets.cjs')).v5Assets().js as string, { filename: 'v5-page.js' }));

/** The kit booted on a model: the page's whole script run in a fresh context, as the browser runs it. With `timers`
 *  the page gets the real setTimeout, which the vendored ELK needs to lay out a view; with `start` its fonts load at
 *  once, so the page opens on the system context as it does in the browser. `globals` are laid on the window before
 *  the page runs, getters as getters: the window around the frame (parent, C4_EMBED), its listeners, a storage that
 *  counts. `text` replaces the texts the page carries. */
export function boot(model: any, o: { timers?: boolean; start?: boolean; globals?: object; text?: object } = {}) {
  const d = fakeDom();
  const ids = new Map<string, any>();
  const px = new WeakMap<object, any>();
  const wrap = (n: any): any => {
    if (px.has(n)) return px.get(n);
    const p = new Proxy(n, {
      get: (t, k) => {
        if (k in t) { const v = t[k]; return v && typeof v === 'object' && px.has(v) ? px.get(v) : v; }
        if (typeof k === 'symbol' || k === 'then') return undefined;
        t[k] = stub();
        return t[k];
      },
      set: (t, k, v) => { t[k] = v; if (k === 'id') ids.set(String(v), p); return true; },
    });
    px.set(n, p);
    return p;
  };
  const make = (tag: string) => {
    const e = wrap(d.node(tag));
    e.remove = () => { if (e.parent) e.parent.children = e.parent.children.filter((c: any) => c !== e); };
    if (tag === 'canvas') e.getContext = () => ({ font: '', measureText: (t: string) => ({ width: String(t).length * 7 }) });
    return e;
  };
  // the shell's elements, each inside one stage as the page's are; the text block with the table's v5 section
  let stage: any = null;
  const textBlock = { textContent: JSON.stringify(o.text || TEXT) };
  const byId = (id: string) => {
    if (id === 'v5-text') return textBlock;
    if (!ids.has(id) && BODY_IDS.includes(id)) {
      stage = stage || make('main');
      const e = make('div');
      e.id = id;
      stage.append(e);
    }
    return ids.get(id) || null;
  };
  const doc = new Proxy(d.doc, {
    get: (t, k) => {
      if (k === 'getElementById') return byId;
      if (k === 'createElement') return make;
      if (k === 'createElementNS') return (_ns: string, tag: string) => make(tag);
      if (k === 'querySelector') return (s: string) => (/^#[\w-]+$/.test(s) ? byId(s.slice(1)) : make('div'));
      if (k === 'querySelectorAll') return () => [];
      if (k === 'fonts') return { load: () => (o.start ? Promise.resolve() : new Promise(() => {})) };
      if (k === 'body' || k === 'documentElement') return wrap(t[k]);
      if (k in t) return t[k];
      return typeof k === 'symbol' ? undefined : stub();
    },
  });
  const ctx: any = {
    document: doc, console,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {}, removeEventListener() {} }),
    location: { hash: '' }, history: { pushState() {}, replaceState() {} },
    navigator: stub(), getComputedStyle: () => stub(), getSelection: () => null,
    ResizeObserver: class { observe() {} disconnect() {} }, MutationObserver: class { observe() {} disconnect() {} }, IntersectionObserver: class { observe() {} disconnect() {} },
    HTMLElement: function HTMLElement() {}, Element: function Element() {}, CSS: { escape: (s: string) => s, supports: () => false },
    addEventListener() {}, removeEventListener() {}, innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1, performance: { now: () => 0 },
  };
  if (o.timers) Object.assign(ctx, { setTimeout, clearTimeout });
  if (o.globals) Object.defineProperties(ctx, Object.getOwnPropertyDescriptors(o.globals));
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  // the model made inside the page's own realm, as the browser parses its data block: the vendored ELK reads the
  // objects of a view (an edge's own record among them) and takes an object of another realm for no object at all
  ctx.C4 = { model: vm.runInContext('JSON.parse', ctx)(JSON.stringify(model)) };
  page().runInContext(ctx);
  return { ctx, C4: ctx.C4, byId, d };
}

/** Every element under e, e itself first. */
export const all = (e: any): any[] => [e, ...(e.children || []).filter((c: any) => c && c.children).flatMap(all)];
export const text = (e: any) => String(e.textContent);
/** Wait, in real time, until `test` holds (the vendored ELK lays out on its own timers). */
export async function until(test: () => boolean) {
  for (let i = 0; i < 300 && !test(); i++) await new Promise((r) => setTimeout(r, 10));
}
