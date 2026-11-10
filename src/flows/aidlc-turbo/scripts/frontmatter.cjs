/**
 * specsmd AI-DLC Turbo - frontmatter helpers shared by the flow scripts.
 *
 * These scripts run from the project root of whatever project the flow is
 * installed in, and that project often has no node_modules at all (Maven,
 * Gradle, Python, Go, Rust). js-yaml is therefore optional here:
 *
 * - When js-yaml resolves it is used, with CORE_SCHEMA on load so a date like
 *   2026-09-22 stays a string, and the dump options story-complete.cjs used.
 * - When it does not resolve, the flat reader and writer below take over. They
 *   cover exactly what this flow writes into a brief or a story: top-level keys
 *   with a scalar, `null`, a boolean, or a one-level list in flow (`[a, b]`) or
 *   block (`- a`) style. Nothing in the schema is deeper than that.
 *
 * No network, no dependency of its own.
 */

const YAML = loadYamlModule();

/** Resolve js-yaml if the host project happens to have it, else null. */
function loadYamlModule() {
    try {
        // eslint-disable-next-line global-require
        return require('js-yaml');
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Fallback reader
// ---------------------------------------------------------------------------

/** Parse one unquoted or quoted YAML scalar into a JS value. */
function parseScalar(raw) {
    const text = String(raw).trim();
    if (text === '' || text === 'null' || text === '~') return null;
    if ((text.startsWith('"') && text.endsWith('"') && text.length > 1)
        || (text.startsWith("'") && text.endsWith("'") && text.length > 1)) {
        const inner = text.slice(1, -1);
        return text[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner.replace(/''/g, "'");
    }
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (/^-?\d+$/.test(text)) return Number(text);
    if (/^-?\d*\.\d+$/.test(text)) return Number(text);
    return text;
}

/** Split a flow list body (`a, "b", c`) into its items. */
function parseFlowList(body) {
    const items = [];
    let current = '';
    let quote = null;
    for (const ch of body) {
        if (quote) {
            current += ch;
            if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
            current += ch;
        } else if (ch === ',') {
            items.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    items.push(current);
    return items.map((i) => i.trim()).filter((i) => i !== '').map(parseScalar);
}

/** Read the flat frontmatter shapes this flow writes, without js-yaml. */
function parseFlat(block) {
    const result = {};
    const lines = block.split('\n');
    let currentKey = null;
    for (const line of lines) {
        if (line.trim() === '' || line.trim().startsWith('#')) continue;

        const item = line.match(/^\s+-\s*(.*)$/);
        if (item && currentKey !== null) {
            if (!Array.isArray(result[currentKey])) result[currentKey] = [];
            result[currentKey].push(parseScalar(item[1]));
            continue;
        }

        const entry = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
        if (!entry) continue;
        const [, key, rawValue] = entry;
        currentKey = key;
        const value = rawValue.trim();
        if (value === '') {
            // Either an empty value or the head of a block list; a following
            // `- item` line turns it into an array.
            result[key] = null;
        } else if (value.startsWith('[') && value.endsWith(']')) {
            result[key] = parseFlowList(value.slice(1, -1));
        } else {
            result[key] = parseScalar(value);
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// Fallback writer
// ---------------------------------------------------------------------------

/** True when a string needs quotes to survive a YAML round trip. */
function needsQuotes(text) {
    if (text === '') return true;
    if (text !== text.trim()) return true;
    if (typeof parseScalar(text) !== 'string') return true;
    return /[:#\[\]{},&*!|>'"%@`]/.test(text);
}

/** Render one scalar value. */
function dumpScalar(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'boolean' || typeof value === 'number') return String(value);
    const text = String(value);
    if (!needsQuotes(text)) return text;
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Render a flat frontmatter object, keeping key order. */
function dumpFlat(frontmatter) {
    return Object.entries(frontmatter).map(([key, value]) => {
        if (Array.isArray(value)) {
            return value.length === 0
                ? `${key}: []`
                : `${key}: [${value.map(dumpScalar).join(', ')}]`;
        }
        return `${key}: ${dumpScalar(value)}`;
    }).join('\n');
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/** Extract the YAML frontmatter block of a markdown file, or null. */
function extractFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]+?)\n---/);
    if (!match) return null;
    if (!YAML) return parseFlat(match[1]);
    try {
        return YAML.load(match[1], { schema: YAML.CORE_SCHEMA });
    } catch {
        return parseFlat(match[1]);
    }
}

/** Rewrite the frontmatter block, keeping key order and the body untouched. */
function updateFrontmatter(content, newFrontmatter) {
    const match = content.match(/^---\n([\s\S]+?)\n---/);
    if (!match) return null;
    const rendered = YAML
        ? YAML.dump(newFrontmatter, {
            lineWidth: -1,
            noRefs: true,
            quotingType: '"',
            forceQuotes: false,
            sortKeys: false
        }).trim()
        : dumpFlat(newFrontmatter);
    return `---\n${rendered}\n---${content.slice(match[0].length)}`;
}

/** ISO 8601 date, no time. The brief and story date fields use this. */
function getDate() {
    return new Date().toISOString().slice(0, 10);
}

module.exports = {
    extractFrontmatter,
    updateFrontmatter,
    getDate,
    yamlModuleAvailable: YAML !== null
};
