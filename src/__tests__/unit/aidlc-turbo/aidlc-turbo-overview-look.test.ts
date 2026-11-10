/**
 * Unit tests for the look of the overview page (the Functional view and the Code Scaffold):
 * the colours of the AI-DLC Turbo logo, a synthwave sunset, on a white page, light only.
 * - no dark block anywhere in the templates, no theme switch, no saved theme; color-scheme light;
 * - the palette: the night for the masthead and the marks, magenta and coral for the accents, gold, a white
 *   page with lavender-grey lines and pink chips, sunset lanes in the drawing, frost for what was built;
 * - the masthead: the night sky with a dot grid and a pink glow on the horizon, the Turbo logo inline
 *   (a sun with slits, "AI-DLC" in frost, "TURBO" from frost to magenta), DM Sans for the text;
 * - text that reads: the grey text, the chosen status, the step coins, the start bands, the pills;
 * - the keys, the lit pieces and the pills of the drawing keep their own look, from tokens;
 * - on a phone the story panel is a flat sheet, the masthead chips 44 px; the lanes keep their names;
 * - no image or font file under the templates: the logo is one SVG file, inlined.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const read = (f: string) => readFileSync(path.join(FLOW, f), 'utf8');
const TEMPLATE = read('templates/overview/overview-template.html');
const LOGO = read('templates/overview/turbo-logo.svg');
const PAGE_JS = read('scripts/lib/overview-page.cjs');
const DESIGN = read('templates/design/design.css');
const LAYOUT = read('templates/design/design-layout.css');
const SCAFFOLD = read('templates/design/design-scaffold.css');
const MQ = read('templates/design/maquette.css');
const FUNC = read('templates/design/maquette-func.css');
const DRAW = read('templates/design/maquette-draw.css');
const BUILT = read('templates/design/maquette-built.css');

/** Every file under a folder of the flow, as [relative path, text]. */
function filesOf(dir: string): [string, string][] {
  const out: [string, string][] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else out.push([path.relative(FLOW, p), readFileSync(p, 'latin1')]);
    }
  };
  walk(path.join(FLOW, dir));
  return out;
}

/** The body of the first block that starts with `head`, braces balanced. */
function block(css: string, head: string): string {
  const at = css.indexOf(head);
  if (at < 0) return '';
  let i = css.indexOf('{', at) + 1;
  const start = i;
  for (let depth = 1; depth > 0 && i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
  }
  return css.slice(start, i - 1);
}
/** The declarations of a block as name -> value. */
function decls(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of body.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const m = /^\s*(--[\w-]+|color-scheme)\s*:\s*([\s\S]+?)\s*$/.exec(d);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
/** The first block of `sel` at the start of a line. */
const tokensOf = (css: string, sel: string) => decls(block(css, `\n${sel} {`));
const page = tokensOf(TEMPLATE, '  :root');
const td = tokensOf('\n' + DESIGN, ':root');
const mq = tokensOf(MQ, 'body.mq');
const draw = tokensOf('\n' + DRAW, 'body.mq');
/** The rules of a file without its token blocks and comments. */
const rules = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(body\.mq \{\s*)?(--[\w-]+: [^;]+; ?)+\}?\s*$/.test(l)).join('\n');

