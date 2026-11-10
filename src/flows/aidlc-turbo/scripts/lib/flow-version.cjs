/**
 * specsmd AI-DLC Turbo - the version of the flow that runs.
 *
 * An intent keeps the version its inception was approved with, as
 * `turbo_version` in the brief frontmatter (skills/inception/review.md step 5).
 * Construction compares it with this one and names a difference before it
 * builds: a later version draws the overview and the pages its own way.
 *
 * flowVersion(flowRoot) reads it next to the flow's own folder (the one that
 * holds scripts/, skills/ and agents/), the first that answers:
 *
 *   ../.claude-plugin/plugin.json   a Claude Code plugin, its version
 *   ../manifest.yaml                an install by the specsmd installer
 *   ../../package.json              the source tree, only when it is specsmd
 *
 * null when none does. Node builtins only.
 */

const fs = require('fs');
const path = require('path');

const FLOW_ROOT = path.resolve(__dirname, '..', '..');

const filled = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

function manifestVersion(file) {
    try {
        const m = fs.readFileSync(file, 'utf8').match(/^version:\s*['"]?([^'"\s#]+)/m);
        return m ? m[1] : null;
    } catch {
        return null;
    }
}

/** The version of the flow in flowRoot, by default the one this file belongs to; null when none is found. */
function flowVersion(flowRoot = FLOW_ROOT) {
    const plugin = readJson(path.join(flowRoot, '..', '.claude-plugin', 'plugin.json'));
    if (plugin && filled(plugin.version)) return filled(plugin.version);
    const installed = manifestVersion(path.join(flowRoot, '..', 'manifest.yaml'));
    if (installed) return installed;
    const source = readJson(path.join(flowRoot, '..', '..', 'package.json'));
    return source && source.name === 'specsmd' ? filled(source.version) : null;
}

module.exports = { flowVersion, FLOW_ROOT };
