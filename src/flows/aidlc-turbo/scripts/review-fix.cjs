#!/usr/bin/env node

/**
 * specsmd AI-DLC Turbo - process the review comments on a done intent.
 *
 * The review fix agent (agents/review-fix-agent.md) runs it for an intent
 * whose brief is `done` and whose merge requests are open. Five commands:
 *
 *   where    which intent, and which story, the project tree's branch belongs
 *            to: the intent branch, or a story branch (the intent branch with
 *            its last part swapped for `story-{SSS}-{slug}`, or the story's
 *            recorded `branch`). On any other branch: `candidates`, every done
 *            intent with a merge request.
 *   threads  the open review threads of the intent's merge requests (the
 *            brief's `merge_request` and every story's), each with its story:
 *            the story of its merge request, or on the intent's merge request
 *            the one story whose changed_files or touches hold the file it is
 *            on. More than one: `story` null and `candidates`. --story keeps
 *            the threads of that story only. A merge request that is merged
 *            or closed brings none, and says its `state`.
 *   open     a worktree for one story's fix. Story branches on: on the story's
 *            own branch, first brought up to the remote's version of it (a
 *            fast-forward; a branch that went apart from the remote is a stop),
 *            at `{project root}/../{project folder}-turbo/{intent}/review-fix-{SSS}`.
 *            Story branches off: the project tree itself, which must be clean
 *            outside the artifact root.
 *   land     after the fix passed its verification and its delta review:
 *            commit the fix files as `fix({intent}): {message} (S{SSS})`, merge
 *            the fixed branch into every story branch that builds on it, in
 *            build order, remove the worktree, then on the intent branch add
 *            the fix files to the story's changed_files, mark the test cases
 *            the fix may have changed (`twin_result: outdated`) and commit the
 *            story file, its proof and those test cases as
 *            `docs({intent}): review fix S{SSS}`. Nothing is pushed.
 *   reply    one reply in one thread, ending in an invisible marker so the
 *            next run knows the thread waits for the reviewer.
 *
 * The impact of a fix: it is small when every fix file belongs to this story
 * alone and none is a test file. Otherwise the test cases of this story and of
 * every story whose changed_files or touches share a fix file are no longer
 * proven: their twins ran on the code before the fix. The navigator then
 * suggests Finish again before the merge.
 *
 * Usage:
 *   node .specsmd/aidlc-turbo/scripts/review-fix.cjs where
 *   node .specsmd/aidlc-turbo/scripts/review-fix.cjs threads <intent-slug> [--story SSS]
 *   node .specsmd/aidlc-turbo/scripts/review-fix.cjs open <intent-slug> <SSS>
 *   node .specsmd/aidlc-turbo/scripts/review-fix.cjs land <intent-slug> <SSS> --fix-files a,b --message "<what was wrong>"
 *   node .specsmd/aidlc-turbo/scripts/review-fix.cjs reply --url <merge request link> --discussion <id> --body-file <file>
 * Every command takes [--root .specs-aidlc-turbo] and prints one JSON object.
 * Exit 0 on success, 1 on a stop, 2 on a usage error.
 *
 * Node builtins only, plus the scripts beside it: the target project often
 * has no node_modules at all.
 */

const fs = require('fs');
const path = require('path');
const paths = require('./lib/paths.cjs');
const { extractFrontmatter, updateFrontmatter } = require('./frontmatter.cjs');
const {
    DEFAULT_ROOT, normId, resolveIntent, readStories, findStory, readBrief, buildOrder, branchPlan,
} = require('./intent-status.cjs');
const { readSettings, git, storyBranch, artifactPrefix, currentBranch, branchExists, listWorktrees } = require('./story-start.cjs');
const { diffSha, playwrightDir } = require('./story-verify.cjs');
const { fileList, stagedSet } = require('./story-land.cjs');
const { isTestFile } = require('./lib/test-files.cjs');
const { envLookup } = require('./confluence-attach.cjs');
const { fetchThreads, replyThread } = require('./lib/mr-threads.cjs');

const NO_TOKEN = 'no GITLAB_TOKEN in the environment, the project .env or ~/.claude/.env';
const OUTDATED = 'outdated';
const TWIN_DIR = 'aidlc-twins';
const USAGE = 'Usage: review-fix.cjs where | threads <intent> [--story SSS] | open <intent> <SSS> '
    + '| land <intent> <SSS> --fix-files a,b --message "<text>" | reply --url <link> --discussion <id> --body-file <file>';

