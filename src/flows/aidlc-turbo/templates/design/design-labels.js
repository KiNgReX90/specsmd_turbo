/**
 * AI-DLC Turbo - Code Scaffold, the link labels.
 *
 * Finds a spot for the label of every routed link: a plate with the step
 * number and the text, beside one of its own segments. No line may run
 * under a plate, other lines keep farther off than its own, and a label never
 * covers a block (or comes within 4 of one), another label, an arrow head, a
 * status icon or a title. A label that does not fit on one line tries two lines;
 * when there is still no clean spot, only the step number goes on the line
 * (a badge) and the text lives in the list under the drawing. Pure: no DOM,
 * the text widths are estimated per character. The page inlines it
 * (window.TdLabels); Node loads it for the tests.
 */
(function (root) {
  'use strict';

  const LINE = 18;
  const SIZE_TEXT = 14;
  const PAD = 8;
  const NUM = 20;
  const GAP_NUM = 6;
  const PLATE_H = 26;
  const BADGE = 24;
  const OFF = 5;
  // the arrow head: the last 14 units of a line, 7 to each side
  const HEAD = 14;
  // how far other lines keep from a plate: about twice its own line (OFF), so it never reads as theirs; else only its number
  const CLEAR = [9];
  const TS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.12, 0.88];

  const grow = (r, m) => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const hits = (box, p, q) => Math.min(p[0], q[0]) <= box.x + box.w && Math.max(p[0], q[0]) >= box.x
    && Math.min(p[1], q[1]) <= box.y + box.h && Math.max(p[1], q[1]) >= box.y;

  /** Two segments run along each other on the same line for more than a pixel. */
  function along(p, q, c, d) {
    const k = p[1] === q[1] ? 1 : 0;
    if (p[k] !== q[k] || c[k] !== d[k] || p[k] !== c[k]) return false;
    const j = 1 - k;
    return Math.min(Math.max(p[j], q[j]), Math.max(c[j], d[j])) - Math.max(Math.min(p[j], q[j]), Math.min(c[j], d[j])) > 1;
  }

  /** Width of a text in px, estimated per character for DM Sans, or a monospace font. */
  function textWidth(text, size, mono) {
    if (mono) return String(text).length * size * 0.62;
    let w = 0;
    for (const ch of String(text)) {
      if ('ijl.,:;\'|!'.includes(ch)) w += 0.27;
      else if ('ftr ()[]I'.includes(ch)) w += 0.36;
      else if ('mw'.includes(ch)) w += 0.84;
      else if ('MW'.includes(ch)) w += 0.95;
      else if (/[A-Z]/.test(ch)) w += 0.7;
      else if (/[0-9]/.test(ch)) w += 0.58;
      else if ('/-'.includes(ch)) w += 0.42;
      else w += 0.58;
    }
    return w * size;
  }

  /** Split a text into two lines of about the same length, or null for one word. */
  function twoLines(text) {
    const words = String(text).split(' ');
    if (words.length < 2) return null;
    let best = null;
    for (let i = 1; i < words.length; i += 1) {
      const a = words.slice(0, i).join(' ');
      const b = words.slice(i).join(' ');
      const w = Math.max(textWidth(a, SIZE_TEXT), textWidth(b, SIZE_TEXT));
      if (!best || w < best.w) best = { w, lines: [a, b] };
    }
    return best.lines;
  }

  /** The size of a plate: the number, then the text. */
  function plateOf(lines, n) {
    const tw = Math.max(...lines.map((t) => textWidth(t, SIZE_TEXT)));
    return { w: Math.ceil(PAD + (n ? NUM + GAP_NUM : 0) + tw + PAD), h: PLATE_H + (lines.length - 1) * LINE, tw };
  }

  /** The box the arrow head covers at the end of the segment a-b. */
  function headOf(a, b) {
    const dx = Math.sign(b[0] - a[0]);
    const dy = Math.sign(b[1] - a[1]);
    const len = Math.min(HEAD, Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]));
    const c = [b[0] - dx * len, b[1] - dy * len];
    return { x: Math.min(c[0], b[0]) - (dy ? HEAD / 2 : 0), y: Math.min(c[1], b[1]) - (dx ? HEAD / 2 : 0),
      w: Math.abs(b[0] - c[0]) + (dy ? HEAD : 0), h: Math.abs(b[1] - c[1]) + (dx ? HEAD : 0) };
  }

  /** Candidate boxes of w x h beside the segment a-b, with a base score each. */
  function beside(a, b, w, h) {
    const out = [];
    const flat = a[1] === b[1];
    const len = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
    if (len < 20) return out;
    for (const t of TS) {
      const base = Math.abs(t - 0.5) * 24;
      if (flat) {
        const cx = a[0] + (b[0] - a[0]) * t;
        const over = Math.max(0, w + 24 - len) * 0.6;
        out.push({ box: { x: cx - w / 2, y: a[1] - OFF - h, w, h }, score: base + over });
        out.push({ box: { x: cx - w / 2, y: a[1] + OFF, w, h }, score: base + over + 4 });
      } else {
        const cy = a[1] + (b[1] - a[1]) * t;
        const over = len < h + 30 ? 40 : 0;
        out.push({ box: { x: a[0] + OFF, y: cy - h / 2, w, h }, score: base + over + 8 });
        out.push({ box: { x: a[0] - OFF - w, y: cy - h / 2, w, h }, score: base + over + 12 });
      }
    }
    return out;
  }

  /** Candidate badges on the segment a-b itself, away from its ends. */
  function onLine(a, b) {
    const out = [];
    const len = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
    if (len < BADGE + 4) return out;
    // every 4 px along the stretch, the badge whole on it
    for (let d = BADGE / 2 + 2; d <= len - BADGE / 2 - 2; d += 4) {
      const t = d / len;
      const cx = a[0] + (b[0] - a[0]) * t;
      const cy = a[1] + (b[1] - a[1]) * t;
      out.push({ box: { x: cx - BADGE / 2, y: cy - BADGE / 2, w: BADGE, h: BADGE }, score: Math.abs(t - 0.5) * 24 });
    }
    return out;
  }

  /**
   * A spot for every label. `geo` has width, height, blocks, frames and
   * obstacles; `routes` maps a link id to its points; `labels` maps a link id
   * to { text, n } (the text and the step number). `order` lists the
   * link ids in step order: the first steps choose first. Returns a Map from
   * link id to { kind: 'plate' | 'badge', lines, n, box }.
   */
  function placeLabels(geo, links, routes, labels, order) {
    const placed = new Map();
    const taken = [];
    const blocks = geo.blocks.map((b) => grow(b, 4));
    const all = links.map((l) => {
      const pts = routes.get(l.id);
      return { link: l, segs: pts.slice(1).map((q, k) => [pts[k], q]) };
    });
    const segsAll = all.flatMap((o) => o.segs.map((s) => ({ link: o.link, s })));
    const frameEdges = geo.frames.flatMap((f) => [
      [[f.x, f.y], [f.x + f.w, f.y]], [[f.x, f.y + f.h], [f.x + f.w, f.y + f.h]],
      [[f.x, f.y], [f.x, f.y + f.h]], [[f.x + f.w, f.y], [f.x + f.w, f.y + f.h]],
    ]);
    const heads = all.map((o) => headOf(...o.segs[o.segs.length - 1]));
    const inside = (box) => box.x >= 2 && box.y >= 2 && box.x + box.w <= geo.width - 2 && box.y + box.h <= geo.height - 2;
    /** Free: inside the drawing, off every block, label, icon and arrow head. */
    const free = (box) => inside(box) && !blocks.some((r) => overlaps(box, r)) && !taken.some((r) => overlaps(box, grow(r, 3)))
      && !geo.obstacles.some((r) => overlaps(box, r)) && !heads.some((r) => overlaps(box, r));
    /** Clean: free, and no other line within `gap` (its own line may pass when it is `own`). */
    const clean = (box, own, borders, gap) => {
      if (!free(box)) return false;
      const g = grow(box, gap === undefined ? 3 : gap);
      for (const { link, s } of segsAll) if (link !== own && hits(g, s[0], s[1])) return false;
      if (!borders && frameEdges.some(([p, q]) => hits(g, p, q))) return false;
      return true;
    };
    // a stretch another line from the same block runs along too: a label there reads as both
    const shared = (link, p, q) => all.some((o) => o.link !== link && o.link.from === link.from && o.segs.some(([c, d]) => along(p, q, c, d)));
    const rank = new Map((order || []).map((id, i) => [id, i]));
    const queue = all.slice().sort((a, b) => (rank.has(a.link.id) ? rank.get(a.link.id) : 1e6) - (rank.has(b.link.id) ? rank.get(b.link.id) : 1e6));
    for (const { link, segs } of queue) {
      const lab = labels.get(link.id) || {};
      if (!lab.text && !lab.n) continue;
      const tries = [];
      if (lab.text) {
        tries.push({ lines: [lab.text], extra: 0 });
        const split = twoLines(lab.text);
        if (split) tries.push({ lines: split, extra: 30 });
      }
      let pick = null;
      for (const [tier, gap] of CLEAR.entries()) {
        for (const borders of [false, true]) {
          for (const { lines, extra } of tries) {
            const { w, h } = plateOf(lines, lab.n);
            segs.forEach(([p, q], k) => {
              const own = (shared(link, p, q) ? 60 : 0) + (k === segs.length - 1 && segs.length > 2 ? 10 : 0);
              for (const s of beside(p, q, w, h)) {
                const ownHit = segs.some(([c, d], j) => j !== k && hits(grow(s.box, 2), c, d));
                if (ownHit || !clean(s.box, link, borders, gap)) continue;
                const v = s.score + own + extra + (borders ? 80 : 0) + tier * 40;
                if (!pick || v < pick.v) pick = { kind: 'plate', box: s.box, lines, v };
              }
            });
          }
          if (pick) break;
        }
        if (pick) break;
      }
      if (!pick && lab.n) {
        // no clean spot for the text: the number goes on the line, the text in the list
        for (const pass of [0, 1]) {
          segs.forEach(([p, q]) => {
            const cands = pass === 0 ? onLine(p, q) : beside(p, q, BADGE, BADGE);
            for (const s of cands) {
              if (!clean(s.box, link, true, 3)) continue;
              const v = s.score + (shared(link, p, q) ? 60 : 0);
              if (!pick || v < pick.v) pick = { kind: 'badge', box: s.box, lines: [], v };
            }
          });
          if (pick) break;
        }
        if (!pick) {
          // last resort: the spot with the fewest lines through it, never on a block, a label, an icon or an arrow head
          const crossings = (box) => segsAll.filter(({ link: o, s: sg }) => o !== link && hits(grow(box, 2), sg[0], sg[1])).length;
          segs.forEach(([p, q]) => {
            for (const s of [...onLine(p, q), ...beside(p, q, BADGE, BADGE)]) {
              if (!free(s.box)) continue;
              const v = crossings(s.box) * 100 + s.score;
              if (!pick || v < pick.v) pick = { kind: 'badge', box: s.box, lines: [], v };
            }
          });
        }
        if (!pick) {
          const [p, q] = segs[segs.length - 1];
          pick = { kind: 'badge', box: { x: (p[0] + q[0]) / 2 - BADGE / 2, y: (p[1] + q[1]) / 2 - BADGE / 2, w: BADGE, h: BADGE }, lines: [] };
        }
      }
      if (!pick) continue;
      taken.push(pick.box);
      const b = pick.box;
      placed.set(link.id, { kind: pick.kind, lines: pick.lines, n: lab.n || null,
        box: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) } });
    }
    return placed;
  }

  const api = { placeLabels, textWidth, twoLines, plateOf, headOf, LINE, PAD, NUM, GAP_NUM, PLATE_H, BADGE, SIZE_TEXT, HEAD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdLabels = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
