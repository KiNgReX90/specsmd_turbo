/**
 * Unit tests for lib/v5-model.cjs, the v5 page model built from an intent's records (with lib/v5-c4.cjs), on the
 * invented Acme Shop gift card intent (fixtures/aidlc-turbo-v5/record.yaml) written into a fresh artifact root:
 * - the title, the phase from the brief, the language of the record, the intent branch; the stories with
 *   their number, title, short name and plain text;
 * - the scaffold half maps every drawn designModel() part and link onto the v5 keys, a part without a layer folded
 *   into the `near` of its part;
 * - the C4 half reads technical_design.c4 and derives the stories and status of an element from what it holds, and
 *   the context, containers and per-container views from the elements, their edges and the Code Scaffold's calls,
 *   their titles from the record's string table;
 * - a record without the C4 block or the plain texts builds, with those fields absent, never filled in;
 * - the seam for the build half, and the model is the shape the kit reads;
 * - the libraries load Node builtins and the flow's own lib only.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'fs';
import { builtinModules, createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';
import { FLOW, FIX, clone } from './aidlc-turbo-v5-boot';

const LIB = path.join(FLOW, 'scripts/lib');
const req = createRequire(import.meta.url);
const v5 = req(path.join(LIB, 'v5-model.cjs'));
const { designModel } = req(path.join(LIB, 'design-model.cjs'));
const { parseYaml, dumpYaml } = req(path.join(LIB, 'yaml-subset.cjs'));

const RECORD = parseYaml(readFileSync(path.join(FIX, 'record.yaml'), 'utf8'));
const BRIEF = { title: 'Pay with a gift card', status: 'approved', branch: 'shop/gift-cards/intent' };

/** The fixture's intent in a fresh artifact root: its record, `edit`ed first, and a brief with `brief` in its
 *  front matter (a key set to null left out). No story files: the stories are the record's. */
function intentOf(edit: (r: any) => void = () => {}, brief: Record<string, string | null> = {}, table?: object) {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-v5-model-')), '.specs-aidlc-turbo');
  const dir = path.join(root, 'docs', 'shop', 'gift-cards');
  mkdirSync(dir, { recursive: true });
  const record = clone(RECORD);
  edit(record);
  writeFileSync(path.join(dir, 'record.yaml'), dumpYaml(record));
  const front = Object.entries({ ...BRIEF, ...brief }).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`).join('\n');
  writeFileSync(path.join(dir, 'brief.md'), `---\n${front}\n---\n\n# ${BRIEF.title}\n`);
  if (table) {
    mkdirSync(path.join(root, 'repo', 'lang'), { recursive: true });
    writeFileSync(path.join(root, 'repo', 'lang', `${record.intent.language}.json`), JSON.stringify(table));
  }
  const at = (f: string) => path.join(dir, f);
  const intent = { slug: 'gift-cards', inception: 'shop', dir, record: at('record.yaml'), brief: at('brief.md'), stories: at('stories'), tests: at('tests') };
  return { root, intent, record };
}
const model = (...a: Parameters<typeof intentOf>) => { const { root, intent } = intentOf(...a); return v5.v5Model(root, intent); };
const ids = (a: any[]) => a.map((x) => x.id);

/** What the kit reads, checked on a model: every reference lands on something the model holds. */
function contract(M: any) {
  for (const k of ['title', 'phase', 'lang', 'intentBranch', 'stories', 'parts', 'links', 'persons', 'systems', 'containers', 'components', 'outside', 'views']) {
    expect(M, k).toHaveProperty(k);
  }
  expect(typeof M.title).toBe('string');
  for (const u of M.stories) expect([typeof u.n, typeof u.title, typeof u.short]).toEqual(['number', 'string', 'string']);
  for (const p of Object.values<any>(M.parts)) {
    expect(['screen', 'server', 'database', 'external']).toContain(p.layer);
    expect(Array.isArray(p.near) && Array.isArray(p.stories)).toBe(true);
  }
  for (const l of M.links) expect(!!M.parts[l.from] && !!M.parts[l.to], l.id).toBe(true);
  for (const k of Object.values<any>(M.components)) {
    expect(M.containers[k.c], k.id).toBeTruthy();
    for (const pid of k.parts) expect(M.parts[pid], `${k.id} ${pid}`).toBeTruthy();
  }
  for (const [pid, sid] of Object.entries<any>(M.outside)) expect(!!M.parts[pid] && !!M.systems[sid]).toBe(true);
  for (const c of Object.values<any>(M.containers)) if (c.zoom) expect(M.views[c.zoom].of).toBe(c.id);
  for (const [key, v] of Object.entries<any>(M.views)) {
    const nodes = new Set(v.nodes.map((n: any) => n.id));
    for (const e of v.edges) expect(nodes.has(e.from) && nodes.has(e.to), `${key} ${e.from}>${e.to}`).toBe(true);
    for (const id of (v.boundary && v.boundary.children) || []) expect(nodes.has(id), `${key} ${id}`).toBe(true);
  }
  expect(JSON.parse(JSON.stringify(M))).toEqual(M);
}

