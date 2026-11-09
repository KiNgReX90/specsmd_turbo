/* The inspector at the right. With nothing chosen it tells what the view shows and lists its elements by status;
   for an element it shows what it is, how to zoom in, who it talks to, the stories that touched it (each with its
   branch and merge request) and, for a component, its classes and scripts; for a class or script, where the build
   went otherwise than drawn; for a story everything it touched, level by level. Before the build a story has no branch
   and no merge request yet: it says what it will touch. */
(function () {
  'use strict';
  const C4 = window.C4;
  const { el, icon, T, count, noun, day, STATUS, KIND, PART_KIND, statusOf, copy, capFirst, built, plan, storyNo } = C4.kit;
  const { typeText, iconOf } = C4.shapes;
  const asBuilt = built && !plan;

  /** What the zoom button says, by the view it opens. */
  const zoomText = (key, n) => (key === 'containers' ? T('panel.zoom.containers') : key.startsWith('code:') ? T(n.kind === 'ref' ? 'panel.zoom.itsCode' : 'panel.zoom.code')
    : T('panel.zoom.components'));

  function mount(box, M, api) {
    // the inspector is rebuilt on every choice: focus that was in it goes to the new heading, so it is read out
    const shell = (parts) => {
      const had = box.contains(document.activeElement);
      const inn = el('div', 'side-in');
      inn.append(...parts.filter(Boolean));
      box.replaceChildren(inn);
      box.scrollTop = 0;
      const h = had && inn.querySelector('h2');
      if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
      return inn;
    };
    const h3 = (t, n) => { const h = el('h3', null, t); if (n != null) h.append(el('span', 'n', String(n))); return h; };
    const closer = (label) => {
      const b = el('button', 'copy x');
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.append(icon('plus'));
      b.addEventListener('click', () => api.clear());
      return b;
    };
    const kindRow = (n, extra) => {
      const p = el('p', 'kind');
      const g = el('span', `glyph ${statusOf(n) === 'ext' ? '' : statusOf(n)}`);
      g.append(icon(iconOf(n)));
      p.append(g, el('span', null, typeText(n).replace(/^\[|\]$/g, '').replace(': ', ' · ')));
      if (extra) p.append(extra);
      return p;
    };
    const statusTag = (n) => el('span', `status ${statusOf(n)}`, STATUS[statusOf(n)]);
    const chip = (label, status, go, mono) => {
      const li = el('li');
      const b = el('button', 'chip');
      b.type = 'button';
      if (status) b.append(el('span', `dot ${status}`));
      const t = el('span', mono ? 'mono' : null, label);
      b.append(t);
      b.addEventListener('click', go);
      li.append(b);
      return li;
    };

    /** The elements of a view in groups, by what happened to them. */
    function groupsOf(v) {
      const inScope = new Set(v.scope || C4.layout.aboutOf(v));
      return [
        [asBuilt ? T('panel.builtNew') : STATUS.new, (n) => inScope.has(n.id) && statusOf(n) === 'new'],
        [STATUS.changed, (n) => inScope.has(n.id) && statusOf(n) === 'changed'],
        [STATUS.existing, (n) => inScope.has(n.id) && statusOf(n) === 'existing'],
        [T('panel.persons'), (n) => n.kind === 'person'],
        [T('panel.around'), (n) => !inScope.has(n.id) && n.kind !== 'person'],
      ];
    }
    function idle(v, caption) {
      const n = el('p', 'soft', T('panel.count', { elements: count('words.element', v.nodes.length), level: v.level, name: T(`levels.${v.level}`).toLowerCase() }));
      n.append(el('span', 'how', ` ${T('panel.clickOne')}`));
      const parts = [el('h2', null, v.title), caption ? el('p', 'lead how', caption) : null, n, marks(v)];
      for (const [name, test] of groupsOf(v)) {
        const ns = v.nodes.filter(test);
        if (!ns.length) continue;
        const ul = el('ul', 'chips');
        for (const x of ns) ul.append(chip(x.name, x.kind === 'person' ? null : statusOf(x), () => api.select(x.id), x.kind === 'code' && !x.ext));
        parts.push(h3(name, ns.length), ul);
      }
      const keys = el('p', 'keys how');
      keys.append(...withKeys(T('panel.keys')));
      parts.push(keys, el('p', 'soft how', T('panel.source')));
      shell(parts);
    }
    /** A text whose [x] parts are keys. */
    function withKeys(text) {
      return String(text).split(/(\[[^\]]+\])/).filter(Boolean).map((p) => (/^\[.+\]$/.test(p) ? el('kbd', null, p.slice(1, -1)) : p));
    }

    /** How many files the build made otherwise than drawn, and how their cards show it; null when none did. While a
     *  change is open: that the drawing is the plan with it, not yet built. */
    function marks(v) {
      if (plan) return el('p', 'bnote', T('build.planOpen'));
      const n = ['different', 'added', 'gone'].map((k) => [v.nodes.filter((x) => x.dev === k).length, k]).filter(([c]) => c);
      if (!n.length) return null;
      return el('p', 'bnote', T('build.note', { counts: n.map(([c, k]) => `${c} ${T(`build.short.${k}`)}`).join(', ') }));
    }

    function relations(v, n) {
      const byId = new Map(v.nodes.map((x) => [x.id, x]));
      const ul = el('ul', 'list');
      for (const e of v.edges) {
        if (e.from !== n.id && e.to !== n.id) continue;
        const out = e.from === n.id;
        const other = byId.get(out ? e.to : e.from);
        if (!other) continue;
        const b = el('button', 'row');
        b.type = 'button';
        const lead = el('span', 'lead-ic' + (out ? ' out' : ''));
        lead.append(icon(out ? 'out' : 'in'));
        const body = el('span');
        body.append(el('span', 't', T(out ? 'panel.to' : 'panel.from', { name: other.name })));
        const texts = (e.labels && e.labels.length ? e.labels : e.label ? [e.label] : []).map(capFirst);
        for (const t of texts.slice(0, 3)) body.append(el('span', 'd', t));
        if (e.tech || e.ends) {
          const tags = el('span', 'rtags');
          if (e.tech) tags.append(el('span', 'tech', e.tech));
          if (e.ends) tags.append(el('span', 'tech', T('legend.ends')));
          body.append(tags);
        }
        b.append(lead, body);
        b.addEventListener('click', () => api.select(other.id));
        b.addEventListener('mouseenter', () => api.hover(other.id));
        b.addEventListener('mouseleave', () => api.hover(null));
        const li = el('li');
        li.append(b);
        if (texts.length > 3) {
          const more = el('details', 'more');
          more.append(el('summary', null, T('more', { n: texts.length - 3 })));
          const rest = el('ul');
          for (const t of texts.slice(3)) rest.append(el('li', null, t));
          more.append(rest);
          li.append(more);
        }
        ul.append(li);
      }
      return ul.children.length ? [h3(T('panel.relations'), ul.children.length), ul] : [];
    }

    function storyBlocks(ids, active) {
      const ul = el('ul', 'list us-list');
      for (const id of ids) {
        const u = M.stories.find((x) => x.id === id);
        if (!u) continue;
        const li = el('li', 'us' + (id === active ? ' on' : ''));
        const top = el('div', 'us-top');
        const b = el('button');
        b.type = 'button';
        b.append(el('span', 'badge' + (id === active ? ' on' : ''), String(u.n)), el('span', 'nm', u.short));
        b.title = T(built ? 'panel.showStory.built' : 'panel.showStory.plan', { n: u.n });
        b.addEventListener('click', () => api.pick(u.id));
        // a planned story has no merge request and no branch yet: its title says what it is
        if (built && u.url) { top.append(b, mrLink(u)); li.append(top, branchLine(u.branch)); }
        else if (built) { top.append(b); li.append(top, branchLine(u.branch)); }
        else { top.append(b); li.append(top, el('p', 'soft us-what', u.title)); }
        ul.append(li);
      }
      return ul;
    }
    const mrLink = (u) => {
      const a = el('a', 'mr');
      a.href = u.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.append(icon('mr'), `!${u.mr}`);
      a.setAttribute('aria-label', T('panel.mrLabel', { n: u.mr }));
      return a;
    };
    const branchLine = (name) => {
      if (!name) return null;
      const d = el('div', 'branch');
      const c = el('button', 'copy');
      c.type = 'button';
      c.setAttribute('aria-label', T('panel.copyBranch'));
      c.append(icon('copy'));
      c.addEventListener('click', () => copy(name, c));
      d.append(icon('branch'), el('code', null, name), c);
      return d;
    };

    function node(v, n, story) {
      const part = n.part ? M.parts[n.id] : null;
      const parts = [kindRow(n, closer(T('panel.close'))), el('h2', part && part.layer !== 'external' ? 'code' : null, n.name)];
      if (n.kind !== 'person') {
        const tags = el('div', 'tags');
        tags.append(statusTag(n));
        if (part && part.sub) tags.append(el('span', 'soft', part.sub));
        parts.push(tags);
      }
      const what = part ? part.what : n.desc;
      if (what) parts.push(el('p', null, what.replace(/`/g, '')));
      // where the build went otherwise than drawn (02-build.js)
      if (part && n.dev) parts.push(C4.build.card(part, C4.build.devOf(M, part)));
      if (n.zoom) {
        const b = el('button', 'act');
        b.type = 'button';
        b.append(icon('zoom'), zoomText(n.zoom, n));
        b.addEventListener('click', () => (v.nodes.some((x) => x.id === n.id) ? api.zoom(n.id) : api.go(n.zoom)));
        parts.push(b);
      }
      parts.push(...relations(v, n));
      if ((n.stories || []).length) parts.push(h3(T(n.stories.length === 1 ? 'panel.story' : 'panel.stories'), n.stories.length), storyBlocks(n.stories, story));
      // a component's classes open its code
      const k = n.kind === 'component' ? M.components[n.id] : null;
      if (k) {
        const ul = el('ul', 'list');
        for (const pid of k.parts) {
          const p = M.parts[pid];
          const b = el('button', 'row' + (story && p.stories.includes(story) ? ' hit' : ''));
          b.type = 'button';
          const body = el('span');
          body.append(el('span', 't code', p.name), el('span', 'd', [PART_KIND[p.kind] || KIND.code, p.sub].filter(Boolean).join(' · ')
            + (p.stories.length ? ` · ${T('panel.storyList', { list: p.stories.map(storyNo).join(', ') })}` : '')));
          b.append(el('span', `dot ${p.status}`), body);
          b.addEventListener('click', () => api.go('code:' + k.id, pid));
          const li = el('li');
          li.append(b);
          ul.append(li);
        }
        parts.push(h3(T('panel.classes'), k.parts.length), ul);
      }
      if (part) {
        if (part.path) parts.push(h3(T('panel.file')), el('p', 'what', part.path.replace(/\//g, '/​')));
        if ((part.near || []).length) {
          const ul = el('ul', 'chips');
          for (const f of part.near) { const li = el('li', 'chip'); li.append(icon('file'), el('span', 'mono', f)); ul.append(li); }
          parts.push(h3(T('panel.near'), part.near.length), ul);
        }
      }
      shell(parts);
    }

    function story(id) {
      const u = M.stories.find((x) => x.id === id);
      if (!u) return;
      const big = el('span', 'badge big on', String(u.n));
      const kind = el('p', 'kind');
      kind.append(big, el('span', null, T(built ? 'panel.storyN' : 'panel.storyPlanned', { n: u.n })), closer(T('panel.letGo')));
      const parts = [kind, el('h2', null, u.title), C4.switches.story(u.id)];
      if (built) builtFacts(parts, u);
      const conts = Object.values(M.containers).filter((c) => (c.stories || []).includes(id));
      const comps = Object.values(M.components).filter((k) => k.stories.includes(id));
      const code = Object.values(M.parts).filter((p) => p.stories.includes(id) && C4.layout.compOf(p.id));
      if (!comps.length) parts.push(h3(T('panel.touches')), el('p', 'soft', nothing(u)));
      const group = (title, list, make) => {
        if (!list.length) return;
        const ul = el('ul', 'chips');
        for (const x of list) ul.append(make(x));
        parts.push(h3(title, list.length), ul);
      };
      group(T('levels.2'), conts, (c) => chip(c.name, c.status, () => api.go('containers', c.id)));
      group(T('levels.3'), comps, (k) => chip(k.name, k.status, () => api.go(C4.layout.viewOfContainer(k.c), k.id)));
      group(T('panel.classes'), code, (p) => chip(p.name, p.status, () => api.go('code:' + C4.layout.compOf(p.id), p.id), true));
      if (comps.length) parts.push(el('p', 'soft how', T(built ? 'panel.lit.built' : 'panel.lit.plan')));
      shell(parts);
    }
    /** What a story that touches nothing in the model says. */
    const nothing = (u) => T(u.files && u.files === u.tests ? 'panel.nothingTests' : 'panel.nothing');
    /** How a built story reached the intent: its commits and files, its branch, its merge request. */
    function builtFacts(parts, u) {
      const facts = el('p', 'facts');
      const fact = (n, key, rest) => { const s = el('span'); s.append(el('b', null, String(n)), ` ${noun(key, n)}${rest || ''}`); facts.append(s); };
      fact(u.commits || 0, 'words.commit');
      fact(u.files || 0, 'words.file', u.files ? `, ${T('panel.ofTests', { tests: count('words.test', u.tests || 0) })}` : '');
      if (u.first) facts.append(el('span', null, T('panel.span', { from: day(u.first), to: day(u.merged) })));
      parts.push(facts);
      const branch = branchLine(u.branch);
      if (branch) parts.push(h3(T('panel.branch')), branch);
      if (M.intentBranch) {
        const into = el('p', 'merge-into');
        const intoText = el('span');
        intoText.append(T('panel.mergedInto'), ' ', el('code', null, M.intentBranch));
        into.append(icon('merge'), intoText);
        parts.push(into);
      }
      if (u.url) {
        const a = el('a', 'act quiet');
        a.href = u.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.append(icon('mr'), T('panel.mr', { n: u.mr }));
        parts.push(a);
      }
    }

    return { idle, node, story, show: shell };
  }

  C4.panel = { mount };
})();
