/**
 * AI-DLC Turbo - Code Scaffold, the stories of what the details show, as
 * chips under them.
 *
 * Under the description of a part or a module (and its deviation) a chip per
 * story that has it, its number and short title, under "Story" or
 * "Stories". A chip folds out that story under the chips: its full title (a
 * way to choose the story in the drawing), the story in plain words (class
 * plain, which the overview's Details hides), its user story and, after the
 * build, what it built (all from the page, `told`); one story at a time;
 * again folds it in. A story folded out stays out for the next details that
 * have it too. The story chosen in the drawing is marked, also on chips
 * already shown (sync).
 *
 *   TdStories.create({ model, built, told, titleOf, story(), choose(s) })
 *     -> { foot(of), sync() }
 *   foot(of) the chips of the stories `of` for new details, or null for none;
 *   sync() marks the story chosen again on the chips shown last.
 *
 * The page inlines it as window.TdStories, before the panel (design-panel.js).
 */
(function (root) {
  'use strict';

  const K = typeof module !== 'undefined' && module.exports ? require('./design-kit.js') : root.TdKit;
  const TX = typeof module !== 'undefined' && module.exports ? require('./design-text.js') : root.TdText;
  const CHEV = `<svg class="td-i td-cs-chev" viewBox="0 0 20 20" aria-hidden="true">${K.ICON.chev}</svg>`;

  function create(o) {
    const { h } = K;
    let open = null; // the story folded out
    let cur = null; // { el, of }: the chips shown last
    const uid = 'td-cs-' + Math.random().toString(36).slice(2, 8);

    /**
     * The full title (a way to choose the story), the story in plain words when the page has them (class plain: the
     * overview's Details), its user story and, after the build, what it built.
     */
    function more(s) {
      const t = (o.told || {})[s.id] || {}, on = s === o.story();
      const name = h('button', 'td-cs-name' + (on ? ' td-on' : ''));
      name.type = 'button';
      if (!on) name.title = TX.t('design.stories.choose', { n: s.n });
      name.setAttribute('aria-pressed', String(on));
      name.append(o.titleOf(s));
      name.addEventListener('click', () => { if (s !== o.story()) o.choose(s); });
      const out = [name];
      if (t.plain) out.push(h('p', 'td-cs-plain plain', t.plain));
      const u = t.story;
      if (u && (u.asA || u.iWant)) {
        const p = h('p', 'td-cs-us');
        p.append(h('b', null, TX.t('md.asA')), ` ${u.asA}, `, h('b', null, TX.t('md.iWant')), ` ${u.iWant}, `, h('b', null, TX.t('md.soThat')), ` ${u.soThat}`);
        out.push(p);
      }
      if (o.built && t.built) out.push(h('h4', 'td-cs-over', TX.t('design.stories.built')), h('p', 'td-cs-built', t.built));
      return out;
    }

    /** The chips and what is folded out, in `f`; the focus stays on chip `at` when one was pressed. */
    function fill(f, of, at) {
      if (open && !of.some((s) => s.id === open)) open = null;
      const chips = h('div', 'td-cs-chips');
      const out = h('div', 'td-cs-more');
      out.id = uid;
      out.hidden = !open;
      of.forEach((s, i) => {
        const on = s.id === open;
        const b = h('button', 'td-cs-s' + (s === o.story() ? ' td-on' : ''));
        b.type = 'button';
        b.title = `${TX.t(on ? 'design.stories.fold' : 'design.stories.unfold', { n: s.n })}: ${o.titleOf(s)}`;
        b.setAttribute('aria-expanded', String(on));
        b.setAttribute('aria-controls', uid);
        b.append(h('span', 'td-badge', s.n), h('span', 'td-cs-t', s.title));
        b.insertAdjacentHTML('beforeend', CHEV);
        b.addEventListener('click', () => {
          open = on ? null : s.id;
          fill(f, of, i);
          // what folded out comes into sight in the details that scroll
          const m = open && f.querySelector('.td-cs-more');
          if (m && typeof m.scrollIntoView === 'function') m.scrollIntoView({ block: 'nearest' });
        });
        chips.append(b);
        if (on) out.append(...more(s));
      });
      f.replaceChildren(h('span', 'td-cs-lead', TX.t(of.length > 1 ? 'design.stories.many' : 'design.stories.one')), chips, out);
      const again = at === undefined ? null : f.querySelectorAll('.td-cs-s')[at];
      if (again) again.focus({ preventScroll: true });
    }

    function foot(of) {
      cur = null;
      if (!of || !of.length) return null;
      const f = h('div', 'td-cs-foot');
      f.setAttribute('role', 'region');
      f.setAttribute('aria-label', TX.t('design.stories.region'));
      fill(f, of);
      cur = { el: f, of };
      return f;
    }

    /** The story chosen in the drawing changed: the chips shown mark it, nothing else moves. */
    function sync() {
      if (!cur) return;
      const st = o.story();
      cur.el.querySelectorAll('.td-cs-s').forEach((b, i) => b.classList.toggle('td-on', cur.of[i] === st));
      const name = cur.el.querySelector('.td-cs-name');
      const s = open && cur.of.find((x) => x.id === open);
      if (name && s) {
        name.classList.toggle('td-on', s === st);
        name.setAttribute('aria-pressed', String(s === st));
        name.title = s === st ? '' : TX.t('design.stories.choose', { n: s.n });
      }
    }

    return { foot, sync };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdStories = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
