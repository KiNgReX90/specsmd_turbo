/* The drawing under the pointer and the keys: drag to pan (a drag is never a click), click to choose a card,
   double-click or Enter to zoom in, a story number on a card to pin that story, Escape to step back, + - 0 for the
   zoom. */
(function () {
  'use strict';
  const C4 = window.C4;

  function mount(canvas, api) {
    const { state, select, pick, zoomInto, zoomOut, lights, zoomBy, fit } = api;
    // drag the drawing with the mouse when it is larger than its window; a drag is never a click
    let drag = null, dragged = false;
    canvas.addEventListener('pointerdown', (ev) => {
      dragged = false;
      if (ev.pointerType !== 'mouse' || ev.button !== 0 || !canvas.classList.contains('can-pan')) return;
      drag = { x: ev.clientX, y: ev.clientY, l: canvas.scrollLeft, t: canvas.scrollTop, id: ev.pointerId, moved: false };
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < 5) return;
        drag.moved = true;
        canvas.setPointerCapture(ev.pointerId);
        canvas.classList.add('panning');
      }
      canvas.scrollLeft = drag.l - dx;
      canvas.scrollTop = drag.t - dy;
    });
    const endDrag = () => { if (drag && drag.moved) { dragged = true; canvas.classList.remove('panning'); } drag = null; };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('click', (ev) => {
      if (dragged) { dragged = false; return; }
      const z = ev.target.closest('.zoomer');
      if (z) { zoomInto(z.dataset.zoom); return; }
      const b = ev.target.closest('.sbadge');
      if (b && !String(b.dataset.us).startsWith('+')) { ev.stopPropagation(); pick(state.story === b.dataset.us ? null : b.dataset.us); return; }
      const n = ev.target.closest('.node');
      select(n ? n.dataset.id : null);
    });
    canvas.addEventListener('dblclick', (ev) => { const n = ev.target.closest('.node'); if (n) zoomInto(n.dataset.id); });
    canvas.addEventListener('keydown', (ev) => {
      const n = ev.target.closest('.node');
      if (!n) return;
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        if (ev.key === 'Enter' && state.sel === n.dataset.id) zoomInto(n.dataset.id); else select(n.dataset.id);
      }
    });
    canvas.addEventListener('mouseover', (ev) => {
      const n = ev.target.closest('.node');
      const id = n ? n.dataset.id : null;
      if (id !== state.hover) { state.hover = id; lights(); }
    });
    canvas.addEventListener('mouseleave', () => { state.hover = null; lights(); });
    // a card reached with the keyboard previews like one under the pointer; a click already chooses it
    canvas.addEventListener('focusin', (ev) => { const n = ev.target.closest('.node'); if (n && n.matches(':focus-visible')) { state.hover = n.dataset.id; lights(); } });
    canvas.addEventListener('focusout', () => { state.hover = null; lights(); });

    // the keys anywhere on the page, unless you are typing
    document.addEventListener('keydown', (ev) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((ev.target.tagName || '')) || ev.target.isContentEditable;
      // Ctrl or Cmd with + or - zooms the browser, not the drawing
      if (typing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key === 'Escape') {
        state.hover = null;
        if (state.sel) select(null); else if (state.story) pick(null); else zoomOut();
      } else if (ev.key === '+' || ev.key === '=') zoomBy(1);
      else if (ev.key === '-' || ev.key === '_') zoomBy(-1);
      else if (ev.key === '0') fit();
    });
  }

  C4.input = { mount };
})();