function lum(hex: string) {
  const c = hex.replace('#', '').match(/../g)!.map((h) => parseInt(h, 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('aidlc-turbo look: images', () => {
  it('holds no image or font file under the templates; the Turbo logo is one SVG file', () => {
    expect(filesOf('templates').filter(([f]) => /\.(png|jpe?g|gif|webp|woff2?|ttf|otf)$/i.test(f))).toEqual([]);
    expect(existsSync(path.join(FLOW, 'templates/overview/turbo-logo.svg'))).toBe(true);
  });
});

describe('aidlc-turbo look: light only', () => {
  it('has no dark block, no theme switch and no saved theme in any template', () => {
    const savedTheme = /localStorage\.(get|set)Item\('[\w-]*theme'/;
    const hits = filesOf('templates').filter(([, t]) => /prefers-color-scheme: dark|data-theme|color-scheme: dark/.test(t) || savedTheme.test(t)).map(([f]) => f);
    expect(hits).toEqual([]);
    expect(TEMPLATE).not.toMatch(/class="theme"|\.theme\b|setTheme|mq-theming/);
    expect(MQ).not.toMatch(/\.theme\b|mq-theming/);
    expect(read('templates/design/maquette-page.js')).toContain("$$('.views').forEach(knob);");
    expect(page['color-scheme']).toBe('light');
  });
});

describe('aidlc-turbo look: the palette of the logo', () => {
  it('names the night, magenta, pink, coral and gold as the page colours', () => {
    expect(page).toMatchObject({
      '--purple': '#1C1230', '--violet': '#D700D7', '--lilac': '#FF87FF', '--orange': '#FF875F', '--yellow': '#FFD75F',
      '--violet-ink': '#A800A8', '--mast': '#1C1230', '--heading': '#1C1230', '--badge-bg': '#1C1230',
    });
    expect(td).toMatchObject({ '--td-purple': '#1C1230', '--td-violet': '#D700D7', '--td-orange': '#FF875F', '--td-lilac': '#FFAFFF', '--td-accent': '#A800A8' });
    expect(mq).toMatchObject({ '--mast': '#1C1230', '--mq-key-on': '#FF875F', '--mq-key-on-ink': '#1C1230' });
  });

  it('is a white page with lavender-grey lines and inks and pink chips', () => {
    expect(page).toMatchObject({
      '--bg': '#FFFFFF', '--surface': '#FFFFFF', '--tint': '#F6F6FB', '--tint-2': '#FAFAFD', '--chip': '#FFE6FA',
      '--line': '#E8E8F0', '--line-strong': '#D3D3E0', '--ink': '#1A1528', '--ink-2': '#4C4760', '--ink-3': '#6E6984',
      '--on-dark-2': '#D7D7FF', '--sel': '#FFF0EA',
    });
    expect(mq['--bg']).toBe('#FFFFFF');
    expect(mq).toMatchObject({ '--mq-grid': 'rgb(28 18 48 / .035)', '--mq-grid-2': 'rgb(28 18 48 / .06)', '--mq-side': '#E3E1EE' });
  });

  it('draws the Code Scaffold on sunset lanes, what was built in frost, a colour per module', () => {
    for (const lanes of [td, draw]) expect(lanes).toMatchObject({ '--td-lane-1': '#FFFBEA', '--td-lane-2': '#FFF5EF', '--td-lane-3': '#FFF2FA' });
    expect(td).toMatchObject({ '--td-built-bg': '#D7F7FA', '--td-built-ink': '#0B4A5A', '--td-built-line': '#36A6BD', '--td-new-fill': '#A800A8', '--td-sel': '#FFF0EA' });
    expect(tokensOf('\n' + BUILT, 'body.mq')).toMatchObject({ '--mq-dif-f': '#EAF8FA', '--mq-dif-s': '#B4E2EA', '--mq-dif-l': '#36A6BD' });
    expect(tokensOf('\n' + LAYOUT, ':root')).toMatchObject({ '--td-mc0-bg': '#FFE3FB', '--td-mc3-bg': '#E6E6FF', '--td-mc4-bg': '#DDF6F8', '--td-mc5-bg': '#FFF6CC' });
    expect(tokensOf('\n' + SCAFFOLD, ':root')).toMatchObject({ '--td-start-bg': '#FF875F', '--td-start-ink': '#1C1230' });
  });

  it('sets the text in DM Sans, the system face after it', () => {
    const stack = '"DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
    expect(page['--font']).toBe(stack);
    expect(td['--td-font']).toBe(stack);
  });
});

describe('aidlc-turbo look: the masthead', () => {
  it('is the night sky the logo glows in: a dot grid, a pink glow on the horizon', () => {
    const mast = block(MQ, '\n.mq .mast {');
    expect(mast).toContain('background-color: var(--mast);');
    expect(mast).toMatch(/radial-gradient\(rgb\(255 255 255 \/ \.075\) 1px, transparent 1\.6px\)/);
    expect(mast).toMatch(/radial-gradient\(55% 150% at 90% 140%, rgb\(255 95 175 \/ \.34\), rgb\(215 0 215 \/ \.14\) 45%, transparent 72%\)/);
    expect(mast).toMatch(/linear-gradient\(180deg, #120A20, var\(--mast\)\)/);
  });

  it('holds the Turbo logo inline, from one SVG file', () => {
    expect(TEMPLATE).toMatch(/<div class="mast-top">\s*__TURBO_LOGO__\s*<h1 id="title">/);
    expect(TEMPLATE).not.toContain('<img class="logo"');
    expect(PAGE_JS).toContain("fs.readFileSync(path.join(TEMPLATE_DIR, 'turbo-logo.svg'), 'utf8')");
  });

  it('draws a sun with slits, "AI-DLC" in frost and "TURBO" from frost to magenta', () => {
    expect(LOGO).toMatch(/^<svg class="logo"[^>]*role="img" aria-label="AI-DLC Turbo"/);
    const stops = (id: string) => [...(new RegExp(`<linearGradient id="${id}"[\\s\\S]*?</linearGradient>`).exec(LOGO) || [''])[0].matchAll(/stop-color="(#\w+)"/g)].map((m) => m[1]);
    expect(stops('tb-sun')).toEqual(['#FFFF5F', '#FFD75F', '#FFAF5F', '#FF875F', '#FF5FAF', '#D700D7']);
    expect(stops('tb-word')[0]).toBe('#FFFFFF');
    expect(stops('tb-word').at(-1)).toBe('#FF00FF');
    expect(LOGO).toMatch(/<mask id="tb-slits">/);
    expect(LOGO).toMatch(/fill="#D7FFFF"[^>]*>A I - D L C</);
    expect(LOGO).toMatch(/fill="url\(#tb-word\)"[^>]*>TURBO</);
  });
});

describe('aidlc-turbo look: text that reads', () => {
  it('has a grey text of at least 4.5:1 on the panels', () => {
    for (const bg of ['#FFFFFF', page['--tint-2'], page['--tint']]) expect(contrast(page['--ink-3'], bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('sets the chosen status and the rail of the steps on a magenta white text reads on', () => {
    expect(contrast(tokensOf(FUNC, 'body.mq')['--mq-band-b'], '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(FUNC).toMatch(/\.mq \.flow \.band-b \{ fill: var\(--mq-band-b\); \}/);
    expect(FUNC).toMatch(/\.mq \.ftl-st\.r-b b \{ background: var\(--mq-band-b\); \}/);
  });

  it('reads the step coins, the start bands and the pills after the build', () => {
    const s = tokensOf('\n' + SCAFFOLD, ':root');
    expect(contrast(s['--td-step-bg'], s['--td-step-ink'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(s['--td-start-bg'], s['--td-start-ink'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(s['--td-start2-bg'], s['--td-start2-ink'])).toBeGreaterThanOrEqual(4.5);
    for (const [bg, ink] of [['--td-built-bg', '--td-built-ink'], ['--td-add-bg', '--td-add-ink']]) expect(contrast(td[bg], td[ink])).toBeGreaterThanOrEqual(7);
    expect(contrast(draw['--mq-gone-pill-ink'], '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });

  it('turns "Only new and changed" on in magenta with a white knob', () => {
    expect(DRAW).toMatch(/\.mq \.td-only\[aria-checked="true"\] \.td-only-k \{ border-color: var\(--mq-only-on\); background: var\(--mq-only-on\); \}/);
    expect(draw['--mq-only-on']).toBe('#D700D7');
    expect(contrast(draw['--mq-only-on'], '#FFFFFF')).toBeGreaterThanOrEqual(3);
  });
});

describe('aidlc-turbo look: the pieces of the model', () => {
  it('has the sides of a lit piece as tokens, and names the peach and the coral glows only there', () => {
    expect(mq).toMatchObject({ '--mq-on-side': '#FFC2A8', '--mq-sel-side': '#FFAA88' });
    for (const css of [MQ, FUNC, DRAW]) {
      for (const lit of [/#FFC2A8/i, /#FFAA88/i, /rgb\(255 135 95/, /rgb\(217 96 58/, /#A8441F/i]) expect(rules(css)).not.toMatch(lit);
    }
  });

  it('keeps the general key rule weak, so a key with a look of its own keeps it', () => {
    expect(DRAW).not.toMatch(/\.mq \.td-btn:not\(\.td-zb/);
    const general = /\.mq \.td-btn:where\(:not\(([^)]*)\)\) \{/.exec(DRAW);
    expect(general).not.toBeNull();
    for (const own of ['.td-zb', '.td-play', '.td-side-x']) expect(general![1]).toContain(own);
    expect(DRAW).toMatch(/\.mq \.td-ctl \.td-steps-nav \.td-btn:not\(\.td-play\) \{ box-shadow: none; border-color: transparent; \}/);
    expect(DRAW).toMatch(/\.mq \.td-btn\.td-play, [^{]*\.td-tbar \.td-fsb[^{]*\{[^}]*0 10px 16px -8px var\(--mq-key-drop\)/);
    expect(DRAW).toMatch(/\.mq \.td-sideb\[aria-pressed="true"\][^{]*\{[^}]*background: var\(--mq-key-on\); color: var\(--mq-key-on-ink\)/);
    expect(DRAW).toMatch(/\.mq \.td-ctl \.td-steps-nav \.td-btn:not\(\.td-play\):not\(:disabled\):hover \{ background: var\(--mq-hover\);/);
    expect(draw['--mq-hover']).toBe('rgb(28 18 48 / .06)');
  });

  it('stands a chosen part on the selection side, a plinth in its module colour, a block side as a side', () => {
    expect(DRAW).toMatch(/\.mq \.td-svg \.td-node\.td-sel \.mq-plinth \{ fill: var\(--mq-sel-side\);/);
    expect(DRAW).toMatch(/\.mq \.td-svg \.mq-mc0 \.mq-plinth \{ fill: var\(--td-mc0-line\); stroke: var\(--mq-plinth-edge, var\(--td-mc0-ink\)\); \}/);
    for (const n of [0, 1, 2]) expect(DRAW).toContain(`.mq .td-sw-mods .td-mc${n} { background: var(--td-mc${n}-line); }`);
    expect(FUNC).toMatch(/\.mq \.fnode rect\.mq-side \{[^}]*stroke: var\(--mq-side-line\)/);
    expect(FUNC).toMatch(/\.mq \.flow \.mq-lane:has\(\.lane-crash\) \.mq-lside \{ fill: var\(--mq-crash-side\); \}/);
  });

  it('keeps the ring of every ringed pill, and draws "not built" as a dashed empty pill', () => {
    for (const [cls, line] of [['td-changed', '--td-accent'], ['td-built', '--td-built-line'], ['td-open', '--td-zk-red'], ['td-built-added', '--td-add-line']]) {
      expect(DRAW).toContain(`.mq .td-pill.${cls} { box-shadow: inset 0 0 0 1.5px var(${line}), var(--mq-pill-drop); }`);
    }
    expect(DRAW).toMatch(/\.mq \.td-pill\.td-built-gone \{ border: 1\.5px dashed var\(--mq-gone-pill-line\); [^}]*background: transparent; color: var\(--mq-gone-pill-ink\); box-shadow: none; \}/);
  });
});

describe('aidlc-turbo look: a phone, and the lanes while a story is open', () => {
  it('shows the story panel as a flat full sheet and the masthead chips 44 px high', () => {
    expect(block(MQ, '@media (max-width: 760px)')).toMatch(/\.mq \.drawer \{ border-radius: 0; box-shadow: none; \}/);
    expect(block(MQ, '@media (pointer: coarse)')).toMatch(/\.mq \.mast-chips \.td-chip \{ min-height: 44px; \}/);
  });

  it('keeps the names of the lanes in sight, and a label between two lanes clear of their edges', () => {
    expect(TEMPLATE).toContain('class="lane-pins"');
    expect(TEMPLATE).toMatch(/pins\.setAttribute\('transform', `translate\(\$\{[^}]+\} 0\)`\)/);
    expect(TEMPLATE).toMatch(/\.flow\.more-l \.lane-pins \{ display: inline; \}/);
    expect(TEMPLATE).toContain("'in-gap'");
    expect(FUNC).toMatch(/\.mq \.fedge text\.in-gap \{ stroke: none; \}/);
  });
});
