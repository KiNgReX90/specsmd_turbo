/**
 * AI-DLC Turbo - Code Scaffold, the note and the build.
 *
 * The Code Scaffold is the starting point of the code, not a source of
 * truth: it is never redrawn after the approval. This file holds what the
 * page says about that:
 *
 *   - the note under the heading: one text before the build, one after, and
 *     one while a change the user asked for is open (model.plan), when the
 *     drawing is the plan with that change in it and carries no mark of the
 *     build;
 *   - after the build (model.build, see scripts/lib/design-build.cjs): the
 *     words for a part that deviated on the drawing (different from the
 *     design, added, not built, or not used for a part that already existed
 *     and was drawn to be used), and the short parts Planned, Built and Why
 *     of the card of the deviation in the details (design-about.js);
 *   - after the build, what each story changed in a part or module, for
 *     "What changed" in the details: the builder's own sentences
 *     (model.build.changes, its **What changed** in the build notes), else,
 *     for an intent built before builders wrote them, what the story's
 *     drawing says it builds there, so a part a story built or changed
 *     never says nothing;
 *   - the legend lines for the marks of the build.
 *
 * The words come from the page's string table (TdText, design.built). The
 * page inlines it as window.TdBuild, before the details.
 */
(function (root) {
  'use strict';

  const TX = typeof module !== 'undefined' && module.exports ? require('./design-text.js') : root.TdText;
  const t = (key) => TX.t(`design.built.${key}`);
  const STATES = ['different', 'added', 'gone'];
  const byState = (group) => Object.fromEntries(STATES.map((k) => [k, t(`${group}.${k}`)]));
  // the third: a change the user asked for at finish, planned and not built yet, in the same words as on the v5 drawings
  const NOTE = { get plan() { return t('note.plan'); }, get built() { return t('note.built'); }, get open() { return t('note.open'); } };

  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  /**
   * The note under the heading: after the build (phase construction) the second text, with a change open the third.
   * The first two explain the drawing and show only with the overview's ? on (class how); the third tells that the
   * drawing is the plan, whatever the switch.
   */
  function note(phase, plan) {
    return h('p', plan ? 'td-note' : 'td-note how', plan ? NOTE.open : phase === 'construction' ? NOTE.built : NOTE.plan);
  }

  /** A part that already existed, drawn to be used, and not used by the build. */
  const unused = (x) => !!(x && x.build && x.build.state === 'gone' && x.status === 'existing');

  /** The short word of the build on a part or in its details: different, added, not built or not used; null without one. */
  function pillOf(x) {
    const b = x && x.build;
    if (!b || !STATES.includes(b.state)) return null;
    return unused(x) ? t('unused') : t(`pills.${b.state}`);
  }

  /**
   * The short parts of a deviation of a part or module: Planned, Built and Why, each left out when it has
   * nothing (a part that came in was never drawn, one not built or used has nothing built); Why says so when
   * the notes give no reason. Nothing for a part built as planned.
   */
  function cardLines(x) {
    const b = x && x.build;
    if (!b || !STATES.includes(b.state)) return [];
    const out = [];
    if (b.plan && b.state !== 'added') out.push([t('planned'), b.plan]);
    if (b.built && b.state !== 'gone') out.push([t('builtLabel'), b.built]);
    out.push([t('why'), b.why || t('noReason')]);
    return out;
  }

  const num = (id) => (/^\d+$/.test(String(id)) ? String(Number(id)) : String(id));
  /**
   * What the build changed in part or module x, per story in story order: [{ story, text, told }], `told` when the
   * builder wrote it (model.build.changes), else the words of the story's drawing for x. Only stories that are built
   * (model.build.stories) and that build x, or whose builder wrote of it; nothing for a part not built or not used.
   */
  function changesOf(model, x) {
    const b = model && model.build;
    if (!b || !x || (x.build && x.build.state === 'gone')) return [];
    const done = new Set((b.stories || []).map((s) => num(s.id)));
    const told = ((b.changes || {})[x.id] || []).filter((c) => c && c.text);
    return model.stories.map((s) => {
      const own = told.find((c) => num(c.story) === num(s.id));
      if (own) return { story: s, text: own.text, told: true };
      const say = done.has(num(s.id)) && s.builds ? String(s.builds[x.id] || '').trim() : '';
      return say ? { story: s, text: say, told: false } : null;
    }).filter(Boolean);
  }

  /** The legend lines for the marks of the build: only the kinds the drawing shows (`states`, `mod`). */
  // a part built otherwise gets the mark, a module a border and a dot on its tag
  const legendItem = (states, mod) => states.map((s) => `<li><span class="td-ico"><svg class="td-bi-lg" data-s="${s}" viewBox="-20 -20 40 40" aria-hidden="true"></svg></span><span class="td-lg-t">${t(`legend.${s}`)}</span></li>`).join('')
    + (mod ? `<li><span class="td-ico td-wide"><i class="td-sw-mtag td-sw-built"></i></span><span class="td-lg-t">${t('legend.module')}</span></li>` : '');

  const api = {
    NOTE, note, unused, pillOf, cardLines, changesOf, legendItem,
    get NO_REASON() { return t('noReason'); },
    get PILLS() { return byState('pills'); },
    get UNUSED() { return t('unused'); },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdBuild = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
