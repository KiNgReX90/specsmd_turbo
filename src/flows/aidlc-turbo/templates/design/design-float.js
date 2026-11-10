/**
 * AI-DLC Turbo - Code Scaffold, the details as a card that floats over the
 * drawing's full-screen view, on a desktop.
 *
 * The view (design-view.js) shows the details over the drawing, top right.
 * take() wraps them in a card with a head of its own: a grip, "Details" and
 * a button that folds the card to that head (remembered). Dragged by its
 * head (a mouse, a pen; a press that moves less than 4 px stays a click) the
 * card goes anywhere in the view, 12 px inside, also when the view gets
 * smaller; lower down it gets shorter and its details scroll. Where it was let go is remembered per viewer, where the browser
 * allows it; a double click on its head puts it back top right and forgets
 * it. The card hides while the details do (design.css). A finger keeps the
 * details as the sheet they are: the view does not wrap them there.
 *
 *   TdFloat.create({ detail }) -> { take(), place() }
 *     take() the card with the details in it, for the view to show; place()
 *     puts it where it belongs now (the view calls it when the card is in)
 *
 * The details go back to the page when the view closes (the view puts back
 * what it moved): the card then stays behind, empty, for the next time. Its
 * texts come from the page's string table (TdText, design.float). The page
 * inlines it as window.TdFloat, after TdKit, before the view.
 */
(function (root) {
  'use strict';

  const cjs = typeof module !== 'undefined' && module.exports;
  const K = cjs ? require('./design-kit.js') : root.TdKit;
  const TX = cjs ? require('./design-text.js') : root.TdText;
  const tx = (key, vars) => TX.t(`design.float.${key}`, vars);
  const AT = 'td-detail-at'; // where the viewer let it go: { x, y } in the view
  const FOLD = 'td-detail-folded';
  const M = 12; // its margin to the edge of the view
  const LOW = 160; // how short it gets low in the view
  const GRIP = '<svg class="td-i" viewBox="0 0 20 20" aria-hidden="true"><g class="td-fill"><circle cx="7.5" cy="5" r="1.5"/>'
    + '<circle cx="12.5" cy="5" r="1.5"/><circle cx="7.5" cy="10" r="1.5"/><circle cx="12.5" cy="10" r="1.5"/>'
    + '<circle cx="7.5" cy="15" r="1.5"/><circle cx="12.5" cy="15" r="1.5"/></g></svg>';

  const get = (k) => { try { return root.localStorage.getItem(k); } catch (e) { return null; } };
  const put = (k, v) => { try { root.localStorage.setItem(k, v); } catch (e) { /* not remembered, works all the same */ } };
  const drop = (k) => { try { root.localStorage.removeItem(k); } catch (e) { /* not remembered, works all the same */ } };
  function saved() {
    try { const v = JSON.parse(get(AT)); return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : null; } catch (e) { return null; }
  }

  function create(o) {
    const { h } = K;
    const { detail } = o;
    const el = h('section', 'td-fdet');
    el.setAttribute('aria-label', tx('title'));
    const head = h('div', 'td-fdet-head');
    head.title = tx('headTip');
    const grip = h('span', 'td-fdet-grip');
    grip.innerHTML = GRIP;
    const fold = K.btn('td-fdet-fold', 'chev', null, tx('fold'));
    if (!detail.id) detail.id = 'td-detail-' + Math.random().toString(36).slice(2, 8);
    fold.setAttribute('aria-controls', detail.id);
    head.append(grip, h('span', 'td-fdet-t', tx('title')), fold);
    el.append(head);
    let at = saved(); // where the viewer let it go, in the view; null top right
    let folded = false;

    /** Top right, or where the viewer let it go, 12 px inside the view. Lower down it gets shorter (its body
     *  scrolls), never under LOW px, so a long card can go down too. */
    function place() {
      el.classList.toggle('td-fdet-at', !!at);
      const v = el.parentElement;
      if (!at || !v) { el.style.left = el.style.top = el.style.maxHeight = ''; return; }
      const H = v.clientHeight, tall = Math.min(el.scrollHeight || el.offsetHeight, LOW);
      const x = Math.max(M, Math.min(at.x, v.clientWidth - el.offsetWidth - M));
      const y = Math.max(M, Math.min(at.y, H - tall - M));
      el.style.left = Math.round(x) + 'px';
      el.style.top = Math.round(y) + 'px';
      el.style.maxHeight = Math.round(H - y - M) + 'px';
    }
    function setFold(v, own) {
      folded = v;
      el.classList.toggle('td-fdet-folded', v);
      const t = v ? tx('unfold') : tx('fold');
      fold.title = t;
      fold.setAttribute('aria-label', t);
      fold.setAttribute('aria-expanded', String(!v));
      if (own) put(FOLD, v ? '1' : '0');
      place();
    }
    fold.addEventListener('click', () => setFold(!folded, true));
    function take() {
      el.append(detail);
      at = saved();
      setFold(get(FOLD) === '1', false);
      return el;
    }

    // the drag, by the head only (not its button); the pointer captured, so the moves come here even off the card
    let go = null;
    const grabbed = (ev) => { const t = ev.target; return !!(t && t.closest && t.closest('.td-fdet-head') && !t.closest('button, a')); };
    el.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation(); // the view never pans the drawing under it
      if ((ev.pointerType === 'mouse' && ev.button !== 0) || !grabbed(ev)) return;
      ev.preventDefault(); // no text selection while it moves
      const r = el.getBoundingClientRect(), v = el.parentElement.getBoundingClientRect();
      go = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, l: r.left - v.left, t: r.top - v.top, on: false };
      try { el.setPointerCapture(ev.pointerId); } catch (e) { /* a pointer the page does not know: no drag */ }
    });
    el.addEventListener('pointermove', (ev) => {
      if (!go || ev.pointerId !== go.id) return;
      const dx = ev.clientX - go.x, dy = ev.clientY - go.y;
      if (!go.on) {
        if (Math.hypot(dx, dy) < 4) return;
        go.on = true;
        el.classList.add('td-fdet-moving');
      }
      at = { x: go.l + dx, y: go.t + dy };
      place();
    });
    const end = (ev) => {
      if (!go || ev.pointerId !== go.id) return;
      const was = go;
      go = null;
      el.classList.remove('td-fdet-moving');
      if (!was.on) return;
      at = { x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0 };
      put(AT, JSON.stringify(at));
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    // a double click on the head (the pointer captured: it comes to the card itself), never in the details
    el.addEventListener('dblclick', (ev) => {
      const t = ev.target;
      if (!t || (t !== el && !(t.closest && t.closest('.td-fdet-head'))) || (t.closest && t.closest('button'))) return;
      at = null;
      drop(AT);
      place();
    });

    // inside the view when it changes size, and when the card itself grows
    if (typeof root.addEventListener === 'function') root.addEventListener('resize', () => place());
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => place()).observe(el);
    return { take, place };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdFloat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
