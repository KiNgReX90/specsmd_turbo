/**
 * AI-DLC Turbo - Code Scaffold, the panel around the drawing.
 *
 * Builds the story chips, the line about the chosen story, the drawing
 * (design-layout.js and design-engine.js) with the legend (design-keys.js),
 * and the details panel right of the drawing, always there on a desktop,
 * under it on a phone (design-pane.js). This is the flow view of the page
 * (the tab "Code Scaffold", after the build "Code"): the drawing is always in step mode, a step
 * always held. The panel shows one element at a time (design-show.js): the
 * block clicked, else the part the step held goes to; the step itself shows
 * in a box over the drawing that the viewer can drag anywhere
 * (design-stepbox.js). Choosing a story lights up what it builds and uses
 * and puts its number on what it builds; hovering a block (with no story
 * chosen) lights up its neighbours after a short rest (design-light.js). A
 * link to #story-2, #<part> or #<module> opens there.
 *
 *   CodeScaffold.mount(container, model, { titles, stories, steer, phase, onStory, chipSlot, onReview })
 *     -> { follow, geo, choose }, through the switch that leaves out what exists (design-filter.js),
 *        which draws the panel again with `filter` (the switch) and `start` (what showed, snap())
 *
 * `titles` maps a story id to its full title for the line under the chips;
 * `stories` what the page tells of each story (its user story, what it
 * built) for the chips under the details; `steer` shows the "Is this
 * wrong?" steps (only while the inception waits for approval). The note on
 * top says the drawing is a starting point; with `phase` construction and
 * model.build it shows where the build deviated (design-built.js,
 * design-about.js): a pill on the drawing, and in the details what was
 * planned, what was built and why. A page with a story choice of its own
 * shares it with the drawing: `onStory(id or null)` hears a chip click,
 * `choose(id or null)` shows the page's choice without reporting it back.
 * `onReview(part id)` opens a part's change in the Review tab: after the
 * build the details of a part with a change or a deviation get the button
 * "See the change" for it (design-detail.js).
 *
 * On a desktop the whole view fits the window under the masthead
 * (design-room.js): the legend, the drawing and the panel take the height
 * left, and in its box the drawing opens at a size people can read, on the
 * step held, or whole where the whole fits readable (design-zoom.js): it
 * pans along with the step, a mouse drags it, the buttons, the keys + and -
 * and Ctrl with the wheel zoom it, "Fit" shows the whole. Elsewhere the drawing shrinks to the
 * width (never grows), read from its viewBox on every draw and resize, and
 * where it would shrink too far to read (a phone, a tablet, a narrow window)
 * the page shows it as a preview that opens the full-screen view
 * (design-view.js). One bar over the drawing holds the line about the story
 * (two lines, "More" for the rest) and the way to full screen. The legend
 * sits in a panel left of the drawing on a desktop page (1280 wide or more),
 * open or folded as the viewer chose, without a choice folded where the
 * drawing beside it would get narrower than 720 (TdKit.fit, TdKit.narrow),
 * else under it.
 *
 * The walk over the steps (design-steps.js) sits over the drawing, top
 * left: the arrows and Space walk and play the steps. A step is always held
 * (design-chosen.js), step 1 when the page opens; Escape (it leaves the
 * view) and the empty drawing (the story back to Alles) let go of nothing.
 * A click on a block chooses it and shows its details, the step into it
 * held; a click or a tap on a line holds its step (only a drawing without
 * steps shows a line's own details). A block with the focus takes all four
 * arrows (design-input.js, design-near.js). "Play" (design-play.js)
 * walks the steps on its own. In the full-screen view the chosen part comes
 * out from under the details.
 */
