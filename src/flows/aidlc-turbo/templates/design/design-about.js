/**
 * AI-DLC Turbo - Code Scaffold, what a part does, in plain words, in its
 * details.
 *
 * Under the name of a part or a module the details tell, in this order:
 *   - "What it does", under a small heading: what it is and does and its
 *     role in the application (`what`, a few sentences written at
 *     inception), on the plan page and after the build alike;
 *   - after the build only, for what a built story built or changed, "What
 *     changed": what this intent changed in it and why, in the
 *     builder's sentences, else in the words of the story's drawing
 *     (TdBuild.changesOf); the builder's text of one story alone, else each
 *     under its story's number and short title, in story order;
 *   - after the build only, where it deviated from the design, one calm card
 *     named for what happened: "Different from the design" (built otherwise),
 *     "Added during the build", "Not built" or "Not used" (a part that
 *     existed and was not used), with the mark of the legend
 *     (TdEngine.buildIcon), then Planned, Built and Why from the build
 *     notes (TdBuild.cardLines), each a short paragraph under its label in
 *     semibold, left out when the notes have nothing for it or when it only
 *     says again what the sections above say, Why always there and saying
 *     so when the notes give no reason;
 *   - for a part, what it does in the flow: the plain sentence (`step`)
 *     of every step it takes part in, from it or to it, in step order: "In
 *     the flow: ... (step 3)." for one step, a short list for more, at most
 *     FLOW of them and one line with the numbers of the rest. A step without
 *     a plain sentence is left out: its label alone would only name the call
 *     the drawing shows already.
 * Code in a text, between backticks, shows as code.
 *
 * The step held itself is told in the box over the drawing (design-stepbox.js),
 * not in the details.
 *
 * After a colon a sentence goes on in lower case, unless its first word is a
 * name: a word with a capital inside, or one that is part of the name of a
 * part or a module ("Warehouse" in WarehouseGatewayImpl).
 *
 * The words come from the page's string table (TdText, design.about).
 *
 *   TdAbout.create(model, { built, order }) -> { about(kind, x), deviation(x) }
 *     each an element for the details, or null where there is nothing to say;
 *     `order` is the drawing's step order (geo.flow.order), `built` the build
 *     on the page after the build (null before it).
 *   TdAbout.flowOf(model, id, order) -> [{ n, text }]  the steps of part id with a plain sentence
 *   TdAbout.devOf(x) -> { state, title, lines: [[label, text]] } or null
 *   TdAbout.low(text, names) -> text  the first letter small, unless the first word is a name
 *
 * The page inlines it as window.TdAbout, after TdBuild, before the details (design-detail.js).
 */
