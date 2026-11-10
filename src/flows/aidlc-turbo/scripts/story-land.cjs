#!/usr/bin/env node

/**
 * specsmd AI-DLC Turbo - land one story.
 *
 * After the review passed: commit the story's code, carry it onto the intent
 * branch, mark the story done and clean up. Run it from the project root, with
 * the project tree on the intent branch.
 *
 * 1. Gates first: the story is `building` or `review` (story-complete.cjs), its
 *    proof exists and passed, and the worktree diff still has the proof's
 *    diff_sha (nothing changed after story-verify.cjs).
 * 2. The staged set is `git status --porcelain` of the worktree minus the
 *    artifact root. It must equal --changed-files (order does not matter); on a
 *    mismatch nothing happens and both lists are printed. A path with an
 *    `aidlc-twins` segment, at any depth, in --changed-files or in the staged
 *    set is a stop too, naming the paths: that folder belongs to the test
 *    writer at finish, and a builder never writes a twin. On a real run a
 *    builder's Playwright file there was committed on its story branch, and the
 *    intent branch went out without the twin its test case named.
 * 3. Story branches off: commit `build S{SSS}` on the build branch, then in the
 *    project tree `git cherry-pick --no-commit` it and commit it as
 *    `feat({intent}): {title} (S{SSS})` (`fix(...)` with --fix). A conflict is a
 *    human stop: the cherry-pick is aborted and the conflicting files printed.
 *    Story branches on: commit with the story message on the story branch. It
 *    stays local: finish pushes every branch once the user approved the intent.
 * 4. story-complete.cjs marks the story done (commit, branch, changed files),
 *    and the story file is committed on the intent branch:
 *    `docs({intent}): S{SSS} done`.
 * 5. Only when all of that worked: remove the worktree, and the build branch
 *    (a story branch is kept). A rerun after a stop reuses the story's commit:
 *    one the intent branch already carries is not picked again, and a story
 *    already done only gets its docs commit and the cleanup.
 *
 * Sandbox mode lands exactly as production with story branches off: it never
 * has story branches, so it never pushes here.
 *
 * Prints { story, commit, frontier, worktree_removed }, or on a stop
 * { story, error, staged, expected } with exit 1. On any stop the worktree and
 * its branch stay.
 *
 * Usage:
 *   node .specsmd/aidlc-turbo/scripts/story-land.cjs <intent-slug> <SSS> --changed-files a,b \
 *     [--tests "14 passed"] [--fix] [--root .specs-aidlc-turbo]
 *
 * --tests defaults to the counts in the proof file.
 *
 * Node builtins only, plus ./frontmatter.cjs and ./lib/paths.cjs: the target
 * project often has no node_modules at all.
 */

const fs = require('fs');
const path = require('path');
const {
    DEFAULT_ROOT, normId, resolveIntent, readStories, findStory, readBrief, computeFrontier,
} = require('./intent-status.cjs');
const { DONE_STATUS, checkComplete, completeStory } = require('./story-complete.cjs');
const {
    readSettings, git, buildBranch, storyBranch, worktreePath, artifactPrefix, currentBranch, branchExists,
} = require('./story-start.cjs');
const { diffSha, summaryLine } = require('./story-verify.cjs');

/** Parse argv into positionals and flags. */
function parseArgs(argv) {
    const out = { positional: [], changedFiles: null, tests: null, fix: false, root: DEFAULT_ROOT };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--changed-files') { out.changedFiles = argv[i + 1] ?? ''; i += 1; }
        else if (arg === '--tests') { out.tests = argv[i + 1] ?? null; i += 1; }
        else if (arg === '--fix') out.fix = true;
        else if (arg === '--root') { out.root = argv[i + 1] || DEFAULT_ROOT; i += 1; }
        else if (arg === '--help' || arg === '-h') out.help = true;
        else if (!arg.startsWith('--')) out.positional.push(arg);
    }
    return out;
}