describe('v5Model: the title and the stories', () => {
  it('names the title, the phase from the brief, the language of the record and the intent branch', () => {
    expect(model()).toMatchObject({ title: 'Pay with a gift card', phase: 'inception', lang: 'en', intentBranch: 'shop/gift-cards/intent' });
    expect(model(undefined, { status: 'building' }).phase).toBe('construction');
    expect(model(undefined, { status: 'done' }).phase).toBe('construction');
    const { root, intent } = intentOf(undefined, { status: 'done' });
    expect(v5.v5Model(root, intent, 'inception').phase).toBe('inception');
    expect(model(undefined, { branch: null }).intentBranch).toBeNull();
    // without a title in the brief, the record's
    expect(model((r) => { r.intent.title = 'Gift cards at checkout'; }, { title: null }).title).toBe('Gift cards at checkout');
  });

  it('gives each story its number, title, short name and plain text', () => {
    expect(model().stories).toEqual([
      { id: '001', n: 1, title: 'Check the balance of a gift card', short: 'Gift card balance', what: 'At checkout the customer enters a gift card code and sees its balance.' },
      { id: '002', n: 2, title: 'Pay part of an order with a gift card', short: 'Pay with gift card', what: 'The order books the gift card part and charges only the rest to the payment provider.' },
      { id: '003', n: 3, title: 'Show the gift card on the order status page', short: 'Gift card on status', what: 'The order status page shows how much of the order the gift card paid.' },
    ]);
  });
});

describe('v5Model: the scaffold half', () => {
  it('maps every drawn part onto the v5 keys, a part without a layer folded into its part', () => {
    const { root, intent, record } = intentOf();
    const design = designModel(record);
    const M = v5.v5Model(root, intent);
    expect(Object.keys(M.parts)).toEqual(design.parts.filter((p: any) => p.layer).map((p: any) => p.id));
    expect(M.parts['giftcard-service']).toEqual({
      id: 'giftcard-service', name: 'GiftCardService', kind: 'class', sub: 'balance and booking', status: 'new',
      path: 'shop-server/src/main/java/com/acme/shop/giftcards/GiftCardService.java', what: 'Reads the balance of a gift card and books an amount on it.',
      near: ['GiftCardServiceTest'], stories: ['001', '002'], layer: 'server', module: 'server', lines: null,
    });
    expect(M.parts['giftcard-test']).toBeUndefined();
    expect(M.parts['payment-api']).toMatchObject({ layer: 'external', status: 'existing' });
  });

  it('maps every link, with the stories that walk it and whether the intent touches it', () => {
    const { root, intent, record } = intentOf();
    const M = v5.v5Model(root, intent);
    expect(ids(M.links)).toEqual(designModel(record).links.map((l: any) => l.id));
    expect(M.links.find((l: any) => l.from === 'giftcard-field')).toEqual({
      id: 'giftcard-field-giftcard-controller', from: 'giftcard-field', to: 'giftcard-controller', kind: 'calls', label: 'asks the balance',
      code: 'POST /giftcards/balance', step: 'The field asks the server for the balance.', intent: true, stories: ['001'],
    });
    // two parts that already existed: the intent does not touch the call between them
    expect(M.links.find((l: any) => l.from === 'payment-client').intent).toBe(false);
  });

  it('has no parts and no links without a drawing', () => {
    const M = model((r) => { delete r.technical_design.drawing; });
    expect([M.parts, M.links]).toEqual([{}, []]);
  });
});

