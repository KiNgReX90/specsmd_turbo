/**
 * AI-DLC Turbo - the fixed texts of the page, in the record's language.
 *
 * The page carries no text of its own: the generator (intent-overview.cjs,
 * through lib/overview-page.cjs) puts the string table of the record's
 * language (scripts/lib/lang.cjs, templates/lang/{code}.json) in the JSON
 * block with id turbo-text before the scripts of the page, and every script
 * reads its texts here.
 *
 *   TdText.t(key, vars) -> text  the text under a dotted key ('design.legend.title'),
 *     with {name} filled from vars; a list stays a list; the key itself when
 *     the table has nothing there
 *   TdText.use(table)  takes another table (Node and the tests; the page reads its own)
 *
 * Node (the tests) reads the English table until use() gives another. The
 * page inlines it first, as window.TdText.
 */
(function (root) {
  'use strict';

  const cjs = typeof module !== 'undefined' && module.exports;
  let table = null;

  function load() {
    if (table) return table;
    const doc = root.document;
    const el = doc && typeof doc.getElementById === 'function' ? doc.getElementById('turbo-text') : null;
    if (el && el.textContent) {
      try { table = JSON.parse(el.textContent); } catch (e) { table = {}; }
    } else table = cjs ? require('../lang/en.json') : {};
    return table;
  }

  function t(key, vars) {
    let v = load();
    for (const k of String(key).split('.')) v = v && typeof v === 'object' && !Array.isArray(v) ? v[k] : undefined;
    if (Array.isArray(v)) return v;
    if (typeof v !== 'string') return key;
    return vars ? v.replace(/\{(\w+)\}/g, (m, name) => (vars[name] === undefined || vars[name] === null ? m : String(vars[name]))) : v;
  }

  function use(next) { table = next || null; }

  const api = { t, use };
  if (cjs) module.exports = api;
  else root.TdText = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