/** argv into { cmd, positional, flags }, or { error }. Pure. */
function parseArgs(argv) {
    const [cmd, ...rest] = argv;
    if (cmd === '--help' || cmd === '-h') return { help: true };
    if (!['where', 'threads', 'open', 'land', 'reply'].includes(cmd)) return { error: `unknown command ${JSON.stringify(cmd || '')}` };
    const out = { cmd, positional: [], root: DEFAULT_ROOT };
    const flags = { '--story': 'story', '--fix-files': 'fixFiles', '--message': 'message', '--url': 'url', '--discussion': 'discussion', '--body-file': 'bodyFile', '--root': 'root' };
    for (let i = 0; i < rest.length; i += 1) {
        if (flags[rest[i]]) { out[flags[rest[i]]] = rest[i + 1] ?? ''; i += 1; }
        else if (rest[i].startsWith('--')) return { error: `unknown flag ${rest[i]}` };
        else out.positional.push(rest[i]);
    }
    const need = { threads: 1, open: 2, land: 2 }[cmd] || 0;
    if (out.positional.length < need) return { error: `${cmd} needs ${need === 1 ? '<intent-slug>' : '<intent-slug> <SSS>'}` };
    if (cmd === 'land' && (!out.fixFiles || !String(out.message || '').trim())) return { error: 'land needs --fix-files and --message' };
    if (cmd === 'reply' && (!out.url || !out.discussion || !out.bodyFile)) return { error: 'reply needs --url, --discussion and --body-file' };
    return out;
}

/** The stories whose changed_files, else touches, hold `file`. Pure. */
function ownersOf(stories, file) {
    if (!file) return [];
    const changed = stories.filter((s) => s.changed_files.includes(file)).map((s) => s.id);
    return changed.length ? changed : stories.filter((s) => s.touches.includes(file)).map((s) => s.id);
}

/** Small, or the stories whose test cases the fix may have changed. Pure. */
function impact({ stories, storyId, fixFiles, pwDir = null }) {
    const files = fileList(fixFiles);
    const shared = stories.filter((s) => s.id !== storyId
        && files.some((f) => s.changed_files.includes(f) || s.touches.includes(f))).map((s) => s.id);
    const tests = files.filter((f) => isTestFile(f, pwDir));
    const small = !shared.length && !tests.length;
    return { small, affected: small ? [] : [storyId, ...shared], shared, tests };
}

/** Intent, brief, stories and settings, or { error }. */
function load(root, cwd, intentSlug) {
    const absRoot = path.resolve(cwd, root);
    const { intent, error } = resolveIntent(absRoot, intentSlug);
    if (error) return { error };
    const brief = readBrief(intent);
    return { absRoot, intent, brief, stories: readStories(intent), settings: readSettings(absRoot, brief.frontmatter) };
}

function where({ root = DEFAULT_ROOT, cwd = process.cwd() } = {}) {
    const absRoot = path.resolve(cwd, root);
    if (paths.isLegacy(absRoot)) return { error: paths.legacyMessage(absRoot) };
    const branch = currentBranch(cwd);
    const candidates = [];
    for (const intent of paths.listIntents(absRoot)) {
        const brief = readBrief(intent);
        const intentBranch = brief.frontmatter.branch ? String(brief.frontmatter.branch) : null;
        if (!intentBranch) continue;
        const found = { intent: intent.slug, branch, intent_branch: intentBranch, brief_status: brief.status };
        if (branch === intentBranch) return { ...found, story: null };
        const story = readStories(intent).find((s) => s.branch === branch || storyBranch(intentBranch, s) === branch);
        if (story) return { ...found, story: story.id };
        if (brief.status === 'done' && brief.frontmatter.merge_request) {
            candidates.push({ intent: intent.slug, title: brief.frontmatter.title || intent.slug, merge_request: String(brief.frontmatter.merge_request) });
        }
    }
    return { intent: null, story: null, branch, candidates };
}

