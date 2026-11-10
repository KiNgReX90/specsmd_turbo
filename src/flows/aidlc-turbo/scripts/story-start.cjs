#!/usr/bin/env node

/**
 * specsmd AI-DLC Turbo - start one story.
 *
 * Claims a story for building and prints everything its builder and reviewers
 * need, as one JSON object: { story, slug, file, worktree, branch, base,
 * builder, brief, standards, project_docs, verification, touches }. Paths are
 * absolute. `project_docs` is { index, batches }: the root page of the Project
 * Documentation, and every standard and page in batches, one per docs reviewer.
 *
 * Refuses a story that is not `todo`, or whose `depends_on` stories are not all
 * `done`, or a brief that is not `approved` or `building`. The first start sets
 * the brief to `building`. --resume takes a story that is already `building`,
 * `review` or `blocked` and reuses its worktree and branch.
 *
 * Story branches off: a worktree at
 * `{project root}/../{project folder}-turbo/{intent}/story-{SSS}` on a local
 * build branch (the intent branch with its last part `intent` swapped for
 * `build-{SSS}`), created from the intent branch. A leftover worktree or build
 * branch of a fresh start is removed first, but only when it holds no work: an
 * old worktree with uncommitted changes, or an old build branch with commits
 * beyond its base, is an error that names it, and nothing is removed.
 *
 * Story branches on: the worktree is on the story's own branch (last part
 * swapped for `story-{SSS}-{slug}`), started from the intent branch or from the
 * branch of the dependency it stacks on (intent-status.cjs `stack_on`); the
 * other dependencies (`merge_in`) are merged in. An existing story branch is
 * reused, never deleted. A merge conflict is a human stop: the merge is
 * aborted, the conflicting files are printed, and the worktree stays.
 *
 * Sandbox mode works exactly as production with story branches off: it never
 * has story branches, whatever `branching.story_branches` says.
 *
 * Mode comes from the brief's `mode` snapshot, else from repo/config.yaml.
 * Run it from the project root.
 *
 * Usage:
 *   node .specsmd/aidlc-turbo/scripts/story-start.cjs <intent-slug> <SSS> [--resume] [--root .specs-aidlc-turbo]
 *
 * Node builtins only, plus ./frontmatter.cjs, ./lib/paths.cjs and ./lib/project-docs.cjs: the target
 * project often has no node_modules at all.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { extractFrontmatter, updateFrontmatter } = require('./frontmatter.cjs');
const paths = require('./lib/paths.cjs');
const { projectDocs } = require('./lib/project-docs.cjs');
const {
    DEFAULT_ROOT, normId, resolveIntent, readStories, findStory, readBrief, branchPlan,
} = require('./intent-status.cjs');

const BUILDER = 'specsmd-aidlc-turbo-builder';
const BUILDER_LOW = 'specsmd-aidlc-turbo-builder-low';
const RESUMABLE = ['building', 'review', 'blocked'];

/** Parse argv into positionals and flags. */
function parseArgs(argv) {
    const out = { positional: [], resume: false, root: DEFAULT_ROOT };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--resume') out.resume = true;
        else if (arg === '--root') { out.root = argv[i + 1] || DEFAULT_ROOT; i += 1; }
        else if (arg === '--help' || arg === '-h') out.help = true;
        else if (arg === '--json') { /* always JSON */ }
        else if (!arg.startsWith('--')) out.positional.push(arg);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Shared with story-verify.cjs and story-land.cjs
// ---------------------------------------------------------------------------

/** One YAML scalar: quotes, booleans, null, numbers, a flow list. */
function yamlScalar(raw) {
    const text = raw.trim();
    if (text === '' || text === 'null' || text === '~') return null;
    if (/^(['"]).*\1$/.test(text) && text.length > 1) return text.slice(1, -1);
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
    if (text.startsWith('[') && text.endsWith(']')) {
        return text.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean).map(yamlScalar);
    }
    return text;
}

/** Read nested YAML maps of scalars, enough for repo/config.yaml. Block lists are skipped. */
function parseYamlMap(text) {
    const root = {};
    const stack = [{ indent: -1, obj: root }];
    for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.replace(/\s+#(?=(?:[^"']|"[^"]*"|'[^']*')*$).*$/, '');
        if (!line.trim() || line.trim().startsWith('#')) continue;
        const m = line.match(/^(\s*)([A-Za-z_][\w-]*):(?:\s+(.*))?$/);
        if (!m) continue;
        const indent = m[1].length;
        while (stack[stack.length - 1].indent >= indent) stack.pop();
        const parent = stack[stack.length - 1].obj;
        if (m[3] === undefined || m[3].trim() === '') {
            parent[m[2]] = {};
            stack.push({ indent, obj: parent[m[2]] });
        } else {
            parent[m[2]] = yamlScalar(m[3]);
        }
    }
    return root;
}

/**
 * Mode and branching for this intent. The brief's mode snapshot wins over the
 * config. Sandbox never has story branches; `sandboxFinish` says what sandbox
 * does with a finished intent: `push` it onto the base branch (the default) or
 * open one `merge_request`. The two parts a sandbox can leave out, from the
 * config's `sandbox` block, each on unless it says false: `codeScaffold` (the
 * Code Scaffold) and `scaffoldAfterBuild` (its update after the build, never
 * without the scaffold). Production always makes both.
 */
function readSettings(root, briefFm = {}) {
    const file = paths.layout(root).config;
    const config = fs.existsSync(file) ? parseYamlMap(fs.readFileSync(file, 'utf8')) : {};
    const branching = config.branching && typeof config.branching === 'object' ? config.branching : {};
    const mode = (briefFm.mode || config.mode || 'production') === 'sandbox' ? 'sandbox' : 'production';
    const parts = mode === 'sandbox' && config.sandbox && typeof config.sandbox === 'object' ? config.sandbox : {};
    const codeScaffold = parts.code_scaffold !== false;
    return {
        mode,
        storyBranches: mode === 'production' && branching.story_branches !== false,
        projectKey: branching.project_key || '',
        baseBranch: branching.base_branch || null,
        sandboxFinish: branching.sandbox_finish === 'merge_request' ? 'merge_request' : 'push',
        codeScaffold,
        scaffoldAfterBuild: codeScaffold && parts.scaffold_after_build !== false,
    };
}

/** Run git, never throwing. */
function git(args, cwd) {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return {
        ok: r.status === 0,
        status: r.status,
        raw: r.stdout || '',
        stdout: (r.stdout || '').trim(),
        stderr: (r.stderr || '').trim(),
        out: `${r.stdout || ''}${r.stderr || ''}`.trim(),
    };
}

/** Swap the last part of the intent branch (`intent`) for another name. */
function siblingBranch(intentBranch, last) {
    const parts = String(intentBranch).split('/');
    if (parts.length === 1) return `${intentBranch}-${last}`;
    return [...parts.slice(0, -1), last].join('/');
}

const buildBranch = (intentBranch, id) => siblingBranch(intentBranch, `build-${id}`);
const storyBranch = (intentBranch, story) => siblingBranch(intentBranch, `story-${story.id}-${story.slug}`);

/** `{project root}/../{project folder}-turbo/{intent}/story-{SSS}`, outside the project. */
function worktreePath(projectRoot, intentSlug, id) {
    const abs = path.resolve(projectRoot);
    return path.join(path.dirname(abs), `${path.basename(abs)}-turbo`, intentSlug, `story-${id}`);
}

/** The artifact root relative to the project root, for excluding it from diffs and staging. */
function artifactPrefix(projectRoot, root) {
    const rel = path.relative(path.resolve(projectRoot), path.resolve(projectRoot, root)).split(path.sep).join('/');
    return rel && !rel.startsWith('..') ? rel : null;
}

/** The registered worktrees, as { path, branch }. */
function listWorktrees(cwd) {
    const r = git(['worktree', 'list', '--porcelain'], cwd);
    if (!r.ok) return [];
    return r.stdout.split('\n\n').map((block) => {
        const wt = block.match(/^worktree (.+)$/m);
        const br = block.match(/^branch refs\/heads\/(.+)$/m);
        return { path: wt ? path.resolve(wt[1]) : null, branch: br ? br[1] : null };
    }).filter((w) => w.path);
}

const branchExists = (cwd, name) => git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], cwd).ok;
const currentBranch = (cwd) => git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).stdout;

