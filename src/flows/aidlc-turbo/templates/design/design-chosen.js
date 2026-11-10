/**
 * AI-DLC Turbo - Code Scaffold, what is chosen in the drawing: never nothing.
 *
 * The drawing is always in step mode: a step is always held, step 1 when
 * the page opens. A story chosen that lacks the step held holds its first
 * step. A block clicked is chosen (lit in the drawing, its details shown)
 * and holds the step that goes to it, where one does; a block no step goes
 * to is chosen with a step still held. A step walked to, played or clicked
 * (a line) lets go of the block, so the details show the part the step goes
 * to (design-show.js). Nothing lets go of the step: not Escape, not the
 * empty drawing, not a second click. Only a story without steps leaves the
 * drawing without one (the calm word of design-pane.js). A drawing without
 * steps keeps a block chosen instead, from the start the first block of the
 * walk (first(), design-browse.js).
 *
 *   TdChosen.create({ drawn, model, steps, first(), show(), hold() })
 *     -> { get(), flowing(), mark(kind, id), clear(), ensure(), step(id), block(id) }
 *
 * `drawn` is what the engine drew (design-engine.js), `steps` the walk over
 * the steps (none on a drawing without them), first() the first block of
 * the walk, show() the details (design-show.js), hold() pauses play. mark()
 * chooses as a click does, lit in the drawing and shown in the details,
 * without a pause of play, the focus or a move of the page; the same block
 * again changes nothing. clear() lets go of the block for the step to show.
 * The page inlines it as window.TdChosen, before the panel (design-panel.js).
 */
(function (root) {
  'use strict';

  function create(o) {
    const { drawn, model, steps } = o;
    const links = new Map(model.links.map((l) => [l.id, l]));
    const nodeEl = new Map(drawn.nodes.map((n) => [n.p.id, n.g]));
    let sel = null;
    const show = () => o.show();
    const flowing = () => !!steps;
    const els = (s) => (s.kind === 'part' ? [nodeEl.get(s.id)].filter(Boolean)
      : s.kind === 'module' ? drawn.frames.filter((f) => f.m.id === s.id).map((f) => f.g) : []);

    function clear() {
      if (sel) for (const g of els(sel)) g.classList.remove('td-sel');
      sel = null;
      show().render();
    }
    function mark(kind, id) {
      if (sel && sel.kind === kind && sel.id === id) return;
      show().batch(() => {
        clear();
        sel = { kind, id };
        for (const g of els(sel)) g.classList.add('td-sel');
        show().render();
      });
    }
    /** The step that goes to part `id`: the one held when it does, else the first of the walk; null without one. */
    function into(id) {
      const cur = steps.current(), l = cur && links.get(cur);
      return l && l.to === id ? cur : steps.ids().find((x) => links.get(x).to === id) || null;
    }
    /** Never nothing: a step held (the first), else, without steps, a block (the first of the walk). */
    function ensure() {
      if (flowing()) {
        const vis = steps.ids();
        if (!steps.current() && vis.length) steps.pin(vis[0]);
      } else if (!sel) {
        const id = o.first();
        if (id) mark('part', id);
      }
    }
    /** A step held: the block lets go, the details show the part the step goes to. */
    function step() {
      if (flowing() && sel) clear();
    }
    /** A block clicked: chosen, the step into it held, else a step still held. False without steps. */
    function block(id) {
      if (!flowing()) return false;
      o.hold();
      show().batch(() => {
        const to = into(id);
        if (to && to !== steps.current()) steps.pin(to);
        mark('part', id);
        if (!steps.current()) { const vis = steps.ids(); steps.pin(vis.find((x) => links.get(x).from === id) || vis[0] || null); }
      });
      return true;
    }

    return { get: () => sel, flowing, mark, clear, ensure, step, block };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdChosen = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
