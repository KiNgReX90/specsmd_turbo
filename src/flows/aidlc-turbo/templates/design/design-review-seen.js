/**
 * AI-DLC Turbo - Code Scaffold, "Viewed" in the Review tab: which files a
 * viewer has marked as viewed, as GitLab's Viewed in a merge request.
 *
 * Remembered per viewer (the browser's localStorage) and per intent (the
 * `scope` the tab gives: the page's own place), as a fingerprint of each
 * file's change: a file whose change is another since (a new build of the
 * story, a fix) is no longer viewed, as in GitLab. Every read and write is
 * guarded: without a localStorage, or with one that refuses, the marks hold
 * for the page alone.
 *
 *   TdReviewSeen.create(scope) -> { has(row), set(row, on), count(rows) }
 *   TdReviewSeen.sig(row) -> the fingerprint of a row's change and deviation
 *
 * A row is one of TdReviewList.rows (design-review-list.js). The page
 * inlines it as window.TdReviewSeen, before the Review tab (design-review.js).
 */
(function (root) {
  'use strict';

  const KEY = 'td-review-seen:';

  /** A short hash of a text (djb2), as letters and digits. */
  function hash(s) {
    let x = 5381;
    for (let i = 0; i < s.length; i += 1) x = ((x << 5) + x + s.charCodeAt(i)) | 0;
    return (x >>> 0).toString(36);
  }
  function sig(r) {
    const e = r.entry;
    return hash([e ? (e.omitted ? 'omitted' : String(e.text || '')) : '', r.added, r.removed, r.dev || ''].join('\u0000'));
  }

  function create(scope) {
    const key = KEY + String(scope || '');
    const read = () => {
      try {
        const v = root.localStorage ? root.localStorage.getItem(key) : null;
        const o = v ? JSON.parse(v) : null;
        return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
      } catch (e) { return {}; }
    };
    let mem = read();
    function set(r, on) {
      mem = { ...read(), ...mem }; // another page of the same intent may have marked more
      if (on) mem[r.id] = sig(r); else delete mem[r.id];
      try { if (root.localStorage) root.localStorage.setItem(key, JSON.stringify(mem)); } catch (e) { /* held for this page only */ }
    }
    const has = (r) => !!r && mem[r.id] === sig(r);
    return { has, set, count: (rows) => rows.filter(has).length };
  }

  const api = { create, sig, KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdReviewSeen = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