const normFile = (f) => f.trim().replace(/\\/g, '/').replace(/^\.\//, '');
const fileList = (list) => [...new Set((Array.isArray(list) ? list : String(list || '').split(','))
    .map(normFile).filter(Boolean))].sort();
const sameSet = (a, b) => a.length === b.length && a.every((f, i) => f === b[i]);
const inPrefix = (file, prefix) => prefix && (file === prefix || file.startsWith(`${prefix}/`));

/** The folder of the Playwright twins: only the test writer writes in it, at finish. */
const TWIN_DIR = 'aidlc-twins';

/**
 * The stop message when `files` hold a path with an `aidlc-twins` segment, at
 * any depth, else null.
 */
function twinError(files) {
    const twins = files.filter((f) => f.split('/').includes(TWIN_DIR));
    if (!twins.length) return null;
    return `${TWIN_DIR}/ belongs to the test writer at finish, and a builder never writes a twin: ${twins.join(', ')}. `
        + "Put a Playwright spec the test plan asks for next to the project's own specs, then run story-verify.cjs again.";
}

/** Every changed path git sees in the worktree, minus the artifact root. */
function stagedSet(wt, prefix) {
    const r = git(['status', '--porcelain', '-z', '-uall'], wt);
    if (!r.ok) return { error: `git status failed in ${wt}: ${r.out}` };
    const files = [];
    const parts = r.raw.split('\0').filter(Boolean);
    for (let i = 0; i < parts.length; i += 1) {
        const code = parts[i].slice(0, 2);
        files.push(parts[i].slice(3));
        if (code[0] === 'R' || code[0] === 'C') files.push(parts[++i]);
    }
    return { files: fileList(files).filter((f) => !inPrefix(f, prefix)) };
}

/** The files of one commit. */
const commitFiles = (cwd, sha) => fileList(git(['diff-tree', '--no-commit-id', '--name-only', '-r', '-m', '--first-parent', sha], cwd)
    .stdout.split('\n'));

/**
 * Undo a cherry-pick --no-commit. The index was clean before it, so every staged
 * change is the pick's; `reset --merge` drops those and keeps unstaged edits
 * such as the story files.
 */
function undoPick(cwd) {
    if (!git(['cherry-pick', '--abort'], cwd).ok) git(['reset', '-q', '--merge'], cwd);
}

const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The story's commit when an earlier run already carried it onto the intent
 * branch: `feat|fix({intent}): ... (S{SSS})` in the commits since the build
 * commit forked off. Returns its sha, or null.
 */
function landedCommit(cwd, buildSha, intentSlug, id) {
    const base = git(['merge-base', buildSha, 'HEAD'], cwd);
    if (!base.ok) return null;
    const log = git(['log', '--format=%H%x09%s', `${base.stdout}..HEAD`], cwd);
    if (!log.ok) return null;
    const re = new RegExp(`^(feat|fix)\\(${escapeRe(intentSlug)}\\): .* \\(S${escapeRe(id)}\\)$`);
    const hit = log.stdout.split('\n').map((l) => l.split('\t')).find(([, subject]) => subject && re.test(subject));
    return hit ? hit[0] : null;
}

/** The test summary for story-complete: --tests, else the proof's counts. */
function testsSummary(tests, proof) {
    if (tests && String(tests).trim()) return String(tests).trim();
    return summaryLine(proof).replace(/^PASS \S+ /, '');
}

/** Land one story. Returns the JSON of section 10. */
function landStory({
    root = DEFAULT_ROOT, intentSlug, storyId, changedFiles, tests = null, fix = false, cwd = process.cwd(),
}) {
    const id = normId(storyId);
    const expected = fileList(changedFiles);
    const stop = (error, extra = {}) => ({ story: id, error, staged: [], expected, ...extra });
    const changedTwins = twinError(expected);
    if (changedTwins) return stop(changedTwins);
    const absRoot = path.resolve(cwd, root);

    const { intent, error } = resolveIntent(absRoot, intentSlug);
    if (error) return stop(error);
    const story = findStory(intent, id);
    if (!story) return stop(`story not found: ${id} in ${intent.stories}`);

    const proofFile = path.join(intent.proof, `${story.id}.json`);
    if (!fs.existsSync(proofFile)) return stop(`no proof: run story-verify.cjs first (${proofFile})`);
    const proof = JSON.parse(fs.readFileSync(proofFile, 'utf8'));
    if (proof.passed !== true) return stop(`the proof did not pass: fix the story and run story-verify.cjs again (${proofFile})`);
    const summary = testsSummary(tests, proof);
    const brief = readBrief(intent);
    const settings = readSettings(absRoot, brief.frontmatter);
    const frontier = () => computeFrontier(readStories(intent));
    // A rerun after the story was marked done, but its docs commit or the
    // cleanup failed: finish those, and only those.
    const alreadyDone = story.status === DONE_STATUS;
    if (!alreadyDone) {
        const gate = checkComplete({ root: absRoot, intentSlug, storyId: story.id, tests: summary });
        if (gate.error) return stop(gate.error);
    }

    const intentBranch = brief.frontmatter.branch;
    if (!intentBranch) return stop('the brief has no branch');
    const onBranch = currentBranch(cwd);
    if (onBranch !== intentBranch) return stop(`the project tree is on "${onBranch}", expected the intent branch "${intentBranch}"`);
    const storyBranches = settings.storyBranches;
    const branch = storyBranches ? storyBranch(intentBranch, story) : buildBranch(intentBranch, story.id);
    const wt = worktreePath(cwd, intent.slug, story.id);

    const rel = path.relative(cwd, story.file);
    /** Commit the story file on the intent branch, remove the worktree and the build branch. */
    const closeOut = (out) => {
        if (git(['status', '--porcelain', '--', rel], cwd).stdout) {
            git(['add', '--', rel], cwd);
            const docs = git(['commit', '-m', `docs(${intent.slug}): S${story.id} done`, '--', rel], cwd);
            if (!docs.ok) return stop(`committing the story file failed: ${docs.out}`, { staged: expected, commit: out.commit });
            out.story_commit = git(['rev-parse', 'HEAD'], cwd).stdout;
        }
        if (fs.existsSync(wt)) {
            const removed = git(['worktree', 'remove', '--force', wt], cwd);
            out.worktree_removed = removed.ok;
            if (!removed.ok) out.warning = `worktree not removed: ${removed.out}`;
            else if (!storyBranches && branchExists(cwd, branch)) {
                const del = git(['branch', '-D', branch], cwd);
                if (!del.ok) out.warning = `build branch not deleted: ${del.out}`;
            }
        }
        out.frontier = frontier();
        return out;
    };

    if (alreadyDone) {
        const pending = git(['status', '--porcelain', '--', rel], cwd).stdout || fs.existsSync(wt);
        if (!pending) return stop(`story ${story.id} is already done.`);
        const out = {
            story: story.id, commit: story.frontmatter.commit ? String(story.frontmatter.commit) : null,
            frontier: [], worktree_removed: false, resumed: 'the story was already done: only its docs commit and the cleanup ran',
        };
        if (storyBranches) out.branch = branch;
        return closeOut(out);
    }
    if (!fs.existsSync(wt)) return stop(`worktree not found: ${wt}`);
    if (!storyBranches && !git(['diff', '--cached', '--quiet'], cwd).ok) {
        return stop('the project tree has staged changes: the cherry-pick needs a clean index');
    }

    const prefix = artifactPrefix(cwd, root);
    const staged = stagedSet(wt, prefix);
    if (staged.error) return stop(staged.error);
    const stagedTwins = twinError(staged.files);
    if (stagedTwins) return stop(stagedTwins, { staged: staged.files });
    const subject = git(['log', '-1', '--format=%s'], wt).stdout;
    const ownCommit = storyBranches ? subject.endsWith(`(S${story.id})`) : subject === `build S${story.id}`;
    const type = fix ? 'fix' : 'feat';
    const message = `${type}(${intent.slug}): ${story.title} (S${story.id})`;

    let sha;
    if (staged.files.length === 0 && ownCommit) {
        // A rerun after a stop: the story's commit is already there.
        sha = git(['rev-parse', 'HEAD'], wt).stdout;
        const files = commitFiles(wt, sha).filter((f) => !inPrefix(f, prefix));
        if (!sameSet(files, expected)) return stop('the story commit differs from --changed-files', { staged: files });
    } else {
        if (!sameSet(staged.files, expected)) {
            return stop('the staged set differs from --changed-files', { staged: staged.files });
        }
        if (proof.diff_sha) {
            const d = diffSha(wt, prefix);
            if (d.error) return stop(d.error, { staged: staged.files });
            if (d.sha !== proof.diff_sha) {
                return stop('the code changed after story-verify.cjs: run it again', { staged: staged.files });
            }
        }
        const add = git(['add', '--all', '--', ...expected], wt);
        if (!add.ok) return stop(`git add failed: ${add.out}`, { staged: staged.files });
        const commit = git(['commit', '-m', storyBranches ? message : `build S${story.id}`], wt);
        if (!commit.ok) return stop(`commit in the worktree failed: ${commit.out}`, { staged: staged.files });
        sha = git(['rev-parse', 'HEAD'], wt).stdout;
    }

    const out = { story: story.id, commit: null, frontier: [], worktree_removed: false };
    if (storyBranches) {
        out.commit = sha;
        out.branch = branch;
    } else if ((out.commit = landedCommit(cwd, sha, intent.slug, story.id))) {
        // A rerun: an earlier run already carried the commit onto the intent branch.
        out.resumed = 'the commit was already on the intent branch';
    } else {
        const pick = git(['cherry-pick', '--no-commit', sha], cwd);
        if (!pick.ok) {
            const conflicts = git(['diff', '--name-only', '--diff-filter=U'], cwd).stdout.split('\n').filter(Boolean);
            undoPick(cwd);
            return stop(`cherry-pick onto ${intentBranch} conflicts: a human stop. The worktree and ${branch} are kept.`, {
                staged: expected, conflicts,
            });
        }
        const commit = git(['commit', '-m', message], cwd);
        if (!commit.ok) {
            undoPick(cwd);
            return stop(`commit on ${intentBranch} failed: ${commit.out}`, { staged: expected });
        }
        out.commit = git(['rev-parse', 'HEAD'], cwd).stdout;
    }

    const done = completeStory({
        root: absRoot, intentSlug, storyId: story.id, tests: summary, commit: out.commit,
        branch: storyBranches ? branch : null, files: expected,
    });
    if (done.error) return stop(done.error, { staged: expected, commit: out.commit });
    return closeOut(out);
}

module.exports = { fileList, stagedSet, testsSummary, landStory };

if (require.main === module) {
    const options = parseArgs(process.argv.slice(2));
    const [intentSlug, storyId] = options.positional;
    if (options.help || !intentSlug || !storyId || options.changedFiles === null) {
        const usage = `
Usage: node story-land.cjs <intent-slug> <SSS> --changed-files a,b [options]

Options:
  --changed-files <a,b>   The files the builder changed, repo-relative (required)
  --tests <summary>       One line test summary, default the counts from the proof
  --fix                   Commit as fix(...) instead of feat(...)
  --root <dir>            Artifact root, default ${DEFAULT_ROOT}
  --help, -h              Show this message
`;
        if (options.help) console.log(usage); else console.error(usage);
        process.exitCode = options.help ? 0 : 2;
    } else {
        try {
            const result = landStory({ ...options, intentSlug, storyId });
            console.log(JSON.stringify(result, null, 2));
            process.exitCode = result.error ? 1 : 0;
        } catch (error) {
            console.log(JSON.stringify({ story: storyId, error: error.message, staged: [], expected: [] }, null, 2));
            process.exitCode = 1;
        }
    }
}
