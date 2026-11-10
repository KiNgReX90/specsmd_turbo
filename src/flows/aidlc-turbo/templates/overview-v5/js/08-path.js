/* The zoom path above the drawing: the four levels, where you are and the way you came, and the choice of container
   at level 3. Going up lands on the element you were in. */
(function () {
  'use strict';
  const C4 = window.C4;
  const { el, T } = C4.kit;

  function mount(box, M, L, api) {
    function render(state) {
      box.replaceChildren();
      const trail = new Set();
      for (let k = state.key, up = L.parentOf(k); up; k = up.key, up = L.parentOf(k)) trail.add(up.key);
      // 'code' stands for the last component opened
      const deep = { code: () => 'code:' + state.comp };
      const step = (key, lv, name, sub, disabled) => {
        const b = el('button', 'step');
        b.type = 'button';
        b.append(el('span', 'lv', String(lv)), el('span', null, name));
        if (sub) b.append(el('span', 'sub', sub));
        if (state.key === key || (deep[key] && state.key.startsWith(key + ':'))) b.setAttribute('aria-current', 'true');
        else if (trail.has(key)) b.classList.add('trail');
        b.disabled = !!disabled;
        if (disabled) b.title = T('path.pickFirst');
        b.addEventListener('click', () => {
          const to = deep[key] ? deep[key]() : key;
          if (state.key !== to) api.go(to, deep[key] ? undefined : { select: landing(state.key, key) });
        });
        const li = el('li');
        li.append(b);
        return li;
      };
      const sep = () => { const li = el('li', 'sep'); li.setAttribute('aria-hidden', 'true'); li.textContent = '›'; return li; };
      const lv3 = el('li', 'lv3');
      const pick3 = el('div', 'pick');
      pick3.setAttribute('role', 'group');
      pick3.setAttribute('aria-label', T('path.componentsOf'));
      // every container with components of its own, by its name, a way into its view
      for (const [id, c] of Object.entries(M.containers || {})) {
        const key = L.viewOfContainer(c.id || id);
        if (!key) continue;
        const b = el('button', null, c.name);
        b.type = 'button';
        b.title = T('path.componentsOfName', { name: c.name });
        if (state.key === key) b.setAttribute('aria-current', 'true');
        else if (trail.has(key)) { b.classList.add('trail'); lv3.classList.add('trail'); }
        b.addEventListener('click', () => { if (state.key !== key) api.go(key, { select: landing(state.key, key) }); });
        pick3.append(b);
      }
      lv3.append(el('span', 'lv', '3'), el('span', 't', T('levels.3')), pick3);
      const k = state.comp && M.components[state.comp];
      box.append(step('context', 1, T('levels.1')), sep(), step('containers', 2, T('levels.2')), sep(), lv3);
      // the code level only where the intent has files (a Code Scaffold); before it the path ends at the components
      if (Object.keys(M.parts || {}).length) box.append(sep(), step('code', 4, T('levels.4'), k ? k.name : null, !k));
    }
    /** Going up from where you are lands on the element you were in. */
    function landing(from, key) {
      let k = from;
      while (k) { const p = L.parentOf(k); if (!p) return null; if (p.key === key) return p.at; k = p.key; }
      return null;
    }
    return { render };
  }

  C4.path = { mount };
})();