async function threads({ root = DEFAULT_ROOT, intentSlug, storyId = null, cwd = process.cwd(), lookup = envLookup(), transport } = {}) {
    const ctx = load(root, cwd, intentSlug);
    if (ctx.error) return ctx;
    const requests = [];
    if (ctx.brief.frontmatter.merge_request) requests.push({ story: null, url: String(ctx.brief.frontmatter.merge_request) });
    for (const s of ctx.stories) if (s.frontmatter.merge_request) requests.push({ story: s.id, url: String(s.frontmatter.merge_request) });
    if (!requests.length) return { error: 'no merge request recorded in the brief or the stories: run Finish again first, it opens them' };
    const token = lookup('GITLAB_TOKEN');
    if (!token) return { error: NO_TOKEN };
    const found = [];
    const errors = [];
    for (const r of requests) {
        const got = await fetchThreads(r.url, { token, ...(transport ? { transport } : {}) });
        if (!got.ok) { errors.push({ url: r.url, detail: got.detail }); continue; }
        r.state = got.state;
        for (const t of got.threads) {
            const owners = r.story ? [r.story] : ownersOf(ctx.stories, t.file);
            found.push({ ...t, story: owners.length === 1 ? owners[0] : null, candidates: owners.length > 1 ? owners : [] });
        }
    }
    const id = storyId ? normId(storyId) : null;
    const shown = id ? found.filter((t) => t.story === id || t.candidates.includes(id)) : found;
    return { intent: ctx.intent.slug, story: id, merge_requests: requests, threads: shown, errors };
}

/** Bring the local `branch` up to the remote's version: a fast-forward, or a stop. */
function syncBranch(cwd, branch) {
    if (!git(['remote', 'get-url', 'origin'], cwd).ok) return {};
    if (!git(['fetch', '--quiet', 'origin', `refs/heads/${branch}:refs/remotes/origin/${branch}`], cwd).ok) return {};
    const remote = `refs/remotes/origin/${branch}`;
    if (!branchExists(cwd, branch)) return git(['branch', branch, remote], cwd).ok ? {} : { error: `could not create ${branch} from the remote` };
    if (git(['merge-base', '--is-ancestor', remote, branch], cwd).ok) return {};
    if (!git(['merge-base', '--is-ancestor', branch, remote], cwd).ok) {
        return { error: `${branch} and its version on the remote went apart: bring them together first` };
    }
    const holder = listWorktrees(cwd).find((w) => w.branch === branch);
    if (holder) return { error: `${branch} is checked out in ${holder.path}: update it there first` };
    return git(['branch', '-f', branch, remote], cwd).ok ? { forwarded: true } : { error: `could not fast-forward ${branch}` };
}

const reviewWorktree = (cwd, intentSlug, id) => {
    const abs = path.resolve(cwd);
    return path.join(path.dirname(abs), `${path.basename(abs)}-turbo`, intentSlug, `review-fix-${id}`);
};

/** The checks open and land share: a done story of a done intent, the tree on the intent branch. */
function gate(ctx, storyId, cwd) {
    const story = findStory(ctx.intent, storyId);
    if (!story) return { error: `story not found: ${storyId} in ${ctx.intent.stories}` };
    if (ctx.brief.status !== 'done') return { error: `the brief has status "${ctx.brief.status}": review fix is for a done intent, build and finish it first` };
    if (story.status !== 'done') return { error: `story ${story.id} has status "${story.status}", expected done` };
    const intentBranch = ctx.brief.frontmatter.branch;
    if (!intentBranch) return { error: 'the brief has no branch' };
    const onBranch = currentBranch(cwd);
    if (onBranch !== intentBranch) return { error: `the project tree is on "${onBranch}", expected the intent branch "${intentBranch}"` };
    const branch = ctx.settings.storyBranches ? (story.branch || storyBranch(intentBranch, story)) : intentBranch;
    return { story, intentBranch: String(intentBranch), branch };
}

