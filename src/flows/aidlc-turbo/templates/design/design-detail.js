/**
 * AI-DLC Turbo - Code Scaffold, the details of what was clicked: a part, a
 * module or a line. A line only where the drawing has no steps: elsewhere a
 * line holds its step and the details show the part it goes to
 * (design-show.js).
 *
 *   TdDetail.create(model, { built, titleOf, order, about, review })
 *     -> { part(p), mod(m), link(l) }, each [head, rows] for the panel to show,
 *        rows null where there are none
 *
 * The head: the state pill, the kind (a label beside it, as on the block),
 * "Still open" before the build, the name as plain text, then in plain words
 * what it does, after the build what changed and where it deviated
 * (`about`, design-about.js; made from the model when none is given). The
 * word of the build ("different", "added", ...) stays on the drawing: the
 * details tell it in the card of the deviation, never in a pill. After the
 * build a part with a change in the code on the page (TdDiff.entry) or a
 * deviation (TdBuild.pillOf) gets the button "See the change" under its
 * name, which calls `review(part id)`: the change itself is in the Review
 * tab, never in these details.
 *
 * After the build (`built`) that is all: no rows. Before the build a part
 * keeps the rows a reviewer needs to approve the design: Certainty first,
 * Extends, Implements, Differs from the example, Where in the code, Looks
 * like, Permission, Still open and Built in; a module Where in the code,
 * Looks like, Registered in and Built in. The words come from the page's
 * string table (TdText, design.detail). The page inlines it as
 * window.TdDetail, before the panel.
 */
