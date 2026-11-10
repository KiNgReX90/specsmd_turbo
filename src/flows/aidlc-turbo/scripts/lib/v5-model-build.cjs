/**
 * specsmd AI-DLC Turbo - the build half of the v5 overview model.
 *
 * addBuild(model, ctx) is the afterBuild seam of lib/v5-model.cjs: after the
 * build (phase construction) it adds to the model what the build did, from
 * the enrichment the flow already has, never worked out again:
 *
 *   build             the build block of lib/design-build.cjs applyBuild() on
 *                     the Code Scaffold, with a drawing and a built story only
 *                     (as the overview page): { stories: [{ id, n, built,
 *                     different, extra, gone }], different, extra, gone }; the
 *                     kit reads a deviation from it where a part carries none
 *   parts[id]         every drawn part its `build` (its deviation, or as
 *                     planned); a part the build added (state added) joins the
 *                     parts, or, while a change is open (ctx.plan),
 *                     build.parts[id]: the drawings show the plan
 *   stories[]         the panels' facts per story: `files` (its changed
 *                     files, tests among them) and `tests`, `commits`, `first`
 *                     (the author date of its first commit), `merged` (the
 *                     commit date of its last, once it is done; without git
 *                     its `completed`), `branch` (its own, else the intent
 *                     branch) and `mr` / `url` (lib/review-links.cjs
 *                     putRequests: its own merge request, else the intent's)
 *
 * A story's commits are those whose subject is the flow's own,
 * `feat|fix({intent}): ... (S001)` (story-land.cjs and the fixes of finish),
 * never a merge, from the base branch's merge-base on (lib/design-diffs.cjs
 * diffBase) on the intent branch and on each story branch; without a base
 * (sandbox) among the last commits of HEAD. Not a git repo, or any git error:
 * one commit when the frontmatter names one, no dates. Git never fails the page.
 *
 * Node builtins only, plus the flow's own libraries named below.
 */

'use strict';

const path = require('path');
const { applyBuild } = require('./design-build.cjs');
const { diffBase } = require('./design-diffs.cjs');
const { putRequests } = require('./review-links.cjs');
const { scaffoldOf } = require('./v5-model.cjs');
const { isTestFile, storyFiles, field, normalizePath } = require('./overview-read.cjs');
const { present, list } = require('./overview-text.cjs');
const { ARTIFACT_DIR } = require('./paths.cjs');
const { readSettings, git } = require('../story-start.cjs');

const ARTIFACTS = /(^|\/)\.specs-aidlc-turbo\//;
const RECENT = 2000;
const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const text = (v) => (present(v) ? String(v).trim() : null);

/** The files a built story changed, the flow's own artifacts left out; none before it changed any. */
const changedFiles = (s) => [...new Set(list(field(s, 'changed_files')).filter(present).map(normalizePath))]
    .filter((f) => !ARTIFACTS.test(f));

/**
 * The drawn parts with their build; a part the build added joins them, or with `plan` (a change open) stands apart
 * in build.parts, so the drawings keep to the plan.
 */
function partsBuilt(model, design, plan) {
    const again = scaffoldOf(design);
    const apart = plan && design.build ? (design.build.parts = {}) : null;
    for (const p of design.parts) {
        if (!p.id || !again.parts[p.id]) continue;
        const home = model.parts[p.id] || !apart ? model.parts : apart;
        const part = home[p.id] || (home[p.id] = again.parts[p.id]);
        if (p.build) part.build = p.build;
    }
}

/** Story id ('001') -> [{ sha, first, last }] of its commits, oldest first; an empty map on any git error. */
function storyCommits(cwd, ctx) {
    const out = new Map();
    try {
        const base = diffBase(cwd, readSettings(path.resolve(cwd, ctx.root || ARTIFACT_DIR), ctx.brief.data || {}));
        if (!base) return out;
        const head = git(['rev-parse', '--verify', '-q', 'HEAD^{commit}'], cwd).stdout;
        const own = [...new Set(ctx.raw.map((s) => text(field(s, 'branch'))).filter(Boolean))]
            .filter((b) => git(['rev-parse', '--verify', '-q', `refs/heads/${b}^{commit}`], cwd).ok);
        const ranges = base === head ? [['-n', String(RECENT), 'HEAD']]
            : ['HEAD', ...own.map((b) => `refs/heads/${b}`)].map((ref) => [`${base}..${ref}`]);
        const subject = new RegExp(`^[a-z]+\\(${reEsc(ctx.intent.slug)}\\)!?:.*\\(S(\\d+)\\)\\s*$`);
        const seen = new Set();
        for (const range of ranges) {
            const r = git(['log', '--no-merges', '--format=%H%x09%aI%x09%cI%x09%s', ...range], cwd);
            if (!r.ok) throw new Error('git');
            for (const line of r.raw.split('\n')) {
                const [sha, first, last, ...rest] = line.split('\t');
                const m = sha && subject.exec(rest.join('\t'));
                if (!m || seen.has(sha)) continue;
                seen.add(sha);
                const id = m[1].padStart(3, '0');
                out.set(id, [...(out.get(id) || []), { sha, first, last }]);
            }
        }
        for (const shas of out.values()) shas.sort((a, b) => Date.parse(a.last) - Date.parse(b.last) || Date.parse(a.first) - Date.parse(b.first));
    } catch {
        return new Map();
    }
    return out;
}

/** The panels' facts of every story: files, tests, commits, first, merged, branch, mr and url. */
function storyFacts(model, ctx, cwd) {
    const byId = new Map(ctx.raw.map((s) => [s.id, s]));
    const commits = storyCommits(cwd, ctx);
    const intentBranch = text(ctx.brief.data.branch);
    for (const u of list(model.stories)) {
        const s = byId.get(u.id);
        if (!s) continue;
        const files = changedFiles(s);
        const mine = commits.get(u.id) || [];
        const done = String(s.data.status || '') === 'done';
        u.files = files.length;
        u.tests = files.filter(isTestFile).length;
        u.commits = mine.length || (text(field(s, 'commit')) ? 1 : 0);
        u.first = mine.length ? mine[0].first : null;
        u.merged = !done ? null : mine.length ? mine[mine.length - 1].last : text(field(s, 'completed'));
        u.branch = text(field(s, 'branch')) || intentBranch;
    }
    putRequests(model, { brief: ctx.brief.data, stories: ctx.raw });
}

/** The build half onto a v5 model, after the build; before it the model stays as it is. Returns the model. */
function addBuild(model, ctx) {
    if (!model || !ctx || ctx.phase !== 'construction') return model;
    const { design, raw } = ctx;
    if (design) {
        // as the overview page: the stories that changed files, their test files left out, their notes read
        applyBuild(design, raw.filter((s) => list(field(s, 'changed_files')).length)
            .map((s) => ({ id: s.id, files: storyFiles(s).filter((f) => !isTestFile(f)), notes: s.body })), ctx.table);
        if (design.build) model.build = design.build;
        partsBuilt(model, design, ctx.plan);
    }
    storyFacts(model, ctx, process.cwd());
    return model;
}

module.exports = { addBuild, storyCommits };
