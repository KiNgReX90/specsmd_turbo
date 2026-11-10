/**
 * Unit tests for lib/design-model.cjs, the model behind the Code
 * Scaffold: the record's technical_design.drawing and stories[].drawing turned
 * into the one shape spec-lint, render-specs, the approval page and the build
 * plan read. The fixture is the order status intent of Acme Shop, an invented
 * webshop.
 * - confidence follows from the evidence with fixed rules: red for an open
 *   choice, green for new, green for changed or existing only with path and
 *   lines, orange for docs, an assumption or doubt; deviating stays green;
 * - a module with parts in two layers gets one frame per layer;
 * - a story's links are the links with both ends in what it builds or uses;
 * - a link carries its proof in the code and what the change adds, or null;
 * - parts and modules know the stories that build them;
 * - a record without a drawing has no model.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const dm = req(path.join(FLOW, 'scripts/lib/design-model.cjs'));
const { parseYaml } = req(path.join(FLOW, 'scripts/render-specs.cjs'));

const FIXTURE = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');
const record = () => parseYaml(readFileSync(FIXTURE, 'utf8'));
const model = dm.designModel(record());
const part = (id: string) => model.parts.find((p: { id: string }) => p.id === id);

describe('confidence', () => {
  it('is red while a choice is open, whatever else the part has', () => {
    expect(dm.confidence({ status: 'existing', path: 'a.js', lines: '1-9', open: 'which one?' })).toEqual({
      level: 'red', reasons: [dm.REASONS.open],
    });
  });

  it('is green for a new part, with or without an example', () => {
    expect(dm.confidence({ status: 'new', follows: { file: 'b.java' } })).toEqual({ level: 'green', reasons: [dm.REASONS.newFollows] });
    expect(dm.confidence({ status: 'new' })).toEqual({ level: 'green', reasons: [dm.REASONS.newOwn] });
  });

  it('is green for changed or existing only with the place checked', () => {
    expect(dm.confidence({ status: 'existing', path: 'a.js', lines: '1-9' }).level).toBe('green');
    expect(dm.confidence({ status: 'changed', path: 'a.js' })).toEqual({ level: 'orange', reasons: [dm.REASONS.unchecked] });
  });

  it('only goes down for docs, an assumption or doubt', () => {
    const c = dm.confidence({ status: 'existing', path: 'a.js', lines: '1-9', source: 'S-012', assumption: 'there is a role', doubt: 'maybe two' });
    expect(c.level).toBe('orange');
    expect(c.reasons).toEqual([dm.REASONS.checked, dm.REASONS.docs, `${dm.REASONS.assumption}there is a role`, `${dm.REASONS.doubt}maybe two`]);
  });

  it('stays green when the part deviates from its example on purpose', () => {
    expect(part('gw').confidence.level).toBe('green');
    expect(part('gw').deviates).toMatch(/timeouts/);
  });
});

describe('designModel', () => {
  it('reads the fixture into lanes, modules, frames, parts and links', () => {
    expect(model.lanes.map((l: { id: string; name: string }) => [l.id, l.name])).toEqual([
      ['screen', 'Screen in the browser'], ['server', 'Acme Shop server'],
      ['database', 'Acme Shop database'], ['external', 'Warehouse system, another application'],
    ]);
    expect(model.parts).toHaveLength(20);
    expect(model.links).toHaveLength(19);
    expect(model.summary).toMatch(/^All five stories together\./);
    expect(part('chart').confidence.level).toBe('red');
    expect(part('whread')).toMatchObject({ repo: 'warehouse', lines: '27-136', confidence: { level: 'green' } });
  });

  it('gives a module with parts in two layers a frame per layer', () => {
    const frames = model.frames.filter((f: { module: string }) => f.module === 'shop');
    expect(frames.map((f: { id: string; layer: string; parts: string[] }) => [f.id, f.layer, f.parts])).toEqual([
      ['shop@screen', 'screen', ['menu', 'host']],
      ['shop@server', 'server', ['routes', 'prov']],
    ]);
    expect(model.frames.find((f: { module: string }) => f.module === 'ui').id).toBe('ui');
  });

  it('takes the story links from what the story builds and uses', () => {
    const s1 = model.stories[0];
    expect(s1).toMatchObject({ id: '001', n: '1', title: 'Order status API' });
    expect(s1.links).toEqual(['routes-ctrl', 'ctrl-uc', 'uc-gw', 'gw-iface', 'prov-iface', 'gw-whread']);
    expect(s1.modules).toEqual(['ad', 'core', 'setm', 'shop']);
    expect(s1.parts).not.toContain('ad');
    expect(model.stories[1].links).toContain('kpi-card');
    expect(model.stories[1].links).not.toContain('page-table');
  });

  it('marks the stories that build a part or a module', () => {
    expect(part('ctrl').stories).toEqual(['001', '002', '003', '004', '005']);
    expect(part('api').stories).toEqual([]);
    expect(model.modules.find((m: { id: string }) => m.id === 'shop').stories).toEqual(['001', '002']);
  });

  it('gives every link the plain sentence of its step, or null', () => {
    const r = record();
    r.technical_design.drawing.links[0] = { from: 'menu', to: 'host', step: ' The worker looks up the newest answer. ' };
    r.technical_design.drawing.links[1] = { ...r.technical_design.drawing.links[1], step: ' ' };
    const m = dm.designModel(r);
    expect(m.links[0].step).toBe('The worker looks up the newest answer.');
    expect(m.links[1].step).toBeNull();
  });

  it('gives every link its proof in the code and what the change adds, or null', () => {
    const link = (id: string) => model.links.find((l: { id: string }) => l.id === id);
    expect(link('gw-whread')).toMatchObject({
      proof: { file: 'warehouse-api/src/main/java/com/acme/warehouse/api/FulfilmentController.java', lines: '27-136', note: 'the read endpoints exist already' },
      adds: null,
    });
    expect(link('svc-api').proof).toEqual({
      file: 'shop-web-components/src/main/resources/static/web-components/services/api-client.js', lines: '1-36', note: null,
    });
    expect(link('trend-events')).toMatchObject({ proof: null, adds: 'the index ose_window_i for the time window' });
    expect(link('menu-host')).toMatchObject({ proof: null, adds: null });
    // A proof without a file is no proof, and an empty addition is none.
    const r = record();
    r.technical_design.drawing.links[0] = { from: 'menu', to: 'host', proof: { lines: '1-3' }, adds: ' ' };
    expect(dm.designModel(r).links[0]).toMatchObject({ proof: null, adds: null });
  });

  it('numbers a second link between the same two parts', () => {
    const r = record();
    r.technical_design.drawing.links.push({ from: 'menu', to: 'host', label: 'once more' });
    expect(dm.designModel(r).links.at(-1).id).toBe('menu-host-2');
  });

  it('is null for a record without a drawing', () => {
    expect(dm.designModel({ technical_design: { modules: ['auth'] } })).toBeNull();
    expect(dm.designModel(null)).toBeNull();
  });
});
