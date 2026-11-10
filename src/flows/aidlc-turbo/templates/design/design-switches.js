/**
 * AI-DLC Turbo - the switches Details and ? on the overview's masthead.
 *
 * Details, on until the viewer turns it off (localStorage c4-details, '0' is off): the plain words of the intent
 * under the masthead's summary and of each story under its title (in the column head of the vertical slices and in the
 * story section of the Code panel), all of class "plain"; off, html gets the class plain-off and exactly those step
 * aside. The masthead's summary with its read-more link always stays.
 *
 * ?, off until the viewer turns it on (localStorage c4-help, '1' is on): every part of the page that explains how to
 * read it, of class "how" (the intros of the lifecycle, the vertical slices and the integration tests, the legend of the
 * slices and the key of the tests, the keys along the drawing, the note on the Code Scaffold), shows while html has
 * the class help-on. The drawing's legend is a control and always stays. And the help of the tab shown
 * hangs under the ? while the pointer rests on it or the keyboard is on it, or right after it is switched on; a tab
 * chosen while it hangs there shows that tab's help. The close button in it, a click outside it (the tabs aside) or
 * Escape takes it away; while it is there Escape closes the help and nothing else. It stands in the top layer (a
 * manual popover; position: fixed where the browser has none), under the ? and inside the window.
 *
 * Storage that throws (a sandboxed frame, a locked-down browser): the defaults, kept for the visit. Every change goes
 * to `onChange({ details, help })`: the page hands it to the tabs of the v5 page it holds (design-tabs.js
 * embed().set), which follow these switches and never keep them themselves.
 *
 *   TdSwitches.mount({ slot, built, plan, code, tabs(), now(), onChange(state) })
 *     -> { details(), help(), state(), shown(view), open(), show(), hide(), tab() }
 *   TdSwitches.lines(view, { built, plan, code, tabs }) -> the lines of that tab's help
 *
 * `slot` is the masthead's place for the two switches, `tabs()` the views the page shows, `now()` the one shown,
 * `built` the page after the build (the words in the past), `plan` a change open after it (the drawing is the plan),
 * `code` a drawing with parts (C4-model then zooms in to the code). The words: {view} is a tab's name as its button
 * shows it, [x] a key, *x* the words on a button or a tab; after " | " what the keys and the mouse do, left out on
 * a touch screen without a keyboard. A line naming a tab the page does not show is left out. Every word comes from
 * the page's string table (TdText, design.switches).
 *
 * The page inlines it as window.TdSwitches with the tabs, also on a page without a drawing (lib/design-assets.cjs).
 */