(function (root) {
  'use strict';

  const cjs = typeof module !== 'undefined' && module.exports;
  const K = cjs ? require('./design-kit.js') : root.TdKit;
  const TX = cjs ? require('./design-text.js') : root.TdText;
  const B = () => root.TdBuild || (cjs ? require('./design-built.js') : null);
  const FLOW = 4; // at most this many steps told in the description
  const t = (key, vars) => TX.t(`design.about.${key}`, vars);
  const NS = 'http://www.w3.org/2000/svg';

  const bare = (s) => String(s || '').trim().replace(/[.!?]+$/, '');
  const end = (s) => (/[.!?]$/.test(s) ? s : s + '.');
  /** One sentence or more as told: a capital first, a full stop at the end. */
  const told = (s) => { const b = bare(s); return end(b.charAt(0).toUpperCase() + b.slice(1)); };
  /** `text` into el, what stands between backticks as code, a name kept whole. */
  function prose(el, text) {
    String(text || '').split(/`([^`]+)`/).forEach((bit, i) => { if (bit) el.append(i % 2 ? K.h('code', 'td-cin', bit) : bit); });
    return el;
  }
  /** A text as it compares: without its full stop, case, code marks and extra spaces. */
  const key = (s) => bare(s).replace(/`/g, '').replace(/\s+/g, ' ').toLowerCase();
  /** "8", "8 and 9", "8, 9 and 12". */
  const list = (ns) => (ns.length < 2 ? String(ns[0]) : `${ns.slice(0, -1).join(', ')} ${TX.t('design.and')} ${ns[ns.length - 1]}`);

  function low(text, names) {
    const s = String(text || '').trim();
    const m = /^\p{Lu}\p{Ll}*(?=[\s,.:;!?)]|$)/u.exec(s);
    if (!m || (names || []).some((n) => String(n).includes(m[0]))) return s;
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  function flowOf(model, id, order) {
    const num = new Map((order || []).map((x, i) => [x, i + 1]));
    return model.links.filter((l) => (l.from === id || l.to === id) && num.has(l.id) && bare(l.step))
      .map((l) => ({ n: num.get(l.id), text: bare(l.step) })).sort((a, b) => a.n - b.n);
  }

  function devOf(x) {
    const b = x && x.build, T = B();
    if (!b || !T || !T.PILLS[b.state]) return null;
    return { state: b.state, title: t(b.state === 'gone' && T.unused(x) ? 'unused' : b.state), lines: T.cardLines(x) };
  }

  function create(model, o) {
    const { h } = K;
    const opts = o || {};
    const order = opts.order || [];
    const names = [...model.parts, ...model.modules].map((x) => x.name).filter(Boolean);

    /** What it does in the flow: one sentence, or a short list and the numbers of the rest. */
    function flow(id) {
      const steps = flowOf(model, id, order);
      if (!steps.length) return null;
      if (steps.length === 1) return prose(h('p', 'td-dflow'), t('inFlowOne', { text: low(steps[0].text, names), n: steps[0].n }));
      const box = h('div', 'td-dflow');
      const ul = h('ul');
      for (const s of steps.slice(0, FLOW)) ul.append(prose(h('li'), t('stepLine', { text: s.text, n: s.n })));
      box.append(h('p', null, t('inFlow')), ul);
      const rest = steps.slice(FLOW).map((s) => s.n);
      if (rest.length) box.append(h('p', 'td-dflow-more', t(rest.length > 1 ? 'alsoInSteps' : 'alsoInStep', { list: list(rest) })));
      return box;
    }

    /** A section with its small heading. */
    function section(title, cls, ...body) {
      const box = h('div', 'td-dsec' + (cls ? ' ' + cls : ''));
      box.append(h('h4', 'td-dsec-t', title), ...body);
      return box;
    }

    /**
     * After the build, what the built stories changed in it (`all`, TdBuild.changesOf); else null. The builder's text
     * of one story stands alone, else each under its story's number and short title (the words of a story's drawing
     * say nothing without it).
     */
    function change(all) {
      if (!all.length) return null;
      const say = (c) => prose(h('p', 'td-dchg-p'), told(c.text));
      if (all.length === 1 && all[0].told) return section(t('changed'), 'td-dchg', say(all[0]));
      return section(t('changed'), 'td-dchg', ...all.map((c) => {
        const one = h('div', 'td-dchg-s'), n = h('div', 'td-dchg-n');
        n.append(h('span', 'td-badge', c.story.n), h('span', null, c.story.title));
        one.append(n, say(c));
        return one;
      }));
    }

    /** What it does, what changed, where it deviated and, for a part, its flow; null without any of them. */
    function about(kind, x) {
      const box = h('div', 'td-dabout');
      const what = x.what ? section(t('what'), null, prose(h('p', 'td-dwhat'), x.what)) : null;
      const all = opts.built ? B().changesOf(model, x) : [];
      // the card leaves out what these two sections say already
      const said = new Set([x.what, ...all.map((c) => c.text)].filter(Boolean).map(key));
      for (const el of [what, change(all), deviation(x, said), kind === 'part' ? flow(x.id) : null]) if (el) box.append(el);
      return box.children.length ? box : null;
    }

    /** The mark of the legend for what the build did (TdEngine.buildIcon), where the page has it. */
    function mark(state) {
      const E = root.TdEngine;
      if (!E || !E.buildIcon) return null;
      const sv = document.createElementNS(NS, 'svg');
      sv.classList.add('td-bi-lg', 'td-ddev-i');
      sv.setAttribute('viewBox', '-20 -20 40 40');
      sv.setAttribute('aria-hidden', 'true');
      E.buildIcon(sv, 0, 0, state, '');
      return sv;
    }

    /**
     * After the build, where it deviated: one card, its mark and title, a short paragraph per label; else null. A
     * Planned or Built that only says again a text of `said` (keys of what the details show above it) is left out.
     * While a change the user asked for is open (model.plan) the drawing is the plan: no card, Review still has it.
     */
    function deviation(x, said) {
      const d = opts.built && !model.plan ? devOf(x) : null;
      if (!d) return null;
      const box = h('div', 'td-ddev td-ddev-' + d.state);
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', d.title);
      const head = h('h4', 'td-ddev-t'), ic = mark(d.state);
      if (ic) head.append(ic);
      head.append(d.title);
      box.append(head);
      const why = TX.t('design.built.why');
      for (const [k, v] of d.lines) {
        if (k !== why && said && said.has(key(v))) continue;
        const p = h('p', 'td-ddev-p');
        p.append(h('b', 'td-ddev-k', k), ' ', prose(h('span'), told(v)));
        box.append(p);
      }
      return box;
    }

    return { about, deviation };
  }

  const api = { create, flowOf, devOf, low, FLOW };
  if (cjs) module.exports = api;
  else root.TdAbout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