function open({ root = DEFAULT_ROOT, intentSlug, storyId, cwd = process.cwd() } = {}) {
    const ctx = load(root, cwd, intentSlug);
    if (ctx.error) return ctx;
    const g = gate(ctx, storyId, cwd);
    if (g.error) return g;
    const prefix = artifactPrefix(cwd, root);
    const out = { story: g.story.id, branch: g.branch, file: path.relative(cwd, g.story.file), changed_files: g.story.changed_files };
    if (!ctx.settings.storyBranches) {
        const dirty = stagedSet(cwd, prefix);
        if (dirty.error) return dirty;
        if (dirty.files.length) return { error: `the project tree has changes outside ${prefix}: ${dirty.files.join(', ')}` };
        return { ...out, code_root: cwd, worktree: null };
    }
    const wt = reviewWorktree(cwd, ctx.intent.slug, g.story.id);
    if (fs.existsSync(wt)) {
        const held = listWorktrees(cwd).find((w) => path.resolve(w.path) === wt);
        if (held && held.branch === g.branch) return { ...out, code_root: wt, worktree: wt, resumed: true };
        return { error: `${wt} exists and is not this story's worktree: remove it first` };
    }
    const synced = syncBranch(cwd, g.branch);
    if (synced.error) return synced;
    if (!branchExists(cwd, g.branch)) return { error: `the story branch ${g.branch} is not here and not on the remote` };
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    const added = git(['worktree', 'add', wt, g.branch], cwd);
    if (!added.ok) return { error: `git worktree add failed: ${added.out}` };
    return { ...out, code_root: wt, worktree: wt, forwarded: Boolean(synced.forwarded) };
}

/** Every story that builds on `id`, directly or further down, in build order. */
function dependents(stories, id) {
    const plan = branchPlan(stories);
    const on = new Set([id]);
    const order = buildOrder(stories);
    for (const sid of order) {
        const p = plan.get(sid);
        if (sid !== id && p && (on.has(p.stack_on) || p.merge_in.some((d) => on.has(d)))) on.add(sid);
    }
    return order.filter((sid) => sid !== id && on.has(sid));
}

/** Set `twin_result: outdated` on every proven test case of the affected stories. */
function markOutdated(intent, affected) {
    const out = { outdated: [], recheck: [] };
    if (!affected.length || !fs.existsSync(intent.tests)) return out;
    for (const f of fs.readdirSync(intent.tests).filter((n) => n.endsWith('.md')).sort()) {
        const file = path.join(intent.tests, f);
        const content = fs.readFileSync(file, 'utf8');
        const fm = extractFrontmatter(content) || {};
        if (!affected.includes(normId(String(fm.story || '').split('-')[0]))) continue;
        if (!fm.twin || String(fm.twin) === 'null') { out.recheck.push(file); continue; }
        if (fm.twin_result === OUTDATED) continue;
        fs.writeFileSync(file, updateFrontmatter(content, { ...fm, twin_result: OUTDATED }), 'utf8');
        out.outdated.push(file);
    }
    return out;
}

