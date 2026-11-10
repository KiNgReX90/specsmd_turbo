/**
 * Unit tests for the v5 page kit inside the flow (templates/overview-v5) and the two libraries that serve it:
 * - the kit holds the head, the style, the body shell, the modules in load order, the tail, and elkjs 0.9.3
 *   vendored with a README naming it as third-party code and its licence beside it;
 * - lib/v5-assets.cjs returns the style and the code in the order the kit documents, the vendored bundle first,
 *   before the module that calls ELK, and every module of the kit exactly once;
 * - lib/v5-page.cjs makes one complete page from a model: the texts of the string table in the shell and in the
 *   page's text block, the title escaped, the model read back unchanged, nothing loaded over the network, no script
 *   closed early; a table of another language fills the same places;
 * - every text the kit names is in the `v5` section of the English table, and the code holds no sentence of its
 *   own;
 * - every module of the kit and both libraries stay under 500 lines without a long dash; the vendored bundle is
 *   left out by name.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import path from 'path';
import vm from 'vm';
import { FLOW, KIT, kit, BUILT, TEXT, clone } from './aidlc-turbo-v5-boot';

const req = createRequire(import.meta.url);
const assets = req(path.join(FLOW, 'scripts/lib/v5-assets.cjs'));
const page = req(path.join(FLOW, 'scripts/lib/v5-page.cjs'));
const lang = req(path.join(FLOW, 'scripts/lib/lang.cjs'));

const MODULES = readdirSync(path.join(KIT, 'js')).filter((f) => f.endsWith('.js')).sort();
/** The load order the kit documents. */
const ORDER = ['00-kit.js', '01-shapes.js', '02-build.js', '03-layout.js', '04-view.js', '05-panel.js', '06-legend.js', '07-switches.js',
  '08-path.js', '09-input.js', '10-app.js', '11-side.js'];
/** The value under a dotted key of the v5 section. */
const at = (key: string) => key.split('.').reduce((v: any, k) => (v && typeof v === 'object' ? v[k] : undefined), TEXT);

describe('aidlc-turbo v5 kit: the files', () => {
  it('holds the head, the style, the body shell, the tail and every module', () => {
    for (const f of ['00-head.html', 'style.css', 'body.html', 'tail.html', 'README.md']) expect(existsSync(path.join(KIT, f)), f).toBe(true);
    expect(MODULES).toEqual([...ORDER].sort());
    expect(readdirSync(KIT).sort()).toEqual(['00-head.html', 'README.md', 'body.html', 'js', 'style.css', 'tail.html', 'vendor']);
    expect(kit('style.css')).not.toMatch(/<\/?style>/);
  });

  it('vendors elkjs 0.9.3 untouched, named as third-party code, its licence beside it', () => {
    const bundle = readFileSync(path.join(KIT, 'vendor/elk.bundled.js'));
    expect(createHash('sha256').update(bundle).digest('hex')).toBe('b0745abd7f23cd91690a1587e377edbe19fd7233c783300290936720546216d4');
    const readme = kit('vendor/README.md');
    expect(readme).toMatch(/elkjs/);
    expect(readme).toMatch(/0\.9\.3/);
    expect(readme).toMatch(/vendored third-party code/i);
    expect(readme).toMatch(/EPL-2\.0/);
    expect(kit('vendor/LICENSE')).toMatch(/Eclipse Public License - v 2\.0/);
  });

  it('the shell loads nothing over the network but the fonts, and carries no icon of its own', () => {
    for (const f of ['00-head.html', 'body.html', 'tail.html']) expect(kit(f), f).not.toMatch(/<script[^>]+src=/i);
    expect(kit('00-head.html')).not.toMatch(/rel="icon"/);
    expect(kit('00-head.html')).toContain('family=DM+Sans');
  });

  it('the style is light only, without a theme of its own', () => {
    const css = kit('style.css');
    expect(css).toContain('color-scheme: light');
    expect(css).not.toMatch(/data-theme|prefers-color-scheme/);
  });

  it('the README documents the load order the library uses', () => {
    const readme = kit('README.md');
    let pos = -1;
    for (const f of ['vendor/elk.bundled.js', ...ORDER]) {
      const i = readme.indexOf(f, pos + 1);
      expect(i, f).toBeGreaterThan(pos);
      pos = i;
    }
  });
});

