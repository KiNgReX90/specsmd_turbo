/**
 * AI-DLC Turbo - Code Scaffold, only what is new or changed.
 *
 * A switch with the drawing's own controls, "Only new and changed",
 * leaves out of the drawing the parts that already exist and stay as they
 * are: the drawing is laid out again without them (design-layout.js), so it
 * gets smaller. A part counts as existing when its status is existing and,
 * after the build, the build did not mark it: a part built otherwise, added
 * or not built shows. A line with an end left out goes with it, and so does
 * a module, a frame or a lane left empty; a story keeps only what still
 * shows, and the steps are numbered again over what shows. Nothing to leave
 * out, or nothing left: everything shows and there is no switch.
 *
 * On by default; the viewer's choice is remembered per page, where the
 * browser allows it. Everything comes from the model the page has. Its
 * label and its tooltip name it in full (on or off, and what a click does);
 * where the row over the drawing is tight it shows only SHORT
 * (design-steps.css).
 *
 *   TdFilter.hidden(model, built) -> Set of the part ids left out
 *   TdFilter.only(model, built)   -> the model without them (the same model when nothing is left out)
 *   TdFilter.mount(container, model, opts, paint) -> { follow, choose, geo }
 *     the panel's mount (design-panel.js) through the switch: paint(container, model, opts) draws
 *     the panel, with opts.filter the switch to put with its controls and opts.start what showed
 *     before (paint's snap()); a flip draws it again.
 */
(function (root) {
  'use strict';

  const TX = typeof module !== 'undefined' && module.exports ? require('./design-text.js') : root.TdText;
  const t = (key, vars) => TX.t(`design.filter.${key}`, vars);
  // the label, and SHORT where the row over the drawing is tight (design-steps.css); the label and the tooltip keep LABEL
  const KEY = 'td-only-new';
  // what the build may mark an existing part with, so it shows after all
  const MARKED = ['different', 'added', 'gone'];

  /** The part ids left out: existing, and (after the build) not marked by it. */
  function hidden(model, built) {
    const marked = (p) => !!built && !!p.build && MARKED.includes(p.build.state);
    return new Set(model.parts.filter((p) => p.status === 'existing' && !marked(p)).map((p) => p.id));
  }

  function only(model, built) {
    const off = hidden(model, built);
    if (!off.size || off.size === model.parts.length) return model;
    const parts = model.parts.filter((p) => !off.has(p.id));
    const keep = new Set(parts.map((p) => p.id));
    const links = model.links.filter((l) => keep.has(l.from) && keep.has(l.to));
    const lids = new Set(links.map((l) => l.id));
    // a module that had parts and has none left goes; one that never had any was never drawn
    const had = new Set(model.parts.map((p) => p.module).filter(Boolean));
    const has = new Set(parts.map((p) => p.module).filter(Boolean));
    const modules = model.modules.filter((m) => has.has(m.id) || !had.has(m.id));
    const mids = new Set(modules.map((m) => m.id));
    const gone = (id) => off.has(id) || (had.has(id) && !mids.has(id));
    const frames = model.frames.map((f) => ({ ...f, parts: f.parts.filter((id) => keep.has(id)) })).filter((f) => f.parts.length);
    const lanes = model.lanes.filter((l) => parts.some((p) => p.layer === l.id));
    const stories = model.stories.map((s) => ({ ...s,
      builds: Object.fromEntries(Object.entries(s.builds || {}).filter(([id]) => !gone(id))),
      uses: (s.uses || []).filter((id) => !gone(id)),
      parts: s.parts.filter((id) => keep.has(id)),
      modules: (s.modules || []).filter((id) => mids.has(id)),
      links: s.links.filter((id) => lids.has(id)) }));
    return { ...model, lanes, modules, frames, parts, links, stories };
  }

  const key = () => KEY + ':' + ((typeof location !== 'undefined' && location.pathname) || '');
  /** The viewer's own choice on this page: true, false, or null when never made (or not readable). */
  const saved = () => { try { const v = root.localStorage.getItem(key()); return v === null ? null : v === '1'; } catch (e) { return null; } };
  const save = (on) => { try { root.localStorage.setItem(key(), on ? '1' : '0'); } catch (e) { /* not remembered, works all the same */ } };

  /** The switch: a button with role switch, a knob and its label. */
  function switchEl() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'td-btn td-only';
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-label', t('label'));
    const k = document.createElement('span');
    k.className = 'td-only-k';
    k.setAttribute('aria-hidden', 'true');
    const l = document.createElement('span');
    l.className = 'td-only-t';
    l.textContent = t('label');
    const s = document.createElement('span');
    s.className = 'td-only-s';
    s.textContent = t('short');
    b.append(k, l, s);
    return b;
  }

  function mount(container, model, opts, paint) {
    const o = opts || {};
    const built = o.phase === 'construction' && model.build ? model.build : null;
    const off = hidden(model, built);
    if (!off.size || off.size === model.parts.length) return paint(container, model, o);
    const less = only(model, built);
    // what a click does: show them too, or leave them out again; after the build in the past tense
    const one = off.size === 1 ? 'one' : 'many';
    const which = t(`which.${one}`, { n: off.size }), are = t(`are.${one}.${built ? 'built' : 'plan'}`);
    const sw = switchEl();
    let on = saved() !== false;
    let cur = null;
    function draw(start) {
      sw.setAttribute('aria-checked', String(on));
      sw.title = t('title', { label: t('label'), state: t(on ? 'on' : 'off'), action: t(on ? 'showAlso' : 'leaveOut', { which, are }) });
      cur = paint(container, on ? less : model, { ...o, filter: sw, start });
    }
    sw.addEventListener('click', () => {
      const start = cur.snap ? cur.snap() : null;
      on = !on;
      save(on);
      draw(start);
      sw.focus({ preventScroll: true });
    });
    draw(null);
    return { follow: (h) => cur.follow(h), choose: (id) => cur.choose(id), get geo() { return cur.geo; } };
  }

  const api = { hidden, only, mount, get LABEL() { return t('label'); }, get SHORT() { return t('short'); } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdFilter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
