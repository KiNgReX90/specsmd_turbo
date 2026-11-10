#!/usr/bin/env node

/**
 * specsmd AI-DLC Turbo - leftovers of earlier work.
 *
 * Runs at the start of a new inception, from the project root. Names what
 * earlier work left in the project that a new inception should not build on:
 * - old AI-DLC work at the project root: the memory bank and the FIRE folder
 *   (OLD_PATHS below);
 * - every Turbo inception under docs/ whose intents are all done.
 *
 * Open Turbo work is named apart, with how to continue it, and is never
 * removed: an inception with an intent that is still draft (a record without
 * a brief counts as draft), approved or building, an inception with no intent
 * yet, and a done intent of the branch the user is on or one of its story
 * branches, which can still be finished again. repo/ and project/ are never
 * named.
 *
 * Report: one line per item, `leftover {id}: ...` or `open {id}: ...`, and
 * `No leftovers.` when there is none. The id is the path from the project
 * root, and --remove takes it back.
 *
 * --remove [id ...]: removes every leftover, or only the ids given. A tracked
 * path goes with `git rm -r`, what is left of it on disk after that is
 * deleted, local changes in it too. When anything tracked went, one local
 * commit holds only that removal (a pathspec commit, so other staged work
 * stays staged): `chore: remove leftovers of earlier AI-DLC work`. Never
 * pushed. Sandbox mode uses git as production does. No git repository:
 * removed from disk, no commit.
 * An id that is open work or no leftover is refused, and then nothing is
 * removed. The output says whether the commit goes along with the intent
 * branch: that branch is cut from the base branch after the approval.
 *
 * Usage:
 *   node .specsmd/aidlc-turbo/scripts/leftovers.cjs [--remove [id ...]] [--json] [--root .specs-aidlc-turbo]
 *
 * Exit codes: 0 done, also when there is nothing; 1 refused or failed; 2 usage.
 *
 * Node builtins only, plus ./lib/paths.cjs, ./intent-status.cjs and
 * ./story-start.cjs: the target project often has no node_modules at all.
 */

const fs = require('fs');
const path = require('path');
const paths = require('./lib/paths.cjs');
const { readBrief } = require('./intent-status.cjs');
const { readSettings, git, currentBranch } = require('./story-start.cjs');

const DEFAULT_ROOT = paths.ARTIFACT_DIR;
const MESSAGE = 'chore: remove leftovers of earlier AI-DLC work';
const INCEPTION = '/specsmd-aidlc-turbo-inception';
const CONSTRUCTION = '/specsmd-aidlc-turbo-construction';

/** Old AI-DLC work at the project root, in report order. */
const OLD_PATHS = [
    { id: 'memory-bank', what: 'old AI-DLC work' },
    { id: '.specs-fire', what: 'old FIRE work' },
];

/** Parse argv. Ids are only taken after --remove. */
function parseArgs(argv) {
    const out = { remove: false, ids: [], json: false, root: DEFAULT_ROOT };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--remove') out.remove = true;
        else if (arg === '--json') out.json = true;
        else if (arg === '--root') { out.root = argv[i + 1] || DEFAULT_ROOT; i += 1; }
        else if (arg === '--help' || arg === '-h') out.help = true;
        else if (arg.startsWith('--')) out.usage = `unknown option ${arg}`;
        else if (out.remove) out.ids.push(arg);
        else out.usage = `an id is only taken after --remove: ${arg}`;
    }
    return out;
}

/** A leading `./` or a trailing slash makes no difference to an id. */
function normalizeId(raw) {
    return String(raw).replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
}

const toId = (p) => p.split(path.sep).join('/');

/** Mode, git and branches: what decides how a removal is done and where its commit goes. */
function repoContext(root, cwd) {
    const settings = readSettings(path.resolve(cwd, root));
    const inGit = git(['rev-parse', '--is-inside-work-tree'], cwd).stdout === 'true';
    const branch = inGit ? currentBranch(cwd) || null : null;
    const base = settings.baseBranch || 'main';
    return { mode: settings.mode, git: inGit, branch, base_branch: base, on_base: inGit && branch === base };
}

function isTracked(ctx, id, cwd) {
    if (!ctx.git) return false;
    const r = git(['ls-files', '-z', '--', id], cwd);
    return r.ok && r.raw !== '';
}

