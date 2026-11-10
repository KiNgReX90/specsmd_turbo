/**
 * Unit tests for the system the v5 page kit (templates/overview-v5) names, js/00-kit.js SYSTEM:
 * - the intent's own system is the system of the C4 model without ext; with several, the one whose containers the
 *   model draws; the words for what lies outside it follow ("Outside {name}");
 * - a model that names no system of its own gets the table's word for it ("the system"), in the table's language;
 * - so no module of the kit names a system: every name comes from the model or the table.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync } from 'fs';
import path from 'path';
import vm from 'vm';
import { KIT, kit, clone, BUILT, TEXT } from './aidlc-turbo-v5-boot';

const MODULES = readdirSync(path.join(KIT, 'js')).filter((f) => f.endsWith('.js')).sort();

/** The shared tools of the kit (js/00-kit.js) run on a model, with the page's text block and just enough of a
 *  document to measure text. */
function kitOf(model: unknown, text: object = TEXT) {
  const node = (): any => ({ getContext: () => ({ font: '', measureText: (t: string) => ({ width: String(t).length * 7 }) }) });
  const block = { textContent: JSON.stringify(text) };
  const ctx: any = {
    document: { createElement: node, createElementNS: node, getElementById: (id: string) => (id === 'v5-text' ? block : null) },
    addEventListener() {},
    C4: { model },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(kit('js/00-kit.js'), ctx);
  return ctx.C4.kit;
}

const ext = (id: string, name: string) => ({ id, name, kind: 'system', ext: true });
const own = (id: string, name: string) => ({ id, name, kind: 'system' });

describe('aidlc-turbo v5 kit: the system it names', () => {
  it('is the system of the C4 model without ext, and what lies outside it is "Outside" that name', () => {
    const k = kitOf({ systems: { 's-shop': own('s-shop', 'Acme Shop'), 's-pay': ext('s-pay', 'Payment provider') } });
    expect([k.SYSTEM, k.OWN]).toEqual(['Acme Shop', 's-shop']);
    expect(k.STATUS.ext).toBe('Outside Acme Shop');
    const built = kitOf({ phase: 'construction', systems: { 's-shop': own('s-shop', 'Acme Shop') } });
    expect([built.built, built.STATUS.ext]).toEqual([true, 'Outside Acme Shop']);
  });

  it('with two systems of its own, the one whose containers the model draws', () => {
    const systems = { a: own('a', 'Shop admin'), b: own('b', 'Acme Shop'), x: ext('x', 'Payment provider') };
    const views = { containers: { boundary: { id: 'b', name: 'Acme Shop', children: [] } } };
    expect(kitOf({ systems, views }).SYSTEM).toBe('Acme Shop');
    expect(kitOf({ systems }).SYSTEM).toBe('Shop admin');
  });

  it('is the table\'s word for it when the model names no system of its own', () => {
    for (const model of [{ systems: { x: ext('x', 'Payment provider') } }, { systems: {} }, {}]) {
      const k = kitOf(model);
      expect([k.SYSTEM, k.OWN, k.STATUS.ext]).toEqual(['the system', null, 'Outside the system']);
    }
    const other = { ...clone(TEXT), theSystem: 'THE SYSTEM', status: { ...TEXT.status, ext: 'OUTSIDE {system}' } };
    expect(kitOf({}, other).STATUS.ext).toBe('OUTSIDE THE SYSTEM');
  });

  it('the fixture\'s model names its own system', () => {
    expect(kitOf(BUILT).SYSTEM).toBe('Acme Shop');
  });
});

describe('aidlc-turbo v5 kit: no module names a system of its own', () => {
  it('every system name on the page comes from the model or from the table (an example in a comment aside)', () => {
    const names = [...Object.values(BUILT.systems) as any[]].map((s) => s.name);
    const hits = MODULES.flatMap((f) => kit(`js/${f}`).split('\n')
      .filter((l) => names.some((n) => l.replace(/\/\*.*?\*\/|\/\/.*$/g, '').includes(n))).map((l) => `${f}: ${l.trim()}`));
    expect(hits).toEqual([]);
    expect(kit('js/00-kit.js')).toMatch(/T\('theSystem'\)/);
  });
});
