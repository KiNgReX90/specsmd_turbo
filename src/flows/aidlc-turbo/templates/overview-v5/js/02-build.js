/* The marks of the build: where a file deviated from the approved Code Scaffold. Pure but for the card it makes.

   The deviation is read, never worked out here: a part's own `build` where the model carries one, else what the
   build block says of it (model.build.stories, per built story `different`, `extra` and `gone`, lib/design-build.cjs),
   by its id, else by its path. A deviation is { state: different | added | gone, story, plan, built, why }; a part
   that already existed and was drawn to be used but was not is "not used" rather than "not built". While a change is
   open (kit.plan) the drawings show the plan and nothing here is asked for.

     C4.build.devOf(model, part) -> deviation | null
     C4.build.markTitle(part, dev) -> the words of its mark, as the legend says them
     C4.build.card(part, dev) -> the card of its deviation for the inspector: its mark and title, then Planned, Built
       and Why, each a short paragraph, left out when the notes have nothing for it; Why always, saying so when the
       notes give no reason. null without a deviation. */
(function () {
  'use strict';
  const C4 = window.C4;
  const { el, svgEl, T } = C4.kit;
  const DEV = new Set(['different', 'added', 'gone']);
  const list = (v) => (Array.isArray(v) ? v : []);
  const norm = (p) => String(p).trim().replace(/\\/g, '/').replace(/^\.\//, '');

  /** The deviation of part or module x: its own `build`, else what the build block says of it; null without one. */
  function devOf(M, x) {
    if (!x) return null;
    if (x.build && x.build.state) return DEV.has(x.build.state) ? x.build : null;
    const b = M && M.build;
    const at = x.path ? norm(x.path) : null;
    const hit = (e) => !!e && ((!!x.id && e.id === x.id) || (!!at && !!e.path && norm(e.path) === at));
    // a part two stories build: a deviation in either one shows, the first in story order
    for (const s of list(b && b.stories)) {
      const story = String(s.id);
      const d = list(s.different).find(hit);
      if (d) return { state: 'different', story, plan: d.plan || null, built: d.built || null, why: d.why || null };
      const g = list(s.gone).find(hit);
      if (g) return { state: 'gone', story, plan: g.plan || null, built: null, why: g.why || null };
      const e = at ? list(s.extra).find((y) => !!y && !!y.file && norm(y.file) === at) : null;
      if (e) return { state: 'added', story, plan: null, built: e.built || null, why: e.why || null };
    }
    return null;
  }
  /** Not used: a part that already existed, drawn to be used, the build left out. */
  const unused = (x, d) => !!d && d.state === 'gone' && !!x && x.status === 'existing';
  /** The key of the words of a deviation: different, added, gone or unused. */
  const wordOf = (x, d) => (d && DEV.has(d.state) ? (unused(x, d) ? 'unused' : d.state) : null);
  /** The title of the mark of the deviation, as the legend says it. */
  const markTitle = (x, d) => (wordOf(x, d) ? T(`build.mark.${wordOf(x, d)}`) : '');

  /** The mark of a deviation as a small picture for the inspector, the same sign as on the card. */
  function mark(state) {
    const s = svgEl('svg', { viewBox: '-20 -20 40 40', class: 'bdev-i', 'aria-hidden': 'true', focusable: 'false' });
    s.append(C4.shapes.bmark(state, '', 0, 0, 19));
    return s;
  }
  /** `text` into e, what stands between backticks as code. */
  function prose(e, text) {
    String(text || '').split(/`([^`]+)`/).forEach((bit, i) => { if (bit) e.append(i % 2 ? el('code', null, bit) : bit); });
    return e;
  }
  const told = (s) => { const t = String(s || '').trim().replace(/[.!?]+$/, ''); return t ? t.charAt(0).toUpperCase() + t.slice(1) + '.' : ''; };

  /** The card of the deviation: its mark and title, then Planned, Built and Why. */
  function card(x, d) {
    const w = wordOf(x, d);
    if (!w) return null;
    const title = T(`build.card.${w}`);
    const box = el('div', 'bdev bdev-' + d.state);
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', title);
    const t = el('h4', 'bdev-t');
    t.append(mark(d.state), title);
    box.append(t);
    const lines = [];
    if (d.plan && d.state !== 'added') lines.push([T('build.planned'), d.plan]);
    if (d.built && d.state !== 'gone') lines.push([T('build.built'), d.built]);
    lines.push([T('build.why'), d.why || T('build.noReason')]);
    for (const [k, v] of lines) {
      const p = el('p', 'bdev-p');
      p.append(el('b', 'bdev-k', k), ' ', prose(el('span'), told(v)));
      box.append(p);
    }
    return box;
  }

  C4.build = { devOf, markTitle, card };
})();