/** True when the user is on this intent's branch or on one of its story branches. */
function onOwnBranch(intent, ctx) {
    if (!ctx.git || !ctx.branch || !intent.branch) return false;
    if (ctx.branch === intent.branch) return true;
    const cut = intent.branch.lastIndexOf('/');
    return cut > 0 && ctx.branch.startsWith(intent.branch.slice(0, cut + 1));
}

/** One Turbo inception: a leftover when it is finished, else open work with how to continue it. */
function classifyInception(root, inception, intents, ctx, cwd) {
    const id = toId(path.join(root, 'docs', inception));
    const shown = intents.map(({ slug, status }) => ({ slug, status }));
    const list = shown.map((i) => `${i.slug} ${i.status}`).join(', ');
    if (intents.length === 0) {
        return { open: { id, inception, intents: shown, list, label: 'Turbo inception started, no intent yet', continue: INCEPTION } };
    }
    const allDone = intents.every((i) => i.status === 'done');
    const own = intents.find((i) => i.status === 'done' && onOwnBranch(i, ctx));
    if (allDone && !own) {
        return {
            leftover: { id, kind: 'turbo', what: `finished Turbo inception (${list})`, tracked: isTracked(ctx, id, cwd), inception, intents: shown },
        };
    }
    if (allDone) {
        return { open: { id, inception, intents: shown, list, label: `Turbo inception of this branch (${list})`, continue: `${CONSTRUCTION} ${own.slug}` } };
    }
    const build = intents.find((i) => i.status === 'building') || intents.find((i) => i.status === 'approved');
    return {
        open: {
            id, inception, intents: shown, list,
            label: `Turbo inception still open (${list})`,
            continue: build ? `${CONSTRUCTION} ${build.slug}` : INCEPTION,
        },
    };
}

/** Every leftover and every piece of open Turbo work, in report order. */
function findLeftovers(root, ctx, cwd = process.cwd()) {
    const leftovers = [];
    const open = [];
    for (const old of OLD_PATHS) {
        if (fs.existsSync(path.resolve(cwd, old.id))) {
            leftovers.push({ id: old.id, kind: 'aidlc', what: old.what, tracked: isTracked(ctx, old.id, cwd) });
        }
    }
    const intents = paths.listIntents(path.resolve(cwd, root)).map((i) => {
        const brief = readBrief(i);
        return {
            inception: i.inception,
            slug: i.slug,
            status: brief.status === 'missing' ? 'draft' : brief.status,
            branch: brief.frontmatter.branch ? String(brief.frontmatter.branch) : null,
        };
    });
    for (const inception of paths.listInceptions(path.resolve(cwd, root))) {
        const found = classifyInception(root, inception, intents.filter((i) => i.inception === inception), ctx, cwd);
        if (found.leftover) leftovers.push(found.leftover);
        else open.push(found.open);
    }
    return { leftovers, open };
}

const gitSuffix = (ctx, tracked) => {
    if (!ctx.git) return '';
    return tracked ? ', in git' : ', not in git';
};

function reportLines(found, ctx) {
    return [
        ...found.leftovers.map((l) => `leftover ${l.id}: ${l.what}${gitSuffix(ctx, l.tracked)}`),
        ...found.open.map((o) => `open ${o.id}: ${o.label}, continue with ${o.continue}`),
    ];
}

/** The report, as --json prints it. */
function report(root, cwd = process.cwd()) {
    const ctx = repoContext(root, cwd);
    const found = findLeftovers(root, ctx, cwd);
    return {
        leftovers: found.leftovers,
        open: found.open.map(({ list, label, ...rest }) => rest),
        ...ctx,
        lines: reportLines(found, ctx),
    };
}

/** Pick the leftovers to remove; any id that is open work or no leftover refuses the whole run. */
function choose(found, ids) {
    if (ids.length === 0) return { chosen: found.leftovers };
    const wanted = new Set(ids.map(normalizeId));
    const refused = [];
    for (const id of wanted) {
        const open = found.open.find((o) => o.id === id);
        if (open) refused.push(`${id} is open Turbo work (${open.list || 'no intent yet'}), never removed: continue with ${open.continue}`);
        else if (!found.leftovers.some((l) => l.id === id)) refused.push(`not a leftover: ${id}`);
    }
    if (refused.length) return { refused };
    return { chosen: found.leftovers.filter((l) => wanted.has(l.id)) };
}

