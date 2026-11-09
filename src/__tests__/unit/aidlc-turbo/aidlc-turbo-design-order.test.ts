/**
 * Unit tests for templates/design/design-order.js, the flow order of the Code
 * Scaffold drawing, on what the layout tests do not reach:
 * - a column that holds one unit only is never emptied to make room: a
 *   contract with an implementation nobody calls stacked under it is two rows
 *   on its own, more than a later band's limit of one, and moving it on only
 *   moves the same two rows one column to the right. On a real intent it went
 *   64 columns to the right, a drawing over 20000 px wide that the page zoomed
 *   all the way out to show.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const { layout, SIZE } = req(path.join(FLOW, 'templates/design/design-layout.js'));

const part = (id: string, kind: string) => ({
  id, name: id.toUpperCase(), layer: 'server', status: 'new', kind, module: null, right: null, open: null,
  confidence: { level: 'green', reasons: [] }, stories: [],
});
const link = (from: string, to: string, kind = 'calls') => ({ id: `${from}-${to}`, from, to, kind, label: kind === 'calls' ? 'calls' : null, code: null });

// A first band four columns wide (a job down a chain of three), so a later band may hold one row per
// column; that later band: a config that calls a contract, and an implementation nobody calls that
// builds on the contract, stacked under it.
const model = {
  summary: null, lanes: [{ id: 'server', name: 'Server' }], modules: [], frames: [], stories: [],
  parts: [part('job', 'job'), part('a', 'class'), part('b', 'class'), part('c', 'class'),
    part('config', 'config'), part('contract', 'interface'), part('impl', 'class')],
  links: [link('job', 'a'), link('a', 'b'), link('b', 'c'), link('config', 'contract'), link('impl', 'contract', 'builds_on')],
};

describe('design order: a unit alone in its column stays there', () => {
  const g = layout(model);
  const b = (id: string) => g.blocks.find((x: { id: string }) => x.id === id);

  it('keeps the contract and its stacked implementation next to the config that calls them', () => {
    expect(b('config').band).toBeGreaterThan(b('job').band);
    expect(b('contract').col).toBe(b('config').col + 1);
    // the implementation nobody calls stacks under its contract, in the same column
    expect(b('impl').col).toBe(b('contract').col);
    expect(b('impl').y).toBeGreaterThan(b('contract').y);
  });

  it('keeps the drawing as wide as its columns, never 64 columns out', () => {
    const cols = Math.max(...g.blocks.map((x: { col: number }) => x.col));
    expect(cols).toBeLessThanOrEqual(4);
    expect(g.width).toBeLessThan(6 * (SIZE.BW + SIZE.GAP_MAX));
  });
});
