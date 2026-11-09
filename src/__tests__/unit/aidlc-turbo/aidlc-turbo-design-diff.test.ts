/**
 * Unit tests for the change in the code beside the details of a part, after
 * the build (design-diff.js, design-diff.css):
 * - the unified diff body of the page (`model.build.diffs[part.path].text`,
 *   from the first @@ on) read into hunks with their line numbers;
 * - which part gets the column: only after the build, with diffs on the page,
 *   for a file of this repo that the build changed; never otherwise;
 * - the column as a code review reads: the file, what came in and went out,
 *   hunks apart, a line number on each side, a note when the page cut it
 *   short or left it out;
 * - the details and the change side by side from a tablet up, stacked
 *   (details first) only on a phone, light only;
 * - the panel wired to it, the files under 500 lines.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fakeDom } from './aidlc-turbo-design-fake-dom';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const DESIGN = path.join(FLOW, 'templates/design');
const req = createRequire(import.meta.url);
const read = (f: string) => { try { return readFileSync(path.join(DESIGN, f), 'utf8'); } catch { return ''; } };
const Diff = () => req(path.join(DESIGN, 'design-diff.js'));

const TEXT = [
  '@@ -10,4 +10,5 @@ public class Task {',
  '     void run() {',
  '-        old();',
  '+        check();',
  '+        <b>later()</b>;',
  '     }',
  '@@ -40,2 +41,2 @@',
  ' }',
  '-// end',
  '\\ No newline at end of file',
  '+// end',
  '',
].join('\n');
const NEW = '@@ -0,0 +1,3 @@\n+package com.shop;\n+\n+class Cache {}\n';
const part = { id: 'task', name: 'Task', path: 'src/main/java/com/shop/Task.java' };
const build = (diffs: Record<string, unknown> | undefined) => ({ stories: [], different: 0, extra: 0, ...(diffs ? { diffs } : {}) });
const ENTRY = { text: TEXT, added: 3, removed: 2, truncated: 0 };

describe('aidlc-turbo Code Scaffold diff: reading the diff', () => {
  it('reads the hunks with the line number on each side', () => {
    const hunks = Diff().parse(TEXT);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({ old: [10, 4], new: [10, 5], ctx: 'public class Task {' });
    expect(hunks[0].lines.map((l: any) => [l.k, l.o, l.n, l.text])).toEqual([
      ['ctx', 10, 10, '    void run() {'],
      ['del', 11, null, '        old();'],
      ['add', null, 11, '        check();'],
      ['add', null, 12, '        <b>later()</b>;'],
      ['ctx', 12, 13, '    }'],
    ]);
    expect(hunks[1].lines.map((l: any) => [l.k, l.o, l.n])).toEqual([['ctx', 40, 41], ['del', 41, null], ['eof', null, null], ['add', null, 42]]);
  });

  it('reads a new file as all added, and leaves out anything before the first @@', () => {
    const [h] = Diff().parse('diff --git a/x b/x\n+++ b/x\n' + NEW);
    expect(h.old).toEqual([0, 0]);
    expect(h.lines.map((l: any) => [l.k, l.n])).toEqual([['add', 1], ['add', 2], ['add', 3]]);
    expect(Diff().parse('')).toEqual([]);
  });
});

describe('aidlc-turbo Code Scaffold diff: which part gets the column', () => {
  it('a part of this repo whose file the build changed', () => {
    fakeDom();
    expect(Diff().entry(build({ [part.path]: ENTRY }), part)).toBe(ENTRY);
    expect(Diff().side(build({ [part.path]: ENTRY }), part)).toBeTruthy();
  });

  it('none before the build, on an older page without diffs, in another repo, or for a file the build left alone', () => {
    fakeDom();
    const d = Diff();
    expect(d.side(null, part)).toBeNull();
    expect(d.side(build(undefined), part)).toBeNull();
    expect(d.side(build({ [part.path]: ENTRY }), { ...part, repo: 'shop-invoices' })).toBeNull();
    expect(d.side(build({ [part.path]: ENTRY }), { ...part, path: null })).toBeNull();
    expect(d.side(build({ 'src/Other.java': ENTRY }), part)).toBeNull();
  });
});

describe('aidlc-turbo Code Scaffold diff: the column', () => {
  it('one line on top: the file at the left, what came in and went out at the right; no heading over it, its name for a screen reader', () => {
    const { all } = fakeDom();
    const v = Diff().view(ENTRY, part);
    expect(String(v.className)).toBe('td-diff');
    expect(v.attrs['aria-label']).toBe('Change in the code');
    expect(all(v, 'td-df-t')).toHaveLength(0);
    expect(v.textContent).not.toContain('Change during the build');
    const head = all(v, 'td-df-head')[0];
    expect(head.children.map((c: any) => String(c.className))).toEqual(['td-df-path', 'td-df-meta']);
    expect(all(v, 'td-df-path')[0].textContent).toBe(part.path);
    expect(all(v, 'td-df-plus')[0].textContent).toBe('+3');
    expect(all(v, 'td-df-min')[0].textContent).toBe('−2');
    expect(all(v, 'td-df-count')[0].attrs['aria-label']).toBe('3 lines added, 2 lines removed');
    expect(all(v, 'td-df-new')).toHaveLength(0);
  });

  it('shows each hunk apart, its range on top, every line with its numbers and its mark', () => {
    const { all } = fakeDom();
    const v = Diff().view(ENTRY, part);
    const hunks = all(v, 'td-df-hunk');
    expect(hunks).toHaveLength(2);
    expect(all(hunks[0], 'td-df-hh')[0].textContent).toBe('@@ -10,4 +10,5 @@public class Task {');
    const rows = all(hunks[0], 'td-df-l');
    expect(rows.map((r: any) => String(r.className))).toEqual(['td-df-l td-df-same', 'td-df-l td-df-del', 'td-df-l td-df-add', 'td-df-l td-df-add', 'td-df-l td-df-same']);
    expect(rows[1].children.map((c: any) => c.textContent)).toEqual(['11', '', '-', '        old();']);
    expect(rows[2].children.map((c: any) => c.textContent)).toEqual(['', '11', '+', '        check();']);
    // code stays text, never markup
    expect(rows[3].children[3].textContent).toBe('        <b>later()</b>;');
    expect(read('design-diff.js')).not.toContain('innerHTML');
    expect(all(hunks[1], 'td-df-eof')[0].textContent).toBe('No newline at the end of the file');
    // the numbers take the room of the largest one
    expect(all(v, 'td-df-body')[0].style['--td-df-w']).toBe('2ch');
  });

  it('marks a new file', () => {
    const { all } = fakeDom();
    const v = Diff().view({ text: NEW, added: 3, removed: 0, truncated: 0 }, { ...part, path: 'src/Cache.java' });
    expect(all(v, 'td-df-new')[0].textContent).toBe('New file');
    expect(all(v, 'td-df-add')).toHaveLength(3);
  });

  it('leaves "New file" out for a new part, whose pill already says it is new', () => {
    const { all } = fakeDom();
    const v = Diff().view({ text: NEW, added: 3, removed: 0, truncated: 0 }, { ...part, path: 'src/Cache.java', status: 'new' });
    expect(all(v, 'td-df-new')).toHaveLength(0);
    expect(all(v, 'td-df-add')).toHaveLength(3);
  });

  it('says when the page cut the change short, or left it out for its size', () => {
    const { all } = fakeDom();
    expect(all(Diff().view({ ...ENTRY, truncated: 120 }, part), 'td-df-note')[0].textContent)
      .toBe('Shortened: the last 120 lines of the change are not on this page.');
    expect(all(Diff().view({ ...ENTRY, truncated: 1 }, part), 'td-df-note')[0].textContent)
      .toBe('Shortened: the last line of the change is not on this page.');
    const left = Diff().view({ omitted: true }, part);
    expect(all(left, 'td-df-note')[0].textContent).toBe('Too large to show here: see this change in git.');
    expect(all(left, 'td-df-body')).toHaveLength(0);
    expect(all(left, 'td-df-count')).toHaveLength(0);
  });

  it('puts the details and the change side by side, or leaves the details as they are without one', () => {
    const { node } = fakeDom();
    const left = node('div');
    expect(Diff().split(left, null)).toBe(left);
    const side = node('section');
    const s = Diff().split(left, side);
    expect(String(s.className)).toBe('td-dsplit');
    expect(String(s.children[0].className)).toBe('td-dcols');
    // the divider between them, which the details panel makes a handle (design-pane.js)
    expect(s.children[0].children[0]).toBe(left);
    expect(String(s.children[0].children[1].className)).toBe('td-dsep');
    expect(s.children[0].children[2]).toBe(side);
  });
});

describe('aidlc-turbo Code Scaffold diff: the look and the wiring', () => {
  const css = read('design-diff.css');

  it('has its own colours, light only, a tint and a bar per line, not a solid slab', () => {
    expect(css).toMatch(/:root \{[^}]*--td-df-add:/);
    expect(css).not.toMatch(/prefers-color-scheme: dark|data-theme/);
    expect(css).toMatch(/\.td-df-add \{[^}]*background: var\(--td-df-add\);[^}]*box-shadow: inset 3px 0 0 var\(--td-df-add-bar\);/);
    expect(css).toMatch(/\.td-df-del \{[^}]*background: var\(--td-df-del\);[^}]*box-shadow: inset 3px 0 0 var\(--td-df-del-bar\);/);
  });

  it('its head is one line that wraps cleanly under a long path: the count stays at the right', () => {
    expect(css).toMatch(/\.td-df-head \{[^}]*display: flex;[^}]*flex-wrap: wrap;[^}]*justify-content: space-between;/);
    expect(css).toMatch(/\.td-df-path \{[^}]*flex: 1 1 [^;]+;[^}]*min-width: 0;/);
    expect(css).toMatch(/\.td-df-meta \{[^}]*margin-left: auto;/);
    expect(css).not.toMatch(/\.td-df-t\b|td-df-top/);
  });

  it('scrolls on its own when long, wraps long lines so a phone never scrolls sideways', () => {
    expect(css).toMatch(/\.td-df-body \{[^}]*max-height:[^}]*overflow: auto;/);
    expect(css).toMatch(/\.td-df-c \{[^}]*white-space: pre-wrap;[^}]*overflow-wrap: anywhere;/);
  });

  it('its split stands side by side from a tablet up; only a phone stacks it', () => {
    // the rules themselves: aidlc-turbo-design-walk-pin.test.ts
    expect(css).toMatch(/@media \(min-width: 601px\) \{[^@]*\.td-dcols \{[^}]*grid-template-columns: minmax\(220px, var\(--td-da, 40fr\)\) 12px minmax\(300px, var\(--td-db, 60fr\)\);/);
    expect(css).not.toMatch(/@container td-split/);
    // no line of its own beside it: the divider is the line
    expect(css).not.toMatch(/td-dcols::before/);
  });

  it('the details of the flow view never show the change: that is the Review tab\'s', () => {
    expect(read('design-show.js')).not.toMatch(/TdDiff/);
  });

  it('keeps its files under 500 lines', () => {
    for (const f of ['design-diff.js', 'design-diff.css']) {
      const n = read(f).split('\n').length;
      expect(n, f).toBeGreaterThan(1);
      expect(n, f).toBeLessThanOrEqual(500);
    }
  });
});
