/**
 * Unit tests for the Code Scaffold at a laptop's width (1440x900), where the
 * drawing used to get about 350 px and its controls half of that:
 * - the controls over the drawing take one row where they fit: lower pills;
 *   where the row is tight "Full screen" shows only its icon (its name
 *   in its label and tooltip) and the switch "Only new and changed"
 *   shortens to "Changes" (its full name in its label and tooltip);
 * - the name in the details reads as a title of the column: about 19 px,
 *   semibold, never stretched, its lines balanced at the words of the name;
 * - the step held sits in a compact box over the drawing (design-stepbox.js),
 *   its sentence 14 px, its line of from and to and the call 12 px or more.
 * The legend that starts folded: aidlc-turbo-design-kit.test.ts; the split of
 * the details and the code (40 to 60): aidlc-turbo-design-pane-split.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fakeDom } from './aidlc-turbo-design-fake-dom';
const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const DESIGN = path.join(FLOW, 'templates/design');
const req = createRequire(import.meta.url);
const EN = req(path.join(FLOW, 'templates/lang/en.json'));
const plain = (f: string) => readFileSync(path.join(DESIGN, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const read = (f: string) => readFileSync(path.join(DESIGN, f), 'utf8');
/** Every block that opens with `head` (a media or container query), its rules in it. */
function blocks(css: string, head: string) {
  const out: string[] = [];
  for (let i = css.indexOf(head); i >= 0; i = css.indexOf(head, i + 1)) {
    let depth = 0;
    for (let j = css.indexOf('{', i); j < css.length; j += 1) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}' && --depth === 0) { out.push(css.slice(i, j + 1)); break; }
    }
  }
  return out.join('\n');
}
const px = (css: string, sel: RegExp) => { const m = sel.exec(css); return m ? Number(m[1]) : NaN; };

describe('aidlc-turbo Code Scaffold: the controls over the drawing in one row', () => {
  const steps = plain('design-steps.css');
  const filter = plain('design-filter.css');

  it('lower pills on a desktop: 40 px high, round buttons of 32 px in the walk', () => {
    expect(steps).toMatch(/\.td-ctl \.td-steps-nav \{[^}]*grid-template-columns: 32px 32px auto 32px;[^}]*padding: 3px;/);
    expect(steps).toMatch(/\.td-ctl \.td-steps-nav \.td-btn \{[^}]*width: 32px; height: 32px; min-height: 32px;/);
    expect(steps).toMatch(/\.td-ctl-l \.td-fsb \{[^}]*min-height: 40px;/);
    expect(filter).toMatch(/\.td-only \{[^}]*min-height: 40px;/);
    // a finger keeps its larger targets
    expect(steps).toMatch(/\.td-root\.td-touch \.td-ctl \.td-steps-nav \{ grid-template-columns: 44px 44px auto 44px; \}/);
    expect(filter).toMatch(/\.td-root\.td-touch \.td-only \{ min-height: 56px; \}/);
  });

  it('a tight row: "Full screen" only its icon, then the switch its short word; before the build (no button) only the switch', () => {
    const tight = blocks(steps, '@container td-draw (max-width:');
    expect(tight).toMatch(/\.td-ctl-l \.td-fsb > span \{ display: none; \}/);
    expect(tight).toMatch(/\.td-ctl-l:has\(> \.td-fsb\) \.td-only-t \{ display: none; \}/);
    expect(tight).toMatch(/\.td-ctl-l:has\(> \.td-fsb\) \.td-only-s \{ display: inline; \}/);
    expect(tight).toMatch(/\.td-ctl-l \.td-only-t \{ display: none; \}/);
    // the icon first, the short word only where the icon alone left too little
    const at = (re: RegExp) => px(steps, re);
    const icon = at(/@container td-draw \(max-width: (\d+)px\) \{[^@]*\.td-fsb > span \{ display: none; \}/);
    const short = at(/@container td-draw \(max-width: (\d+)px\) \{[^@]*:has\(> \.td-fsb\) \.td-only-t \{ display: none; \}/);
    const plan = at(/@container td-draw \(max-width: (\d+)px\) \{\s*\.td-ctl-l \.td-only-t \{ display: none; \}/);
    expect(icon).toBeGreaterThan(short);
    expect(short).toBeGreaterThan(plan);
    // short by default: hidden until the row is tight
    expect(filter).toMatch(/\.td-only-s \{ display: none; \}/);
  });

  it('the icon-only button keeps its name in its label and its tooltip', () => {
    const PANEL = read('design-panel.js');
    expect(PANEL).toMatch(/const fsBtn = btn\('td-fsb', 'full', t\('full'\), t\('fullTip'\)\);\s*fsBtn\.setAttribute\('aria-label', t\('full'\)\);/);
    expect([EN.design.panel.full, EN.design.panel.fullTip]).toEqual(['Full screen', 'Open the drawing full screen']);
  });
});

describe('aidlc-turbo Code Scaffold: the switch "Only new and changed" in short', () => {
  let d: ReturnType<typeof fakeDom>;
  beforeEach(() => { d = fakeDom(); delete (globalThis as any).localStorage; });

  it('names itself in full in its label and its tooltip, its short word beside the full one', () => {
    const F = req(path.join(DESIGN, 'design-filter.js'));
    const dm = req(path.join(FLOW, 'scripts/lib/design-model.cjs'));
    const { parseYaml } = req(path.join(FLOW, 'scripts/render-specs.cjs'));
    const model = dm.designModel(parseYaml(readFileSync(path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml'), 'utf8')));
    let sw: any = null;
    F.mount(d.node('div'), model, { phase: 'inception' }, (_c: any, _m: any, o: any) => { sw = o.filter; return { snap: () => null }; });
    expect(sw.getAttribute('aria-label')).toBe('Only new and changed');
    expect(d.all(sw, 'td-only-t')[0].textContent).toBe('Only new and changed');
    expect(d.all(sw, 'td-only-s')[0].textContent).toBe('Changes');
    expect(sw.title).toMatch(/^Only new and changed: on\. Also show /);
    sw.click();
    expect(sw.title).toMatch(/^Only new and changed: off\. Leave out /);
  });
});

describe('aidlc-turbo Code Scaffold: the name in the details and the line of the step', () => {
  it('the name about 19 px, semibold, not stretched, its lines balanced', () => {
    const base = plain('design.css');
    expect(base).toMatch(/\.td-dhead h3 \{[^}]*font-size: 1\.1875rem;[^}]*font-weight: 600;[^}]*line-height: 1\.3;[^}]*text-wrap: balance;/);
    const mq = plain('maquette-draw.css');
    const rule = /\.mq \.td-dhead h3 \{([^}]*)\}/.exec(mq);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/font-weight: 600;/);
    expect(rule![1]).not.toMatch(/font-stretch: 1[1-9]\d%|font-weight: [7-9]00|font-weight: 750/);
    // the whole width of the column: no room kept for a button
    expect(base).toMatch(/\.td-dhead \{ display: flex; flex-direction: column; gap: 6px; \}/);
  });

  it('the step box over the drawing compact: its sentence 14 px, its line of from and to and the call 12 px or more', () => {
    const box = plain('design-stepbox.css');
    expect(box).toMatch(/\.td-sbox-s \{[^}]*font-size: 14px;[^}]*line-height: 1\.4;/);
    expect(box).toMatch(/\.td-sbox-r \{[^}]*font: 600 12\.5px\/1\.4 var\(--td-font\);/);
    expect(box).toMatch(/\.td-sbox-c \{[^}]*font: 12px\/1\.4 var\(--td-mono\);/);
  });
});
