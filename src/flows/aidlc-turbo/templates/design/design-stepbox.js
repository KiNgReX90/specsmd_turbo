/**
 * AI-DLC Turbo - Code Scaffold, the step held in a small box over the drawing.
 *
 * The arrows of the drawing say what happens, but where there is no room the
 * drawing leaves that label out. The box always shows the step held in full:
 * a step is always held (design-chosen.js), only a story without steps
 * holds none, and then the box is hidden. "Step n", at the
 * end of its head a small label per story it is in ("US 003", the story's
 * title in its tooltip and its name), its plain sentence (`step`, else
 * its label) and a small line from -> to with the call in code type. Another
 * step fades over, quick and calm: the old one fades out over the new one,
 * cut to the new one's size and out of reach, opacity only; a step after it
 * ends that fade at once (the last one wins); with reduced motion, and when
 * the box was hidden, it changes at once. One quiet line for a screen reader
 * (role status) says the step once.
 *
 * It starts in the drawing's frame, bottom left, just above the line of keys,
 * where it covers the least of the drawing. Dragged by its head (a mouse, a
 * pen, a finger; a press that moves less than 4 px stays a click) it floats
 * over the page, 12 px inside the window, also when the window gets smaller.
 * Where it was let go is remembered per viewer, where the browser allows it;
 * a double click or two taps on its head put it back in its place and forget
 * it. The button in its head folds it to a small pill "Step n" (remembered).
 * In the drawing's full-screen view (design-view.js takes it along) it stays
 * inside the view; in the preview of a phone it is a bar right under the
 * preview that does not move.
 *
 *   TdStepBox.create({ model, steps, frame, page, titleOf(story) }) -> { el, place() }
 *
 * `titleOf` gives a story's full title (the page's own, else its short one),
 * `steps` is the walk over the steps (design-steps.js), `frame` the drawing's
 * frame it starts in (td-dzw), `page` the root of the drawing (td-root) it
 * floats over. place() puts it where it belongs now: the view calls it as
 * el.tdPlace when it takes the box in or gives it back. Its texts come from
 * the page's string table (TdText, design.stepbox). The page inlines it as
 * window.TdStepBox, after TdKit, before the panel (design-panel.js).
 */
