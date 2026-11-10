/**
 * AI-DLC Turbo - Code Scaffold, what the details show, in the panel right of
 * the drawing (design-pane.js) and wherever the details go (under the
 * drawing on a phone, in the drawing's own view).
 *
 * Always one element; something is always chosen (design-chosen.js):
 *   - a block chosen (a click, the arrows on a block with the focus, the
 *     walk under the details, a link to it): that block;
 *   - else the step held (the arrows, play, a line clicked): the part the
 *     step goes to; the step itself shows in the box over the drawing
 *     (design-stepbox.js), not in the details;
 *   - only a story without steps leaves nothing: the details close and the
 *     panel says so calmly (design-pane.js).
 * The details: the head with the name and what it does (design-detail.js),
 * the rows of the review before the build, the chips of its stories
 * (design-stories.js); that is the body, which scrolls on its own. Under it,
 * outside what scrolls, the walk: for a block chosen to the element before
 * or after it, for the part of the step held to the step before or after
 * it (design-browse.js). The change in the code never shows here: that is
 * the Review tab's, which "See the change" in the head opens. Another
 * element fades over (design-swap.js); the same one again only marks the
 * story chosen anew. batch(fn) shows only what is there once fn is done, so
 * a click that changes the story, the step and the block at once fades over
 * once.
 *
 *   TdShow.create({ detail, model, steps, facts, stories, browse, holds, selected() })
 *     -> { render(force), subject(), batch(fn) }
 *
 * `facts` is TdDetail.create, `stories` TdStories.create, `browse`
 * TdBrowse.create; `holds(kind, id)` tests whether a story has the element.
 * The page inlines it as window.TdShow, before the panel (design-panel.js).
 */
(function (root) {
  'use strict';

  const K = typeof module !== 'undefined' && module.exports ? require('./design-kit.js') : root.TdKit;

  function create(o) {
    const { h } = K;
    const { detail, model } = o;
    const parts = new Map(model.parts.map((p) => [p.id, p]));
    const mods = new Map(model.modules.map((m) => [m.id, m]));
    const links = new Map(model.links.map((l) => [l.id, l]));
    let shown = ''; // what the details show now, as kind:id:step
    let quiet = 0, due = false;

    /** The block chosen (with the step held that goes to it), else the part the step held goes to, else null; `walk` the walk under it. */
    function subject() {
      const s = o.selected();
      const at = o.steps && o.steps.current();
      const l = at && links.get(at);
      if (s) return { kind: s.kind, id: s.id, step: l && s.kind === 'part' && l.to === s.id ? l : null, walk: 'part' };
      return l && parts.has(l.to) ? { kind: 'part', id: l.to, step: l, walk: 'step' } : null;
    }

    function build(sub) {
      const { kind, id, step } = sub;
      const x = kind === 'part' ? parts.get(id) : kind === 'module' ? mods.get(id) : links.get(id);
      const [hd, dl] = kind === 'part' ? o.facts.part(x) : kind === 'module' ? o.facts.mod(x) : o.facts.link(x);
      // the body that scrolls: the head, the rows (before the build), the stories
      const g = h('div', 'td-dgrid' + (dl ? '' : ' td-dgrid-one'));
      g.append(hd);
      if (dl) g.append(dl);
      const f = kind !== 'link' && o.stories ? o.stories.foot(model.stories.filter(o.holds(kind, id))) : null;
      if (f) g.append(f);
      // the column: the body, the walk under it where nothing scrolls under it
      const col = h('div', 'td-dcol');
      col.append(g);
      const nav = sub.walk === 'step' ? o.browse.stepNav(step.id) : kind === 'part' ? o.browse.nav(id) : null;
      if (nav) col.append(nav);
      return col;
    }

    /** Show what is chosen or held; `force` builds the details again even when they show the same element. */
    function render(force) {
      if (quiet) { due = true; return; }
      const sub = subject();
      if (!sub) { shown = ''; detail.hidden = true; return; }
      // the step counts only for the walk under the part of a step: its numbers are the step's
      const key = `${sub.kind}:${sub.id}:${sub.walk === 'step' ? sub.step.id : ''}:${sub.walk}`;
      if (!force && key === shown && !detail.hidden) { if (o.stories) o.stories.sync(); return; }
      shown = key;
      root.TdSwap.put(detail, null, build(sub)); // the old details fade over into these
      detail.hidden = false;
    }

    /** Run fn, then show once what is there after it. */
    function batch(fn) {
      quiet += 1;
      try { return fn(); } finally {
        quiet -= 1;
        if (!quiet && due) { due = false; render(); }
      }
    }

    return { render, subject, batch };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdShow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
