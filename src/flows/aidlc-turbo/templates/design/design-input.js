/**
 * AI-DLC Turbo - Code Scaffold, what the pointer and the keys do in the
 * drawing on the page.
 *
 * A click or a tap on a block chooses it and shows its details (`clicked`,
 * design-panel.js); Enter or Space on a block reached with Tab does the
 * same, while Space on a block a pointer pressed plays the steps
 * (design-play.js). A block with the focus takes all four arrows: they
 * choose the block in that direction (design-near.js), give it the focus
 * and keep it in sight. A click or a tap on a line (or, for a finger, its
 * label) holds its step. Escape leaves the drawing's own view and never
 * lets go of what is chosen. A click on the drawing's empty space, between
 * the parts or along its edges, pauses play and puts the story back to
 * All (`reset`); in the preview (td-pv) a click opens the view instead,
 * at the spot that was clicked. Where the drawing pans in its box on a
 * desktop page (`pans()`, design-zoom.js) a block reached with the arrows or
 * with Tab comes into sight there (`reveal(at)`), and the page stays put.
 *
 *   TdInput.wire({ drawn, geo, model, root, dz, view, chosen(), clicked(kind, id), reset(), openView(at), svgOf(), vbOf(svg), pans(), reveal(at) })
 *
 * `root` is the root of the drawing (td-root), `dz` the drawing's box,
 * `view` the full-screen view (design-view.js), chosen() what is chosen now
 * (design-chosen.js). The page inlines it as window.TdInput, before the
 * panel (design-panel.js).
 */
(function (root) {
  'use strict';

  function wire(o) {
    const { drawn, geo, model, dz, view } = o;
    const parts = new Set(model.parts.map((p) => p.id));
    const links = new Set(model.links.map((l) => l.id));
    const nodeEl = new Map(drawn.nodes.map((n) => [n.p.id, n]));
    const blocks = geo.blocks.filter((b) => parts.has(b.id));

    /** A block with the focus and an arrow: the block in that direction, chosen as a click does, the focus on it, in sight. */
    function toward(id, dir) {
      const to = root.TdNear.pick(blocks, id, dir);
      if (!to) return;
      const s = o.chosen();
      if (!(s && s.kind === 'part' && s.id === to)) o.clicked('part', to);
      const g = nodeEl.get(to).g;
      g.focus({ preventScroll: true });
      if (view.isOpen()) view.reveal({ part: to });
      else if (o.pans && o.pans()) o.reveal({ part: to });
      else if (typeof g.getBoundingClientRect === 'function') {
        const r = g.getBoundingClientRect();
        if (r.top < 0 || r.bottom > innerHeight) g.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
    // a block a pointer pressed has the pointer's focus: Space on it plays (design-play.js), it chooses only after Tab
    let pointed = null;
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Tab') pointed = null; }, true);
    function clickable(g, id) {
      g.addEventListener('click', () => o.clicked('part', id));
      g.addEventListener('pointerdown', () => { pointed = g; });
      g.addEventListener('focus', () => { if (!view.isOpen() && o.pans && o.pans()) o.reveal({ part: id }); });
      g.addEventListener('keydown', (ev) => {
        const dir = !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && root.TdNear.DIR[ev.key];
        if (dir) { ev.preventDefault(); ev.stopPropagation(); toward(id, dir); return; }
        if (ev.key === ' ' && pointed === g) return;
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); o.clicked('part', id); }
      });
    }
    // a block: the module chip and the number in it are plain labels, the pointer goes through them to the block
    for (const n of drawn.nodes) clickable(n.g, n.p.id);
    for (const e of drawn.edges) {
      if (!links.has(e.l.id)) continue;
      for (const g of [e.g, e.lg]) g.addEventListener('click', () => o.clicked('link', e.l.id));
    }
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape' || ev.defaultPrevented) return;
      if (view.isOpen()) view.close();
    });
    // the empty drawing (around the drawing in the view: design-view.js, a finger's tap there comes as onBlank)
    dz.addEventListener('click', (ev) => {
      if (!view.isOpen() && o.root.classList.contains('td-pv')) return; // the preview opens the view instead
      if (ev.target.closest('.td-node, .td-mtag, .td-edge, .td-elab, .td-pv-open')) return;
      o.reset();
    });
    // the preview opens the view: the button at START 1, a tap on the drawing at that spot
    dz.addEventListener('click', (ev) => {
      if (view.isOpen() || !o.root.classList.contains('td-pv')) return;
      const svg = o.svgOf(), vb = o.vbOf(svg), r = svg && svg.getBoundingClientRect();
      if (ev.target.closest('.td-pv-open') || !vb || !r.width) { o.openView(); return; }
      o.openView({ point: [(ev.clientX - r.left) * vb.w / r.width, (ev.clientY - r.top) * vb.w / r.width] });
    });
  }

  const api = { wire };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdInput = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
