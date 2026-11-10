/**
 * specsmd AI-DLC Turbo - the overview section of an intent's documentation
 * page on Confluence.
 *
 * The intent's overview page (overview.html, attached as
 * `overview-{intent-slug}.html` by default) sits on the intent's
 * documentation page as an attachment. Confluence hides the attachments of a
 * page behind a menu, so the page body lists them in one section that
 * confluence-attach.cjs owns: a link per .html attachment. It is one string
 * with no newlines between its tags (shown here on several lines):
 *
 *   <h2>Interactive overview</h2>
 *   <p>Click a file to download it and open it in your browser. ...</p>
 *   <ul>
 *   <li><a href="https://{site}/wiki/download/attachments/{pageId}/{name}"><strong>{name}</strong></a>: {what it is}</li>
 *   </ul>
 *
 * The heading and the name an intent's overview page is attached by are the
 * project's page names (`sync.page_names.overview_section` and
 * `overview_file`, lib/page-names.cjs), handed in as
 * `{ heading, overviewFile }`; without them the defaults above. In the
 * overview file name `{slug}` stands for the intent's folder name.
 *
 * The name in the link is encoded as encodeURIComponent does, the name in the
 * text is HTML-escaped. A name that is no intent overview gets no `: `.
 *
 * The links are plain absolute download links, deliberately not Confluence's
 * own <ac:link><ri:attachment>: the Turbo sync reads and writes this page as
 * markdown, and a plain link survives that round trip.
 *
 * The section always sits at the very top of the body, with nothing between
 * it and the rest. It is found by its h2 with the heading's text (attributes,
 * spaces around the text and inner tags allowed) and runs up to and including
 * the first </ul> after it; when no </ul> comes before the next heading (any
 * level), it ends right before that heading, or at the end of the body. Only
 * the first section found is handled. Everything else in the body stays byte
 * for byte.
 *
 * Pure, Node builtins only.
 */

const HEADING = 'Interactive overview';
const OVERVIEW_FILE = 'overview-{slug}.html';
const INTRO = 'Click a file to download it and open it in your browser. '
    + 'Click a part in it to see what belongs to it.';
/** What the section says after an intent's overview page. */
const OVERVIEW = 'the overview of the intent from AI-DLC Turbo, with the functional part, the C4 model, '
    + 'the Code Scaffold and, after the build, the Review.';

const H2 = /<h2(?:\s[^>]*)?>([\s\S]*?)<\/h2\s*>/gi;
const ANY_HEADING = /<h[1-6](?:\s[^>]*)?>/i;
const LIST_END = /<\/ul\s*>/i;

/** Python's html.escape(text, quote=True). */
function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

const filled = (v) => typeof v === 'string' && v.trim() !== '';

/** The options with their defaults: the section's heading and the overview file name template. */
function optionsOf(options = {}) {
    const o = options && typeof options === 'object' ? options : {};
    return {
        heading: filled(o.heading) ? o.heading.trim() : HEADING,
        overviewFile: filled(o.overviewFile) ? o.overviewFile.trim() : OVERVIEW_FILE,
    };
}

/** The pattern of an intent's overview file name: the template with `{slug}` standing for any name. */
function overviewPattern(template = OVERVIEW_FILE) {
    const parts = String(template).split('{slug}').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`^${parts.join('.+')}$`);
}

/**
 * The .html names in page order: each intent's overview alphabetically, then
 * any other name alphabetically.
 */
function ordered(names, options) {
    const isOverview = overviewPattern(optionsOf(options).overviewFile);
    const have = [...new Set((Array.isArray(names) ? names : []).filter((n) => typeof n === 'string' && n.endsWith('.html')))];
    const group = (n) => (isOverview.test(n) ? 0 : 1);
    return have.sort((a, b) => group(a) - group(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** What the section says after a name: an intent's overview has its own text, any other name none. */
function note(name, options) {
    return overviewPattern(optionsOf(options).overviewFile).test(name) ? OVERVIEW : '';
}

/** The section in storage format for these attachment names, or '' when none is a .html file. */
function section(site, pageId, names, options) {
    const o = optionsOf(options);
    const items = ordered(names, o).map((name) => {
        const href = `https://${site}/wiki/download/attachments/${encodeURIComponent(pageId)}/${encodeURIComponent(name)}`;
        const text = note(name, o);
        return `<li><a href="${href}"><strong>${escapeHtml(name)}</strong></a>${text ? `: ${text}` : ''}</li>`;
    });
    if (!items.length) return '';
    return [`<h2>${escapeHtml(o.heading)}</h2>`, `<p>${INTRO}</p>`, '<ul>', ...items, '</ul>'].join('');
}

/** The text of a heading: inner tags dropped, spaces collapsed. */
function headingText(inner) {
    return inner.replace(/<[^>]*>/g, '').replace(/&nbsp;| /g, ' ').replace(/\s+/g, ' ').trim();
}

/** [start, end] of the first section in the body, or null. */
function span(body, options) {
    const heading = optionsOf(options).heading;
    const h2 = new RegExp(H2.source, 'gi');
    for (let m = h2.exec(body); m; m = h2.exec(body)) {
        if (headingText(m[1]) !== heading && headingText(m[1]) !== escapeHtml(heading)) continue;
        const after = m.index + m[0].length;
        const rest = body.slice(after);
        const next = rest.search(ANY_HEADING);
        const stop = next === -1 ? rest.length : next;
        const list = rest.match(LIST_END);
        return [m.index, after + (list && list.index < stop ? list.index + list[0].length : stop)];
    }
    return null;
}

/** Two sections are the same when only the whitespace between their tags differs. */
function same(a, b) {
    const squeeze = (s) => s.replace(/>\s+</g, '><').trim();
    return squeeze(a) === squeeze(b);
}

/**
 * The body with `wanted` (a section, or '' for none) at the very top, or null
 * when nothing would change. The first section found is cut out where it is;
 * the rest of the body stays byte for byte.
 */
function splice(body, wanted, options) {
    const found = span(body, options);
    if (!found) return wanted ? wanted + body : null;
    const [start, end] = found;
    const atTop = body.slice(0, start).trim() === '';
    if (wanted && atTop && same(body.slice(start, end), wanted)) return null;
    const next = wanted + body.slice(0, start) + body.slice(end);
    return next === body ? null : next;
}

module.exports = {
    HEADING, OVERVIEW_FILE, OVERVIEW, escapeHtml, overviewPattern, ordered, section, span, splice,
};
