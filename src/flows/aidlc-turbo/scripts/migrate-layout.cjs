#!/usr/bin/env node

/**
 * specsmd AI-DLC Turbo - move an artifact root to the repo/, project/, docs/ layout.
 *
 * Before the layout of ./lib/paths.cjs, everything sat at the top of the
 * artifact root. This moves it, once:
 *
 *   config.yaml                   -> repo/config.yaml
 *   project.yaml                  -> codebase and live_test into repo/repo.yaml,
 *                                    the rest into project/project.yaml, plus
 *                                    jira_project_url from the config's sync block
 *   standards/                    -> repo/standards/
 *   project-docs/                 -> project/pages/
 *   digests/                      -> project/digests/
 *   intents/{slug}/docs/          -> docs/{slug}/pages/
 *   intents/{slug}/sync.yaml      -> docs/{slug}/sync.yaml (its page paths rewritten)
 *   intents/{slug}/*              -> docs/{slug}/{slug}/
 *   tests/{slug}/                 -> docs/{slug}/{slug}/tests/
 *
 * Every old intent becomes an inception of its own, with the same slug.
 * Dry run by default: it prints what it would move. --write moves it.
 * Never overwrites: a destination that already exists is left alone, and the
 * source stays where it is. Running it again on a moved root does nothing.
 *
 * Usage:
 *   node .specsmd/aidlc-turbo/scripts/migrate-layout.cjs [--write] [--json] [--root .specs-aidlc-turbo]
 *
 * Exit 0 when everything moved (or would move), 1 when something could not,
 * 2 on a usage error.
 *
 * Node builtins only, plus ./lib/paths.cjs: the target project often has no
 * node_modules at all.
 */

const fs = require('fs');
const path = require('path');
const { ARTIFACT_DIR, layout, isReservedSlug } = require('./lib/paths.cjs');

const REPO_KEYS = new Set(['codebase', 'live_test']);

function exists(p) {
    return fs.existsSync(p);
}

function isDir(p) {
    try {
        return fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
}

function entries(dir) {
    try {
        return fs.readdirSync(dir).sort();
    } catch {
        return [];
    }
}

// ---------------------------------------------------------------------------
// Pure text helpers
// ---------------------------------------------------------------------------

/**
 * Split YAML text into its top-level blocks: a key line plus everything
 * indented under it. Comment and blank lines go with the key that follows.
 */
function topLevelBlocks(text) {
    const blocks = [];
    let pending = [];
    let current = null;
    for (const line of text.replace(/\s+$/, '').split('\n')) {
        const key = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):/);
        if (key) {
            current = { key: key[1], lines: [...pending, line] };
            pending = [];
            blocks.push(current);
        } else if (/^\s*(#.*)?$/.test(line) && !/^\s+#/.test(line)) {
            pending.push(line);
        } else if (current) {
            current.lines.push(...pending, line);
            pending = [];
        }
    }
    return blocks;
}

function joinBlocks(blocks) {
    const text = blocks.map((b) => b.lines.join('\n')).join('\n').replace(/^\s+/, '').replace(/\s+$/, '');
    return text ? `${text}\n` : '';
}

/**
 * Split an old project.yaml. `codebase` and `live_test` describe the repo and
 * go to repo/repo.yaml; everything else describes the project.
 */
function splitProjectYaml(text) {
    const blocks = topLevelBlocks(text);
    return {
        repo: joinBlocks(blocks.filter((b) => REPO_KEYS.has(b.key))),
        project: joinBlocks(blocks.filter((b) => !REPO_KEYS.has(b.key))),
    };
}

