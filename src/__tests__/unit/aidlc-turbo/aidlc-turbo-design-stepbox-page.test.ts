/**
 * Unit tests for how the page carries the step box of the Code Scaffold
 * drawing (design-stepbox.js; its behaviour is in
 * aidlc-turbo-design-stepbox.test.ts): inlined after the kit and before the
 * panel with its own style, localStorage only inside try, the page's colour
 * tokens and a fade of opacity only, and its files under 500 lines.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const DESIGN = path.join(FLOW, 'templates/design');
const req = createRequire(import.meta.url);
const read = (f: string) => { try { return readFileSync(path.join(DESIGN, f), 'utf8'); } catch { return ''; } };
const plain = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '');
const assets = req(path.join(FLOW, 'scripts/lib/design-assets.cjs'));

describe('aidlc-turbo Code Scaffold: the step box on the page', () => {
  it('is inlined after the kit and before the panel, with its own style', () => {
    const js = (f: string) => assets.DESIGN_JS.indexOf(f);
    expect(js('design-stepbox.js')).toBeGreaterThan(js('design-kit.js'));
    expect(js('design-stepbox.js')).toBeLessThan(js('design-panel.js'));
    const css = (f: string) => assets.DESIGN_CSS.indexOf(f);
    expect(css('design-stepbox.css')).toBeGreaterThan(css('design-steps.css'));
    expect(css('design-stepbox.css')).toBeLessThan(css('maquette.css'));
  });

  it('remembers through localStorage only inside try', () => {
    const src = read('design-stepbox.js');
    const all = src.match(/localStorage/g) || [];
    const guarded = src.match(/try \{[^\n]*localStorage[^\n]*\} catch/g) || [];
    expect(all.length).toBeGreaterThan(0);
    expect(guarded.length).toBe(all.length);
  });

  it('light and dark from the page\'s tokens, a fade of opacity only, none with reduced motion', () => {
    const css = plain('design-stepbox.css');
    expect(css).toMatch(/\.td-sbox \{[^}]*background: var\(--td-[a-z-]+\);/);
    expect(css).not.toMatch(/#[0-9A-Fa-f]{3,8}\b|rgb\(/);
    expect(css).toMatch(/\.td-sbox-head \{[^}]*touch-action: none;/);
    expect(css).toMatch(/\.td-sbox\.td-sbox-float \{[^}]*position: fixed;/);
    expect(css).toMatch(/\.td-fs-view > \.td-sbox\.td-sbox-float \{[^}]*position: absolute;/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });

  it('its files and the panel stay under 500 lines, without a long dash', () => {
    for (const f of ['design-stepbox.js', 'design-stepbox.css', 'design-panel.js', 'design-view.js', 'design-about.js', 'design-show.js']) {
      const src = read(f);
      expect(src.length, f).toBeGreaterThan(0);
      expect(src.split('\n').length, f).toBeLessThanOrEqual(500);
      expect(src, f).not.toMatch(/\u2014/);
    }
  });
});
