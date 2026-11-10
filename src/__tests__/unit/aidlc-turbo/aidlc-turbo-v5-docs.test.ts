/**
 * AI-DLC Turbo - the v5 page kit's own README (templates/overview-v5/README.md): it says how the overview runs the
 * kit in a frame for its C4 model tab (the embed block, window.C4_EMBED with the two switches, the message that
 * follows them), names every module in the order the page runs them, and keeps the kit's rules. The flow's other
 * docs are checked by their own tests. A later edit cannot quietly drop any of it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { KIT } from './aidlc-turbo-v5-boot';

const readme = readFileSync(path.join(KIT, 'README.md'), 'utf8');
/** The README with every run of whitespace collapsed, so a phrase may wrap. */
const flat = readme.replace(/\s+/g, ' ');
/** The text of one `## ` section, whitespace collapsed. */
function section(heading: string) {
  const at = flat.indexOf(`## ${heading}`);
  expect(at, heading).toBeGreaterThan(-1);
  const next = flat.indexOf('## ', at + heading.length + 3);
  return flat.slice(at, next === -1 ? undefined : next);
}

describe('aidlc-turbo v5 kit README', () => {
  it('says how the overview runs the kit embedded: the block, C4_EMBED and the message', () => {
    const embed = section('Embedded in the overview');
    for (const key of ['`withEmbed`', '`embed: true`', 'id="v5-embed"', '`views.context`', 'srcdoc',
      'window.C4_EMBED = {"details":true,"help":false}', "{ type: 'turbo-switches', details, help }", 'by `postMessage`',
      'only from the window around it', 'nothing in the browser\'s storage']) expect(embed, key).toContain(key);
  });

  it('names every module of the kit, in the order the page runs them', () => {
    const order = section('Load order');
    const modules = readdirSync(path.join(KIT, 'js')).filter((f) => f.endsWith('.js')).sort();
    // the layout engine first, then each module after the one before it
    let from = order.indexOf('`vendor/elk.bundled.js`');
    expect(from).toBeGreaterThan(-1);
    for (const f of modules) {
      const at = order.indexOf(`\`${f}\``, from + 1);
      expect(at, f).toBeGreaterThan(from);
      from = at;
    }
  });

  it('says where the texts come from', () => {
    const texts = section('The texts');
    for (const key of ['`v5` section', '`templates/lang/en.json`', '`scripts/lib/lang.cjs`', 'id="v5-text"', '`C4.kit.T`']) expect(texts, key).toContain(key);
  });

  it('keeps the kit\'s rules', () => {
    const rules = section('Rules');
    expect(rules).toContain('under 500 lines');
    expect(rules).toContain('`vendor/`');
  });
});