/** The `sync.jira_project_url` of a config file, or '' when there is none. */
function readSyncJiraUrl(configText) {
    const sync = topLevelBlocks(configText || '').find((b) => b.key === 'sync');
    if (!sync) return '';
    for (const line of sync.lines) {
        const m = line.match(/^\s+jira_project_url:\s*(.*?)\s*(#.*)?$/);
        if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    }
    return '';
}

/** Add `jira_project_url` to project.yaml text unless it already has one. */
function withJiraUrl(projectText, url) {
    if (!url || /^jira_project_url:/m.test(projectText)) return projectText;
    return `${projectText}jira_project_url: "${url.replace(/"/g, '\\"')}"\n`;
}

/**
 * Rewrite the page paths inside a moved sync.yaml. Paths in it are relative
 * to the artifact root, so they follow the files they point at.
 */
function rewriteSyncPaths(text, slug) {
    const at = (from, to) => (s) => s.replace(new RegExp(`(^|[\\s"'\\[,])${from}`, 'gm'), `$1${to}`);
    const esc = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [
        at(`intents/${esc}/docs/`, `docs/${slug}/pages/`),
        at(`intents/${esc}/`, `docs/${slug}/${slug}/`),
        at(`tests/${esc}/`, `docs/${slug}/${slug}/tests/`),
        at('project-docs/', 'project/pages/'),
    ].reduce((acc, fn) => fn(acc), text);
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/**
 * Plan a move of `from` to `to`. A destination that does not exist takes the
 * whole source. Two folders merge, child by child. Anything else that already
 * exists is a conflict: it is never overwritten.
 */
function planMove(from, to, ops, conflicts) {
    if (!exists(from)) return;
    if (!exists(to)) {
        ops.push({ op: 'move', from, to });
    } else if (isDir(from) && isDir(to)) {
        for (const name of entries(from)) planMove(path.join(from, name), path.join(to, name), ops, conflicts);
        ops.push({ op: 'prune', from });
    } else {
        conflicts.push({ from, to, reason: 'destination exists' });
    }
}

/** Every step the migration of `root` takes, and what it cannot do. */
function planMigration(root = ARTIFACT_DIR) {
    const L = layout(root);
    const ops = [];
    const conflicts = [];
    const old = (name) => path.join(root, name);

    planMove(old('config.yaml'), L.config, ops, conflicts);

    if (exists(old('project.yaml'))) {
        const configFile = exists(old('config.yaml')) ? old('config.yaml') : L.config;
        const configText = exists(configFile) ? fs.readFileSync(configFile, 'utf8') : '';
        const parts = splitProjectYaml(fs.readFileSync(old('project.yaml'), 'utf8'));
        const project = withJiraUrl(parts.project, readSyncJiraUrl(configText));
        const blocked = [];
        if (parts.repo && exists(L.repoYaml)) blocked.push(L.repoYaml);
        if (project && exists(L.projectYaml)) blocked.push(L.projectYaml);
        if (blocked.length > 0) {
            for (const to of blocked) conflicts.push({ from: old('project.yaml'), to, reason: 'destination exists' });
        } else {
            ops.push({ op: 'split', from: old('project.yaml'), repo: parts.repo, project, toRepo: L.repoYaml, toProject: L.projectYaml });
        }
    }

    planMove(old('standards'), L.standards, ops, conflicts);
    planMove(old('project-docs'), L.projectPages, ops, conflicts);
    planMove(old('digests'), L.digests, ops, conflicts);

    const intentsDir = old('intents');
    for (const slug of entries(intentsDir)) {
        const from = path.join(intentsDir, slug);
        if (!isDir(from)) continue;
        if (isReservedSlug(slug)) {
            conflicts.push({ from, to: null, reason: `"${slug}" is a folder name of the layout, rename the intent first` });
            continue;
        }
        const inception = L.inception(slug);
        const intent = L.intent(slug, slug);
        for (const name of entries(from)) {
            const src = path.join(from, name);
            if (name === 'docs') planMove(src, inception.pages, ops, conflicts);
            else if (name === 'sync.yaml') {
                const before = conflicts.length;
                planMove(src, inception.sync, ops, conflicts);
                if (conflicts.length === before) ops.push({ op: 'rewrite', file: inception.sync, slug });
            } else planMove(src, path.join(intent.dir, name), ops, conflicts);
        }
        ops.push({ op: 'prune', from });
    }
    if (exists(intentsDir)) ops.push({ op: 'prune', from: intentsDir });

    const testsDir = old('tests');
    for (const slug of entries(testsDir)) {
        const from = path.join(testsDir, slug);
        if (!isDir(from)) continue;
        if (isReservedSlug(slug)) {
            conflicts.push({ from, to: null, reason: `"${slug}" is a folder name of the layout, rename the intent first` });
            continue;
        }
        const target = L.intent(slug, slug);
        planMove(from, target.tests, ops, conflicts);
    }
    if (exists(testsDir)) ops.push({ op: 'prune', from: testsDir });

    return { root, ops, conflicts };
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/** Remove a folder when it is empty, and say whether it went. */
function pruneEmpty(dir) {
    if (!isDir(dir)) return false;
    for (const name of entries(dir)) pruneEmpty(path.join(dir, name));
    if (entries(dir).length > 0) return false;
    fs.rmdirSync(dir);
    return true;
}

/** Carry out a plan. Returns what was left behind (folders that are not empty). */
function applyMigration(plan) {
    const left = [];
    for (const step of plan.ops) {
        if (step.op === 'move') {
            fs.mkdirSync(path.dirname(step.to), { recursive: true });
            fs.renameSync(step.from, step.to);
        } else if (step.op === 'split') {
            if (step.repo) {
                fs.mkdirSync(path.dirname(step.toRepo), { recursive: true });
                fs.writeFileSync(step.toRepo, step.repo, 'utf8');
            }
            if (step.project) {
                fs.mkdirSync(path.dirname(step.toProject), { recursive: true });
                fs.writeFileSync(step.toProject, step.project, 'utf8');
            }
            fs.unlinkSync(step.from);
        } else if (step.op === 'rewrite') {
            const text = fs.readFileSync(step.file, 'utf8');
            const next = rewriteSyncPaths(text, step.slug);
            if (next !== text) fs.writeFileSync(step.file, next, 'utf8');
        } else if (step.op === 'prune') {
            if (!pruneEmpty(step.from) && exists(step.from)) left.push(step.from);
        }
    }
    const conflicted = new Set(plan.conflicts.map((c) => c.from));
    return left.filter((dir) => ![...conflicted].some((f) => f === dir || f.startsWith(dir + path.sep)));
}

/** Plan, and with `write` apply, the migration of `root`. */
function migrate(root = ARTIFACT_DIR, { write = false } = {}) {
    const plan = planMigration(root);
    const left = write ? applyMigration(plan) : [];
    return { ...plan, written: write, left };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function describe(result) {
    const rel = (p) => path.relative(result.root, p) || '.';
    const lines = [];
    for (const step of result.ops) {
        if (step.op === 'move') lines.push(`move     ${rel(step.from)} -> ${rel(step.to)}`);
        else if (step.op === 'split') {
            const to = [step.repo && rel(step.toRepo), step.project && rel(step.toProject)].filter(Boolean);
            lines.push(`split    ${rel(step.from)} -> ${to.join(' + ') || '(empty, removed)'}`);
        } else if (step.op === 'rewrite') lines.push(`rewrite  page paths in ${rel(step.file)}`);
    }
    for (const c of result.conflicts) {
        lines.push(`kept     ${rel(c.from)}${c.to ? ` (${rel(c.to)} ${c.reason})` : ` (${c.reason})`}`);
    }
    for (const dir of result.left) lines.push(`kept     ${rel(dir)} (not empty after the move)`);
    const moved = result.ops.some((s) => s.op !== 'prune');
    if (!moved && result.conflicts.length === 0 && result.left.length === 0) {
        lines.push(`${result.root} already has the new layout. Nothing to move.`);
    }
    if (moved && !result.written) lines.push('Dry run, nothing moved. Run again with --write to move.');
    return lines.join('\n');
}

function parseArgs(argv) {
    const out = { root: ARTIFACT_DIR, write: false, json: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--write') out.write = true;
        else if (arg === '--json') out.json = true;
        else if (arg === '--root') {
            if (!argv[i + 1]) return { error: '--root needs a folder' };
            out.root = argv[i + 1];
            i += 1;
        } else if (arg === '--help' || arg === '-h') out.help = true;
        else return { error: `unknown argument: ${arg}` };
    }
    return out;
}

function main(argv) {
    const opts = parseArgs(argv);
    if (opts.error || opts.help) {
        const usage = 'Usage: node migrate-layout.cjs [--write] [--json] [--root .specs-aidlc-turbo]';
        if (opts.error) {
            console.error(`migrate-layout: ${opts.error}\n${usage}`);
            return 2;
        }
        console.log(usage);
        return 0;
    }
    if (!isDir(opts.root)) {
        console.error(`migrate-layout: no artifact root at ${opts.root}`);
        return 1;
    }
    const result = migrate(opts.root, { write: opts.write });
    if (opts.json) {
        const rel = (p) => (p ? path.relative(result.root, p) : p);
        console.log(JSON.stringify({
            written: result.written,
            moves: result.ops.filter((s) => s.op === 'move').map((s) => ({ from: rel(s.from), to: rel(s.to) })),
            splits: result.ops.filter((s) => s.op === 'split').map((s) => rel(s.from)),
            rewrites: result.ops.filter((s) => s.op === 'rewrite').map((s) => rel(s.file)),
            kept: [...result.conflicts.map((c) => rel(c.from)), ...result.left.map(rel)],
        }, null, 2));
    } else {
        console.log(describe(result));
    }
    return result.conflicts.length > 0 || result.left.length > 0 ? 1 : 0;
}

if (require.main === module) {
    process.exit(main(process.argv.slice(2)));
}

module.exports = {
    splitProjectYaml,
    readSyncJiraUrl,
    rewriteSyncPaths,
    planMigration,
    applyMigration,
    migrate,
    describe,
    main,
};
