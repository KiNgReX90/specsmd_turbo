/**
 * AI-DLC Turbo - Code Scaffold, the block in a direction: where the arrows
 * go from a block with the focus.
 *
 * Up, down, left or right from a block go to the nearest block that way on
 * the drawing, measured between the centres of the blocks. Only a block
 * inside the cone around the direction counts: more ahead than to the side
 * (a block exactly on the diagonal is out). Of those the nearest wins, a step
 * to the side counting double, so a block on the same line goes before one
 * a little nearer but off to the side. None that way: null, and the focus
 * stays where it is. The panel (design-panel.js) chooses the block it gives
 * as a click does, gives it the focus and keeps it in sight.
 *
 *   TdNear.pick(blocks, from, dir) -> id or null
 *     blocks [{ id, x, y, w, h }] (geo.blocks), from the id of the block with the focus,
 *     dir 'up', 'down', 'left' or 'right'
 *   TdNear.DIR maps the arrow keys to those directions.
 *
 * The page inlines it as window.TdNear, before the panel.
 */
(function (root) {
  'use strict';

  const DIR = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  const AXIS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const SIDE = 2; // a step to the side counts this much

  function pick(blocks, from, dir) {
    const v = AXIS[dir];
    const c = (b) => [b.x + (b.w || 0) / 2, b.y + (b.h || 0) / 2];
    const a = (blocks || []).find((b) => b.id === from);
    if (!v || !a) return null;
    const [ax, ay] = c(a);
    let best = null, score = Infinity, side = Infinity;
    for (const b of blocks) {
      if (b.id === from) continue;
      const [bx, by] = c(b);
      const ahead = (bx - ax) * v[0] + (by - ay) * v[1];
      const off = Math.abs((bx - ax) * v[1] - (by - ay) * v[0]);
      if (ahead <= 0 || off >= ahead) continue; // behind, or outside the cone
      const s = ahead + SIDE * off;
      if (s < score || (s === score && off < side)) { best = b.id; score = s; side = off; }
    }
    return best;
  }

  const api = { pick, DIR };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdNear = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
