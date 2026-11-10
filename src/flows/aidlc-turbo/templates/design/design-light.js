/**
 * AI-DLC Turbo - Code Scaffold, what lights up in the drawing.
 *
 * A story chosen lights up what it builds and uses and puts its number on
 * what it builds (story(s); null puts it out). With no story chosen,
 * hovering a block lights up its neighbours: the blocks it calls or is
 * called by and the lines between them. That light waits for the pointer to
 * rest a moment (REST) and goes out only a moment after the pointer left the
 * blocks (AWAY): a pointer that crosses the drawing, or moves from one block
 * to the next, never sets it flickering on and off. While a step is held
 * (td-trace, design-steps.js) that light fades nothing further: the block,
 * its neighbours and the lines between them come up over the fade of the
 * step (td-lit, design-scaffold.css), the step's own blocks and line stay as
 * they are, and when the light goes out the step shows as before. Only the
 * blocks themselves listen: the module chip and the number in a block are
 * plain labels the pointer goes through (design-layout.css), the labels of
 * the lines and their step numbers take no pointer at all.
 *
 *   TdLight.create(drawn, model, dz) -> { story(s), set(nodeIds, edgeIds, marks) }
 *
 * `drawn` is what the engine drew (design-engine.js), its svg the one that
 * carries td-trace, `dz` the box of the drawing that carries td-focus. The
 * page inlines it as window.TdLight, before the panel (design-panel.js).
 */
(function (root) {
  'use strict';

  const REST = 120; // the pointer rests this long on a block before its neighbours light up
  const AWAY = 180; // and this long off the blocks before the light goes out

  function create(drawn, model, dz) {
    let story = null;
    let timer = 0;
    let lit = null; // the block whose neighbours are lit

    function set(nodeIds, edgeIds, marks) {
      const on = !!nodeIds;
      lift(null, null);
      dz.classList.toggle('td-focus', on);
      for (const n of drawn.nodes) {
        n.g.classList.toggle('td-in', on && nodeIds.includes(n.p.id));
        n.g.classList.toggle('td-mk', !!marks && n.p.id in marks);
      }
      for (const e of drawn.edges) {
        e.g.classList.toggle('td-in', on && edgeIds.includes(e.l.id));
        e.lg.classList.toggle('td-in', on && edgeIds.includes(e.l.id));
      }
      for (const f of drawn.frames) {
        f.g.classList.toggle('td-in', on && !!f.f && model.frames.some((m) => m.id === f.f.id && m.parts.some((id) => nodeIds.includes(id))));
        f.g.classList.toggle('td-mk', !!marks && f.m.id in marks);
      }
    }
    /** While a step is held: these blocks and lines lit over the fade of the step (td-lit), nothing faded further. */
    function lift(nodeIds, edgeIds) {
      for (const n of drawn.nodes) n.g.classList.toggle('td-lit', !!nodeIds && nodeIds.includes(n.p.id));
      for (const e of drawn.edges) {
        const on = !!edgeIds && edgeIds.includes(e.l.id);
        e.g.classList.toggle('td-lit', on);
        e.lg.classList.toggle('td-lit', on);
      }
    }
    function neighbours(id) {
      const es = model.links.filter((l) => l.from === id || l.to === id);
      const ns = new Set([id]);
      for (const l of es) { ns.add(l.from); ns.add(l.to); }
      const ids = [...ns], lines = es.map((l) => l.id);
      // a step held fades the rest already: the neighbourhood comes up over it, nothing fades further
      if (drawn.svg && drawn.svg.classList.contains('td-trace')) { set(null); lift(ids, lines); } else set(ids, lines);
    }
    function storyLight(s) {
      clearTimeout(timer);
      lit = null;
      story = s || null;
      if (!story) { set(null); return; }
      for (const n of drawn.nodes) n.nb.textContent = story.n;
      for (const f of drawn.frames) if (f.nb) f.nb.textContent = story.n;
      set(story.parts, story.links, story.builds || {});
    }
    /** After a rest: the neighbours of `id`, or (null) the light out. */
    function later(id, wait) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (story || id === lit) return;
        lit = id;
        if (id) neighbours(id); else set(null);
      }, wait);
    }
    for (const n of drawn.nodes) {
      n.g.addEventListener('mouseenter', () => { if (!story) later(n.p.id, REST); });
      n.g.addEventListener('mouseleave', () => { if (!story) later(null, AWAY); });
    }
    return { story: storyLight, set };
  }

  const api = { create, REST, AWAY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdLight = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
