/**
 * Unit tests for the details that keep one height whatever the element
 * (design-about.css, design-browse.css, design-diff.css, design-pane.css,
 * design.css):
 * - the walk "< n of N >" is a footer of the details' column, outside what
 *   scrolls: the body above it scrolls on its own, the walk has a solid ground
 *   and a rule on top, so nothing slides under it; in the panel and in the
 *   drawing's view alike, never sticky over the body;
 * - the split of TdDiff.split (the Review tab's) stands side by side at every
 *   width of a desktop and a tablet; only a phone (under 601 wide) stacks it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const DESIGN = path.resolve(__dirname, '../../../flows/aidlc-turbo/templates/design');
const plain = (f: string) => readFileSync(path.join(DESIGN, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** The body of the block that opens with `head` (a media or container query), its rules in it. */
function block(css: string, head: string) {
  const i = css.indexOf(head);
  if (i < 0) return '';
  let depth = 0;
  for (let j = css.indexOf('{', i); j < css.length; j += 1) {
    if (css[j] === '{') depth += 1;
    else if (css[j] === '}' && --depth === 0) return css.slice(i, j + 1);
  }
  return '';
}
const all = (css: string, head: string) => {
  const out: string[] = [];
  for (let i = css.indexOf(head); i >= 0; i = css.indexOf(head, i + 1)) out.push(block(css.slice(i), head));
  return out.join('\n');
};

describe('aidlc-turbo Code Scaffold: the walk is a footer outside what scrolls', () => {
  const about = plain('design-about.css');

  it('the column: the body takes the room and scrolls where the column has a height, the walk under it does not shrink', () => {
    expect(about).toMatch(/\.td-dcol \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-height: 0;/);
    expect(about).toMatch(/\.td-dcol > \.td-dgrid \{[^}]*flex: 1 1 auto;[^}]*min-height: 0;/);
    expect(about).toMatch(/\.td-dcol > \.td-walk \{[^}]*flex: none;/);
  });

  it('the walk has a solid ground and a rule on top, and is never sticky over the body', () => {
    expect(about).toMatch(/\.td-dcol > \.td-walk\.td-browse \{[^}]*border-top: 1px solid var\(--td-line\);[^}]*background: var\(--td-surface\);/);
    for (const f of ['design-about.css', 'design-browse.css', 'design-pane.css', 'design-diff.css', 'design.css']) {
      expect(plain(f), f).not.toMatch(/\.td-walk[^{}]*\{[^}]*position: sticky;/);
    }
  });

  it('in the panel the body scrolls in its column', () => {
    const pane = plain('design-pane.css');
    expect(pane).toMatch(/\.td-dpane > \.td-detail:not\(\[hidden\]\) \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-height: 0;[^}]*overflow: hidden;/);
    expect(pane).toMatch(/\.td-dpane > \.td-detail > \.td-dcol \{[^}]*flex: 1 1 auto;[^}]*min-height: 0;/);
    expect(pane).toMatch(/\.td-dpane > \.td-detail \.td-dcol > \.td-dgrid \{[^}]*overflow-y: auto;/);
  });

  it('in the drawing\'s view as well', () => {
    const base = plain('design.css');
    expect(base).toMatch(/\.td-fs \.td-detail > \.td-dcol \{[^}]*flex: 1 1 auto;[^}]*min-height: 0;/);
    expect(base).toMatch(/\.td-fs \.td-dgrid \{[^}]*overflow-y: auto;/);
  });
});

describe('aidlc-turbo Code Scaffold: the split of TdDiff.split side by side', () => {
  const diff = plain('design-diff.css');
  const wide = all(diff, '@media (min-width: 601px)');

  it('from a tablet up: two columns with the divider between them, the split the viewer chose, each a minimum', () => {
    expect(wide).toMatch(/\.td-dcols \{[^}]*grid-template-rows: minmax\(0, 1fr\);[^}]*grid-template-columns: minmax\(220px, var\(--td-da, 40fr\)\) 12px minmax\(300px, var\(--td-db, 60fr\)\);/);
    expect(wide).toMatch(/\.td-dcols > \.td-dsep \{[^}]*display: block;[^}]*cursor: col-resize;/);
    expect(wide).toMatch(/\.td-dcols \.td-df-body \{[^}]*flex: 1 1 auto;[^}]*min-height: 0;/);
  });

  it('no width of the details flips them under each other: no container query, no row split', () => {
    expect(diff).not.toMatch(/@container td-split/);
    expect(diff).not.toMatch(/container: td-split/);
    for (const f of ['design-pane.css', 'design-diff.css']) expect(plain(f), f).not.toMatch(/\.td-dsep[^{]*\{[^}]*row-resize|grid-template-rows: minmax\(1\d\dpx/);
    // only a phone stacks them: the one column outside the media query is the phone's
    expect(diff).toMatch(/\.td-dcols \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/);
  });

  it('the drawing\'s view keeps the details one card: no change in the code beside them', () => {
    expect(plain('design.css')).not.toMatch(/td-dsplit/);
  });
});