describe('v5Model: the C4 half', () => {
  it('reads the elements and derives their stories and status from what they hold', () => {
    const M = model();
    expect(M.components['k-giftcards']).toEqual({
      id: 'k-giftcards', c: 'c-server', name: 'Gift cards', kind: 'component', tech: 'Spring', desc: 'The balance and the booking of gift cards.',
      parts: ['giftcard-controller', 'giftcard-service'], status: 'new', stories: ['001', '002'],
    });
    expect(M.components['k-payments']).toMatchObject({ status: 'existing', stories: [] });
    expect(M.components['k-checkout']).toMatchObject({ status: 'changed', icon: 'screen' });
    expect(M.containers['c-server']).toMatchObject({ system: 's-shop', kind: 'container', status: 'changed', stories: ['001', '002', '003'], zoom: 'c-server' });
    expect(M.containers['c-db']).toMatchObject({ kind: 'db', status: 'changed' });
    expect(M.systems['s-shop']).toMatchObject({ kind: 'system', status: 'changed', stories: ['001', '002', '003'] });
    expect(M.systems['s-pay']).toMatchObject({ ext: true, status: 'existing', tech: 'REST', stories: [] });
    expect(M.persons['p-customer']).toEqual({ id: 'p-customer', name: 'Customer', kind: 'person', desc: 'Buys in the shop and pays with a card or a gift card.' });
    expect(M.outside).toEqual({ 'payment-api': 's-pay' });
  });

  it('keeps a status and stories the record gives', () => {
    const M = model((r) => { Object.assign(r.technical_design.c4.components[4], { status: 'changed', stories: ['002'] }); });
    expect(M.components['k-payments']).toMatchObject({ status: 'changed', stories: ['002'] });
  });

  it('draws the context with every person and system, a deeper edge lifted onto its systems', () => {
    const v = model().views.context;
    expect(v).toMatchObject({ title: 'System context', level: 1 });
    expect(ids(v.nodes)).toEqual(['p-customer', 'p-support', 's-shop', 's-pay', 's-mail']);
    expect(v.edges.map((e: any) => [e.from, e.to])).toEqual([['p-customer', 's-shop'], ['p-support', 's-shop'], ['s-shop', 's-pay'], ['s-shop', 's-mail']]);
    expect(v.edges[0]).toEqual({ from: 'p-customer', to: 's-shop', label: 'Orders and pays', intent: true, ends: false });
    expect(v.edges[3]).toMatchObject({ label: 'Sends the receipt', tech: 'SMTP', intent: false, ends: false });
  });

  it('draws the containers of the system, the calls between their parts summed per pair', () => {
    const v = model().views.containers;
    expect(v).toMatchObject({ title: 'Containers', level: 2 });
    expect(v.boundary).toEqual({ id: 's-shop', name: 'Acme Shop', tech: 'Java and web components', children: ['c-web', 'c-server', 'c-db'] });
    expect(ids(v.nodes)).toEqual(['p-customer', 'p-support', 'c-web', 'c-server', 'c-db', 's-pay', 's-mail']);
    const e = v.edges.find((x: any) => x.from === 'c-server' && x.to === 'c-db');
    expect(e).toMatchObject({ label: 'reads and writes', tech: 'SQL', intent: true });
    expect(e.calls.map((c: any) => c.label)).toEqual(['reads and books the balance', 'stores the payment split']);
  });

  it('draws one view per container with components, keyed by its zoom, titled after it', () => {
    const M = model();
    expect(Object.keys(M.views)).toEqual(['context', 'containers', 'c-web', 'c-server', 'c-db']);
    const s = M.views['c-server'];
    expect(s).toMatchObject({ title: 'Components of Shop server', level: 3, of: 'c-server' });
    expect(s.boundary).toEqual({ id: 'c-server', name: 'Shop server', tech: 'Java', children: ['k-giftcards', 'k-orders', 'k-payments'] });
    expect(ids(s.nodes)).toEqual(['k-giftcards', 'k-orders', 'k-payments', 'c-web', 'c-db', 's-pay']);
    const e = (from: string, to: string) => s.edges.find((x: any) => x.from === from && x.to === to);
    expect(e('k-orders', 'k-giftcards')).toMatchObject({ label: 'Books the gift card part', intent: true, quiet: false });
    expect(e('k-giftcards', 'c-db')).toMatchObject({ label: 'Reads and books the balance', tech: 'SQL', quiet: true });
    const keyed = model((r) => { r.technical_design.c4.containers[0].zoom = 'web'; });
    expect(Object.keys(keyed.views)).toEqual(['context', 'containers', 'web', 'c-server', 'c-db']);
    expect(keyed.containers['c-web'].zoom).toBe('web');
  });

  it('marks every edge into a system whose relation ends, at every level', () => {
    const V = model().views;
    expect(V.context.edges.find((e: any) => e.to === 's-pay').ends).toBe(true);
    expect(V.containers.edges.find((e: any) => e.to === 's-pay').ends).toBe(true);
    expect(V['c-server'].edges.filter((e: any) => e.to === 's-pay').map((e: any) => e.ends)).toEqual([true, true]);
    expect(V.containers.edges.find((e: any) => e.to === 's-mail').ends).toBe(false);
    expect(V['c-server'].edges.find((e: any) => e.to === 'c-db').ends).toBe(false);
  });

  it('takes the titles of the views from the record\'s string table, English for what it lacks', () => {
    const table = { v5: { views: { context: 'XX context', components: 'XX inside {name}' } } };
    const M = model((r) => { r.intent.language = 'xx'; }, {}, table);
    expect(M.lang).toBe('xx');
    expect([M.views.context.title, M.views.containers.title, M.views['c-web'].title]).toEqual(['XX context', 'Containers', 'XX inside Shop web app']);
  });

  it('is the shape the kit reads', () => {
    contract(model());
    contract(model(undefined, { status: 'building' }));
    contract(model((r) => { delete r.technical_design.drawing; delete r.technical_design.c4; }));
  });
});

