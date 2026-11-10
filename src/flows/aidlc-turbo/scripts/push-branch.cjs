#!/usr/bin/env node

/**
 * specsmd AI-DLC Turbo - push a branch and open its merge request.
 *
 * Every branch the flow pushes gets its merge request in the same step; the
 * user never has to click a "create merge request" link:
 *   - a story branch goes into the branch it started from: the branch of the
 *     story it stacks on (intent-status.cjs `stack_on`), else the intent branch;
 *   - the intent branch goes into `branching.base_branch`, or into the remote's
 *     default branch when that is empty.
 * A target the remote does not have yet is pushed first, so the merge request
 * always has somewhere to go. A story branch pushed that way gets its own
 * merge request too.
 *
 * The title starts with the Jira key the after-inception sync wrote into
 * sync.yaml (`SHOP-101 - Pay with a gift card`), then the title of
 * the story or brief, in the record's language. The description in the push is one line;
 * the construction agent replaces it with the full reviewer description from
 * the mr-description skill (mr-describe.cjs writes it).
 *
 * GitLab: plain git push options (`merge_request.create`, `.target`, `.title`,
 * `.description`), no token. GitHub (github.com): `gh pr create` after the
 * push, when gh is installed and logged in. A remote that refuses push options
 * gets a plain push. What did not open a merge request is said in
 * `merge_request.note`, and the push's own links stay in `push.lines`.
 *
 * GitLab applies the title and the description of the push options to a
 * merge request that is already open for the branch too, so a later push would
 * reset the full description to the one line. A branch with a merge request
 * recorded in the story file or the brief therefore asks GitLab its state first
 * (`mr-describe.cjs read`): open, or a state that cannot be read (no
 * GITLAB_TOKEN, no network): a plain push without push options, and the
 * recorded link stays. Merged or closed: the push options as above, so a new
 * merge request opens and is recorded.
 *
 * A push that sends nothing (the branch was already on the remote) makes
 * GitLab open nothing, so it goes without push options: git can die of
 * SIGPIPE writing them to a remote that has nothing to receive. The merge
 * request is therefore written as `merge_request` into the story file, or into
 * the brief for the intent branch, the moment it opens, and read back from
 * there. The Jira sync after the build links it from there too.
 *
 * The intent branch goes out only with every twin its test cases name: before
 * any push, the `twin` in the frontmatter of every test case in the intent's
 * tests/ folder must be in the branch (`git cat-file -e {branch}:{twin}`). On a
 * real run a twin was committed on its story branch only, and the intent
 * branch went out with a test case pointing at a twin it did not hold.
 *
 * Nothing leaves the machine during the build. Finish pushes once the user
 * approved the intent on its overview page, with --all: the intent branch
 * first, then every story branch in build order, so each merge request has its
 * target. A story branch the intent branch holds already (its merge request was
 * merged) stays, and a story stacked on it goes into the intent branch instead;
 * a branch deleted after its merge is known by the commit the land recorded,
 * and one that cannot be placed is a failed push. A missing twin pushes
 * nothing at all.
 *
 * Sandbox mode has no story branches, so --story is refused there. With
 * `branching.sandbox_finish: merge_request` the intent branch goes out as in
 * production with story branches off. With `push` (the default) it goes
 * straight onto the base branch, after the same twin check, and no merge
 * request opens (lib/push-base.cjs): the base must not have moved
 * (`base_moved`), and the brief records `pushed_to_base`.
 *
 * The flow never merges a merge request. Sandbox with `push` puts the work on
 * the base branch itself, because the user chose that.
 *
 * Prints { branch, push: { ok, lines, error? }, merge_request: { into, url, note? }, target? }.
 * Sandbox with `push` prints { branch, into, push: { ok, lines, local_only? },
 * merge_request: null, pushed_to_base: true, commit, note? }, or { branch,
 * into, error, base_moved: true } when the base moved.
 * A missing twin pushes nothing and prints { branch, error, missing_twins:
 * [{ test_case, twin, on }] } instead, where `on` lists the story branches
 * that hold that twin. --all adds `stories`: per story { story, branch, push,
 * merge_request }, or { story, branch, skipped }. Exit 0 when every push
 * worked, 1 otherwise.
 *
 * Usage:
 *   node .specsmd/aidlc-turbo/scripts/push-branch.cjs <intent-slug> [--story SSS | --all] [--root .specs-aidlc-turbo]
 *
 * Without --story or --all it pushes the intent branch. Run it from the project root.
 *
 * Node builtins only, plus ./frontmatter.cjs and ./lib/*.cjs: the target
 * project often has no node_modules at all.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { extractFrontmatter, updateFrontmatter } = require('./frontmatter.cjs');
const {
    DEFAULT_ROOT, resolveIntent, readStories, findStory, readBrief, buildOrder,
} = require('./intent-status.cjs');
const {
    readSettings, git, storyBranch, startPoint, branchExists,
} = require('./story-start.cjs');
const { pushToBase } = require('./lib/push-base.cjs');
const { jiraKeys, withKey, shownTitle } = require('./lib/jira-keys.cjs');

const MR_URL = /https?:\/\/\S+\/-\/merge_requests\/\d+/;
const PR_URL = /https?:\/\/\S+\/pull\/\d+/;

/** Parse argv into positionals and flags. */
function parseArgs(argv) {
    const out = { positional: [], story: null, all: false, root: DEFAULT_ROOT };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--story') { out.story = argv[i + 1] ?? null; i += 1; }
        else if (arg === '--all') out.all = true;
        else if (arg === '--root') { out.root = argv[i + 1] || DEFAULT_ROOT; i += 1; }
        else if (arg === '--help' || arg === '-h') out.help = true;
        else if (!arg.startsWith('--')) out.positional.push(arg);
    }
    return out;
}

