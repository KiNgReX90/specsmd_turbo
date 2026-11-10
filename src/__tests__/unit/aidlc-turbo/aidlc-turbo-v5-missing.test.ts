/**
 * Unit tests for lib/v5-missing.cjs, the honest report of the new data a record does not carry for the v5 page:
 * the C4 block (technical_design.c4) and the plain texts (intent.plain, stories[].plain). Every gap names its record
 * path and the element it belongs to; the report fills nothing in. The record is the invented Acme Shop gift card
 * intent (fixtures/aidlc-turbo-v5/record.yaml), which holds it all.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { FLOW, FIX } from './aidlc-turbo-v5-boot';

const req = createRequire(import.meta.url);
const { missing, missingLines } = req(path.join(FLOW, 'scripts/lib/v5-missing.cjs'));
const { parseYaml } = req(path.join(FLOW, 'scripts/lib/yaml-subset.cjs'));

/** The fixture's record: a Code Scaffold, the C4 block and every plain text. */
const complete = () => parseYaml(readFileSync(path.join(FIX, 'record.yaml'), 'utf8'));
/** The same record as an inception without the new data writes it: no C4 block and no plain texts. */
function bare() {
  const r = complete();
  delete r.technical_design.c4;
  delete r.intent.plain;
  for (const s of r.stories) delete s.plain;
  return r;
}
const at = (gaps: any[], p: string) => gaps.filter((g) => g.path === p);
const c4 = (r: any) => r.technical_design.c4;

