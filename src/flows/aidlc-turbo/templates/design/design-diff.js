/**
 * AI-DLC Turbo - Code Scaffold, a part's change in the code, beside its
 * details after the build.
 *
 * The page carries the change of every file the build touched in
 * model.build.diffs, keyed by the file's path in the repo (as part.path):
 * { text, added, removed, truncated }, `text` the unified diff from its first
 * @@ on, `truncated` the lines cut off at its end; { omitted: true } when the
 * page left it out for its size. A part gets the column only after the build,
 * with diffs on the page, for a file of this repo (no `repo` of its own) that
 * is in them; else its details stay as they were.
 *
 * The column reads as a code review: the file and what came in and went out,
 * every hunk apart under its range, a line number on each side, the lines
 * that came in and went out by a tint and a bar. The details and the change
 * sit side by side where the details are wide enough, else the change comes
 * under them (design-diff.css). A divider stands between them, which the
 * details panel right of the drawing makes a handle that gives either more
 * room (design-pane.js); elsewhere it does not show.
 *
 *   TdDiff.parse(text) -> [{ old: [start, n], new: [start, n], ctx, lines: [{ k, o, n, text }] }]
 *     k: 'ctx', 'add', 'del' or 'eof' (no newline at the end of the file)
 *   TdDiff.entry(build, part) -> the diff of its file, or null
 *   TdDiff.view(entry, part)  -> the column
 *   TdDiff.side(build, part)  -> the column, or null
 *   TdDiff.split(left, side)  -> left as it is without a side, else both in their columns, the divider between
 *
 * The page inlines it as window.TdDiff, before the panel (design-panel.js).
 */
(function (root) {
  'use strict';

  const K = typeof module !== 'undefined' && module.exports ? require('./design-kit.js') : root.TdKit;
  const { h } = K;
  const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;
  const SIGN = { add: '+', del: '-', ctx: '' };
  // the class of a line: an unchanged one is td-df-same, apart from the context of a hunk header (td-df-ctx)
  const ROW = { add: 'add', del: 'del', ctx: 'same' };

  function parse(text) {
    const hunks = [];
    let cur = null, o = 0, n = 0;
    const rows = String(text || '').split('\n');
    if (rows[rows.length - 1] === '') rows.pop();
    for (const r of rows) {
      const m = HUNK.exec(r);
      if (m) {
        cur = { old: [+m[1], m[2] === undefined ? 1 : +m[2]], new: [+m[3], m[4] === undefined ? 1 : +m[4]], ctx: m[5] || '', lines: [] };
        o = cur.old[0];
        n = cur.new[0];
        hunks.push(cur);
      } else if (!cur) continue; // a header before the first hunk
      else if (r[0] === '+') cur.lines.push({ k: 'add', o: null, n: n++, text: r.slice(1) });
      else if (r[0] === '-') cur.lines.push({ k: 'del', o: o++, n: null, text: r.slice(1) });
      else if (r[0] === '\\') cur.lines.push({ k: 'eof', o: null, n: null, text: r.slice(1).trim() });
      else cur.lines.push({ k: 'ctx', o: o++, n: n++, text: r.slice(1) });
    }
    return hunks;
  }

  function entry(build, part) {
    const diffs = build && build.diffs;
    if (!diffs || !part || !part.path || part.repo) return null;
    return Object.prototype.hasOwnProperty.call(diffs, part.path) ? diffs[part.path] || null : null;
  }

  const TX = typeof module !== 'undefined' && module.exports ? require('./design-text.js') : root.TdText;
  const t = (key, vars) => TX.t(`design.diff.${key}`, vars);
  const lines = (k) => (k === 1 ? t('oneLine') : t('nLines', { n: k }));
  const note = (text) => h('p', 'td-df-note', text);

  /** One line: the old number, the new number, its mark and the code, as text. */
  function line(l) {
    if (l.k === 'eof') return h('div', 'td-df-eof', t('noEol'));
    const r = h('div', 'td-df-l td-df-' + ROW[l.k]);
    r.append(h('span', 'td-df-o', l.o === null ? '' : String(l.o)), h('span', 'td-df-n', l.n === null ? '' : String(l.n)),
      h('span', 'td-df-s', SIGN[l.k]), h('span', 'td-df-c', l.text));
    return r;
  }

  function view(e, part) {
    const box = h('section', 'td-diff');
    box.setAttribute('aria-label', t('change'));
    // one line on top, no heading over it (the section's label names it): the file at the left, the count at the right
    const head = h('div', 'td-df-head');
    head.append(K.soft(h('code', 'td-df-path'), part.path, K.PATH));
    box.append(head);
    if (!e || e.omitted) { box.append(note(t('tooBig'))); return box; }
    const hunks = parse(e.text);
    const all = hunks.flatMap((x) => x.lines);
    const added = Number.isFinite(e.added) ? e.added : all.filter((l) => l.k === 'add').length;
    const removed = Number.isFinite(e.removed) ? e.removed : all.filter((l) => l.k === 'del').length;
    const meta = h('div', 'td-df-meta');
    // a new file only gets its tag when the part's own pill does not already say it is new
    if (hunks.length && hunks[0].old[0] === 0 && hunks[0].old[1] === 0) { if (part.status !== 'new') meta.append(h('span', 'td-df-new', t('newFile'))); }
    else if (hunks.length && hunks[0].new[0] === 0 && hunks[0].new[1] === 0) meta.append(h('span', 'td-df-new td-df-gone', t('deleted')));
    const count = h('span', 'td-df-count');
    count.setAttribute('aria-label', t('count', { added: lines(added), removed: lines(removed) }));
    count.title = count.getAttribute('aria-label');
    // a count of nothing is left out: no "−0" on a new file, no "+0" on a removed one
    if (added || !removed) count.append(h('span', 'td-df-plus', '+' + added));
    if (removed || !added) count.append(h('span', 'td-df-min', '−' + removed));
    meta.append(count);
    head.append(meta);
    const body = h('div', 'td-df-body');
    body.setAttribute('role', 'region');
    body.setAttribute('aria-label', t('body', { name: part.name || part.path }));
    body.setAttribute('tabindex', '0'); // scrolls by the keys too
    // the number columns are as wide as the largest number
    const most = Math.max(1, ...all.map((l) => Math.max(l.o || 0, l.n || 0)));
    body.style.setProperty('--td-df-w', String(most).length + 'ch');
    for (const x of hunks) {
      const hk = h('div', 'td-df-hunk');
      const hh = h('div', 'td-df-hh');
      const range = `@@ -${x.old[0]},${x.old[1]} +${x.new[0]},${x.new[1]} @@`;
      hh.append(h('span', 'td-df-range', range));
      if (x.ctx) hh.append(h('span', 'td-df-ctx', x.ctx));
      hk.append(hh, ...x.lines.map(line));
      body.append(hk);
    }
    box.append(body);
    const cut = Number(e.truncated) || 0;
    if (cut > 0) box.append(note(cut === 1 ? t('cutOne') : t('cutMany', { n: cut })));
    return box;
  }

  function side(build, part) {
    const e = entry(build, part);
    return e ? view(e, part) : null;
  }

  function split(left, s) {
    if (!s) return left;
    const wrap = h('div', 'td-dsplit'), cols = h('div', 'td-dcols');
    cols.append(left, h('div', 'td-dsep'), s);
    wrap.append(cols);
    return wrap;
  }

  const api = { parse, entry, view, side, split };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdDiff = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
