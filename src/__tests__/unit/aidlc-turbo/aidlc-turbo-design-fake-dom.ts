/**
 * Just enough of a document for the Code Scaffold's browse, diff, steps and
 * card code (design-browse.js, design-diff.js, design-steps.js,
 * design-card.js): elements with classes, attributes, children, listeners,
 * focus and a lookup by class or tag; document listeners that a test fires by hand
 * (`key`); a MutationObserver whose callbacks a test runs (`observe`).
 */

export function fakeDom() {
  const docListeners: { type: string; fn: (ev: any) => void; capture: boolean }[] = [];
  const observers: ((records: unknown[]) => void)[] = [];
  const node = (tag: string): any => {
    let cls = '';
    const e: any = { tag, children: [] as any[], attrs: {} as Record<string, string>, own: '', hidden: false, title: '', listeners: {} as Record<string, ((ev: any) => void)[]>, scrollTop: 0, parent: null, innerHTML: '' };
    e.style = { setProperty(k: string, v: string) { (this as any)[k] = v; } };
    Object.defineProperty(e, 'className', { get: () => cls, set: (v: string) => { cls = v; } });
    const has = (c: string) => cls.split(' ').includes(c);
    e.classList = {
      add: (...cs: string[]) => { for (const c of cs) if (!has(c)) cls = (cls ? cls + ' ' : '') + c; },
      remove: (...cs: string[]) => { cls = cls.split(' ').filter((x) => x && !cs.includes(x)).join(' '); },
      contains: has,
      toggle: (c: string, on?: boolean) => { const want = on === undefined ? !has(c) : on; if (want) e.classList.add(c); else e.classList.remove(c); return want; },
    };
    Object.defineProperty(e, 'textContent', {
      get: () => e.own + e.children.map((c: any) => (typeof c === 'string' ? c : c.textContent)).join(''),
      set: (v: string) => { e.own = v; e.children = []; },
    });
    Object.defineProperty(e, 'lastElementChild', { get: () => [...e.children].reverse().find((c: any) => c && c.tag) || null });
    Object.defineProperty(e, 'isConnected', { get: () => true });
    // the element it was appended to, unless a test names one
    Object.defineProperty(e, 'parentElement', { get: () => (e.setParent !== undefined ? e.setParent : e.parent), set: (v: any) => { e.setParent = v; } });
    const adopt = (xs: any[]) => xs.map((x) => (typeof x === 'string' ? { textContent: x } : (x && typeof x === 'object' && (x.parent = e), x)));
    e.append = (...xs: any[]) => { e.children.push(...adopt(xs)); };
    e.prepend = (...xs: any[]) => { e.children.unshift(...adopt(xs)); };
    e.replaceChildren = (...xs: any[]) => { e.children = []; e.own = ''; e.append(...xs); };
    e.setAttribute = (k: string, v: string) => { e.attrs[k] = String(v); };
    e.getAttribute = (k: string) => (k in e.attrs ? e.attrs[k] : null);
    e.removeAttribute = (k: string) => { delete e.attrs[k]; };
    e.hasAttribute = (k: string) => k in e.attrs;
    e.addEventListener = (t: string, fn: (ev: any) => void) => { (e.listeners[t] ||= []).push(fn); };
    e.click = () => { for (const fn of e.listeners.click || []) fn({ target: e, preventDefault() {}, stopPropagation() {} }); };
    e.focus = () => { doc.activeElement = e; };
    e.getClientRects = () => (e.hidden || e.offscreen ? [] : [{}]);
    e.closest = (sel: string) => (e.matches ? e.matches(sel) : null);
    e.scrollIntoView = () => { e.scrolled = (e.scrolled || 0) + 1; };
    // a selector by its last class only (".a .b" finds every .b inside), or by its tag when that is all it names
    // (".a h3" finds every h3 inside), enough for the code under test
    e.querySelectorAll = (sel: string) => {
      const last = String(sel).trim().split(/\s+/).pop()!;
      if (/^[a-z][a-z0-9]*$/.test(last)) return byTag(e, last).filter((x: any) => x !== e);
      return all(e, last.replace(/^[a-z0-9]*\./i, '')).filter((x: any) => x !== e);
    };
    e.querySelector = (sel: string) => e.querySelectorAll(sel)[0] || null;
    e.insertAdjacentHTML = (_at: string, raw: string) => { e.children.unshift({ textContent: '', raw }); };
    return e;
  };
  const html = node('html');
  const body = node('body');
  const doc: any = {
    createElement: node,
    createTextNode: (t: string) => ({ textContent: t }),
    createElementNS: (_ns: string, tag: string) => node(tag),
    documentElement: html,
    body,
    activeElement: null,
    addEventListener: (type: string, fn: (ev: any) => void, capture?: boolean) => { docListeners.push({ type, fn, capture: !!capture }); },
    removeEventListener: (type: string, fn: (ev: any) => void) => { const i = docListeners.findIndex((l) => l.type === type && l.fn === fn); if (i >= 0) docListeners.splice(i, 1); },
  };
  (globalThis as any).document = doc;
  (globalThis as any).MutationObserver = class { constructor(cb: (r: unknown[]) => void) { observers.push(cb); } observe() {} };

  /** Fire a keydown at the document listeners, capture first, as a browser does; returns the event. */
  const key = (k: string, extra: Record<string, unknown> = {}) => {
    const ev: any = { key: k, target: body, defaultPrevented: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra };
    ev.preventDefault = () => { ev.defaultPrevented = true; };
    const ls = docListeners.filter((l) => l.type === 'keydown');
    for (const l of [...ls.filter((x) => x.capture), ...ls.filter((x) => !x.capture)]) l.fn(ev);
    return ev;
  };
  /** Run the MutationObserver callbacks, as the browser does after a task. */
  const observe = () => { for (const cb of observers) cb([]); };
  const all = (e: any, cls: string): any[] => [...(String(e.className || '').split(' ').includes(cls) ? [e] : []), ...(e.children || []).filter((c: any) => c && c.children).flatMap((c: any) => all(c, cls))];
  const byTag = (e: any, tag: string): any[] => [...(e.tag === tag ? [e] : []), ...(e.children || []).filter((c: any) => c && c.children).flatMap((c: any) => byTag(c, tag))];
  return { node, doc, html, body, key, observe, all, docListeners };
}