/** Set one story's status (and nothing else) through the frontmatter writer. */
function setStatus(file, status) {
    const content = fs.readFileSync(file, 'utf8');
    const next = updateFrontmatter(content, { ...extractFrontmatter(content), status });
    if (next) fs.writeFileSync(file, next, 'utf8');
}

/** Where the story's branch starts and what gets merged in. Returns { base, mergeIn } or { error }. */
function startPoint(stories, story, intentBranch, storyBranches) {
    if (!storyBranches) return { base: intentBranch, mergeIn: [] };
    const plan = branchPlan(stories).get(story.id);
    const byId = new Map(stories.map((s) => [s.id, s]));
    const branchOf = (id) => (byId.get(id) && byId.get(id).branch) || null;
    const missing = [plan.stack_on, ...plan.merge_in].filter((id) => id !== 'intent' && !branchOf(id));
    if (missing.length) return { error: `dependency without a recorded branch: ${missing.join(', ')}` };
    return {
        base: plan.stack_on === 'intent' ? intentBranch : branchOf(plan.stack_on),
        mergeIn: plan.merge_in.map(branchOf),
    };
}

// ---------------------------------------------------------------------------
// story-start
// ---------------------------------------------------------------------------

/**
 * Standards the builder reads, those the project has: the coding standards, the data stack when the
 * story writes tables, the architecture, the API conventions and the UX guide.
 */
