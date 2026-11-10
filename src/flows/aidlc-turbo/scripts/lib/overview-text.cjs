/**
 * specsmd AI-DLC Turbo - the text helpers of the intent overview
 * (intent-overview.cjs): markdown to plain text, and the small subset of
 * markdown the test cases and the stories use, to HTML. Every string is
 * escaped before it becomes HTML.
 *
 * Node builtins only.
 */

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const present = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const list = (v) => (Array.isArray(v) ? v : []);
const sentence = (s) => (!s || /[.!?:]$/.test(s) ? s : `${s}.`);

/** An unquoted `id: 001` or `depends_on: [001]` reads as the number 1. */
const storyId = (v) => (typeof v === 'number' ? String(v).padStart(3, '0') : String(v).trim());

/** Markdown to one line of plain text: no `**`, `*`, backticks, link syntax or bullets. */
function plain(value) {
    if (!present(value)) return '';
    return String(value)
        .replace(/\r\n?/g, '\n')
        .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
        .replace(/^[ \t]*[-*+][ \t]+/gm, '')
        .replace(/\[([^\]]+)\]\((?:[^)\s]+)\)/g, '$1')
        .replace(/`+/g, '')
        .replace(/\*\*/g, '')
        .replace(/(^|[^\w*])\*(?=\S)|(?<=\S)\*(?![\w*])/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
}

/** The first sentence of a text and the rest, both plain. */
function splitSummary(text) {
    const t = plain(text);
    const m = /[.!?]["'”’)]*(?=\s+["'“‘(]?[A-ZÀ-ÖØ-Þ0-9])/.exec(t);
    if (!m) return { summary: t, rest: '' };
    const end = m.index + m[0].length;
    return { summary: t.slice(0, end).trim(), rest: t.slice(end).trim() };
}

/** A slug for an id: lower case, no accents, dashes between words. */
function slug(text) {
    return String(text).normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

// ---------------------------------------------------------------------------
// Markdown, the small subset the test cases use
// ---------------------------------------------------------------------------

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

const LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]*[^\s<.,;:!?)])/g;

/** Inline markdown: code, links, bold, italic. Everything is escaped first. */
function inline(text) {
    const parts = String(text).split(/(`[^`]+`)/);
    return parts.map((part) => {
        if (/^`[^`]+`$/.test(part)) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
        return escapeHtml(part)
            .replace(LINK, (m, label, url, bare) => `<a href="${url || bare}" target="_blank" rel="noopener">${label || bare}</a>`)
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[^*\w])\*([^*\s](?:[^*]*?[^*\s])?)\*(?![*\w])/g, '$1<em>$2</em>');
    }).join('');
}

const TOP_ITEM = /^\s?(?:[-*]|\d+[.)])\s+/;
const SUB_ITEM = /^\s{2,}(?:[-*]|\d+[.)])\s+/;

/** One list item: its text inline, its indented sub-bullets as a nested list. */
function itemHtml(md) {
    const [head, ...subs] = String(md).split('\n');
    return subs.length ? `${inline(head)}<ul>${subs.map((s) => `<li>${inline(s)}</li>`).join('')}</ul>` : inline(head);
}

/**
 * Collect list items from lines[i..]: a sub-bullet becomes a `\n`-line of its
 * item, any other indented or directly following line continues the item.
 * Returns the items and the index of the first line after the list.
 */
function collectItems(lines, i, marker = TOP_ITEM) {
    const items = [];
    let lazy = false;
    for (; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line.trim()) { lazy = false; continue; }
        if (marker.test(line) && !SUB_ITEM.test(line)) { items.push(line.replace(marker, '')); lazy = true; }
        else if (items.length && SUB_ITEM.test(line)) { items[items.length - 1] += `\n${line.replace(SUB_ITEM, '')}`; lazy = true; }
        else if (items.length && (lazy || /^\s{2,}\S/.test(line)) && !/^\s*(#|\||```)/.test(line)) items[items.length - 1] += ` ${line.trim()}`;
        else break;
    }
    return { items, next: i };
}

function splitRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/** Block markdown: paragraphs, bullet and numbered lists, tables. */
function blocks(md) {
    const lines = String(md).replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim() || /^>/.test(line.trim()) || /^-{3,}$/.test(line.trim())) { i += 1; continue; }
        if (/^\s*\|/.test(line)) {
            const rows = [];
            while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i += 1; }
            const body = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
            const [head, ...rest] = body;
            const th = splitRow(head).map((c) => `<th>${inline(c)}</th>`).join('');
            const tr = rest.map((r) => `<tr>${splitRow(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
            out.push(`<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`);
            continue;
        }
        const heading = /^#{3,6}\s+(.+)$/.exec(line.trim());
        if (heading) { out.push(`<h5>${inline(heading[1])}</h5>`); i += 1; continue; }
        if (/^\s*```/.test(line)) {
            const code = [];
            for (i += 1; i < lines.length && !/^\s*```/.test(lines[i]); i += 1) code.push(lines[i]);
            out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
            i += 1;
            continue;
        }
        const bullet = /^\s?[-*]\s+/;
        const numbered = /^\s?\d+[.)]\s+/;
        if (bullet.test(line) || numbered.test(line)) {
            const kind = numbered.test(line) ? 'ol' : 'ul';
            const { items, next } = collectItems(lines, i, kind === 'ol' ? numbered : bullet);
            i = next;
            out.push(`<${kind}>${items.map((it) => `<li>${itemHtml(it)}</li>`).join('')}</${kind}>`);
            continue;
        }
        if (SUB_ITEM.test(line)) {
            // Indented bullets with no list item above them: a flat list of their own.
            const kind = /^\s*\d+[.)]\s+/.test(line) ? 'ol' : 'ul';
            const items = [];
            for (; i < lines.length && SUB_ITEM.test(lines[i]); i += 1) items.push(lines[i].replace(SUB_ITEM, ''));
            out.push(`<${kind}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${kind}>`);
            continue;
        }
        const para = [];
        while (i < lines.length && lines[i].trim() && !/^\s*([-*]|\d+[.)]|#{3,6})\s+|^\s*\||^\s*```/.test(lines[i])) {
            para.push(lines[i].trim());
            i += 1;
        }
        // Never leave i where it was: a line no branch takes becomes plain text.
        if (!para.length) { para.push(lines[i].trim()); i += 1; }
        out.push(`<p>${inline(para.join(' '))}</p>`);
    }
    return out.join('');
}

/** List items of a markdown block, as markdown (sub-bullets on their own lines); an item that only says none is left out. */
function listItems(md, none = /^none\.?$/i) {
    const lines = String(md).split('\n');
    const items = [];
    for (let i = 0; i < lines.length;) {
        if (!TOP_ITEM.test(lines[i])) { i += 1; continue; }
        const found = collectItems(lines, i);
        items.push(...found.items);
        i = found.next;
    }
    return items.filter((it) => !none.test(it.trim()));
}

/** Split a markdown body into sections by headings of one level. */
function sections(body, level) {
    const marker = '#'.repeat(level);
    const re = new RegExp(`^${marker}\\s+(.+)$`);
    const out = [];
    let current = null;
    for (const line of String(body).split('\n')) {
        const m = re.exec(line);
        if (m && !line.startsWith(`${marker}#`)) {
            current = { heading: m[1].trim(), text: '' };
            out.push(current);
        } else if (current) {
            current.text += `${line}\n`;
        }
    }
    return out;
}

const find = (all, re) => all.find((s) => re.test(s.heading));

module.exports = { present, list, sentence, storyId, plain, splitSummary, slug, escapeHtml, inline, itemHtml, collectItems, splitRow, blocks, listItems, sections, find };