describe('missing', () => {
  it('reports nothing for a record that holds it all', () => {
    expect(missing(complete())).toEqual([]);
  });

  it('names the absent C4 block and the plain texts, with their record paths and elements', () => {
    const gaps = missing(bare());
    expect(gaps.map((g: any) => [g.path, g.id, g.kind])).toEqual([
      ['technical_design.c4', 'gift-cards', 'c4'],
      ['intent.plain', 'gift-cards', 'plain'],
      ['stories[0].plain', '001', 'plain'],
      ['stories[1].plain', '002', 'plain'],
      ['stories[2].plain', '003', 'plain'],
    ]);
    for (const g of gaps) expect(g.text).toMatch(/\S/);
  });

  it('takes the intent from the caller when the record does not name it', () => {
    const r = complete();
    delete r.intent;
    expect(missing(r, { intent: 'gift-cards' })).toEqual([
      expect.objectContaining({ path: 'intent.plain', id: 'gift-cards' }),
    ]);
  });

  it('counts an empty plain text as absent', () => {
    const r = complete();
    r.stories[1].plain = '  ';
    expect(missing(r).map((g: any) => g.path)).toEqual(['stories[1].plain']);
  });

  it('names a component that holds a part the Code Scaffold does not draw', () => {
    const r = complete();
    c4(r).components[0].parts.push('ghost', 'giftcard-test');
    const gaps = at(missing(r), 'technical_design.c4.components[0].parts');
    expect(gaps.map((g: any) => g.id)).toEqual(['k-checkout', 'k-checkout']);
    expect(gaps[0].text).toContain('ghost');
    expect(gaps[1].text).toContain('giftcard-test');
  });

  it('names a component that holds no part at all', () => {
    const r = complete();
    c4(r).components.push({ id: 'k-empty', container: 'c-web', name: 'Empty' });
    expect(at(missing(r), 'technical_design.c4.components[6].parts')).toEqual([
      expect.objectContaining({ id: 'k-empty', kind: 'no-parts' }),
    ]);
  });

  it('names an edge whose end is no element, and each end on its own', () => {
    const r = complete();
    const n = c4(r).edges.length;
    c4(r).edges.push({ from: 'p-nobody', to: 's-nowhere', label: 'calls' }, { to: 's-shop' });
    const gaps = missing(r).filter((g: any) => g.path.startsWith('technical_design.c4.edges'));
    expect(gaps.map((g: any) => [g.path, g.id])).toEqual([
      [`technical_design.c4.edges[${n}].from`, 'p-nobody->s-nowhere'],
      [`technical_design.c4.edges[${n}].to`, 'p-nobody->s-nowhere'],
      [`technical_design.c4.edges[${n + 1}].from`, '?->s-shop'],
    ]);
  });

  it('names a container or component that sits nowhere', () => {
    const r = complete();
    c4(r).containers[2].system = 's-gone';
    c4(r).components[0].container = 'c-gone';
    delete c4(r).components[1].container;
    const gaps = missing(r);
    expect(at(gaps, 'technical_design.c4.containers[2].system')).toEqual([expect.objectContaining({ id: 'c-db' })]);
    expect(at(gaps, 'technical_design.c4.components[0].container')).toEqual([expect.objectContaining({ id: 'k-checkout' })]);
    expect(at(gaps, 'technical_design.c4.components[1].container')).toEqual([expect.objectContaining({ id: 'k-status' })]);
  });

  it('wants the system of a container named when the C4 model has more than one of its own', () => {
    const r = complete();
    c4(r).systems.push({ id: 's-admin', name: 'Shop admin' });
    delete c4(r).containers[0].system;
    expect(at(missing(r), 'technical_design.c4.containers[0].system')).toEqual([expect.objectContaining({ id: 'c-web' })]);
    expect(at(missing(r), 'technical_design.c4.containers[1].system')).toEqual([]);
    // with one system of its own a container may leave it out
    const one = complete();
    delete c4(one).containers[0].system;
    expect(at(missing(one), 'technical_design.c4.containers[0].system')).toEqual([]);
  });

  it('names a C4 model without a system of its own', () => {
    const r = complete();
    c4(r).systems = c4(r).systems.filter((s: any) => s.ext);
    c4(r).containers = [];
    c4(r).components = [];
    expect(at(missing(r), 'technical_design.c4.systems')).toEqual([expect.objectContaining({ kind: 'no-system' })]);
  });

  it('names an element without an id', () => {
    const r = complete();
    c4(r).persons.push({ name: 'No id' });
    expect(at(missing(r), 'technical_design.c4.persons[2].id')).toEqual([expect.objectContaining({ kind: 'no-id' })]);
  });

  it('names the outside map where it points at nothing, and an external part it leaves out', () => {
    const r = complete();
    c4(r).outside = { 'payment-api': 's-gone', ghost: 's-pay' };
    const gaps = missing(r);
    expect(at(gaps, 'technical_design.c4.outside.payment-api')).toEqual([expect.objectContaining({ id: 'payment-api' })]);
    expect(at(gaps, 'technical_design.c4.outside.ghost')).toEqual([expect.objectContaining({ id: 'ghost' })]);
    delete c4(r).outside;
    expect(at(missing(r), 'technical_design.c4.outside')).toEqual([expect.objectContaining({ id: 'payment-api', kind: 'no-outside' })]);
  });

  it('names a drawn part no component holds', () => {
    const r = complete();
    c4(r).components = c4(r).components.filter((k: any) => k.id !== 'k-payments');
    expect(at(missing(r), 'technical_design.c4.components')).toEqual([expect.objectContaining({ id: 'payment-client', kind: 'no-component' })]);
  });

  it('never changes the record', () => {
    const r = complete();
    c4(r).edges.push({ from: 'x', to: 'y' });
    delete r.intent.plain;
    const before = JSON.stringify(r);
    missing(r);
    expect(JSON.stringify(r)).toBe(before);
  });

  it('reads anything that is not a record as an empty one', () => {
    expect(missing(null, { intent: 'x' }).map((g: any) => g.path)).toEqual(['technical_design.c4', 'intent.plain']);
  });
});

describe('missingLines', () => {
  it('gives one line per gap with its record path and element', () => {
    const lines = missingLines(missing(bare()));
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(/^technical_design\.c4 \(gift-cards\): \S/);
    expect(lines[2]).toMatch(/^stories\[0\]\.plain \(001\): \S/);
  });
});