function standardsFor(root, story, projectRoot) {
    const dir = path.resolve(projectRoot, paths.layout(root).standards);
    const files = ['coding-standards.md', ...(story.db_tables.length ? ['data-stack.md'] : []),
        'system-architecture.md', 'api-conventions.md', 'ux-guide.md'];
    return files.map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f));
}

const builderFor = (complexity) => (complexity === 'low' ? BUILDER_LOW : BUILDER);

/**
 * Work a fresh start would throw away: uncommitted changes in the old worktree,
 * or commits on the old build branch beyond its base. Returns a sentence, or null.
 */
function leftoverWork({ cwd, wt, branch, base }) {
    if (wt) {
        const st = git(['status', '--porcelain'], wt);
        if (st.ok && st.stdout) return `the old worktree ${wt} holds uncommitted work`;
    }
    if (branch && base) {
        const ahead = git(['rev-list', '--count', `${base}..${branch}`], cwd);
        if (ahead.ok && Number(ahead.stdout) > 0) return `the old branch ${branch} has ${ahead.stdout} commit(s) beyond ${base}`;
    }
    return null;
}

/** Create or reuse the story's worktree. Returns { resumed } or { error, conflicts? }. */
function prepareWorktree({ cwd, wt, branch, base, mergeIn, storyBranches, reuse }) {
    git(['worktree', 'prune'], cwd);
    const existing = listWorktrees(cwd).find((w) => w.path === wt);
    if (existing && reuse && existing.branch === branch) return { resumed: true, ...mergeDeps(wt, branch, mergeIn) };
    const exists = branchExists(cwd, branch);
    const deleteBranch = exists && !storyBranches && !reuse;
    const work = leftoverWork({ cwd, wt: existing ? wt : null, branch: deleteBranch ? branch : null, base });
    if (work) {
        return {
            error: `${work}. Nothing was removed. Keep it with --resume (the story must be building, review `
                + 'or blocked), or remove it by hand when that work is not needed.',
        };
    }
    if (existing || fs.existsSync(wt)) {
        const r = git(['worktree', 'remove', wt], cwd);
        if (!r.ok && fs.existsSync(wt)) return { error: `cannot remove the old worktree ${wt}: ${r.out}` };
    }
    if (deleteBranch) {
        const r = git(['branch', '-D', branch], cwd);
        if (!r.ok) return { error: `cannot delete the old build branch ${branch}: ${r.out}` };
    }
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    const add = branchExists(cwd, branch)
        ? git(['worktree', 'add', wt, branch], cwd)
        : git(['worktree', 'add', '-b', branch, wt, base], cwd);
    if (!add.ok) return { error: `git worktree add failed: ${add.out}` };
    return { resumed: exists, ...mergeDeps(wt, branch, mergeIn) };
}

/** Merge the other dependency branches into the story branch. A conflict is aborted and reported. */
function mergeDeps(wt, branch, mergeIn) {
    for (const other of mergeIn) {
        if (git(['merge-base', '--is-ancestor', other, 'HEAD'], wt).ok) continue;
        const r = git(['merge', '--no-ff', other, '-m', `merge ${other} into ${branch}`], wt);
        if (!r.ok) {
            const conflicts = git(['diff', '--name-only', '--diff-filter=U'], wt).stdout.split('\n').filter(Boolean);
            git(['merge', '--abort'], wt);
            return { error: `merging ${other} into ${branch} conflicts: a human stop`, conflicts };
        }
    }
    return {};
}

