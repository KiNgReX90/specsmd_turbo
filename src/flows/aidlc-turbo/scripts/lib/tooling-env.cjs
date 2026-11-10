/**
 * specsmd AI-DLC Turbo - what this machine has for the code tooling.
 *
 * Two questions, and nothing is ever run to answer them:
 * - is a program on the PATH (a plain file lookup, PATHEXT on Windows)
 * - is a Claude Code plugin installed, and not switched off
 *
 * The Claude Code config folder is CLAUDE_CONFIG_DIR, else ~/.claude. Its
 * plugins/installed_plugins.json lists the installed plugins, its
 * plugins/marketplaces/<name>/.claude-plugin/marketplace.json the plugins a
 * marketplace offers, and enabledPlugins in the user, project and local
 * settings switches a plugin on or off (local wins, then project, then user).
 *
 * Node builtins only: the target project often has no node_modules at all.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

function claudeDir(env = process.env) {
    return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

/** True when `program` is an executable file on the PATH. A path with a slash is looked up as is. */
function onPath(program, env = process.env, platform = process.platform) {
    if (!program) return false;
    const exts = platform === 'win32'
        ? ['', ...String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)]
        : [''];
    const isFile = (p) => {
        try {
            const st = fs.statSync(p);
            if (!st.isFile()) return false;
            if (platform === 'win32') return true;
            fs.accessSync(p, fs.constants.X_OK);
            return true;
        } catch {
            return false;
        }
    };
    if (/[\\/]/.test(program)) return exts.some((e) => isFile(program + e));
    const dirs = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
    return dirs.some((d) => exts.some((e) => isFile(path.join(d, program + e))));
}

/** The installed plugin ids (`name@marketplace`). */
function installedPlugins(env = process.env) {
    const data = readJson(path.join(claudeDir(env), 'plugins', 'installed_plugins.json'));
    return new Set(Object.keys((data && data.plugins) || {}));
}

/** enabledPlugins of one settings file, or {}. */
function enabledIn(file) {
    const data = readJson(file);
    return (data && typeof data.enabledPlugins === 'object' && data.enabledPlugins) || {};
}

/**
 * The state of one plugin: `on`, `not installed` or `switched off`.
 * Local settings win over project settings, project over user.
 */
function pluginState(plugin, projectRoot, env = process.env) {
    if (!installedPlugins(env).has(plugin)) return 'not installed';
    const scopes = [
        path.join(projectRoot, '.claude', 'settings.local.json'),
        path.join(projectRoot, '.claude', 'settings.json'),
        path.join(claudeDir(env), 'settings.json'),
    ];
    for (const file of scopes) {
        const enabled = enabledIn(file);
        if (Object.prototype.hasOwnProperty.call(enabled, plugin)) {
            return enabled[plugin] === false ? 'switched off' : 'on';
        }
    }
    return 'on';
}

/**
 * Every plugin a known marketplace offers that brings a language server:
 * [{ plugin, description, servers: [{ command, extensions }] }].
 * A plugin whose servers live in its own .lsp.json (not in the catalogue) is
 * left out: the catalogue alone cannot say what it needs.
 */
function languageServerPlugins(env = process.env) {
    const root = path.join(claudeDir(env), 'plugins', 'marketplaces');
    let names;
    try {
        names = fs.readdirSync(root);
    } catch {
        return [];
    }
    const out = [];
    for (const dir of names.sort()) {
        const manifest = readJson(path.join(root, dir, '.claude-plugin', 'marketplace.json'));
        if (!manifest || !Array.isArray(manifest.plugins)) continue;
        const market = manifest.name || dir;
        for (const p of manifest.plugins) {
            if (!p || typeof p.lspServers !== 'object' || p.lspServers === null) continue;
            const servers = Object.values(p.lspServers)
                .filter((s) => s && typeof s.command === 'string')
                .map((s) => ({
                    command: s.command,
                    extensions: Object.keys(s.extensionToLanguage || {}).map((e) => e.toLowerCase()),
                }));
            if (servers.length === 0) continue;
            out.push({ plugin: `${p.name}@${market}`, description: p.description || '', servers });
        }
    }
    return out;
}

module.exports = { claudeDir, onPath, installedPlugins, pluginState, languageServerPlugins };
