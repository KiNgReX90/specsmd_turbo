/**
 * specsmd AI-DLC Turbo - the overview page of templates/overview, and the C4
 * model of the v5 page embedded in it.
 *
 * render(page, table) fills templates/overview/overview-template.html with the
 * data of lib/../intent-overview.cjs buildData(), in the language of `table`
 * (the record's string table, lib/lang.cjs; by default the one of page.lang):
 * every {{key}} in its HTML becomes that text of the table, escaped; the
 * texts the page's scripts show go into the block
 * `<script id="turbo-text" type="application/json">` (read by
 * templates/design/design-text.js); the Turbo logo (templates/overview/turbo-logo.svg)
 * is inlined into the masthead; the drawing's style and code
 * (lib/design-assets.cjs); and the data itself in the block
 * `<script id="overview-data" type="application/json">`. `</` and `<!--`
 * inside the JSON are escaped so nothing in the data can close the block or
 * open a comment. The drawing comes with its lines (lib/design-routes.cjs):
 * routed here once, so the page does not route them on every open.
 *
 * withEmbed(html, model, table) puts the v5 page of `model` (lib/v5-page.cjs,
 * in the words of `table`) into that page, for the one tab the page does not
 * have of its own, the C4 model:
 *
 *   <script type="application/json" id="v5-embed">"...the v5 page..."</script>
 *
 * right after the old page's data block, so it is parsed before the page's
 * own script reads it (templates/design/design-tabs.js embed; else right
 * before </body>), the whole page as one JSON string with every `<`
 * written as its unicode escape. So no data block, no script tag and no
 * comment opener is ever found inside it: lib/review-links.cjs relink, the
 * tests' model regex and any indexOf('<script') read the old page only. The
 * block is written only when the v5 model has a C4 context view. The embedded
 * model carries `embed: true` and no `build.diffs` (the C4 drawing needs the
 * marks of the build, never the diffs; Review lives on the old page).
 *
 * Node builtins only, plus the flow's own libraries named below.
 */

const fs = require('fs');
const path = require('path');
const lang = require('./lang.cjs');
const { escapeHtml } = require('./overview-text.cjs');
const { designAssets, pageAssets } = require('./design-assets.cjs');
const { designRoutes } = require('./design-routes.cjs');
const { v5Page } = require('./v5-page.cjs');

const TEMPLATE_DIR = path.join(__dirname, '..', '..', 'templates', 'overview');

const EMBED_OPEN = '<script type="application/json" id="v5-embed">';
const EMBED_CLOSE = '</script>';

/** JSON for inside a <script> block: `</` and `<!--` escaped so nothing can close the block or open a comment. */
const scriptJson = (v) => JSON.stringify(v).replace(/<\//g, '<\\/').replace(/<!--/g, '\\u003c!--');

/** The texts the page shows, from the string table: the product half (md), the overview and the Code Scaffold. */
const pageText = (table) => ({ lang: table.lang, md: table.md, overview: table.overview, design: table.design });

/**
 * The page from buildData(), in the language of `table`. The drawing comes with its lines
 * (lib/design-routes.cjs): routed here once, so the page does not route them on every open.
 */
function render(page, table = lang.load(page.lang || lang.FALLBACK)) {
    const template = fs.readFileSync(path.join(TEMPLATE_DIR, 'overview-template.html'), 'utf8');
    const logo = fs.readFileSync(path.join(TEMPLATE_DIR, 'turbo-logo.svg'), 'utf8').trim();
    const data = page.design ? { ...page, design: { ...page.design, routes: designRoutes(page.design, page.phase) } } : page;
    const design = page.design ? designAssets() : pageAssets();
    return template
        .replace(/<!--[\s\S]*?-->\n/, '')
        .replace(/\{\{([\w.]+)\}\}/g, (m, key) => escapeHtml(key === 'lang' ? table.lang : lang.text(table, key)))
        .replace('__TURBO_LOGO__', () => logo)
        .replace('/*__DESIGN_CSS__*/', () => design.css)
        .replace('__TURBO_TEXT__', () => scriptJson(pageText(table)))
        .replace('/*__DESIGN_JS__*/', () => design.js)
        .replace('__OVERVIEW_DATA__', () => scriptJson(data));
}

/** Whether the v5 model has what the embedded tab shows: a C4 context view. */
function hasEmbed(model) {
    return !!(model && typeof model === 'object' && model.views && model.views.context);
}

/** The v5 model as the embed carries it: `embed: true`, and the diffs of the build left behind. */
function embedModel(model) {
    const out = { ...model, embed: true };
    if (out.build && typeof out.build === 'object') {
        const { diffs, ...rest } = out.build;
        out.build = rest;
    }
    return out;
}

/** The embed block of a v5 model: its whole page as one JSON string, every `<` written as its unicode escape. */
function embedBlock(model, table = lang.load(lang.FALLBACK)) {
    return EMBED_OPEN + JSON.stringify(v5Page(embedModel(model), table)).replace(/</g, '\\u003c') + EMBED_CLOSE;
}

const DATA_OPEN = '<script id="overview-data" type="application/json">';

/** The v5 page of `model` in the old page, right after its data block (before the script that reads both), else
 *  right before </body>; the page as it is when it has nothing to show. */
function withEmbed(html, model, table = lang.load(lang.FALLBACK)) {
    if (!hasEmbed(model)) return html;
    const block = embedBlock(model, table);
    const data = html.indexOf(DATA_OPEN);
    const after = data < 0 ? -1 : html.indexOf(EMBED_CLOSE, data + DATA_OPEN.length);
    if (after >= 0) return `${html.slice(0, after + EMBED_CLOSE.length)}\n${block}${html.slice(after + EMBED_CLOSE.length)}`;
    const at = html.lastIndexOf('</body>');
    return at < 0 ? `${html}\n${block}\n` : `${html.slice(0, at)}${block}\n${html.slice(at)}`;
}

/** The v5 page the embed block of `html` carries, or null when it has none. */
function readEmbed(html) {
    const at = String(html).indexOf(EMBED_OPEN);
    const end = at < 0 ? -1 : html.indexOf(EMBED_CLOSE, at + EMBED_OPEN.length);
    if (end < 0) return null;
    try {
        const page = JSON.parse(html.slice(at + EMBED_OPEN.length, end));
        return typeof page === 'string' ? page : null;
    } catch {
        return null;
    }
}

module.exports = { TEMPLATE_DIR, EMBED_OPEN, EMBED_CLOSE, render, scriptJson, pageText, hasEmbed, embedModel, embedBlock, withEmbed, readEmbed };
