/**
 * specsmd AI-DLC Turbo - the v5 page kit (templates/overview-v5) as a page inlines it.
 *
 * The kit's style (style.css), and its code in load order: first the vendored
 * layout engine (vendor/elk.bundled.js, elkjs 0.9.3, which sets window.ELK),
 * then every module in the order the kit's README documents. The order is
 * written out here, never read from a directory listing, so a module can never
 * land before the one it needs: the shared tools first, the drawing and its
 * layout (which calls ELK) after the bundle, the page (10-app.js) after the
 * parts it mounts, the inspector's frame last. The shell (head, body, tail) is
 * served as it is; lib/v5-page.cjs puts the texts and a model into it.
 *
 * Node builtins only.
 */

const fs = require('fs');
const path = require('path');

const KIT_DIR = path.join(__dirname, '..', '..', 'templates', 'overview-v5');
const VENDOR_JS = ['vendor/elk.bundled.js'];
const KIT_JS = [
    '00-kit.js', '01-shapes.js', '02-build.js', '03-layout.js', '04-view.js', '05-panel.js', '06-legend.js',
    '07-switches.js', '08-path.js', '09-input.js', '10-app.js', '11-side.js',
];
const KIT_CSS = ['style.css'];
const LOAD_ORDER = [...VENDOR_JS, ...KIT_JS];
const read = (f) => fs.readFileSync(path.join(KIT_DIR, f), 'utf8');
const mod = (f) => read(path.join('js', f));

/** { css, js }: the kit's style, and its code with the vendored bundle first, as one text each. */
function v5Assets() {
    return { css: KIT_CSS.map(read).join('\n'), js: [...VENDOR_JS.map(read), ...KIT_JS.map(mod)].join('\n') };
}

/** { head, body, tail }: the shell around the style, the texts, the model and the code. */
function v5Shell() {
    return { head: read('00-head.html'), body: read('body.html'), tail: read('tail.html') };
}

module.exports = { KIT_DIR, VENDOR_JS, KIT_JS, KIT_CSS, LOAD_ORDER, v5Assets, v5Shell };