function land({ root = DEFAULT_ROOT, intentSlug, storyId, fixFiles, message, cwd = process.cwd() } = {}) {
    const expected = fileList(fixFiles);
    const twins = expected.filter((f) => f.split('/').includes(TWIN_DIR));
    if (twins.length) return { error: `${TWIN_DIR}/ belongs to the test writer: ${twins.join(', ')}` };
    const ctx = load(root, cwd, intentSlug);
    if (ctx.error) return ctx;
    const g = gate(ctx, storyId, cwd);
    if (g.error) return g;
    const { story } = g;
    const prefix = artifactPrefix(cwd, root);
    const codeRoot = ctx.settings.storyBranches ? reviewWorktree(cwd, ctx.intent.slug, story.id) : cwd;
    if (!fs.existsSync(codeRoot)) return { error: `no worktree at ${codeRoot}: run open first` };

    const proofFile = path.join(ctx.intent.proof, `${story.id}.json`);
    if (!fs.existsSync(proofFile)) return { error: `no proof: run story-verify.cjs first (${proofFile})` };
    const proof = JSON.parse(fs.readFileSync(proofFile, 'utf8'));
    if (proof.passed !== true) return { error: `the proof did not pass (${proofFile})` };
    git(['add', '-N', '.'], codeRoot);
    const now = diffSha(codeRoot, prefix);
    if (now.error) return now;
    if (proof.diff_sha && now.sha !== proof.diff_sha) return { error: 'the code changed after story-verify.cjs: run it again' };
    const staged = stagedSet(codeRoot, prefix);
    if (staged.error) return staged;
    const changed = staged.files.filter((f) => !f.split('/').includes(TWIN_DIR));
    if (changed.join('\n') !== expected.join('\n')) return { error: 'the changed files differ from --fix-files', staged: changed, expected };

    git(['add', '--', ...expected], codeRoot);
    const commit = git(['commit', '-m', `fix(${ctx.intent.slug}): ${message.trim()} (S${story.id})`, '--', ...expected], codeRoot);
    if (!commit.ok) return { error: `the commit failed: ${commit.out}` };
    const out = { story: story.id, branch: g.branch, commit: git(['rev-parse', 'HEAD'], codeRoot).stdout, carried: [] };

    if (ctx.settings.storyBranches) {
        const byId = new Map(ctx.stories.map((s) => [s.id, s]));
        for (const id of dependents(ctx.stories, story.id)) {
            const s = byId.get(id);
            const branch = s.branch || storyBranch(g.intentBranch, s);
            const synced = syncBranch(cwd, branch);
            if (synced.error) return { ...out, error: synced.error, worktree: codeRoot };
            if (!branchExists(cwd, branch)) continue;
            git(['switch', '--quiet', branch], codeRoot);
            const merged = git(['merge', '--no-ff', '--no-edit', g.branch], codeRoot);
            if (!merged.ok) {
                const conflicts = git(['diff', '--name-only', '--diff-filter=U'], codeRoot).stdout.split('\n').filter(Boolean);
                git(['merge', '--abort'], codeRoot);
                return { ...out, error: `merging the fix into ${branch} conflicts`, conflicts, worktree: codeRoot };
            }
            out.carried.push(branch);
        }
        const removed = git(['worktree', 'remove', '--force', codeRoot], cwd);
        out.worktree_removed = removed.ok;
    }

    const content = fs.readFileSync(story.file, 'utf8');
    const fm = extractFrontmatter(content) || {};
    const files = [...new Set([...story.changed_files, ...expected])];
    if (files.length !== story.changed_files.length) fs.writeFileSync(story.file, updateFrontmatter(content, { ...fm, changed_files: files }), 'utf8');
    const effect = impact({ stories: ctx.stories, storyId: story.id, fixFiles: expected, pwDir: playwrightDir(ctx.absRoot) });
    const marked = markOutdated(ctx.intent, effect.affected);
    const rel = (f) => path.relative(cwd, f).split(path.sep).join('/');
    const docs = [story.file, proofFile, ...marked.outdated].map(rel)
        .filter((f) => git(['status', '--porcelain', '--', f], cwd).stdout);
    if (docs.length) {
        git(['add', '--', ...docs], cwd);
        const done = git(['commit', '-m', `docs(${ctx.intent.slug}): review fix S${story.id}`, '--', ...docs], cwd);
        if (!done.ok) return { ...out, error: `committing the story file failed: ${done.out}` };
        out.docs_commit = git(['rev-parse', 'HEAD'], cwd).stdout;
    }
    return { ...out, ...effect, outdated: marked.outdated.map(rel), recheck: marked.recheck.map(rel) };
}

async function reply({ url, discussion, bodyFile, lookup = envLookup(), transport } = {}) {
    const token = lookup('GITLAB_TOKEN');
    if (!token) return { error: NO_TOKEN };
    if (!fs.existsSync(bodyFile)) return { error: `no reply file at ${bodyFile}` };
    const sent = await replyThread(url, discussion, fs.readFileSync(bodyFile, 'utf8'), { token, ...(transport ? { transport } : {}) });
    return sent.ok ? { ok: true, url: sent.url } : { error: sent.detail };
}

/** Prints one JSON object and resolves the exit code. `deps` is for tests. */
async function main(argv, deps = {}) {
    const print = deps.print || ((text) => process.stdout.write(`${text}\n`));
    const args = parseArgs(argv);
    if (args.help) { print(JSON.stringify({ usage: USAGE })); return 0; }
    if (args.error) { print(JSON.stringify({ error: `${args.error}\n${USAGE}` })); return 2; }
    const cwd = deps.cwd || process.cwd();
    const [intentSlug, storyId] = args.positional;
    const common = { root: args.root, cwd };
    let result;
    if (args.cmd === 'where') result = where(common);
    else if (args.cmd === 'threads') result = await threads({ ...common, intentSlug, storyId: args.story || null, ...deps });
    else if (args.cmd === 'open') result = open({ ...common, intentSlug, storyId });
    else if (args.cmd === 'land') result = land({ ...common, intentSlug, storyId, fixFiles: args.fixFiles, message: args.message });
    else result = await reply({ url: args.url, discussion: args.discussion, bodyFile: path.resolve(cwd, args.bodyFile), ...deps });
    print(JSON.stringify(result, null, 2));
    return result.error ? 1 : 0;
}

module.exports = { parseArgs, ownersOf, impact, where, threads, open, land, reply, dependents, markOutdated, main };

if (require.main === module) {
    main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