/** Push options carry one line each. */
const oneLine = (text) => String(text || '').replace(/\s+/g, ' ').trim();

/** The lines of a push that hold a link, without git's `remote:` prefix. */
const linkLines = (out) => out.split('\n').filter((l) => /https?:\/\//.test(l)).map((l) => l.replace(/^remote:\s*/, '').trim());

/** The lines GitLab prints when a push option failed. */
const optionWarnings = (out) => out.split('\n').map((l) => l.replace(/^remote:\s*/, '').trim())
    .filter((l) => /push option|merge request/i.test(l) && /error|could not|not found|invalid/i.test(l));

/** gitlab, github or other, from the remote url. */
function hostOf(url) {
    if (/github\.com[:/]/i.test(url)) return 'github';
    if (/gitlab/i.test(url)) return 'gitlab';
    return 'other';
}

/** Where a push to origin goes: its push url, which may differ from the fetch url. */
function pushTarget(cwd) {
    const r = git(['remote', 'get-url', '--push', 'origin'], cwd);
    return r.ok && r.stdout ? r.stdout : 'origin';
}

/** true, false, or null when the remote could not be asked. */
function remoteHas(cwd, branch) {
    const r = git(['ls-remote', '--exit-code', '--heads', pushTarget(cwd), branch], cwd);
    if (r.ok) return true;
    return r.status === 2 ? false : null;
}

/** true when the remote already has `branch` at the local commit. */
function upToDate(cwd, branch) {
    const local = git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], cwd);
    const remote = git(['ls-remote', '--heads', pushTarget(cwd), branch], cwd);
    if (!local.ok || !remote.ok) return false;
    return remote.stdout.split('\n').some((l) => l.split('\t')[0] === local.stdout && l.endsWith(`refs/heads/${branch}`));
}

/** The remote's default branch (`origin/HEAD`), or null. */
function remoteDefault(cwd) {
    const r = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd);
    return r.ok ? r.stdout.replace(/^origin\//, '') : null;
}

/** The states in which a recorded merge request is done with: a push opens a new one. */
const DONE = new Set(['merged', 'closed']);

/**
 * GitLab's state of the merge request at `url` (`opened`, `merged`, `closed`,
 * `locked`) through `mr-describe.cjs read`, or null when it cannot be read: no
 * GITLAB_TOKEN, no network, not a GitLab link. Synchronous, as every push here.
 */
function requestState(url, cwd) {
    const script = path.join(__dirname, 'mr-describe.cjs');
    const r = spawnSync(process.execPath, [script, 'read', '--url', String(url)], { cwd, encoding: 'utf8', timeout: 30000 });
    try {
        const out = JSON.parse(r.stdout || '');
        return out.ok && out.state ? String(out.state) : null;
    } catch {
        return null;
    }
}

/** The merge request recorded in the frontmatter of `file`, or null. */
function recorded(file) {
    const fm = extractFrontmatter(fs.readFileSync(file, 'utf8')) || {};
    return fm.merge_request ? String(fm.merge_request) : null;
}