/** Commit the tracked removals, and only them. Returns { commit } or { note } or { error }. */
function commitRemoval(ctx, removed, cwd) {
    if (!ctx.git) return { note: 'not a git repository' };
    const tracked = removed.filter((r) => r.tracked).map((r) => r.id);
    if (tracked.length === 0) return { note: 'nothing removed was in git' };
    const staged = git(['diff', '--cached', '--name-only', 'HEAD', '--', ...tracked], cwd);
    if (!staged.ok || !staged.stdout) return { note: 'nothing removed was in a commit yet' };
    const c = git(['commit', '-q', '-m', MESSAGE, '--', ...tracked], cwd);
    if (!c.ok) return { error: `the commit failed, the removal stays staged: ${c.out}` };
    return { commit: { sha: git(['rev-parse', '--short', 'HEAD'], cwd).stdout, branch: ctx.branch, message: MESSAGE } };
}

function removeLines(ctx, removed, done) {
    const out = removed.map((r) => `removed ${r.id}${gitSuffix(ctx, r.tracked)}`);
    if (done.commit) {
        const { sha, branch } = done.commit;
        out.push(`commit ${sha} on ${branch}, not pushed: ${MESSAGE}`);
        out.push(ctx.on_base
            ? `${branch} is the base branch: the intent branch is cut from it, so this commit goes along`
            : `the base branch is ${ctx.base_branch}, not ${branch}: this commit stays on ${branch} until you push or merge it`);
    } else {
        out.push(`no commit: ${done.note}`);
    }
    return out;
}

/** --remove: returns the JSON --json prints, or { error } with what was removed so far. */
function removeLeftovers(root, ids = [], cwd = process.cwd()) {
    const ctx = repoContext(root, cwd);
    const found = findLeftovers(root, ctx, cwd);
    const { chosen, refused } = choose(found, ids);
    if (refused) return { error: refused.join('\n'), refused, removed: [] };
    if (chosen.length === 0) return { ...ctx, removed: [], commit: null, note: 'nothing to remove', lines: [] };

    const removed = [];
    for (const l of chosen) {
        if (ctx.git && l.tracked) {
            const r = git(['rm', '-r', '-q', '-f', '--', l.id], cwd);
            if (!r.ok) return { error: `git rm failed on ${l.id}: ${r.out}`, removed };
        }
        fs.rmSync(path.resolve(cwd, l.id), { recursive: true, force: true });
        removed.push({ id: l.id, tracked: l.tracked });
    }
    const done = commitRemoval(ctx, removed, cwd);
    if (done.error) return { error: done.error, removed };
    return { ...ctx, removed, commit: done.commit || null, note: done.note || null, lines: removeLines(ctx, removed, done) };
}

function main(options) {
    if (options.usage) {
        console.error(`Error: ${options.usage}`);
        console.error('Usage: node leftovers.cjs [--remove [id ...]] [--json] [--root <dir>]');
        return 2;
    }
    if (paths.isLegacy(options.root)) {
        console.error(`Error: ${paths.legacyMessage(options.root)}`);
        return 1;
    }
    const out = options.remove ? removeLeftovers(options.root, options.ids) : report(options.root);
    if (out.error) {
        if (options.json) console.log(JSON.stringify(out, null, 2));
        else {
            out.error.split('\n').forEach((line) => console.error(`Error: ${line}`));
            console.error(out.removed.length ? `Removed before the stop: ${out.removed.map((r) => r.id).join(', ')}` : 'Nothing was removed.');
        }
        return 1;
    }
    if (options.json) console.log(JSON.stringify(out, null, 2));
    else if (out.lines.length) console.log(out.lines.join('\n'));
    else console.log(options.remove ? 'Nothing to remove.' : 'No leftovers.');
    return 0;
}

module.exports = {
    OLD_PATHS,
    MESSAGE,
    normalizeId,
    findLeftovers,
    report,
    removeLeftovers,
};

if (require.main === module) {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        console.log(`
Usage: node leftovers.cjs [options]

Names the leftovers of earlier work, and the open Turbo work, one line each.

Options:
  --remove [id ...]   Remove every leftover, or only these ids. One local commit, never pushed
  --json              Print one JSON object
  --root <dir>        Artifact root, default ${DEFAULT_ROOT}
  --help, -h          Show this message
`);
        process.exit(0);
    }
    try {
        process.exitCode = main(options);
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exitCode = 1;
    }
}
