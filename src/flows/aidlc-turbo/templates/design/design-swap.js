/**
 * AI-DLC Turbo - Code Scaffold, one element's details giving way to the next.
 *
 * Another element chosen (previous or next, the arrows, the list of the
 * name, a click on another block): the details and their change in the code
 * fade over into the new ones together, quick and calm, in the panel and on
 * full screen. The old ones stay frozen where they were (fixed on the
 * screen, cut to the box, out of reach of the pointer, the keys and a screen
 * reader) while they fade out; the new ones fade in under them, in their own
 * place. The box keeps its size, the calm word never shows between two
 * elements, and a scroll back to the top happens unseen under the old ones.
 * Only opacity moves. A new choice while one still fades ends that one at
 * once and shows the newest whole: presses in a row never stack, the last
 * choice wins. Without motion (the viewer's prefers-reduced-motion, a browser
 * without animations) and for the first details the swap is instant.
 *
 *   TdSwap.put(box, fixed, body) -> body
 *
 * `box` holds the details (design-panel.js), `fixed` is what stays put in it
 * (its buttons: no fade), `body` the new details. The page inlines it as
 * window.TdSwap, before the panel.
 */
(function (root) {
  'use strict';

  const OUT = 100; // the old details fade out
  const IN = 160; // the new ones fade in, a moment later: done within 190 ms
  const LAG = 30;
  const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'; // easing out, the page's own --td-ease
  const runs = new WeakMap(); // box -> the swap still running
  const bodies = new WeakMap(); // box -> the details it shows

  const still = () => {
    try { return !root.matchMedia || root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return true; }
  };
  const px = (v) => Math.round(v * 100) / 100 + 'px';

  /** The swap of `box` still running ends at once: the old details gone, the new ones whole. */
  function settle(box) {
    const run = runs.get(box);
    if (!run) return false;
    runs.delete(box);
    for (const a of run.anims) { try { a.cancel(); } catch (e) { /* ended already */ } }
    run.ghost.remove();
    return true;
  }

  /** The old details frozen where they are on the screen, cut to the box, out of reach. */
  function freeze(old, box) {
    const r = old.getBoundingClientRect(), b = box.getBoundingClientRect(), s = old.style;
    old.classList.add('td-dgone');
    old.setAttribute('aria-hidden', 'true');
    old.inert = true;
    Object.assign(s, { position: 'fixed', top: px(r.top), left: px(r.left), width: px(r.width), height: px(r.height),
      margin: '0px', boxSizing: 'border-box', pointerEvents: 'none' });
    // a transformed parent moves fixed boxes along: put them back where they were
    const n = old.getBoundingClientRect();
    if (n.top !== r.top || n.left !== r.left) { s.top = px(2 * r.top - n.top); s.left = px(2 * r.left - n.left); }
    const cut = [b.top - r.top, r.right - b.right, r.bottom - b.bottom, b.left - r.left].map((v) => px(Math.max(0, v)));
    s.clipPath = `inset(${cut.join(' ')})`;
  }

  function put(box, fixed, body) {
    const busy = settle(box);
    const old = bodies.get(box);
    bodies.set(box, body);
    const fade = !busy && !still() && typeof body.animate === 'function' && !box.hidden
      && !!old && old.parentNode === box && old.getClientRects().length > 0;
    if (!fade) {
      box.replaceChildren(...[fixed, body].filter(Boolean));
      return body;
    }
    freeze(old, box);
    for (const c of [...box.children]) if (c !== old) c.remove();
    if (fixed) box.insertBefore(fixed, old);
    box.insertBefore(body, old);
    const run = { ghost: old, anims: [] };
    runs.set(box, run);
    run.anims.push(old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: OUT, easing: EASE, fill: 'forwards' }));
    const a = body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: IN, delay: LAG, easing: EASE, fill: 'backwards' });
    run.anims.push(a);
    a.onfinish = () => { if (runs.get(box) === run) settle(box); };
    return body;
  }

  const api = { put, OUT, IN, LAG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdSwap = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
