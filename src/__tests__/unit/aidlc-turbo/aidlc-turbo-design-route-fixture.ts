/**
 * A generated drawing for the router of the Code Scaffold
 * (templates/design/design-route.js), the same for the same seed: `cols` x
 * `rows` blocks, each a little off its column and row and of its own height,
 * the way a real drawing has them (so their ports give the grid many tracks),
 * the channel tracks between them, the status icon and the story number on
 * every block's top edge, `count` links between random blocks (about a third
 * quiet, routed after the others) and, with `fixed`, a few straight lines
 * already drawn between neighbours in one row. The geometry is the input
 * routeLinks takes from design-layout.js.
 */

type Block = { id: string; x: number; y: number; w: number; h: number; band: number };
type Link = { id: string; from: string; to: string; prio: number };

export function bigDrawing(cols: number, rows: number, count: number, seed: number, fixed = false) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const BW = 236; const BH = 150; const GX = 130; const GY = 96; const X0 = 40; const Y0 = 60;
  const blocks: Block[] = [];
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      blocks.push({ id: `b${c}-${r}`, x: X0 + c * (BW + GX) + Math.floor(rnd() * 5) * 6, y: Y0 + r * (BH + GY) + Math.floor(rnd() * 7) * 7,
        w: BW, h: BH - 42 + Math.floor(rnd() * 4) * 14, band: r % 2 });
    }
  }
  const width = 2 * X0 + cols * (BW + GX) - GX;
  const height = 2 * Y0 + rows * (BH + GY) - GY;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let c = 0; c <= cols; c += 1) { const m = X0 + c * (BW + GX) - GX / 2; xs.push(m - 24, m, m + 24); }
  for (let r = 0; r <= rows; r += 1) { const m = Y0 + r * (BH + GY) - GY / 2; ys.push(m - 20, m, m + 20); }
  const obstacles = blocks.flatMap((b) => [{ x: b.x + b.w - 38, y: b.y - 14, w: 28, h: 28 }, { x: b.x + b.w - 67, y: b.y - 11, w: 22, h: 22 }]);
  const links: Link[] = [];
  const seen = new Set<string>();
  const set = new Map<string, [number, number][]>();
  const at = (id: string) => blocks.find((b) => b.id === id) as Block;
  if (fixed) {
    for (const r of [1, 3].filter((v) => v < rows)) {
      for (const c of [0, 2, 4].filter((v) => v + 1 < cols)) {
        const a = at(`b${c}-${r}`);
        const b = at(`b${c + 1}-${r}`);
        const y = Math.max(a.y, b.y) + 20;
        links.push({ id: `${a.id}>${b.id}`, from: a.id, to: b.id, prio: 0 });
        seen.add(`${a.id}>${b.id}`);
        set.set(`${a.id}>${b.id}`, [[a.x + a.w, y], [b.x, y]]);
      }
    }
  }
  while (links.length < count) {
    const a = blocks[Math.floor(rnd() * blocks.length)].id;
    const b = blocks[Math.floor(rnd() * blocks.length)].id;
    if (a === b || seen.has(`${a}>${b}`)) continue;
    seen.add(`${a}>${b}`);
    links.push({ id: `${a}>${b}`, from: a, to: b, prio: rnd() < 0.3 ? 1 : 0 });
  }
  const geo = { width, height, blocks, frames: [], obstacles, tracks: { xs, ys }, inner: { x0: 14, x1: width - 14 }, half: 64 };
  return { geo, links, fixed: set };
}