(function (root) {
  'use strict';

  const E = () => root.TdEngine;
  // what it does and where it deviated: the page's own, else (in Node) the file beside this one
  const A = () => root.TdAbout || (typeof module !== 'undefined' && module.exports ? require('./design-about.js') : null);
  const K = root.TdKit;
  const { h } = K;
  const TX = typeof module !== 'undefined' && module.exports ? require('./design-text.js') : root.TdText;
  const t = (key, vars) => TX.t(`design.detail.${key}`, vars);

  // a place in the code; the path wraps only between its parts, "lines 21-29" and "File.java:12-13" never at
  // the dash of their range (the table puts a no-break space before the range)
  const where = (path, lines, repo) => (path ? `${repo ? repo + ': ' : ''}${path}${lines ? `, ${t('lines', { lines })}` : ''}` : null);
  const RANGE = /\d+-\d+$/;
  function code(text, el) {
    const c = el || h('div', 'td-c'), m = RANGE.exec(text || '');
    c.replaceChildren();
    K.soft(c, m ? text.slice(0, m.index) : text, K.PATH);
    if (m) c.append(h('span', 'td-nw', m[0]));
    return c;
  }
  // the example's place in code type, the note about it in plain text
  const like = (f) => (f && f.file ? [code(where(f.file, f.lines)), f.note && h('div', 'td-dnote', f.note)].filter(Boolean) : null);

  /** After the build, for a part with a change in the code or a deviation: the way to its change in Review. */
  function toReview(kind, x, built, review) {
    if (kind !== 'part' || !built || typeof review !== 'function') return null;
    const D = root.TdDiff, Bd = root.TdBuild;
    if (!((D && D.entry(built, x)) || (Bd && Bd.pillOf(x)))) return null;
    const b = h('button', 'td-btn td-dreview');
    b.type = 'button';
    b.innerHTML = '<svg class="td-i" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 5.5l4.5 4.5-4.5 4.5"/></svg>';
    b.append(h('span', null, t('review')));
    b.title = t('reviewTip', { name: x.name });
    b.addEventListener('click', () => review(x.id));
    return b;
  }

  function create(model, o) {
    const { built, titleOf, order } = o;
    const parts = new Map(model.parts.map((p) => [p.id, p]));
    const about = o.about || A().create(model, { built, order });
    const list = K.dl;
    /** The pills and the name, the way to Review, what it does, after the build what changed and where it deviated. */
    function head(kind, x, label, open) {
      const d = h('div', 'td-dhead');
      const pills = h('div', 'td-pills');
      pills.append(h('span', 'td-pill td-' + x.status, label));
      // the kind beside it, as the label on the block
      const k = E().kindOf(x.kind);
      if (k) pills.append(h('span', 'td-kind', k));
      if (open) pills.append(h('span', 'td-pill td-open', t('stillOpen')));
      d.append(pills, K.soft(h('h3'), x.name));
      const go = toReview(kind, x, built, o.review);
      if (go) d.append(go);
      const told = about.about(kind, x);
      if (told) d.append(told);
      return d;
    }
    // the stories that will build it: the plan page only
    const builtIn = (id) => model.stories.filter((s) => s.builds && s.builds[id]).map((s) => `${s.n}. ${titleOf(s)}: ${s.builds[id]}`);
    const rows = (dl) => (dl.children.length ? dl : null);
    /** Its certainty, with the colour of its block and the reasons: before the build only. */
    function sure(dl, p) {
      const level = p.confidence ? p.confidence.level : 'green';
      const dd = h('dd', 'td-zkr');
      const why = h('span');
      why.append(h('b', null, `${t(`level.${level}`)}. `), (p.confidence ? p.confidence.reasons : []).join(' '));
      dd.append(h('i', 'td-zkb td-' + level), why);
      dl.append(h('dt', null, t('certainty')), dd);
    }
    /** After the build only the head; before it the rows of the review. */
    function part(p) {
      const hd = head('part', p, E().statusOf(p, !!built), !built && !!p.open);
      if (built) return [hd, null];
      const dl = list();
      sure(dl, p);
      dl.row(t('extends'), p.extends);
      dl.row(t('implements'), p.implements);
      dl.row(t('deviates'), p.deviates);
      dl.row(t('where'), p.path && code(where(p.path, p.lines, p.repo), h('span', 'td-c')), 'td-code');
      dl.row(t('like'), like(p.follows), 'td-code');
      if (p.right) dl.row(t('right'), [p.right.what || p.right.short, p.right.file && code(where(p.right.file, p.right.lines))].filter(Boolean));
      if (p.open) dl.row(t('stillOpen'), p.open_detail || p.open, 'td-warn');
      dl.row(t('builtIn'), builtIn(p.id));
      return [hd, rows(dl)];
    }
    function mod(m) {
      const hd = head('module', m, E().statusOf(m, !!built, true), false);
      if (built) return [hd, null];
      const dl = list();
      dl.row(t('where'), m.path && code(where(m.path, null, m.repo), h('span', 'td-c')), 'td-code');
      dl.row(t('like'), like(m.follows), 'td-code');
      dl.row(t('registeredIn'), (m.registered_in || []).filter((r) => r.file).map((r) => code(where(r.file, r.lines))), 'td-code');
      dl.row(t('builtIn'), builtIn(m.id));
      return [hd, rows(dl)];
    }
    /** A line: its step, from and to, what it does and the call in the code. */
    function link(l) {
      const k = order.indexOf(l.id) + 1;
      const name = (id) => (parts.get(id) || { name: id }).name;
      const d = h('div', 'td-dhead'), pills = h('div', 'td-pills');
      pills.append(h('span', 'td-pill td-stp', k ? t('step', { n: k }) : t('buildsOn')));
      // each side moves to the next line whole while it fits on one, the arrow with the part it points at
      const title = h('h3');
      title.append(K.soft(h('span', 'td-ib'), name(l.from)), ' ', K.soft(h('span', 'td-ib'), `→ ${name(l.to)}`));
      d.append(pills, title);
      if (k && l.label) d.append(h('p', null, l.label));
      const dl = list();
      dl.row(t('inCode'), l.code, 'td-code');
      return [d, dl];
    }
    return { part, mod, link };
  }

  root.TdDetail = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