describe('aidlc-turbo v5 kit: lib/v5-assets.cjs', () => {
  it('names every module once, in the documented order, the vendored bundle first', () => {
    expect(assets.KIT_JS).toEqual(ORDER);
    expect(assets.VENDOR_JS).toEqual(['vendor/elk.bundled.js']);
    expect(assets.LOAD_ORDER).toEqual(['vendor/elk.bundled.js', ...ORDER]);
    expect(assets.KIT_CSS).toEqual(['style.css']);
  });

  it('the bundle comes before every module that calls ELK', () => {
    const callers = ORDER.filter((f) => /\bELK\b/.test(kit(`js/${f}`)));
    expect(callers).toEqual(['03-layout.js']);
    const { js } = assets.v5Assets();
    const elk = js.indexOf('g.ELK = f()');
    expect(elk).toBeGreaterThanOrEqual(0);
    for (const f of callers) expect(js.indexOf(kit(`js/${f}`)), f).toBeGreaterThan(elk);
  });

  it('returns the style and the code as one text each, every module in order', () => {
    const { css, js } = assets.v5Assets();
    expect(css).toBe(kit('style.css'));
    let pos = -1;
    for (const f of ORDER) { const i = js.indexOf(kit(`js/${f}`)); expect(i, f).toBeGreaterThan(pos); pos = i; }
    expect(() => new vm.Script(js)).not.toThrow();
  });

  it('gives the shell around them', () => {
    const shell = assets.v5Shell();
    expect(shell.head).toBe(kit('00-head.html'));
    expect(shell.body).toBe(kit('body.html'));
    expect(shell.tail).toBe(kit('tail.html'));
  });
});

describe('aidlc-turbo v5 kit: lib/v5-page.cjs', () => {
  const back = (html: string) => {
    const m = /<script>window\.C4 = \{ model: ([\s\S]*?) \};<\/script>/.exec(html);
    return m ? JSON.parse(m[1]) : null;
  };
  const texts = (html: string) => {
    const m = /<script type="application\/json" id="v5-text">([\s\S]*?)<\/script>/.exec(html);
    return m ? JSON.parse(m[1]) : null;
  };

  it('makes a complete page of the model, the texts filled in and carried', () => {
    const html = page.v5Page(BUILT);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html.trimEnd().endsWith('</body></html>')).toBe(true);
    expect(html).toContain('<div class="app">');
    expect(html).toContain(`<style>${kit('style.css')}</style>`);
    expect(back(html)).toEqual(BUILT);
    expect(texts(html)).toEqual(TEXT);
    // every place of the shell filled in, from the table
    expect(html.slice(0, html.indexOf('<script'))).not.toMatch(/\{\{/);
    expect(html).toContain(`aria-label="${TEXT.tools.label}"`);
    expect(html).toContain(`<p class="wait">${TEXT.drawing.wait}</p>`);
    expect(html.indexOf('id="v5-text"')).toBeLessThan(html.indexOf('window.C4 = { model:'));
    expect(html.indexOf('window.C4 = { model:')).toBeLessThan(html.indexOf('g.ELK = f()'));
    expect(html.indexOf('g.ELK = f()')).toBeLessThan(html.indexOf(kit('js/10-app.js')));
  });

  it('every place in the shell names a text of the table', () => {
    for (const f of ['00-head.html', 'body.html']) {
      for (const [, key] of kit(f).matchAll(/\{\{([\w.]+)\}\}/g)) {
        if (key === 'TITLE' || key === 'lang') continue;
        expect(typeof at(key), `${f}: ${key}`).toBe('string');
      }
    }
  });

  it('takes the texts of the table given: another language fills the same places', () => {
    // every text in capitals, its {places} left as they are
    const up = (s: string) => s.split(/(\{\w+\})/).map((bit, i) => (i % 2 ? bit : bit.toUpperCase())).join('');
    const shout = (v: any): any => (typeof v === 'string' ? up(v) : Array.isArray(v) ? v.map(shout) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shout(x)])));
    const table = { ...lang.load('en'), lang: 'xx', v5: shout(TEXT) };
    const html = page.v5Page(BUILT, table);
    expect(html).toContain('<html lang="xx">');
    expect(html).toContain('<title>Pay with a gift card · C4 MODEL</title>');
    expect(html).toContain(`aria-label="${TEXT.tools.label.toUpperCase()}"`);
    expect(texts(html).panel.relations).toBe(TEXT.panel.relations.toUpperCase());
  });

  it('loads no script over the network', () => {
    const html = page.v5Page(BUILT);
    expect(html).not.toMatch(/<script[^>]+src=/i);
  });

  it('names the window after the model, escaped', () => {
    const html = page.v5Page({ ...clone(BUILT), title: 'A <b> & "c"' });
    expect(html).toContain('<title>A &lt;b&gt; &amp; &quot;c&quot; · C4 model</title>');
    expect(page.v5Page(BUILT)).toContain('<title>Pay with a gift card · C4 model</title>');
  });

  it('never closes a script early: a model text that holds a closing tag stays inside its block', () => {
    const m = { ...clone(BUILT), title: 'x</script><script>alert(1)</script>' };
    const html = page.v5Page(m);
    expect(back(html)).toEqual(m);
    // the text block, the data block and the code: three blocks, each closed once
    expect((html.match(/<script[ >]/g) || []).length).toBe(3);
    expect((html.match(/<\/script/gi) || []).length).toBe(3);
    expect(page.dataBlock(m)).not.toMatch(/<\/script>[\s\S]*<\/script>/i);
  });

  it('takes a model and gives a page: it reads no intent and writes no file', () => {
    const src = readFileSync(path.join(FLOW, 'scripts/lib/v5-page.cjs'), 'utf8');
    expect(src).not.toMatch(/writeFileSync|readdirSync|intents/);
    expect(() => page.v5Page(null)).toThrow(/model/);
  });
});

