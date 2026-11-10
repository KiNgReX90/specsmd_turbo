/**
 * AI-DLC Turbo - Code Scaffold, how a text fits its room.
 *
 * Decides the font size and the lines of every text in a part: the name,
 * the summary, the module tag and the one-line texts of the bands and the
 * plates. A text gets a second line before it gets smaller, and smaller
 * before it is cut; a code name is cut in the middle, so a file keeps its
 * extension, prose at the end. No cut lands right after a full stop, a
 * comma or a space. Pure: the caller hands a measure (text, font size) ->
 * width; the engine measures in the browser. The page inlines it
 * (window.TdFit) before the engine; Node loads it for the tests.
 */
(function (root) {
  'use strict';

  const ELL = '…';
  const TX = typeof module !== 'undefined' && module.exports ? require('./design-text.js') : root.TdText;
  // a kind in the page's language where its table names it (design.kinds), else as the record says it
  const kindOf = (k) => { const w = k ? TX.t(`design.kinds.${k}`) : ''; return w && w !== `design.kinds.${k}` ? w : k || ''; };
  // a label on the top row of a part: its text plus 6 on each side, 6 between two
  const PILL_PAD = 12;
  const PILL_GAP = 6;
  // what a cut may not end on, and what a kept end may not start with
  const TRIM_END = /[\s.,;:]+$/;
  const TRIM_START = /^[\s,;:]+/;

  /** Where a code name may break: after _ . - / or a space, or between a small and a capital letter. */
  function breaks(s) {
    const out = [];
    for (let i = 1; i < s.length - 1; i += 1) {
      if ('_.-/ '.includes(s[i - 1])) out.push(i);
      else if (/[a-z0-9]/.test(s[i - 1]) && /[A-Z]/.test(s[i])) out.push(i);
    }
    return out;
  }

  /** The split of `s` at one of `cuts` where both halves come out closest in width. */
  function bestSplit(s, cuts, w) {
    let best = null;
    for (const i of cuts) {
      const a = s.slice(0, i).trimEnd();
      const b = s.slice(i).trimStart();
      const v = Math.max(w(a), w(b));
      if (!best || v < best.v) best = { a, b, v };
    }
    return best;
  }

  /** The longest start of `s` that fits `max` with an ellipsis after it. */
  function cutEnd(s, max, w) {
    if (w(s) <= max) return s;
    for (let k = s.length - 1; k > 0; k -= 1) {
      const head = s.slice(0, k).replace(TRIM_END, '');
      if (head && w(head + ELL) <= max) return head + ELL;
    }
    return ELL;
  }

  /** The start and the end of `s` around an ellipsis, the end at least `keep` characters, as much as fits `max`. */
  function cutMiddle(s, max, w, keep) {
    if (w(s) <= max) return s;
    for (let n = s.length - 1; n > 1; n -= 1) {
      const t = Math.min(n - 1, Math.max(keep || 0, Math.ceil(n * 0.55)));
      const head = s.slice(0, n - t).replace(TRIM_END, '');
      const tail = s.slice(s.length - t).replace(TRIM_START, '');
      if (!head || !tail) continue;
      const out = head + ELL + tail;
      if (w(out) <= max) return out;
    }
    return cutEnd(s, max, w);
  }

  /** The largest size from `from` down to `to` (half a pixel at a time) at which every line fits, or null. */
  function sizeFor(lines, m, max, from, to) {
    for (let fs = from; fs >= to - 1e-9; fs -= 0.5) {
      if (lines.every((l) => m(l, fs) <= max)) return fs;
    }
    return null;
  }

  /**
   * The name of a part: one line while it fits at 14 px, else two lines at a
   * sensible break (its own size down to 12.5 px), a line that still does not fit
   * cut in the middle. With room for `most` = 1 line only: one line down to
   * 12.5 px, then cut in the middle. Returns { fs, lines }.
   */
  function nameFit(s, m, max, base, most) {
    const one = sizeFor([s], m, max, base, Math.min(base, most === 1 ? 12.5 : 14));
    if (one !== null) return { fs: one, lines: [s] };
    const cuts = most === 1 ? [] : breaks(s);
    if (!cuts.length) {
      const fs = Math.min(base, 12.5);
      return { fs, lines: [cutMiddle(s, max, (t) => m(t, fs), 8)] };
    }
    const top = base;
    const { a, b } = bestSplit(s, cuts, (t) => m(t, top));
    const fs = sizeFor([a, b], m, max, top, 12.5) || 12.5;
    return { fs, lines: [a, b].map((l) => cutMiddle(l, max, (t) => m(t, fs), 8)) };
  }

  /**
   * A summary in at most `most` lines: one line at its own size, else two
   * lines split where both come out closest in width (down to 12 px), the
   * second line cut at its end; on one line down to 13 px, then cut.
   */
  function subFit(s, m, max, most, base) {
    if (m(s, base) <= max) return { fs: base, lines: [s] };
    if (most < 2) {
      const fs = sizeFor([s], m, max, base, 13);
      return fs !== null ? { fs, lines: [s] } : { fs: 13, lines: [cutEnd(s, max, (t) => m(t, 13))] };
    }
    const words = s.split(' ');
    const cuts = words.length > 1 ? words.slice(1).map((_, i) => words.slice(0, i + 1).join(' ').length + 1) : breaks(s);
    if (!cuts.length) {
      const fs = sizeFor([s], m, max, base, 12) || 12;
      return { fs, lines: [cutMiddle(s, max, (t) => m(t, fs), 8)] };
    }
    const split = bestSplit(s, cuts, (t) => m(t, base));
    const fs = sizeFor([split.a, split.b], m, max, base, 12);
    if (fs !== null) return { fs, lines: [split.a, split.b] };
    // still too wide at 12 px: fill the first line as far as it goes, the rest is cut
    const w = (t) => m(t, 12);
    let a = null;
    for (const i of cuts) if (w(s.slice(0, i).trimEnd()) <= max) a = i;
    if (a === null) return { fs: 12, lines: [cutEnd(s, max, w)] };
    return { fs: 12, lines: [s.slice(0, a).trimEnd(), cutEnd(s.slice(a).trimStart(), max, w)] };
  }

  /** A module tag: smaller down to 11 px, then cut in the middle, keeping both ends. */
  function tagFit(s, m, max, base) {
    const fs = sizeFor([s], m, max, base, 11);
    if (fs !== null) return { fs, lines: [s] };
    return { fs: 11, lines: [cutMiddle(s, max, (t) => m(t, 11), 6)] };
  }

  /** One line of a band or a plate: smaller down to `min`, then cut at its end. */
  function lineFit(s, m, max, base, min) {
    const fs = sizeFor([s], m, max, base, min);
    if (fs !== null) return { fs, lines: [s] };
    return { fs: min, lines: [cutEnd(s, max, (t) => m(t, min))] };
  }

  /**
   * The labels on the top row of a part: its kind, "differs", and after the build "different", "added",
   * "not built", or "not used" for a part that already existed and was drawn to be used.
   */
  function pillsOf(p, built) {
    const out = [];
    if (p.kind) out.push({ cls: 'pk', text: kindOf(p.kind), fs: 13.5 });
    if (p.deviates) out.push({ cls: 'pa', text: TX.t('design.differs'), fs: 12.5 });
    const pill = (k) => TX.t(`design.built.${k}`);
    const BS = { different: ['pb', pill('pills.different')], added: ['pg', pill('pills.added')], gone: ['pn', p.status === 'existing' ? pill('unused') : pill('pills.gone')] };
    const bs = built && p.build && BS[p.build.state];
    if (bs) out.push({ cls: bs[0], text: bs[1], fs: 12.5 });
    return out;
  }

  /** The row of every label: the first row while it has room, the rest on a second row. `w(pill)` is its text width. */
  function pillRows(pills, room, w) {
    let x = 0;
    let second = false;
    return pills.map((p, k) => {
      const pw = w(p) + PILL_PAD;
      if (second || (k > 0 && x + pw > room)) { second = true; return 1; }
      x += pw + PILL_GAP;
      return 0;
    });
  }

  const api = { nameFit, subFit, tagFit, lineFit, cutEnd, cutMiddle, breaks, kindOf, pillsOf, pillRows, PILL_PAD, PILL_GAP, ELL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdFit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