(function (root) {
  'use strict';

  const E = () => root.TdEngine;
  const B = () => root.TdBuild;

  const K = root.TdKit; // loads before the panel
  const { h, btn } = K;
  const TX = typeof module !== 'undefined' && module.exports ? require('./design-text.js') : root.TdText;
  const t = (key) => TX.t(`design.panel.${key}`);

  /** How to use the drawing: what a story builds (after the build: built), then a click or a tap; in the preview open it first. */
  const HOW = (touch, built, pv) => `${t(built ? 'chooseBuilt' : 'choose')} ${t(`${pv ? 'open' : 'act'}${touch ? 'Tap' : 'Click'}`)}`;
  /** Through the switch "Only new and changed" (design-filter.js), where it is on the page. */
  function mount(container, model, opts) {
    const o = opts || {};
    return root.TdFilter ? root.TdFilter.mount(container, model, o, paint) : paint(container, model, o);
  }
  function paint(container, model, opts) {
    const o = opts || {};
    const titles = o.titles || {};
    // where the build deviated: only on the overview after the build
    const built = o.phase === 'construction' && model.build ? model.build : null;
    // a change the user asked for is open: the drawing is the plan with it, without the marks of the build
    const plan = !!built && !!model.plan;
    const { layout, SIZE } = root.TdLayout;
    const geo = layout(model);
    const rootEl = h('div', 'td-root');
    const main = h('div', 'td-main');
    const chips = h('div', 'td-chips');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', t('chips'));
    const bar = h('div', 'td-storybar');
    bar.setAttribute('aria-live', 'polite');
    const chipRow = h('div', 'td-chiprow');
    const touch = root.TdView.touchy();
    const dhint = h('p', 'td-dhint', HOW(touch, built));
    chipRow.append(chips, dhint);
    // one bar over the drawing: the line about the story, at its right the legend folded behind a button
    // and the way to full screen (prominent when the drawing had to shrink too far to read on the page)
    const keys = root.TdKeys.legend(model, !!built, touch);
    keys.id = 'td-keys-' + Math.random().toString(36).slice(2, 8);
    const tbar = h('div', 'td-tbar');
    const tools = h('div', 'td-tools');
    const fsBtn = btn('td-fsb', 'full', t('full'), t('fullTip'));
    fsBtn.setAttribute('aria-label', t('full')); // where the row is tight only its icon shows (design-steps.css)
    const lgB = btn('td-lgb', 'chev', TX.t('design.legend.title'));
    lgB.setAttribute('aria-expanded', 'false');
    lgB.setAttribute('aria-controls', keys.id);
    lgB.addEventListener('click', () => lgB.setAttribute('aria-expanded', String(rootEl.classList.toggle('td-lg-open'))));
    tools.append(lgB, h('p', 'td-small-t', t('tall')), fsBtn);
    tbar.append(bar, tools, keys);
    const dz = h('div', 'td-scroll td-dz');
    // the drawing, with the walk through its steps over its top left corner
    const dzw = h('div', 'td-dzw');
    dzw.append(dz);
    const detail = h('div', 'td-detail');
    detail.setAttribute('aria-live', 'polite');
    detail.hidden = true;
    // the details in a panel of their own right of the drawing, always there on a desktop, that folds and widens;
    // under it on a phone and in the preview
    const pane = root.TdPane.create(detail, { host: rootEl, draw: dzw, steps: !!(geo.flow && geo.flow.order && geo.flow.order.length), desk: () => !root.TdView.touchy(), onChange: () => fitPage(true) });
    const stage = h('div', 'td-stage');
    stage.append(dzw, pane.el);
    // the chips go where the page wants them (`chipSlot`, beside its view switch), else over the drawing;
    // after the build they stay off the page (the masthead tells what was built, a part clicked chooses
    // its story) and only the full-screen view shows them
    if (!built) { if (o.chipSlot) o.chipSlot.replaceChildren(chipRow); else main.append(chipRow); }
    main.append(tbar, stage);
    main.append(root.TdKeys.asks(!!o.steer));
    // after the build the heading says it all: no note on the starting point, unless a change is open and the
    // drawing is the plan again (model.plan) - then the note says so
    if (!built || plan) rootEl.append(B().note(o.phase, plan));
    rootEl.append(main);
    rootEl.classList.toggle('td-touch', touch);
    container.replaceChildren(rootEl);

    const drawn = E().draw(dz, model, geo, SIZE, { built: !!built });
    dz.append(btn('td-pv-open', 'full', t('openDrawing')));
    const steps = drawn.steps;
    if (steps) stage.prepend(steps.box);
    // with steps the legend goes into their panel, behind a switch: no button for it over the drawing
    if (steps) { steps.legend(keys); lgB.remove(); }
    // play or pause, back, where you are, on: always over the drawing, top left, not in the steps; the keys
    // for it along the bottom of the drawing
    const ctl = steps ? h('div', 'td-ctl') : null;
    let ctlH = () => 0; // the room the walk takes over the drawing (design-steps.js): the drawing starts under it
    if (o.filter && !ctl) tools.prepend(o.filter);
    if (ctl) {
      ctl.setAttribute('role', 'toolbar');
      ctl.setAttribute('aria-label', t('controls'));
      // the walk, and after the build the way to full screen beside it: the masthead tells what was built,
      // so the line about the story over the drawing goes
      const left = h('div', 'td-ctl-l');
      left.append(steps.nav);
      if (built) { left.append(fsBtn); tbar.remove(); }
      if (o.filter) left.append(o.filter);
      ctl.append(left);
      dzw.append(steps.keys); // the keys: one quiet line along the bottom of the drawing's frame (design-steps.css)
      dzw.prepend(ctl);
      // what sits under the walk (the drawing) keeps clear of it, also where its row wraps
      ctlH = steps.band(ctl, left);
    }
    const sbox = steps && root.TdStepBox ? root.TdStepBox.create({ model, steps, frame: dzw, page: rootEl, titleOf: (s) => titleOf(s) }) : null; // the step held, in a box over the drawing
    let lastKey = '';
    const svgOf = () => dz.querySelector('svg.td-svg') || dz.querySelector('svg');
    const vbOf = (svg) => {
      const vb = svg && svg.viewBox && svg.viewBox.baseVal;
      return vb && vb.width > 0 && vb.height > 0 ? { w: vb.width, h: vb.height } : null;
    };
    const size = (svg, vb, s) => { svg.style.width = Math.floor(vb.w * s * 100) / 100 + 'px'; svg.style.height = Math.floor(vb.h * s * 100) / 100 + 'px'; };
    const parts = new Map(model.parts.map((p) => [p.id, p]));
    const mods = new Map(model.modules.map((m) => [m.id, m]));
    const links = new Map(model.links.map((l) => [l.id, l]));
    const order = (geo.flow && geo.flow.order) || [];
    const titleOf = (s) => titles[s.id] || s.title;
    /** Whether story s has the part, the module (one of its parts) or the step. */
    const holds = (kind, id) => (s) => (kind === 'part' ? s.parts.includes(id)
      : kind === 'module' ? model.parts.some((p) => p.module === id && s.parts.includes(p.id)) : s.links.includes(id));
    let story = null;
    const chipEls = []; // { b: the chip, s: its story, or null for Alles }
    let barW = 0; // the width the line about the story was measured at (steadyBar)
    // Space and the arrows work while the drawing shows readable: on the tab, or in the view
    const live = () => view.isOpen() || (rootEl.getClientRects().length > 0 && !rootEl.classList.contains('td-pv'));
    const play = steps && root.TdPlay ? root.TdPlay.create(steps, drawn, model, { live }) : null;
    const hold = () => play && play.stop();
    // what is chosen: never nothing, a step always held (design-chosen.js)
    const ch = root.TdChosen.create({ drawn, model, steps, first: () => browse.first(), show: () => show, hold });
    const light = root.TdLight.create(drawn, model, dz);
    // what the details show (design-show.js): what a part does and where it deviated, its stories, the walk under it
    const about = root.TdAbout.create(model, { built, order });
    const facts = root.TdDetail.create(model, { built, titleOf, order, about, review: o.onReview });
    const stories = root.TdStories.create({ model, built, told: o.stories || {}, titleOf, story: () => story,
      choose: (s) => { setStory(s); if (o.onStory) o.onStory(s.id); } });
    // a part's neighbours in reading order and the walk to them under its details (design-browse.js)
    const browse = root.TdBrowse.create({ detail, geo, model, keys: steps && steps.keys, steps, selected: () => ch.get(), go: (id) => clicked('part', id) });
    const show = root.TdShow.create({ detail, model, steps, facts, stories, browse, holds, selected: () => ch.get() });
    /** What is held now: the block chosen, else the step. */
    const held = () => { const s = ch.get(); return s ? { [s.kind]: s.id } : steps && steps.current() ? { link: steps.current() } : null; };
    const view = root.TdView.create({ dz, ctl, detail, chips, bar, keys, hint: steps && steps.keys, box: sbox && sbox.el, play, btn, svgOf, vbOf, size, geo, drawn,
      title: 'Code Scaffold',
      how: (t) => HOW(t, built),
      current: held,
      onBlank: () => reset(),
      onClose: () => { fitPage(true); if (zoom) zoom.reveal(held()); } });
    // on a desktop page the drawing at a readable size in its box, panned along with the step (design-zoom.js)
    const zoom = root.TdZoom ? root.TdZoom.create({ dz, geo, box: sbox && sbox.el, svgOf, vbOf, size, btn, hold, live, current: held,
      name: (id) => (parts.get(id) || {}).name }) : null;
    if (zoom) { dzw.append(zoom.el); if (o.start && o.start.zoom) zoom.restore(o.start.zoom); }
    const pans = () => !!zoom && zoom.isOn();
    // the details follow the step held (the walk, play, a line), once the view they check against is there
    if (steps) steps.onAt(() => show.render());
    // the legend and the details as tall as the drawing's frame beside them (the screen at most), also after the walk rewraps
    const tall = () => stage.style.setProperty('--td-steps-h', Math.max(480, dzw.offsetHeight || 0) + 'px');
    // on a desktop the drawing's box takes the height the window has left (design-room.js) and the drawing in it a
    // readable size, panned (design-zoom.js); elsewhere the drawing fits the width (never larger than drawn), else the
    // screen height while it stays readable. Its size is read from the drawing every time, so a redrawn or relaid
    // drawing fits as well. Too small to read on a narrower page, it becomes a preview that opens the view, at most
    // two thirds of the screen high. Where the steps go follows TdKit.fit.
    function fitPage(force, again) {
      const full = stage.clientWidth;
      if (view.isOpen() || !full) return;
      steadyBar(); // the line about the story first: its height moves the stage, and the room under it
      const one = root.TdRoom.on({ view: innerWidth, touch: root.TdView.touchy() });
      // what stands above and below the stage counts too: the page may change there later (fonts, a line that wraps)
      const at = one ? root.TdRoom.measure(stage) : null;
      const key = full + 'x' + innerHeight + (steps && steps.folded() ? 'f' : '') + (at ? `@${at.top}:${at.after}` : '');
      if (!force && key === lastKey) return;
      if (drawn.fit) drawn.fit(0);
      const svg = svgOf();
      let vb = vbOf(svg);
      if (!vb) return;
      const H = one ? root.TdRoom.fit({ inner: innerHeight, ...at }) : 0;
      const below = steps && !touch ? 30 : 0; // the line of keys along the bottom of the drawing's frame
      const room = (one ? H - below : innerHeight - 32) - ctlH();
      const { pv, side, fold } = root.TdKit.fit({ view: innerWidth, full, room, vb, steps: !!steps, folded: steps ? steps.saved() : null });
      if (fold !== null) steps.fold(fold);
      const pan = !!zoom && one && !pv;
      rootEl.classList.toggle('td-side', side);
      rootEl.classList.toggle('td-one', one && !pv);
      rootEl.classList.toggle('td-pan', pan);
      stage.style.setProperty('--td-one-h', one && !pv ? H + 'px' : '');
      const beside = pane.place(pv ? 0 : full);
      // never chosen by the viewer: the legend starts folded where the drawing beside it open would get too narrow
      if (side && fold === null) steps.fold(K.narrow(K.drawOpen(full, beside ? (pane.folded() ? K.RAIL : pane.width()) : null)));
      rootEl.classList.toggle('td-lg-col', full < 560); // the legend as one table on a phone
      lastKey = key;
      const avail = side || beside ? dz.clientWidth : full;
      let s = one && !pv ? root.TdRoom.scale(avail, room, vb) : K.scaleFor(avail, room, vb);
      if (pv) s = Math.min(1, full / vb.w, Math.max(0.18, innerHeight * 0.66 / vb.h));
      if (drawn.fit) { drawn.fit(avail / s); vb = vbOf(svg); }
      rootEl.classList.toggle('td-pv', pv);
      if (pan) zoom.layout(); else { if (zoom) zoom.off(); size(svg, vb, s); }
      rootEl.classList.toggle('td-small', !pan && !pv && vb.h * s > room + 1);
      rootEl.classList.toggle('td-tiny', !pan && !pv && s < K.PREVIEW); // small beside the legend: full screen stands out
      tall();
      dhint.textContent = HOW(root.TdView.touchy(), built, pv);
      // what stands above the stage may move with the classes set here: measured again, it fits once more
      if (one && !pv && !again && root.TdRoom.fit({ inner: innerHeight, ...root.TdRoom.measure(stage) }) !== H) fitPage(true, true);
    }
    fitPage(true);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => fitPage(false));
      ro.observe(stage);
      if (document.body) ro.observe(document.body); // the page around the stage grew or shrank
      new ResizeObserver(tall).observe(dzw);
    }
    if (steps) steps.onFold(() => fitPage(true));
    addEventListener('resize', () => fitPage(false));
    root.TdRoom.watch(() => fitPage(true)); // the masthead got another height
    if (typeof MutationObserver !== 'undefined') new MutationObserver(() => (view.isOpen() ? view.refit() : fitPage(true))).observe(dz, { childList: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitPage(true));

    /**
     * The line about the story keeps one height whatever is chosen (Alles or a story):
     * the tallest of them, measured at this width, so the drawing under it never moves on a click.
     */
    function steadyBar() {
      if (!bar.isConnected || !bar.clientWidth || bar.clientWidth === barW || !chipEls.length) return;
      barW = bar.clientWidth;
      bar.style.minHeight = '';
      const was = story;
      let most = 0;
      for (const c of chipEls) {
        story = c.s;
        renderBar();
        most = Math.max(most, bar.offsetHeight);
      }
      story = was;
      renderBar();
      bar.style.minHeight = most + 'px';
    }
    function renderBar() {
      bar.replaceChildren();
      const head = h('p', 'td-sb-t');
      if (story) head.append(h('span', 'td-badge', story.n));
      head.append(document.createTextNode(story ? titleOf(story) : t('allHead')));
      bar.append(head);
      const text = story ? story.summary : model.summary;
      if (text) bar.append(K.lead(h('p', 'td-sb-p'), text)); // the first sentence, "More" for the rest
    }
    function setStory(s) {
      hold();
      show.batch(() => {
        story = s;
        for (const c of chipEls) {
          c.b.classList.toggle('td-on', c.s === s);
          c.b.setAttribute('aria-pressed', String(c.s === s));
        }
        light.story(s);
        renderBar();
        if (steps) steps.filter(s ? s.links : null);
        ch.ensure(); // a story without the step held holds its first
        show.render();
      });
      if (!view.isOpen()) fitPage(true);
    }
    /** Show a story (or all of them for null) the page chose, without reporting it back. */
    function choose(id) {
      const c = chipEls.find((x) => (x.s ? x.s.id : null) === (id || null));
      if (c && c.s !== story) setStory(c.s);
    }
    function chip(label, s) {
      const b = h('button', 'td-chip' + (s ? '' : ' td-all td-on'));
      b.type = 'button';
      if (s) b.append(h('span', 'td-badge', s.n));
      b.append(document.createTextNode(label));
      b.setAttribute('aria-pressed', s ? 'false' : 'true');
      b.addEventListener('click', () => {
        setStory(s);
        if (o.onStory) o.onStory(s ? s.id : null);
      });
      chips.append(b);
      chipEls.push({ b, s });
      return b;
    }
    chip(t('all'), null);
    for (const s of model.stories) chip(s.title, s);
    renderBar();
    steadyBar();

    /**
     * A part or a module clicked shows its story: under Alles the story nearest to the first that has it
     * (the one that built it first), and a chosen story that lacks it makes way the same way, for a step
     * too (Alles when no story has it). A step it is not on lets go (design-chosen.js holds another).
     */
    function bringIn(kind, id) {
      const has = holds(kind, id);
      if (story ? !has(story) : kind !== 'link') {
        const all = model.stories;
        const p = kind === 'part' ? parts.get(id) : null;
        // from a story: nearest to it; from All or an "After the build" chip: nearest to the story that built the part, else the first
        const at = all.includes(story) ? all.indexOf(story) : Math.max(0, all.findIndex((s) => p && p.build && s.id === p.build.story));
        const near = all.filter(has).sort((a, b) => Math.abs(all.indexOf(a) - at) - Math.abs(all.indexOf(b) - at) || all.indexOf(a) - all.indexOf(b))[0] || null;
        if (near !== story) {
          setStory(near);
          if (o.onStory) o.onStory(near ? near.id : null);
        }
      }
      const cur = kind !== 'link' && steps && steps.current();
      const l = cur && links.get(cur);
      if (l && !(kind === 'part' ? [l.from, l.to].includes(id) : model.parts.some((p) => p.module === id && [l.from, l.to].includes(p.id)))) steps.pin(null);
    }
    /** A click or a tap in the drawing (a block is chosen, the step into it held); in the view what was chosen comes out from under its details. */
    function clicked(kind, id) {
      show.batch(() => {
        bringIn(kind, id);
        if (kind === 'link' && steps) holdStep(id);
        else if (!(kind === 'part' && ch.block(id))) { hold(); ch.mark(kind, id); }
      });
      if (kind !== 'link' && view.isOpen()) { view.roomFor(); view.reveal({ [kind]: id }); } else if (kind !== 'link' && pans()) zoom.reveal({ [kind]: id });
    }
    /** A line where there are steps: its step held, the details show where it goes. */
    function holdStep(id) {
      hold();
      steps.pin(id);
      ch.step(id);
      if (view.isOpen()) view.reveal({ link: id }); else if (pans()) zoom.reveal({ link: id });
    }
    /** Play paused and the story back to Alles; what is chosen stays. */
    function reset() {
      hold();
      if (story) {
        setStory(null);
        if (o.onStory) o.onStory(null);
      }
    }
    // the full-screen view takes the drawing over: its size and its place (design-view.js)
    const openView = (at, keep) => { if (zoom) zoom.off(); view.open(at, keep); };
    // the blocks, the lines, Escape, the empty drawing and the preview (design-input.js)
    root.TdInput.wire({ drawn, geo, model, root: rootEl, dz, view, chosen: () => ch.get(), clicked, reset, openView, svgOf, vbOf, pans, reveal: (at) => zoom.reveal(at) });
    // a step walked to, played or picked: the block lets go, the details show where it goes; in the view and in its
    // box on a desktop page the drawing goes to it, elsewhere the page scrolls to it when needed
    if (steps) steps.on((id, on, how) => {
      ch.step(id);
      if (view.isOpen()) view.reveal({ link: id });
      else if (pans()) { zoom.reveal({ link: id }); if (how !== 'play') inSight(); } else if (how !== 'play') steps.reach(id);
    });
    /** The drawing's box in the window, the page scrolled to it when it is not. */
    function inSight() {
      const r = dzw.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight) dzw.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    fsBtn.addEventListener('click', () => openView());

    function follow(hash) {
      for (const bit of decodeURIComponent(hash.replace(/^#/, '')).split(',').filter(Boolean)) {
        const sm = /^story-(\d+)$/.exec(bit);
        const c = sm && chipEls.find((x) => x.s && String(Number(x.s.n)) === String(Number(sm[1])));
        if (c) c.b.click();
        else if (parts.has(bit) || mods.has(bit)) {
          clicked(parts.has(bit) ? 'part' : 'module', bit); // as a click: a part holds the step into it
          if (!view.isOpen()) detail.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    }
    // drawn again (design-filter.js): what showed before shows again, the full-screen view handed over
    const st = o.start;
    if (!st) follow(location.hash || '');
    else {
      choose(st.story);
      const sel = st.sel, has = sel && { part: parts, module: mods, link: links }[sel.kind];
      if (has && has.has(sel.id)) { if (sel.kind === 'link' && steps) steps.pin(sel.id); else ch.mark(sel.kind, sel.id); }
      if (st.at && steps && !steps.current() && steps.ids().includes(st.at)) steps.pin(st.at);
    }
    ch.ensure(); // never nothing: step 1 (no focus, the page stays); a drawing without steps its first block
    if (pans()) zoom.reveal(held());
    if (st && st.view) openView(null, st.view);
    const snap = () => { hold(); return { story: story && story.id, sel: ch.get(), at: steps && steps.current(), zoom: zoom && zoom.state(), view: view.isOpen() ? view.close(true) : null }; };
    return { follow, geo, choose, snap };
  }

  root.CodeScaffold = { mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
