/**
 * Unit tests for lib/overview-text.cjs blocks(), the markdown the overview
 * page renders from story and test-case text:
 * - an indented bullet with no list item above it is a list of its own, and
 *   the renderer always moves on: on a real intent such a line under
 *   "Preparation:" looped forever until memory ran out;
 * - a flush bullet after a plain line and a sub-bullet under a list item
 *   render as before.
 * blocks() runs in a child process with a timeout, so a regression fails
 * instead of hanging the suite.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';

const TEXT = path.resolve(__dirname, '../../../flows/aidlc-turbo/scripts/lib/overview-text.cjs');

function blocks(md: string): string {
  const code = `process.stdout.write(require(${JSON.stringify(TEXT)}).blocks(${JSON.stringify(md)}))`;
  const r = spawnSync(process.execPath, ['--max-old-space-size=128', '-e', code], { encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0) throw new Error(`blocks() did not finish: ${r.signal || r.stderr}`);
  return r.stdout;
}

describe('aidlc-turbo overview text: blocks()', () => {
  it('an indented bullet under a plain line is a list, and the renderer moves on', () => {
    expect(blocks('Preparation:\n\n  - gift card codes for part A\n  - part B')).toBe(
      '<p>Preparation:</p><ul><li>gift card codes for part A</li><li>part B</li></ul>');
  });

  it('an indented numbered line as the first line of a block is a numbered list', () => {
    expect(blocks('  1. first\n  2. then')).toBe('<ol><li>first</li><li>then</li></ol>');
  });

  it('a flush bullet after a plain line renders as before', () => {
    expect(blocks('Preparation:\n- sub item')).toBe('<p>Preparation:</p><ul><li>sub item</li></ul>');
  });

  it('a sub-bullet under a list item still nests', () => {
    expect(blocks('- top\n  - sub')).toBe('<ul><li>top<ul><li>sub</li></ul></li></ul>');
  });
});