/** Run gh, never throwing. null when gh is not installed. */
function gh(args, cwd) {
    const r = spawnSync('gh', args, { cwd, encoding: 'utf8', timeout: 120000 });
    if (r.error && r.error.code === 'ENOENT') return null;
    return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

/**
 * Push one branch to origin and open its merge request into `into`. `known` is
 * the merge request recorded for the branch; `mrState` asks its state.
 * Returns { branch, push, merge_request }.
 */
function pushBranch({ cwd, branch, into, title, description, known = null, mrState = requestState }) {
    const origin = git(['remote', 'get-url', 'origin'], cwd);
    const result = { branch, push: { ok: false, lines: [] }, merge_request: { into, url: null } };
    if (!origin.ok) {
        result.push.error = 'no remote named origin';
        result.merge_request.note = 'not pushed: there is no remote';
        return result;
    }
    const host = hostOf(origin.stdout);
    const plain = ['push', '-u', 'origin', branch];
    let push;
    let reuse = false;
    if (host === 'github' || upToDate(cwd, branch)) {
        // Nothing to send: git can die of SIGPIPE writing push options to a
        // remote that already closed, and GitLab would open nothing anyway.
        push = git(plain, cwd);
    } else if (known && !DONE.has(mrState(known, cwd))) {
        // Open, or unknown: push options would reset its title and description.
        reuse = true;
        push = git(plain, cwd);
    } else {
        const options = ['merge_request.create', `merge_request.title=${oneLine(title)}`];
        if (into) options.push(`merge_request.target=${into}`);
        if (description) options.push(`merge_request.description=${oneLine(description)}`);
        push = git(['push', ...options.flatMap((o) => ['-o', o]), '-u', 'origin', branch], cwd);
        // A remote that is not GitLab may refuse push options, and git can die
        // of a signal halfway: push plainly.
        if (!push.ok && (/push options/i.test(push.out) || push.status === null)) push = git(plain, cwd);
    }
    result.push = { ok: push.ok, lines: linkLines(push.out) };
    if (!push.ok) {
        result.push.error = push.out.split('\n').slice(-3).join(' ');
        result.merge_request.note = 'not opened: the push failed';
        return result;
    }

    if (host === 'github') {
        const args = ['pr', 'create', '--head', branch, '--title', oneLine(title), '--body', description || oneLine(title)];
        if (into) args.push('--base', into);
        const pr = gh(args, cwd);
        const url = pr && (pr.out.match(PR_URL) || [])[0];
        if (url) result.merge_request.url = url;
        else result.merge_request.note = pr ? `not opened: gh said ${oneLine(pr.out).slice(0, 200)}` : 'not opened: gh is not installed';
        return result;
    }
    if (reuse) {
        result.merge_request.url = known;
        return result;
    }
    const url = (push.out.match(MR_URL) || [])[0];
    if (url) {
        result.merge_request.url = url;
    } else if (/Everything up-to-date/i.test(push.out)) {
        result.merge_request.note = 'not opened: the branch was already on the remote, so the push sent nothing';
    } else {
        const warnings = optionWarnings(push.out);
        result.merge_request.note = warnings.length
            ? `not opened: ${warnings.join(' ')}`
            : 'not opened: this remote does not open merge requests from a push';
    }
    return result;
}

const quoted = (titles) => titles.map((t) => `"${t}"`).join(' and ');

/** A story's merge request title: its Jira key, then its title. */
const storyTitle = (story, keys) => withKey(keys.stories[story.id], shownTitle(story.frontmatter, story.title));

/**
 * Title, one-line description and target of one story's merge request. The
 * construction agent writes the full description afterwards with the
 * mr-description skill: a push option carries one line only.
 */
function storyRequest(stories, story, intentBranch, intentTitle, keys) {
    const target = startPoint(stories, story, intentBranch, true);
    if (target.error) return { error: target.error };
    const byId = new Map(stories.map((s) => [s.id, s]));
    const deps = story.depends_on.map((id) => byId.get(id)).filter(Boolean).map((s) => storyTitle(s, keys));
    let description = `One story of "${intentTitle}".`;
    if (deps.length) description += ` Builds on ${quoted(deps)}: merge ${deps.length > 1 ? 'those' : 'that one'} first.`;
    return { into: target.base || intentBranch, title: storyTitle(story, keys), description };
}

/**
 * Write an opened merge request into the frontmatter of `file` (a story or the
 * brief), or read the recorded one back when the push opened none.
 */
function recordRequest(file, result) {
    const content = fs.readFileSync(file, 'utf8');
    const fm = extractFrontmatter(content);
    const url = result.merge_request.url;
    if (url && fm.merge_request !== url) {
        const next = updateFrontmatter(content, { ...fm, merge_request: url });
        if (next) fs.writeFileSync(file, next, 'utf8');
    } else if (!url && result.push.ok && fm.merge_request) {
        result.merge_request.url = String(fm.merge_request);
        delete result.merge_request.note;
    }
    return result;
}

/**
 * Push one story branch with its merge request, the target first when the
 * remote lacks it. `branch` defaults to the story's recorded branch.
 */
function pushStory({ cwd, intent, brief, story, branch = null, seen = new Set(), held = new Set(), mrState }) {
    const intentBranch = brief.frontmatter.branch;
    const own = branch || story.branch || storyBranch(intentBranch, story);
    const stories = readStories(intent);
    const request = storyRequest(stories, story, intentBranch, shownTitle(brief.frontmatter, intent.slug), jiraKeys(intent));
    if (request.error) {
        return { branch: own, push: { ok: false, lines: [], error: request.error }, merge_request: { into: null, url: null, note: 'not opened' } };
    }
    // the story it stacks on is merged into the intent branch already: go there
    if (held.has(request.into)) request.into = intentBranch;

    const out = {};
    seen.add(story.id);
    if (remoteHas(cwd, request.into) === false) {
        const parent = stories.find((s) => s.branch === request.into);
        out.target = parent && !seen.has(parent.id)
            ? pushStory({ cwd, intent, brief, story: parent, seen, held, mrState })
            : pushBranch({ cwd, branch: request.into, into: null, title: request.into });
    }
    const result = recordRequest(story.file, pushBranch({ cwd, branch: own, ...request, known: recorded(story.file), mrState }));
    return { ...result, ...out };
}

/** A twin path as git names it: forward slashes, no leading `./`. */
const twinPath = (value) => String(value).trim().replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * Every twin the test cases in the intent's tests/ folder name in their
 * frontmatter, as { test_case, twin }. A null or empty twin names none.
 */
function namedTwins(cwd, intent) {
    if (!fs.existsSync(intent.tests)) return [];
    return fs.readdirSync(intent.tests).filter((f) => f.endsWith('.md')).sort().flatMap((f) => {
        const file = path.join(intent.tests, f);
        const fm = extractFrontmatter(fs.readFileSync(file, 'utf8')) || {};
        const twin = fm.twin == null ? '' : twinPath(fm.twin);
        if (!twin || twin === 'null') return [];
        return [{ test_case: path.relative(cwd, file).split(path.sep).join('/'), twin }];
    });
}

/** true when the last commit of `branch` has `file`. */
const holds = (cwd, branch, file) => git(['cat-file', '-e', `${branch}:${file}`], cwd).ok;

/**
 * The twins the test cases name that `branch` does not hold, each with the
 * story branches that do hold it (`on`).
 */
function missingTwins(cwd, intent, branch) {
    const missing = namedTwins(cwd, intent).filter((t) => !holds(cwd, branch, t.twin));
    if (!missing.length) return [];
    const storyBranches = [...new Set(readStories(intent).map((s) => s.branch).filter(Boolean))];
    return missing.map((t) => ({ ...t, on: storyBranches.filter((b) => holds(cwd, b, t.twin)) }));
}

/**
 * Push the intent branch with its merge request into the base branch, or in
 * sandbox mode with `push` straight onto it. While a test case names a twin
 * the branch does not hold, nothing is pushed.
 */
function pushIntent({ cwd, absRoot, intent, brief, mrState }) {
    const branch = brief.frontmatter.branch;
    const missing = missingTwins(cwd, intent, branch);
    if (missing.length) {
        const list = missing.map((m) => `${m.twin} (${path.basename(m.test_case, '.md')}, `
            + `${m.on.length ? `on ${m.on.join(', ')}` : 'on no branch'})`).join('; ');
        return {
            branch,
            error: `test cases name twins the intent branch does not hold: ${list}. Nothing was pushed. `
                + 'Carry each one over from the story branch that holds it, commit it on the intent branch '
                + 'and push again. One that no branch holds is a human stop.',
            missing_twins: missing,
        };
    }
    const settings = readSettings(absRoot, brief.frontmatter);
    const into = settings.baseBranch || remoteDefault(cwd);
    if (settings.mode === 'sandbox' && settings.sandboxFinish === 'push') {
        if (!into) return { branch, error: 'no base branch: set branching.base_branch in the config. Nothing was pushed.' };
        return pushToBase({ cwd, briefFile: intent.brief, branch, into });
    }
    const title = shownTitle(brief.frontmatter, intent.slug);
    const stories = readStories(intent);
    const description = settings.storyBranches
        ? `The specs, the review and the test cases of "${title}". Merge its story merge requests into this branch first.`
        : `"${title}": ${stories.length} ${stories.length === 1 ? 'story' : 'stories'}, one commit each, verified and reviewed.`;
    return recordRequest(intent.brief, pushBranch({
        cwd, branch, into, title: withKey(jiraKeys(intent).epic, title), description, known: recorded(intent.brief), mrState,
    }));
}

/**
 * After the approval: the intent branch, then every story branch in build
 * order. Nothing of the stories goes out when the intent branch did not.
 */
function pushAll({ cwd, absRoot, intent, brief, mrState }) {
    const result = { ...pushIntent({ cwd, absRoot, intent, brief, mrState }), stories: [] };
    if (result.error || !result.push.ok || !readSettings(absRoot, brief.frontmatter).storyBranches) return result;
    const intentBranch = brief.frontmatter.branch;
    const stories = readStories(intent);
    const byId = new Map(stories.map((s) => [s.id, s]));
    const seen = new Set();
    const held = new Set();
    for (const story of buildOrder(stories).map((id) => byId.get(id))) {
        const branch = story.branch || storyBranch(intentBranch, story);
        const local = branchExists(cwd, branch);
        // a branch deleted after its merge is known by the commit the land recorded
        const tip = local ? branch : story.frontmatter.commit;
        if (tip && git(['merge-base', '--is-ancestor', String(tip), intentBranch], cwd).ok) {
            held.add(branch);
            seen.add(story.id);
            result.stories.push({ story: story.id, branch, skipped: 'the intent branch holds it already' });
        } else if (!local) {
            result.stories.push({
                story: story.id, branch,
                push: { ok: false, lines: [], error: 'no local branch, and the intent branch does not hold its commit' },
                merge_request: { into: null, url: null, note: 'not opened: the push failed' },
            });
        } else {
            result.stories.push({ story: story.id, ...pushStory({ cwd, intent, brief, story, branch, seen, held, mrState }) });
        }
    }
    return result;
}

/**
 * The CLI: the intent branch, one story branch with --story, or all of them
 * with --all. `mrState` replaces the merge request lookup in tests.
 */
function run({ root = DEFAULT_ROOT, intentSlug, story: storyId = null, all = false, cwd = process.cwd(), mrState = requestState }) {
    const absRoot = path.resolve(cwd, root);
    const { intent, error } = resolveIntent(absRoot, intentSlug);
    if (error) return { error };
    const brief = readBrief(intent);
    const sandbox = readSettings(absRoot, brief.frontmatter).mode === 'sandbox';
    if (sandbox && storyId !== null) return { error: 'sandbox mode has no story branches' };
    if (!brief.frontmatter.branch) return { error: 'the brief has no branch' };
    if (all) return pushAll({ cwd, absRoot, intent, brief, mrState });
    if (storyId === null) return pushIntent({ cwd, absRoot, intent, brief, mrState });
    const story = findStory(intent, storyId);
    if (!story) return { error: `story not found: ${storyId} in ${intent.stories}` };
    return pushStory({ cwd, intent, brief, story, mrState });
}

module.exports = { hostOf, requestState, pushBranch, pushStory, pushIntent, pushAll, run };

if (require.main === module) {
    const options = parseArgs(process.argv.slice(2));
    const [intentSlug] = options.positional;
    if (options.help || !intentSlug) {
        const usage = `
Usage: node push-branch.cjs <intent-slug> [options]

Pushes the intent branch, or one story branch, and opens its merge request.
In sandbox mode with sandbox_finish push, the intent branch goes onto the base branch.

Options:
  --story <SSS>   Push this story's branch instead of the intent branch
  --all           Push the intent branch, then every story branch (after the approval)
  --root <dir>    Artifact root, default ${DEFAULT_ROOT}
  --help, -h      Show this message
`;
        if (options.help) console.log(usage); else console.error(usage);
        process.exitCode = options.help ? 0 : 2;
    } else {
        const result = run({ ...options, intentSlug });
        console.log(JSON.stringify(result, null, 2));
        const failed = (result.stories || []).some((s) => (s.push && !s.push.ok) || (s.target && !s.target.push.ok));
        process.exitCode = result.error || !result.push.ok || failed ? 1 : 0;
    }
}