describe('v5Model: what the records do not hold stays absent', () => {
  it('builds without the C4 block: no C4 elements and no views', () => {
    const M = model((r) => { delete r.technical_design.c4; });
    expect([M.persons, M.systems, M.containers, M.components, M.outside, M.views]).toEqual([{}, {}, {}, {}, {}, {}]);
    expect(Object.keys(M.parts)).toHaveLength(12);
    contract(M);
  });

  it('leaves out a plain text, an unknown part, an edge to nothing and a part without a layer', () => {
    const M = model((r) => {
      delete r.stories[1].plain;
      r.technical_design.c4.components[0].parts.push('ghost');
      r.technical_design.c4.edges.push({ from: 'p-customer', to: 's-nowhere', label: 'calls' });
      r.technical_design.drawing.parts.push({ id: 'loose', name: 'Loose.java', status: 'new', kind: 'class' });
    });
    expect(M.stories[0]).toHaveProperty('what');
    expect(M.stories[1]).not.toHaveProperty('what');
    expect(M.components['k-checkout'].parts).toEqual(['checkout-page', 'giftcard-field']);
    expect(M.parts).not.toHaveProperty('loose');
    for (const v of Object.values<any>(M.views)) expect(ids(v.nodes)).not.toContain('s-nowhere');
    expect(M.systems).not.toHaveProperty('s-nowhere');
    contract(M);
  });
});

describe('v5Model: the seam for the build', () => {
  it('hands the build half the model and what it was read from', () => {
    const { root, intent } = intentOf();
    let seen: any = null;
    const M = v5.v5Model(root, intent, 'construction', { afterBuild: (m: any, ctx: any) => { seen = { m, ctx }; m.stories[0].merged = 'x'; } });
    expect(seen.m).toBe(M);
    expect(M.stories[0].merged).toBe('x');
    expect([seen.ctx.phase, seen.ctx.plan, seen.ctx.table.lang]).toEqual(['construction', false, 'en']);
    expect(seen.ctx.design.parts).toHaveLength(13);
    expect(ids(seen.ctx.raw)).toEqual(['001', '002', '003']);
    expect(seen.ctx.record.technical_design.c4).toBeTruthy();
  });

  it('marks the plan only after the build, when a change is open', () => {
    const { root, intent } = intentOf();
    expect(v5.v5Model(root, intent, 'construction', { plan: true }).plan).toBe(true);
    expect(v5.v5Model(root, intent, 'inception', { plan: true })).not.toHaveProperty('plan');
    expect(v5.v5Model(root, intent, 'construction')).not.toHaveProperty('plan');
  });
});

describe('v5 libraries', () => {
  const FILES = ['v5-model.cjs', 'v5-model-build.cjs', 'v5-c4.cjs', 'v5-missing.cjs', 'v5-page.cjs', 'v5-assets.cjs'];

  it('load Node builtins and the flow\'s own lib only', () => {
    for (const f of FILES) {
      const src = readFileSync(path.join(LIB, f), 'utf8');
      for (const [, spec] of src.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
        if (spec.startsWith('.')) expect(path.resolve(LIB, spec).startsWith(path.join(FLOW, 'scripts')), `${f}: ${spec}`).toBe(true);
        else expect(builtinModules, `${f}: ${spec}`).toContain(spec.replace(/^node:/, ''));
      }
    }
  });

  it('stay under 500 lines, without a long dash', () => {
    for (const f of FILES) {
      const src = readFileSync(path.join(LIB, f), 'utf8');
      expect(src.split('\n').length, f).toBeLessThanOrEqual(500);
      expect(src, f).not.toContain('—');
    }
  });
});
