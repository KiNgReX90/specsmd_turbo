/**
 * specsmd AI-DLC Turbo - put a finished sandbox intent straight onto its base
 * branch.
 *
 * push-branch.cjs calls this in sandbox mode with `branching.sandbox_finish:
 * push` (the default), after its twin check. No merge request is opened:
 *
 * 1. With an `origin` remote: `git fetch origin {base}` into
 *    `origin/{base}`. The remote base, or the local base branch when there is
 *    no remote, must be an ancestor of the intent branch. Otherwise nothing is
 *    pushed or moved, and the result says `base_moved`: the finish merges the
 *    base into the intent branch first. A remote without the base branch gets
 *    it from the push.
 * 2. `git push origin {intent branch}:refs/heads/{base}`: a plain push, no
 *    push options, never --force. A refused push fetches the base again: when
 *    it moved in the meantime the result says `base_moved` as in 1, otherwise
 *    it fails with its lines.
 * 3. The local base branch moves to the intent branch (`git branch -f`) when
 *    it is an ancestor of it and no worktree has it checked out; otherwise it
 *    stays and `note` says so. A missing local base branch is created.
 * 4. Without `origin`, step 2 is skipped and `push.local_only` says nothing
 *    was pushed: the work is only on the local base branch, so a local base
 *    that cannot move is a failure there.
 * 5. The brief records `pushed_to_base: {base}`, where later steps and the
 *    Jira sync read it. Never the commit: a commit cannot hold its own sha, so
 *    the brief would stay changed after the last push. The sha is `commit`.
 *
 * Returns { branch, into, push: { ok, lines, local_only? }, merge_request:
 * null, pushed_to_base: true, commit, note? }, or { branch, into, error,
 * base_moved? }, or on a refused push { ..., push: { ok: false, lines, error },
 * pushed_to_base: false }.
 *
 * Node builtins only, plus ../frontmatter.cjs and ../story-start.cjs: the
 * target project often has no node_modules at all.
 */

const fs = require('fs');
const { extractFrontmatter, updateFrontmatter } = require('../frontmatter.cjs');
const { git, branchExists, listWorktrees } = require('../story-start.cjs');

const BASE_MOVED = 'the base branch moved: merge it into the intent branch first';

/** The lines of a git command, without the `remote:` prefix. */
const outputLines = (out) => out.split('\n').map((l) => l.replace(/^remote:\s*/, '').trim()).filter(Boolean);

const isAncestor = (cwd, older, newer) => git(['merge-base', '--is-ancestor', older, newer], cwd).ok;

/**
 * Fetch the remote base into `origin/{base}`. Returns { ref }, null when the
 * remote has no such branch yet, or { error }.
 */
function fetchBase(cwd, base) {
    const tracking = `refs/remotes/origin/${base}`;
    const r = git(['fetch', 'origin', `+refs/heads/${base}:${tracking}`], cwd);
    if (r.ok) return { ref: tracking };
    if (git(['ls-remote', '--exit-code', '--heads', 'origin', base], cwd).status === 2) return { ref: null };
    return { error: `cannot fetch ${base} from origin: ${outputLines(r.out).slice(-3).join(' ')}` };
}

/** Move the local base branch to the intent branch. Returns why it did not, or null. */
function moveLocalBase(cwd, base, branch) {
    if (!branchExists(cwd, base)) {
        const r = git(['branch', base, branch], cwd);
        return r.ok ? null : `the local ${base} branch could not be created: ${r.out}`;
    }
    const holder = listWorktrees(cwd).find((w) => w.branch === base);
    if (holder) return `the local ${base} branch is checked out in ${holder.path}, so it was not moved`;
    if (!isAncestor(cwd, base, branch)) return `the local ${base} branch has commits the intent branch does not have, so it was not moved`;
    const r = git(['branch', '-f', base, branch], cwd);
    return r.ok ? null : `the local ${base} branch was not moved: ${r.out}`;
}

/** Write pushed_to_base into the brief frontmatter. */
function recordPush(briefFile, base) {
    const content = fs.readFileSync(briefFile, 'utf8');
    const fm = extractFrontmatter(content);
    if (fm.pushed_to_base === base) return;
    const next = updateFrontmatter(content, { ...fm, pushed_to_base: base });
    if (next) fs.writeFileSync(briefFile, next, 'utf8');
}

/** Put the intent branch onto the base branch `into`, as the header says. */
function pushToBase({ cwd, briefFile, branch, into }) {
    const tip = git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], cwd);
    if (!tip.ok) return { branch, into, error: `the intent branch ${branch} does not exist` };
    const commit = tip.stdout;
    const remote = git(['remote', 'get-url', 'origin'], cwd).ok;

    let compare = branchExists(cwd, into) ? `refs/heads/${into}` : null;
    if (remote) {
        const fetched = fetchBase(cwd, into);
        if (fetched.error) return { branch, into, error: fetched.error };
        compare = fetched.ref;
    }
    if (compare && !isAncestor(cwd, compare, commit)) return { branch, into, error: BASE_MOVED, base_moved: true };

    const push = { ok: true, lines: [] };
    if (remote) {
        const r = git(['push', 'origin', `${branch}:refs/heads/${into}`], cwd);
        push.lines = outputLines(r.out);
        if (!r.ok) {
            // The remote base moved between the fetch and the push: the same as a moved base.
            const again = fetchBase(cwd, into);
            if (again.ref && !isAncestor(cwd, again.ref, commit)) return { branch, into, error: BASE_MOVED, base_moved: true };
            push.ok = false;
            push.error = push.lines.slice(-3).join(' ');
            return { branch, into, push, merge_request: null, pushed_to_base: false, commit };
        }
    } else {
        push.local_only = true;
    }

    const note = moveLocalBase(cwd, into, branch);
    if (note && !remote) {
        return { branch, into, error: `${note}. This repository has no remote, so the work is not on the base branch.` };
    }
    recordPush(briefFile, into);
    const out = { branch, into, push, merge_request: null, pushed_to_base: true, commit };
    if (note) out.note = note;
    return out;
}

module.exports = { BASE_MOVED, pushToBase };
