/**
 * AI-DLC Turbo - Code Scaffold, a handle that resizes by a drag or the keys.
 *
 * One way to move an edge for every handle of the details panel
 * (design-pane.js): its left edge, and the divider between a part's details
 * and its change in the code. A drag from where it was pressed (a mouse, a
 * pen, a finger; the pointer captured, so it goes on outside the handle), the
 * arrow keys along its axis in steps, Home and End to its bounds, a double
 * click back to where it starts. While it is dragged no text gets selected
 * and nothing glides: td-dresizing on the page, with td-dresizing-y for a
 * handle that moves up and down (design-pane.css).
 *
 *   TdGrip.bind(el, { axis, dir, step, per, value, set, keep, reset, on }) -> { dragging() }
 *
 * `axis` is 'x' or 'y' (or a function saying which, now); `dir` 1 where a
 * move right or down makes the value larger, -1 where it makes it smaller;
 * `per()` the pixels one unit of the value takes (1 when it is a width in
 * pixels); `value()` what it is now; `set(v)` takes a new value and keeps it
 * inside its own bounds (Home sends -Infinity, End Infinity); `keep()`
 * remembers it after a drag or a key; `reset()` hears the double click;
 * `on()` says whether the handle works now. The page inlines it as
 * window.TdGrip, before the panel.
 */
(function (root) {
  'use strict';

  // the keys along each axis: a step left or up, a step right or down
  const KEYS = { x: { ArrowLeft: -1, ArrowRight: 1 }, y: { ArrowUp: -1, ArrowDown: 1 } };
  const ENDS = { Home: -Infinity, End: Infinity };

  function bind(el, o) {
    const html = document.documentElement;
    const axis = () => (typeof o.axis === 'function' ? o.axis() : o.axis || 'x');
    const on = () => !o.on || o.on();
    const keep = () => { if (o.keep) o.keep(); };
    let drag = null;

    el.addEventListener('pointerdown', (ev) => {
      if (!on() || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      ev.preventDefault(); // no text selected while it moves
      const y = axis() === 'y';
      drag = { id: ev.pointerId, y, at: y ? ev.clientY : ev.clientX, v: o.value(), per: (o.per && o.per()) || 1 };
      try { el.setPointerCapture(ev.pointerId); } catch (e) { /* a pointer the page does not know: the moves still come */ }
      html.classList.add('td-dresizing');
      html.classList.toggle('td-dresizing-y', y);
    });
    el.addEventListener('pointermove', (ev) => {
      if (drag && ev.pointerId === drag.id) o.set(drag.v + o.dir * ((drag.y ? ev.clientY : ev.clientX) - drag.at) / drag.per);
    });
    const end = (ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      drag = null;
      html.classList.remove('td-dresizing', 'td-dresizing-y');
      keep();
    };
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(t, end);
    el.addEventListener('dblclick', () => { if (on() && o.reset) o.reset(); });
    el.addEventListener('keydown', (ev) => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey || !on()) return;
      const m = KEYS[axis()][ev.key];
      const to = m ? o.value() + o.dir * m * (o.step || 1) : ENDS[ev.key];
      if (to === undefined) return;
      ev.preventDefault();
      o.set(to);
      keep();
    });
    return { dragging: () => !!drag };
  }

  const api = { bind };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdGrip = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