describe('aidlc-turbo v5 kit: the texts', () => {
  it('every text a module names is in the v5 section of the English table', () => {
    for (const f of ORDER) {
      const src = kit(`js/${f}`);
      for (const [, key] of src.matchAll(/\bT\(\s*'([\w.]+)'/g)) expect(typeof at(key), `${f}: ${key}`).toBe('string');
      for (const [, key] of src.matchAll(/\b(?:count|noun)\(\s*'([\w.]+)'/g)) expect(at(key), `${f}: ${key}`).toEqual({ one: expect.any(String), many: expect.any(String) });
    }
    // the keys put together at run time
    for (const k of ['built', 'plan']) {
      for (const key of [`caption.context.${k}`, `caption.components.${k}`, `card.storyTip.${k}`, `legend.story.${k}`, `panel.showStory.${k}`, `panel.lit.${k}`]) expect(typeof at(key), key).toBe('string');
      for (const s of ['new', 'changed', 'existing']) expect(typeof at(`status.${k}.${s}`)).toBe('string');
    }
    for (const w of ['different', 'added', 'gone', 'unused']) for (const g of ['mark', 'card']) expect(typeof at(`build.${g}.${w}`), `${g}.${w}`).toBe('string');
    for (const w of ['different', 'added', 'gone']) for (const g of ['legend', 'short']) expect(typeof at(`build.${g}.${w}`), `${g}.${w}`).toBe('string');
    for (const l of ['1', '2', '3', '4']) expect(typeof at(`levels.${l}`)).toBe('string');
    for (const d of ['down', 'up', 'right', 'left']) expect(typeof at(`notice.dir.${d}`)).toBe('string');
    expect(TEXT.months).toHaveLength(12);
  });

  it('a module writes no sentence of its own: every text a reader sees comes from the table', () => {
    for (const f of ORDER) {
      // a quoted text of three words or more that starts with a capital, outside a comment
      const code = kit(`js/${f}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
      const said = [...code.matchAll(/(['`])([A-Z][a-z]+(?: [a-z][\w-]*){2,}[^'`]*)\1/g)].map((m) => m[2]);
      expect(said, f).toEqual([]);
    }
  });
});

describe('aidlc-turbo v5 kit: the size and dash rules', () => {
  it('keeps every module and both libraries under 500 lines, without a long dash; the vendored bundle is exempt by name', () => {
    const files = [...MODULES.map((f) => path.join(KIT, 'js', f)), path.join(FLOW, 'scripts/lib/v5-assets.cjs'), path.join(FLOW, 'scripts/lib/v5-page.cjs')];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text.split('\n').length, f).toBeLessThanOrEqual(500);
      expect(text, f).not.toContain('—');
    }
    for (const f of ['README.md', 'vendor/README.md', 'body.html', '00-head.html', 'style.css']) expect(kit(f), f).not.toContain('—');
    expect(readdirSync(path.join(KIT, 'vendor')).sort()).toEqual(['LICENSE', 'README.md', 'elk.bundled.js']);
  });
});