(function (root) {
  'use strict';

  const cjs = typeof module !== 'undefined' && module.exports;
  const K = cjs ? require('./design-kit.js') : root.TdKit;
  const TX = cjs ? require('./design-text.js') : root.TdText;
  const tx = (key, vars) => TX.t(`design.stepbox.${key}`, vars);
  const AT = 'td-stepbox-at'; // where the viewer let it go: { x, y } on the window
  const FOLD = 'td-stepbox-folded';
  const M = 12; // its margin to the edge of the window, or of the view
  const TWICE = 450; // two clicks or taps within this many ms put it back
  const OUT = 100, IN = 160, LAG = 30; // the old step fades out, the new one in a moment later
  const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'; // easing out, the page's own --td-ease
  const GRIP = '<svg class="td-i" viewBox="0 0 20 20" aria-hidden="true"><g class="td-fill"><circle cx="7.5" cy="5" r="1.5"/>'
    + '<circle cx="12.5" cy="5" r="1.5"/><circle cx="7.5" cy="10" r="1.5"/><circle cx="12.5" cy="10" r="1.5"/>'
    + '<circle cx="7.5" cy="15" r="1.5"/><circle cx="12.5" cy="15" r="1.5"/></g></svg>';

  const get = (k) => { try { return root.localStorage.getItem(k); } catch (e) { return null; } };
  const put = (k, v) => { try { root.localStorage.setItem(k, v); } catch (e) { /* not remembered, works all the same */ } };
  const drop = (k) => { try { root.localStorage.removeItem(k); } catch (e) { /* not remembered, works all the same */ } };
  /** Where the viewer let it go before, or null. */
  function saved() {
    try { const v = JSON.parse(get(AT)); return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : null; } catch (e) { return null; }
  }
  const still = () => { try { return typeof root.matchMedia === 'function' && root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return true; } };
  /** `next` in `box` instead of what it holds; with `fade` the old fades out over it, cut to its size, out of reach. */
  function fadeTo(box, next, fade) {
    for (const g of [...box.children]) if (g.classList.contains('td-sbox-gone')) g.remove(); // the last one wins
    const old = box.children[0] || null;
    if (!fade || !old || typeof next.animate !== 'function') { box.replaceChildren(next); return; }
    old.classList.add('td-sbox-gone');
    old.setAttribute('aria-hidden', 'true');
    old.inert = true;
    box.prepend(next);
    old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: OUT, easing: EASE, fill: 'forwards' }).onfinish = () => old.remove();
    next.animate([{ opacity: 0 }, { opacity: 1 }], { duration: IN, delay: LAG, easing: EASE, fill: 'backwards' });
  }
  const bare = (s) => String(s || '').trim().replace(/[.!?]+$/, '');
  /** The plain sentence of a step (its label without one), with a capital and a full stop. */
  function sentence(l) {
    const s = bare(l.step) || bare(l.label);
    return s ? s.charAt(0).toUpperCase() + s.slice(1) + '.' : '';
  }

  function create(o) {
    const { h } = K;
    const { model, steps } = o;
    const titleOf = (s) => (o.titleOf && o.titleOf(s)) || s.title || '';
    const links = new Map(model.links.map((l) => [l.id, l]));
    const nameOf = (id) => { const p = model.parts.find((x) => x.id === id); return p ? p.name : id; };
    const el = h('div', 'td-sbox');
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', tx('label'));
    el.hidden = true;
    // the head: the grip, "Step n" and the labels of its stories (they fade over), the fold button
    const head = h('div', 'td-sbox-head');
    head.title = tx('headTip');
    const grip = h('span', 'td-sbox-grip');
    grip.innerHTML = GRIP;
    const name = h('div', 'td-sbox-name');
    const fold = K.btn('td-sbox-fold', 'chev', null, tx('fold'));
    const body = h('div', 'td-sbox-body'); // the sentence, from -> to and the call (fades over)
    body.id = 'td-sbox-' + Math.random().toString(36).slice(2, 8);
    fold.setAttribute('aria-controls', body.id);
    head.append(grip, name, fold);
    const live = h('p', 'td-sbox-live'); // what a screen reader hears, once a step
    live.setAttribute('role', 'status');
    el.append(head, body, live);
    let at = saved(); // where the viewer let it go, on the window; null in its place
    let folded = get(FOLD) === '1';
    let shown = null;

    /** Show step `id`, or hide the box without one. */
    function render(id) {
      const l = id ? links.get(id) : null;
      if (!l) { shown = null; el.hidden = true; return; }
      const was = el.hidden;
      if (id !== shown) { // while it was hidden the new step comes at once, without a fade from an old one
        shown = id;
        const n = steps.number(id), label = n ? tx('step', { n }) : tx('stepNone');
        const t = h('div', 'td-sbox-t');
        t.append(h('span', 'td-sbox-n', label));
        // the stories it is in, at the end of the head: "US 003", the title in the tooltip and the name
        const of = model.stories.filter((s) => s.links.includes(id));
        if (of.length) {
          const c = h('span', 'td-sbox-st');
          for (const s of of) {
            const us = h('span', 'td-sbox-us', 'US ' + String(s.n).padStart(3, '0'));
            const say = tx('storySay', { n: Number(s.n) || s.n, title: titleOf(s) });
            us.title = say;
            us.setAttribute('role', 'img');
            us.setAttribute('aria-label', say);
            c.append(us);
          }
          t.append(c);
        }
        const say = sentence(l);
        const b = h('div', 'td-sbox-in');
        if (say) b.append(h('p', 'td-sbox-s', say));
        // from -> to, the arrow with the part it points at so it never hangs at the end of a line; the call after it
        const r = h('p', 'td-sbox-r'), to = h('span', 'td-sbox-to');
        to.append(h('span', 'td-sbox-a', '→'), K.soft(h('span'), nameOf(l.to)));
        r.append(K.soft(h('span'), nameOf(l.from)), ' ', to);
        if (l.code) r.append(' ', K.soft(h('code', 'td-sbox-c'), l.code));
        b.append(r);
        const fade = !was && !still();
        fadeTo(name, t, fade);
        fadeTo(body, b, fade);
        live.textContent = `${label}: ${say ? say + ' ' : ''}${tx('fromTo', { from: nameOf(l.from), to: nameOf(l.to) })}`;
      }
      el.hidden = false;
      if (was) place();
    }

    const view = () => { const p = el.parentElement; return p && p.classList && p.classList.contains('td-fs-view') ? p : null; };
    const preview = () => !view() && !!o.page && o.page.classList.contains('td-pv');
    /** The box it keeps inside, on the window: the full-screen view it is in, else the window. */
    function bounds() {
      const v = view();
      if (v) return v.getBoundingClientRect();
      const d = document.documentElement; // the window without its scrollbars
      return { left: 0, top: 0, right: d.clientWidth, bottom: d.clientHeight };
    }
    /** In its place (the frame, or the view's own place) or where the viewer let it go, 12 px inside. */
    function place() {
      const v = view(), float = !!at && !preview();
      const host = v || (float ? o.page : o.frame);
      if (host && el.parentElement !== host) host.append(el);
      el.classList.toggle('td-sbox-float', float);
      if (!float) { el.style.left = el.style.top = ''; return; }
      if (el.hidden) return;
      const b = bounds(), w = el.offsetWidth, hh = el.offsetHeight;
      const x = Math.max(b.left + M, Math.min(at.x, b.right - w - M));
      const y = Math.max(b.top + M, Math.min(at.y, b.bottom - hh - M));
      // fixed on the window on the page; in the view it lies in the view
      el.style.left = Math.round(x - (v ? b.left : 0)) + 'px';
      el.style.top = Math.round(y - (v ? b.top : 0)) + 'px';
    }
    /** Back in its place, and forgotten where it was. */
    function dock() {
      at = null;
      drop(AT);
      place();
    }
    function setFold(v, own) {
      folded = v;
      el.classList.toggle('td-sbox-folded', v);
      const t = v ? tx('unfold') : tx('fold');
      fold.title = t;
      fold.setAttribute('aria-label', t);
      fold.setAttribute('aria-expanded', String(!v));
      if (own) put(FOLD, v ? '1' : '0');
      place();
    }
    fold.addEventListener('click', () => setFold(!folded, true));

    // the drag, by the head only (not its button); the pointer captured, so the moves come here even off the box
    let go = null, tap = null;
    const capture = (id) => {
      if (typeof el.hasPointerCapture === 'function' && el.hasPointerCapture(id)) return;
      try { el.setPointerCapture(id); } catch (e) { /* a pointer the page does not know: no drag */ }
    };
    const grabbed = (ev) => { const t = ev.target; return !!(t && t.closest && t.closest('.td-sbox-head') && !t.closest('button, a')); };
    el.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation(); // the full-screen view never pans the drawing under it
      if ((ev.pointerType === 'mouse' && ev.button !== 0) || !grabbed(ev) || preview()) return;
      if (ev.pointerType === 'mouse') ev.preventDefault(); // no text selection while it moves
      const r = el.getBoundingClientRect();
      go = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, l: r.left, t: r.top, on: false };
      capture(ev.pointerId);
    });
    el.addEventListener('pointermove', (ev) => {
      if (!go || ev.pointerId !== go.id) return;
      const dx = ev.clientX - go.x, dy = ev.clientY - go.y;
      if (!go.on) {
        if (Math.hypot(dx, dy) < 4) return;
        go.on = true;
        el.classList.add('td-sbox-moving');
      }
      at = { x: go.l + dx, y: go.t + dy };
      place();
      capture(go.id); // out of the frame onto the page: the browser let go of the pointer on the way
    });
    const end = (ev) => {
      if (!go || ev.pointerId !== go.id) return null;
      const was = go;
      go = null;
      el.classList.remove('td-sbox-moving');
      return was;
    };
    el.addEventListener('pointerup', (ev) => {
      const was = end(ev);
      if (!was) return;
      if (was.on) {
        tap = null;
        const r = el.getBoundingClientRect();
        at = { x: Math.round(r.left), y: Math.round(r.top) };
        put(AT, JSON.stringify(at));
        return;
      }
      // a second click or tap close by, soon after the first: back in its place
      const now = Date.now(), again = tap && now - tap.t < TWICE && Math.hypot(ev.clientX - tap.x, ev.clientY - tap.y) < 24;
      tap = again ? null : { t: now, x: ev.clientX, y: ev.clientY };
      if (again) dock();
    });
    el.addEventListener('pointercancel', end);
    head.addEventListener('dblclick', (ev) => { if (!(ev.target && ev.target.closest && ev.target.closest('button'))) dock(); });

    // inside the window when it changes size, and when the box itself grows (a longer sentence, opened again)
    if (typeof root.addEventListener === 'function') root.addEventListener('resize', () => { if (el.isConnected !== false) place(); });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => place()).observe(el);
    // the page became the preview of a phone, or stopped being it
    if (o.page && typeof MutationObserver !== 'undefined') new MutationObserver(() => place()).observe(o.page, { attributes: true, attributeFilter: ['class'] });
    el.tdPlace = place;
    setFold(folded, false);
    steps.onAt(render);
    return { el, place };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdStepBox = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
