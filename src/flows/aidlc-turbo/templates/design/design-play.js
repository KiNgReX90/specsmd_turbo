/**
 * AI-DLC Turbo - Code Scaffold, the steps played one by one.
 *
 * "Play" walks the steps on its own, one every 2.5 seconds: from the
 * chosen step, else from step 1, and again from step 1 when the last one is
 * chosen. After the last step it stops. With a story chosen only its steps
 * play, as with "Next". Every step lights its line as a click does, and
 * a dot runs along the line from the part that calls to the part it calls
 * (about a second); both parts light up briefly. With reduced motion there
 * is no dot, the steps still go on.
 *
 * The details show the part each step goes to, under a line of the step
 * (design-show.js), fading over from step to step; design-view.js pans the
 * full-screen drawing to it. Anything the viewer does pauses it: Pauze,
 * previous, next, a step, a story, the drawing dragged or zoomed, a block
 * chosen, the view left.
 *
 * Space plays and pauses and the left and right arrows go a step back or on,
 * from anywhere while the drawing shows (`live()`), but never in a field (a
 * tab of the page's switch counts as one), and Space never on a button or
 * link the viewer tabbed to. On a block with the focus (design-near.js) the
 * arrows are taken before they come here.
 *
 *   TdPlay.create(steps, drawn, model, { live })
 *     -> { button(cls, keep), toggle(), start(), stop(), playing() }
 */
(function (root) {
  'use strict';

  const TX = typeof module !== 'undefined' && module.exports ? require('./design-text.js') : root.TdText;
  const t = (key) => TX.t(`design.play.${key}`);
  const STEP = 2500; // a step on screen
  const RUN = 1000; // the dot along the line
  const NS = 'http://www.w3.org/2000/svg';
  const ICON = { play: '<path class="td-fill" d="M6.5 4.3v11.4l9.2-5.7z"/>', pause: '<path class="td-fill" d="M5.5 4.5h3.2v11H5.5zM11.3 4.5h3.2v11h-3.2z"/>' };
  const FIELD = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="tab"], [role="slider"], [role="listbox"], [role="separator"]';
  const OWN_SPACE = 'button, a[href], summary, [role="button"], [role="checkbox"], [role="switch"]';
  const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  // the element the viewer reached with Tab (not with a click, which may focus a button too)
  let viaTab = false, tabbed = null;
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Tab') viaTab = true; }, true);
    document.addEventListener('pointerdown', () => { viaTab = false; }, true);
    document.addEventListener('focusin', (ev) => { tabbed = viaTab ? ev.target : null; }, true);
  }

  function create(steps, drawn, model, opts) {
    const o = opts || {};
    const links = new Map(model.links.map((l) => [l.id, l]));
    const btns = [];
    let on = false, timer = 0, raf = 0, dot = null;

    function paint() {
      for (const b of btns) {
        b.classList.toggle('td-playing', on);
        b.firstChild.innerHTML = on ? ICON.pause : ICON.play;
        b.lastChild.textContent = t(on ? 'pause' : 'play');
        b.setAttribute('aria-label', t(on ? 'pause' : 'play'));
        b.title = t(on ? 'pauseTip' : 'playTip');
      }
    }
    /** A play button that follows the state; one without `keep` is forgotten once it leaves the page. */
    function button(cls, keep) {
      for (let i = btns.length - 1; i >= 0; i -= 1) if (!btns[i].tdKeep && !btns[i].isConnected) btns.splice(i, 1);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'td-btn td-play' + (cls ? ' ' + cls : '');
      b.innerHTML = '<svg class="td-i" viewBox="0 0 20 20" aria-hidden="true"></svg><span></span>';
      b.tdKeep = !!keep;
      b.addEventListener('click', toggle);
      btns.push(b);
      paint();
      return b;
    }

    function flash(id) {
      const n = drawn.nodes.find((x) => x.p.id === id);
      if (!n) return;
      n.g.classList.remove('td-pulse');
      n.g.getBoundingClientRect(); // starts the light again
      n.g.classList.add('td-pulse');
      setTimeout(() => n.g.classList.remove('td-pulse'), 900);
    }
    function still() {
      cancelAnimationFrame(raf);
      raf = 0;
      if (dot) dot.remove();
      dot = null;
    }
    /** The dot along the step's line, from the caller to what it calls. */
    function travel(id) {
      still();
      const l = links.get(id), e = drawn.edges.find((x) => x.l.id === id);
      const path = e && e.g.querySelector('path');
      if (l) flash(l.from);
      if (!path || !path.ownerSVGElement || calm()) { if (l) setTimeout(() => on && flash(l.to), RUN); return; }
      const len = path.getTotalLength();
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'td-dot');
      g.setAttribute('aria-hidden', 'true');
      for (const [cls, r] of [['td-dot-h', 13], ['td-dot-c', 6.5]]) {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('class', cls);
        c.setAttribute('r', r);
        g.append(c);
      }
      path.ownerSVGElement.append(g);
      dot = g;
      const t0 = performance.now();
      const frame = (t) => {
        const k = Math.min(1, (t - t0) / RUN), p = path.getPointAtLength(len * ease(k));
        g.setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
        if (k < 1) { raf = requestAnimationFrame(frame); return; }
        raf = 0;
        if (l) flash(l.to);
        g.classList.add('td-out');
        setTimeout(() => { if (dot === g) still(); }, 450);
      };
      raf = requestAnimationFrame(frame);
    }

    /** A step on screen; after a while the next one, or the end. */
    function show(id) {
      travel(id);
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!on) return;
        const nx = steps.walk(1, 'play');
        if (nx) show(nx); else stop();
      }, STEP);
    }
    function start() {
      const vis = steps.ids();
      if (on || !vis.length) return;
      if (vis.indexOf(steps.current()) === vis.length - 1) steps.pin(vis[0]); // from the start again, never a moment without a step
      on = true;
      paint();
      const id = steps.walk(0, 'play');
      if (id && on) show(id); else stop();
    }
    function stop() {
      if (!on) return;
      on = false;
      clearTimeout(timer);
      still();
      paint();
    }
    function toggle() { if (on) stop(); else start(); }

    steps.nav.prepend(button('td-steps-play', true));
    // a step the viewer picked, previous, next or the arrows: the viewer leads again
    steps.on((id, pinned, how) => { if (how !== 'play') stop(); });

    document.addEventListener('keydown', (ev) => {
      if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey || ev.isComposing) return;
      const space = ev.key === ' ' || ev.key === 'Spacebar', dir = { ArrowLeft: -1, ArrowRight: 1 }[ev.key];
      if (!space && !dir) return;
      const t = ev.target instanceof Element ? ev.target : document.body;
      if (t.closest(FIELD) || t.closest('[role="dialog"]:not(.td-fs)') || !(o.live && o.live())) return;
      if (space && t.closest(OWN_SPACE) && t === tabbed) return; // a button reached with Tab keeps its own Space
      ev.preventDefault();
      if (space) { if (!ev.repeat) toggle(); return; }
      steps.walk(dir);
    });

    return { button, toggle, start, stop, playing: () => on };
  }

  root.TdPlay = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