/** Claim one story. Returns the JSON of section 10, or { story, error }. */
function startStory({ root = DEFAULT_ROOT, intentSlug, storyId, resume = false, cwd = process.cwd() }) {
    const id = normId(storyId);
    const fail = (error, extra = {}) => ({ story: id, error, ...extra });
    const { intent, error } = resolveIntent(path.resolve(cwd, root), intentSlug);
    if (error) return fail(error);
    const stories = readStories(intent);
    const story = findStory(intent, id);
    if (!story) return fail(`story not found: ${id} in ${intent.stories}`);

    const allowed = resume ? ['todo', ...RESUMABLE] : ['todo'];
    if (!allowed.includes(story.status)) {
        return fail(`story ${story.id} has status "${story.status}", expected ${resume ? `one of: ${allowed.join(', ')}` : 'todo (use --resume for a story already started)'}`);
    }
    const byId = new Map(stories.map((s) => [s.id, s]));
    const open = story.depends_on.filter((d) => !byId.get(d) || byId.get(d).status !== 'done');
    if (open.length) return fail(`depends_on not done: ${open.join(', ')}`);

    const brief = readBrief(intent);
    if (!['approved', 'building'].includes(brief.status)) {
        return fail(`brief has status "${brief.status}", expected approved or building`);
    }
    const settings = readSettings(path.resolve(cwd, root), brief.frontmatter);
    const out = {
        story: story.id,
        slug: story.slug,
        file: path.resolve(story.file),
        worktree: path.resolve(cwd),
        branch: null,
        base: null,
        builder: builderFor(story.complexity),
        brief: path.resolve(intent.brief),
        standards: standardsFor(root, story, cwd),
        project_docs: projectDocs(root, cwd),
        verification: brief.verification,
        touches: story.touches,
        mode: settings.mode,
        story_branches: settings.storyBranches,
        resumed: story.status !== 'todo',
    };

    const intentBranch = brief.frontmatter.branch;
    if (!intentBranch) return fail('the brief has no branch yet: create the intent branch first');
    if (!git(['rev-parse', '--git-dir'], cwd).ok) return fail(`not a git repository: ${cwd}`);
    const start = startPoint(stories, story, intentBranch, out.story_branches);
    if (start.error) return fail(start.error);
    const branch = out.story_branches ? storyBranch(intentBranch, story) : buildBranch(intentBranch, story.id);
    const wt = worktreePath(cwd, intent.slug, story.id);
    const prepared = prepareWorktree({
        cwd, wt, branch, base: start.base, mergeIn: start.mergeIn,
        storyBranches: out.story_branches, reuse: resume && story.status !== 'todo',
    });
    if (prepared.error && !prepared.conflicts) return fail(prepared.error);
    Object.assign(out, { worktree: wt, branch, base: start.base });
    if (prepared.error) {
        setStatus(story.file, 'building');
        return fail(prepared.error, { conflicts: prepared.conflicts, worktree: wt, branch });
    }

    setStatus(story.file, 'building');
    if (brief.status === 'approved') setStatus(intent.brief, 'building');
    return out;
}

module.exports = {
    BUILDER,
    BUILDER_LOW,
    yamlScalar,
    parseYamlMap,
    readSettings,
    git,
    siblingBranch,
    buildBranch,
    storyBranch,
    worktreePath,
    artifactPrefix,
    listWorktrees,
    branchExists,
    currentBranch,
    startPoint,
    standardsFor,
    builderFor,
    startStory,
};

if (require.main === module) {
    const options = parseArgs(process.argv.slice(2));
    const [intentSlug, storyId] = options.positional;
    if (options.help || !intentSlug || !storyId) {
        const usage = `
Usage: node story-start.cjs <intent-slug> <SSS> [options]

Options:
  --resume        Take a story already building, review or blocked and reuse its worktree
  --root <dir>    Artifact root, default ${DEFAULT_ROOT}
  --help, -h      Show this message
`;
        if (options.help) console.log(usage); else console.error(usage);
        process.exitCode = options.help ? 0 : 2;
    } else {
        try {
            const result = startStory({ root: options.root, intentSlug, storyId, resume: options.resume });
            console.log(JSON.stringify(result, null, 2));
            process.exitCode = result.error ? 1 : 0;
        } catch (error) {
            console.log(JSON.stringify({ story: storyId, error: error.message }, null, 2));
            process.exitCode = 1;
        }
    }
}
