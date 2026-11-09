/**
 * specsmd AI-DLC Turbo - one v5 page from one model.
 *
 * Takes the page model (lib/v5-model.cjs: stories, parts, links and the C4
 * half) and gives one complete HTML page: the kit's head, its style, its body
 * shell, the fixed texts, the model in its data block, then the vendored
 * layout engine and the kit's modules in one script (lib/v5-assets.cjs), then
 * the tail. Nothing in it loads over the network but the fonts, which fall
 * back to the system's. It reads no intent and writes no file: the caller
 * builds the model and decides where the page goes. The overview carries the
 * page as its C4 model tab (lib/overview-page.cjs withEmbed).
 *
 * The texts come from the `v5` section of the string table (lib/lang.cjs): the
 * table given, else the one of the model's language (model.lang, en without
 * one). `{{key}}` in the shell becomes that text, escaped (`{{lang}}` the
 * language code, `{{TITLE}}` the window's title), and the kit's code reads the
 * rest from <script type="application/json" id="v5-text">.
 *
 * Node builtins only, plus ./lang.cjs and ./v5-assets.cjs.
 */

const lang = require('./lang.cjs');
const { v5Assets, v5Shell } = require('./v5-assets.cjs');

const DOCTYPE = '<!doctype html>';
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Text inlined in a script: a closing tag or a comment opener in it would end or bend the script early. */
const inScript = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
/** JSON for inside a script: every < written as its unicode escape, so no text can close the block or open a comment. */
const scriptJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

/** The model's data block, as the kit reads it: `<script>window.C4 = { model: ... };</script>`. */
function dataBlock(model) {
    return `<script>window.C4 = { model: ${scriptJson(model)} };</script>`;
}

/** The texts block: the `v5` section of the table, as the kit reads it (js/00-kit.js). */
function textBlock(table) {
    return `<script type="application/json" id="v5-text">${scriptJson((table && table.v5) || {})}</script>`;
}

/** The window's title, in the words of the table. */
const titleOf = (model, table = lang.load(lang.FALLBACK)) => lang.text(table, 'v5.title', { title: model.title || lang.text(table, 'v5.tab') });

/** One complete page for this model, in the language of `table`. */
function v5Page(model, table) {
    if (!model || typeof model !== 'object') throw new Error('v5Page needs a model object');
    const t = table || lang.load(model.lang || lang.FALLBACK);
    const { head, body, tail } = v5Shell();
    const { css, js } = v5Assets();
    const fill = (html) => html.replace(/\{\{([\w.]+)\}\}/g, (m, key) => (key === 'TITLE' ? escapeHtml(titleOf(model, t))
        : key === 'lang' ? escapeHtml(t.lang || lang.FALLBACK) : escapeHtml(lang.text(t, `v5.${key}`))));
    const top = fill(head);
    if (!top.toLowerCase().startsWith(DOCTYPE)) throw new Error('the kit head must start the document');
    return [top, `<style>${css}</style>`, fill(body), textBlock(t), dataBlock(model), `<script>${inScript(js)}</script>`, tail].join('\n');
}

module.exports = { v5Page, dataBlock, textBlock, titleOf };