(function (root) {
  'use strict';

  const KEYS = { details: 'c4-details', help: 'c4-help' };
  const TX = typeof module !== 'undefined' && module.exports ? require('./design-text.js') : root.TdText;
  const t = (key, vars) => TX.t('design.switches.' + key, vars);
  // a view's name in the string table (design.tabs), for one the page has no button for
  const NAMES = { functional: 'functional', flow: 'flow', c4: 'c4', review: 'review' };

  // ---------- the words ----------
  // each view's lines (design.switches.text.<view>), the line or null for each case
  const say = (key) => t('text.' + key);
  const TEXT = {
    functional: (o) => [
      say(o.built ? 'func.leadBuilt' : 'func.lead'),
      say(o.built ? 'func.flowBuilt' : 'func.flow'),
      say(o.built ? 'func.storyBuilt' : 'func.story'),
      say(o.built ? 'func.codeBuilt' : 'func.code'),
      o.built ? say('func.review') : null,
      say('func.c4'),
    ],
    flow: (o) => [
      `${say(!o.built ? 'flow.lead' : o.plan ? 'flow.leadPlan' : 'flow.leadBuilt')} ${say('flow.drawn')}`,
      say('play'),
      o.built ? null : say('flow.story'),
      o.built && !o.plan ? say('flow.marks') : null,
      o.built ? say('flow.part') : null,
      say('legend'),
      o.built ? null : say('flow.wrong'),
    ],
    review: () => [say('review.list'), say('review.find'), say('review.seen'), say('review.flow')],
    // the C4 model, the v5 page in a frame
    c4: (o) => [
      say(o.code ? 'c4.zoomCode' : 'c4.zoom'),
      say('c4.into'),
      say(o.built ? 'c4.cardBuilt' : 'c4.card'),
      say('c4.drag'),
    ],
  };
  // for every tab: what the two switches do
  const FOOT = () => t('foot');

  /** The lines of a tab's help: those of its words that name only tabs the page shows. */
  function lines(view, o) {
    const opts = o || {};
    const tabs = opts.tabs || ['functional'];
    const fits = (s) => !!s && [...s.matchAll(/\{(\w+)\}/g)].every((m) => tabs.includes(m[1]));
    return TEXT[view] ? TEXT[view](opts).filter(fits) : [];
  }

  // ---------- the page ----------
  const store = {
    get(k) { try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } },
    set(k, v) { try { if (root.localStorage) root.localStorage.setItem(k, v); } catch (e) { /* kept for this visit only */ } },
  };
  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  const media = (q) => (typeof root.matchMedia === 'function' ? root.matchMedia(q) : { matches: false });
  const is = (e, sel) => !!(e && typeof e.matches === 'function' && e.matches(sel));
  const holds = (a, b) => !!(a && b && typeof a.contains === 'function' && a.contains(b));
  const byId = (id) => (typeof document.getElementById === 'function' ? document.getElementById(id) : null);

  /** A tab's name as its button shows it now; the page's name for one it has no button for. */
  function nameOf(v, built) {
    const b = byId('tab-' + v);
    const shown = b ? String(b.textContent || '').replace(/\s+/g, ' ').trim() : '';
    return shown || (v === 'flow' && built ? TX.t('design.tabs.built') : NAMES[v] ? TX.t('design.tabs.' + NAMES[v]) : '');
  }
  /** A line as text with keys: the names filled in, every [x] a key, every *x* the words on a button. */
  function line(p, s, touch, built) {
    const [said, keys] = s.split(' | ');
    const text = (keys && !touch ? `${said} ${keys}` : said).replace(/\{(\w+)\}/g, (m, t) => nameOf(t, built));
    p.replaceChildren();
    text.split(/(\[[^\]]+\]|\*[^*]+\*)/).forEach((part) => {
      if (!part) return;
      const k = part.charAt(0), inner = part.slice(1, -1);
      p.append(k === '[' && part.endsWith(']') ? h('kbd', null, inner) : k === '*' && part.endsWith('*') && part.length > 2 ? h('b', null, inner) : part);
    });
    return p;
  }

  function mount(o) {
    const de = document.documentElement;
    const built = !!o.built;
    const touch = media('(hover: none) and (pointer: coarse)');
    let details = store.get(KEYS.details) !== '0';
    let help = store.get(KEYS.help) === '1';
    let open = false;
    let tab = null; // the tab the help is drawn for

    const sw = h('button', 'dswitch');
    sw.type = 'button';
    sw.setAttribute('role', 'switch');
    sw.append(h('span', 'dswitch-k'), h('span', null, t('details')));
    const btn = h('button', 'help-btn', '?');
    btn.type = 'button';
    btn.id = 'help-btn';
    btn.setAttribute('aria-label', t('help'));

    // the help, next to the "?" so Tab goes from it into the help and on
    const pop = typeof root.HTMLElement === 'function' && 'showPopover' in root.HTMLElement.prototype;
    const box = h('div', 'help');
    box.id = 'help';
    box.tabIndex = -1;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-labelledby', 'help-t');
    if (pop) box.setAttribute('popover', 'manual'); else box.hidden = true;
    const head = h('div', 'help-head');
    const title = h('h2', 'help-t');
    title.id = 'help-t';
    const x = h('button', 'help-x');
    x.type = 'button';
    x.setAttribute('aria-label', t('close'));
    x.title = t('closeTitle');
    x.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    head.append(title, x);
    const list = h('ul', 'help-list');
    const foot = h('div', 'help-foot');
    box.append(head, list, foot);
    btn.setAttribute('aria-controls', box.id);
    o.slot.append(sw, btn, box);

    const state = () => ({ details, help });
    const tell = () => { if (typeof o.onChange === 'function') o.onChange(state()); };

    function setDetails(v, keep) {
      details = v;
      de.classList.toggle('plain-off', !v);
      sw.setAttribute('aria-checked', String(v));
      sw.title = t(v ? 'detailsOn' : 'detailsOff');
      if (keep) store.set(KEYS.details, v ? '1' : '0');
    }
    function setHelp(v, keep) {
      help = v;
      de.classList.toggle('help-on', v);
      btn.setAttribute('aria-pressed', String(v));
      // on, the help under the "?" says it all; a tooltip would only cover it
      btn.title = v ? '' : t('helpOff');
      if (keep) store.set(KEYS.help, v ? '1' : '0');
    }
    setDetails(details, false);
    setHelp(help, false);

    /** The help of the tab shown. */
    function render() {
      tab = (typeof o.now === 'function' && o.now()) || 'functional';
      const opts = { built, plan: !!o.plan, code: !!o.code, tabs: typeof o.tabs === 'function' ? o.tabs() : ['functional'] };
      title.textContent = t('title', { view: nameOf(tab, built) });
      list.replaceChildren(...lines(tab, opts).map((s) => line(h('li'), s, touch.matches, built)));
      foot.replaceChildren(line(h('p'), FOOT(), touch.matches, built));
      box.setAttribute('data-tab', tab);
    }
    /** Under the "?", its right edge on the button's, inside the window with a margin; on top once the masthead scrolled away. */
    function place() {
      if (!open || typeof btn.getBoundingClientRect !== 'function') return;
      const vw = de.clientWidth || root.innerWidth, vh = root.innerHeight;
      const m = 16;
      const r = btn.getBoundingClientRect();
      const w = Math.min(400, vw - 2 * m);
      const left = Math.round(Math.max(m, Math.min(vw - m - w, r.right - w)));
      const below = Math.round(r.bottom + 10);
      const top = Math.max(m, below);
      box.style.width = w + 'px';
      box.style.left = left + 'px';
      box.style.top = top + 'px';
      box.style.maxHeight = Math.max(160, vh - top - m) + 'px';
      // the nub points at the "?" while the help hangs under it
      box.classList.toggle('hung', top === below);
      box.style.setProperty('--nub', Math.round(Math.max(18, Math.min(w - 18, r.left + r.width / 2 - left))) + 'px');
    }
    function show() {
      if (open) return;
      open = true;
      render();
      if (pop) { try { box.showPopover(); } catch (e) { /* already shown */ } } else box.hidden = false;
      box.classList.add('is-open');
      place();
    }
    /** Closed; `back` puts the focus on the "?" again (not after a click elsewhere, which takes it where it lands). */
    function hide(back) {
      if (!open) return;
      open = false;
      const had = holds(box, document.activeElement);
      box.classList.remove('is-open');
      if (pop) { try { box.hidePopover(); } catch (e) { /* already hidden */ } } else box.hidden = true;
      if ((back || had) && typeof btn.focus === 'function') btn.focus({ preventScroll: true });
    }

    sw.addEventListener('click', () => { setDetails(!details, true); tell(); });
    btn.addEventListener('click', () => { setHelp(!help, true); tell(); if (help) show(); else hide(false); });
    x.addEventListener('click', () => hide(true));

    // the help under the "?" while the pointer rests on it, or on the help itself; a moment's grace to cross between them
    let wait = 0;
    const soon = (fn, ms) => { clearTimeout(wait); wait = setTimeout(fn, ms); };
    const away = () => { if (!is(btn, ':hover') && !is(box, ':hover') && !holds(box, document.activeElement)) hide(false); };
    btn.addEventListener('pointerenter', (ev) => { if (help && ev.pointerType === 'mouse') soon(show, 120); });
    btn.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') soon(away, 240); });
    box.addEventListener('pointerenter', () => clearTimeout(wait));
    box.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') soon(away, 240); });
    // and while the keyboard is on the "?" or in the help
    btn.addEventListener('focus', () => { if (help && is(btn, ':focus-visible')) show(); });
    document.addEventListener('focusin', (ev) => { if (open && !holds(btn, ev.target) && !holds(box, ev.target)) hide(false); });
    // a click outside closes it; a tab chosen shows that tab's help instead (shown())
    document.addEventListener('pointerdown', (ev) => {
      const t = ev && ev.target;
      if (!open || !t || typeof t !== 'object') return;
      if (holds(box, t) || holds(btn, t)) return;
      if (typeof t.closest === 'function' && t.closest('[role="tab"]')) return;
      hide(false);
    }, true);
    // keys typed in the help stay in it: Space does not play the drawing, the arrows walk no story or step
    const PAGE_KEYS = new Set([' ', 'Spacebar', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', '/', 'j', 'k', '[', ']']);
    box.addEventListener('keydown', (ev) => { if (PAGE_KEYS.has(ev.key) && !ev.ctrlKey && !ev.metaKey && !ev.altKey) ev.stopPropagation(); });
    if (typeof root.addEventListener === 'function') {
      // Escape closes the help first and nothing else: taken before the page's own keys see it
      root.addEventListener('keydown', (ev) => {
        if (!open || ev.key !== 'Escape' || ev.isComposing) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        hide(true);
      }, true);
      root.addEventListener('resize', () => { if (open) { render(); place(); } });
      root.addEventListener('scroll', () => { if (open) place(); }, { passive: true, capture: true });
    }

    /** Another tab shows: while the help is open, that tab's help. */
    function shown(view) { if (open && view !== tab) { render(); place(); } }

    return { details: () => details, help: () => help, state, shown, open: () => open, show, hide, tab: () => tab };
  }

  const api = { KEYS, TEXT, FOOT, lines, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdSwitches = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
