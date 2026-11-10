/* The inspector's edge and its fold, where it stands beside the board (a window wider than 1080px). A grip on its left
   edge drags its width (a mouse, a pen, a finger; the pointer captured, so the drag goes on outside the grip), from
   narrow to as wide as the window allows while the board keeps a working room; dragged on past its narrowest it folds,
   as an editor's side bar does. The arrow keys step it, Home and End take it to its bounds and a double click puts
   back the width it opens at. The button in its head folds it to a slim rail on the right edge, the board taking the
   room; the rail opens it again, at the width it had. Folded it stays folded whatever is chosen: a dot on the rail
   says there is something to read. A smaller window narrows it for as long as it lasts, the choice kept for a wider
   one; nothing is kept once the page closes (the frame keeps no storage). The drawing fits the new room through its
   own ResizeObserver (10-app.js), as on a window resize. Under the board (a narrower window, a phone) there is no grip
   and no fold (style.css): the inspector is a block after the board. */
(function () {
  'use strict';
  const C4 = window.C4;
  const { T } = C4.kit;
  const $ = (id) => document.getElementById(id);
  const side = $('side');
  const stage = $('dock').parentElement;
  const grip = $('grip'), fold = $('side-fold'), rail = $('side-open');
  const head = fold.parentElement;

  const OPEN = 360; // the width it opens at
  const MIN = 240; // narrower and a sentence breaks every few words; no maximum but the board's room
  const BOARD = 320; // the board keeps at least this much: its tools and a drawing to pan
  const SNAP = MIN / 2; // a drag that takes it under this folds it; back over it in the same drag, it opens again
  const STEP = 16, BIG = 64; // an arrow key, and an arrow key with Shift
  const desk = window.matchMedia('(min-width: 1081px)');

  let want = OPEN; // the width the viewer chose, maybe wider than now
  let now = OPEN; // the width it has: the choice, inside the room the window has now
  let folded = false;

  /** The widest it may be now: the board keeps its room; never under the narrowest (a desktop window has that). */
  function maxNow() {
    const cs = getComputedStyle(stage);
    const inner = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - (parseFloat(cs.columnGap) || 0);
    return Math.max(MIN, Math.floor(inner - BOARD));
  }
  /** Show the width chosen, inside the bounds of now; the grid column follows the variable. */
  function apply() {
    const max = maxNow();
    now = Math.max(MIN, Math.min(max, want));
    stage.style.setProperty('--side-w', now + 'px');
    grip.setAttribute('aria-valuemin', String(MIN));
    grip.setAttribute('aria-valuemax', String(max));
    grip.setAttribute('aria-valuenow', String(now));
    grip.setAttribute('aria-valuetext', T('side.wide', { n: now }));
  }
  /** A new width chosen (Home sends MIN, End Infinity). */
  const resize = (w) => { want = Math.round(Math.max(MIN, Math.min(maxNow(), w))); apply(); };
  const works = () => desk.matches && !folded;

  // ---------- the drag: one width a frame; past the narrowest it folds, back it opens ----------
  const html = document.documentElement;
  let drag = null, frame = 0;
  grip.addEventListener('pointerdown', (ev) => {
    if (!works() || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    ev.preventDefault(); // no text selected while it moves
    drag = { id: ev.pointerId, x: ev.clientX, w: now, want, to: now };
    try { grip.setPointerCapture(ev.pointerId); } catch (e) { /* a pointer the page does not know: the moves still come */ }
    html.classList.add('side-dragging');
  });
  /** Where the pointer is now: folded under the snap (the choice it had left alone), else the width under it. */
  function follow() {
    frame = 0;
    const shut = drag.to < SNAP;
    if (shut !== folded) setFold(shut);
    if (shut) { want = drag.want; apply(); } else resize(drag.to);
  }
  grip.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    drag.to = drag.w + drag.x - ev.clientX; // the edge moves left: wider
    if (!frame) frame = requestAnimationFrame(() => { if (drag) follow(); });
  });
  const end = (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    cancelAnimationFrame(frame);
    frame = 0;
    if (drag.to !== drag.w || folded) follow(); // the last place the pointer reached; a click alone changes nothing
    // let go past the snap: folded as by the button, opened again at the width it had
    if (folded && document.activeElement === grip) rail.focus({ preventScroll: true });
    drag = null;
    getComputedStyle(stage).gridTemplateColumns; // the last width set while it still does not glide
    html.classList.remove('side-dragging');
  };
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) grip.addEventListener(t, end);
  grip.addEventListener('dblclick', () => { if (works()) resize(OPEN); });

  // ---------- the keys: the arrows move the edge, Home and End to its bounds ----------
  grip.addEventListener('keydown', (ev) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey || !works()) return;
    const d = { ArrowLeft: 1, ArrowRight: -1 }[ev.key];
    const to = d ? now + d * (ev.shiftKey ? BIG : STEP) : ev.key === 'Home' ? MIN : ev.key === 'End' ? Infinity : null;
    if (to === null) return;
    ev.preventDefault();
    resize(to);
  });

  // ---------- the fold ----------
  /** What the rail says: the way back, and a dot when something is chosen or a story pinned. */
  function mark() {
    const s = C4.app ? C4.app.state() : {};
    const h = (s.sel || s.story) && side.querySelector('h2');
    const what = h ? h.textContent.trim() : '';
    rail.classList.toggle('has', !!what);
    const label = what ? T('side.openWith', { what }) : T('side.open');
    rail.setAttribute('aria-label', label);
    rail.title = label;
  }
  /** Folded or open; only a desktop page folds, under the board the inspector always shows. */
  function setFold(v) {
    folded = v;
    stage.classList.toggle('side-folded', v);
    fold.setAttribute('aria-expanded', String(!v));
    rail.setAttribute('aria-expanded', String(!v));
    head.inert = side.inert = v && desk.matches;
    mark();
  }
  fold.addEventListener('click', () => { setFold(true); rail.focus({ preventScroll: true }); });
  rail.addEventListener('click', () => { setFold(false); fold.focus({ preventScroll: true }); });

  // the inspector is rebuilt on every choice (05-panel.js): the rail reads it again
  new MutationObserver(mark).observe(side, { childList: true });
  if (C4.app) { C4.app.on('story', mark); C4.app.on('show', mark); }
  // a window that grows or shrinks (or the stage put full screen): the bounds again, the chosen width inside the new
  // room, the choice itself kept
  let rt = 0;
  new ResizeObserver(() => { cancelAnimationFrame(rt); rt = requestAnimationFrame(apply); }).observe(stage);
  desk.addEventListener('change', () => { apply(); setFold(folded); });

  apply();
  setFold(folded);
  // the frame glides from the first frame after the page stands, never on opening it
  requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.add('side-anim')));

  C4.side = { width: () => now, chosen: () => want, folded: () => folded,
    bounds: () => ({ min: MIN, max: maxNow(), open: OPEN, snap: SNAP, board: BOARD }) };
})();

