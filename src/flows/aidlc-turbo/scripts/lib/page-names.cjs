#!/usr/bin/env node

/**
 * specsmd AI-DLC Turbo - the names the Confluence sync looks for and gives.
 *
 * Every name is a template. `{name}` is the inception's or the intent's name,
 * `{slug}` the intent's folder name. A project sets its own under
 * `sync.page_names` in .specs-aidlc-turbo/repo/config.yaml; a key it leaves
 * out keeps the default:
 *
 *   intent            "{name} - Documentation"  an inception's or an intent's page
 *   stories           "{name} - Stories"        the page the story pages hang under
 *   project           "Project Documentation"   the shared project page
 *   overview_section  "Interactive overview"    the section on the intent page that links the overview files
 *   overview_file     "overview-{slug}.html"    the intent's overview page, as attached
 *
 * Usage, to print the names a project uses as JSON:
 *   node .specsmd/aidlc-turbo/scripts/lib/page-names.cjs [--root .specs-aidlc-turbo]
 *
 * Node builtins only, plus ./paths.cjs and ./yaml-subset.cjs.
 */

const fs = require('fs');
const paths = require('./paths.cjs');
const { parseYaml } = require('./yaml-subset.cjs');

const DEFAULTS = Object.freeze({
    intent: '{name} - Documentation',
    stories: '{name} - Stories',
    project: 'Project Documentation',
    overview_section: 'Interactive overview',
    overview_file: 'overview-{slug}.html',
});

const isMap = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * The names of the project under `root`: the defaults, each overridden by a
 * non-empty text under `sync.page_names` of the config. Never throws: a
 * missing or unreadable config gives the defaults.
 */
function pageNames(root = paths.ARTIFACT_DIR) {
    let config = null;
    try {
        config = parseYaml(fs.readFileSync(paths.layout(root).config, 'utf8'));
    } catch {
        config = null;
    }
    const own = isMap(config) && isMap(config.sync) && isMap(config.sync.page_names) ? config.sync.page_names : {};
    const out = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
        if (typeof own[key] === 'string' && own[key].trim()) out[key] = own[key].trim();
    }
    return out;
}

/** The template with `{name}` and `{slug}` filled from vars; a placeholder without a value stays. */
function fill(template, vars = {}) {
    return String(template).replace(/\{(name|slug)\}/g, (m, key) => (vars[key] === undefined || vars[key] === null ? m : String(vars[key])));
}

const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The `{name}` part of a title made from the template, trimmed, or null when
 * the title does not fit it. A template without `{name}` gives '' for a title
 * equal to it. Case and runs of spaces in the fixed part do not count.
 */
function nameFrom(template, title) {
    const t = String(title ?? '').replace(/\s+/g, ' ').trim();
    const parts = String(template).replace(/\s+/g, ' ').trim().split('{name}');
    if (parts.length > 2) return null;
    const fixed = parts.map((p) => escape(fill(p, {})).replace(/ /g, '\\s*'));
    const m = new RegExp(`^${fixed.join('(.+?)')}$`, 'i').exec(t);
    if (!m) return null;
    return parts.length === 1 ? '' : m[1].trim() || null;
}

function main(argv, print = (text) => process.stdout.write(`${text}\n`)) {
    const args = argv.slice();
    const at = args.indexOf('--root');
    const root = at >= 0 ? args.splice(at, 2)[1] : paths.ARTIFACT_DIR;
    if (args.length || !root) {
        print('usage: page-names.cjs [--root .specs-aidlc-turbo]');
        return 2;
    }
    print(JSON.stringify(pageNames(root)));
    return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { DEFAULTS, pageNames, fill, nameFrom, main };
