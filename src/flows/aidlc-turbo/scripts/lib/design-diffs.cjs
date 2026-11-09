/**
 * specsmd AI-DLC Turbo - the git diff of every part after the build.
 *
 * After the build a viewer who clicks a part of the Code Scaffold on the
 * overview sees, next to its details, what the build changed in its file.
 * addDiffs(model, { cwd, root, brief }) puts those diffs on a designModel
 * that applyBuild already enriched:
 *
 *   model.build.diffs   { [part.path]: { text, added, removed, truncated } | { omitted: true } }
 *
 *   text       the unified diff of that one file from its first @@ line, the
 *              header lines left out, git's "\ No newline" lines kept
 *   added      the + lines of the whole diff, removed the - lines
 *   truncated  how many diff lines were cut off past 400, 0 when none
 *   omitted    past 250 KB of text the later files (drawing order) get only this
 *   stories    for a file more than one story changed, what each did to it
 *              (design-story-diffs.cjs)
 *
 * The diff is the working tree against the merge-base of HEAD and the base
 * branch (repo/config.yaml `branching.base_branch`, else origin/HEAD), so a
 * committed and an uncommitted build both show. Sandbox mode, or no base to
 * be found, diffs against HEAD. A new untracked file shows as all added.
 * Only a changed file gets an entry; a part in another repo (`repo`) or a
 * folder (no extension) gets none. A file that is not valid UTF-8 (an Oracle
 * script in Windows-1252, "Financiële") is read as Windows-1252, so its
 * letters show as written, never as a broken character. Not a git repo, or any git error, is no
 * diffs at all: git never fails the overview.
 *
 * Node builtins only, plus ../story-start.cjs for the settings and git, and
 * ./design-story-diffs.cjs for the change per story.
 */

const path = require('path');
const { spawnSync } = require('child_process');
const { ARTIFACT_DIR } = require('./paths.cjs');
const { readSettings, git } = require('../story-start.cjs');
const { addStoryDiffs } = require('./design-story-diffs.cjs');

const MAX_LINES = 400;
const MAX_TEXT = 250 * 1024;
const LITERAL = '--literal-pathspecs';
const DIFF = ['--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '-U3'];

const norm = (p) => String(p).trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
const hasExt = (p) => /\.[a-z0-9]+$/i.test(p.split('/').pop());
const nulList = (r) => new Set(r.raw.split('\0').filter(Boolean));

/** part.path to the file git diffs, for every part in this repo that names a file, in drawing order. */
function filesOf(parts) {
    const files = new Map();
    for (const p of Array.isArray(parts) ? parts : []) {
        if (!p || p.repo || typeof p.path !== 'string' || files.has(p.path)) continue;
        const f = norm(p.path);
        if (f && hasExt(f)) files.set(p.path, f);
    }
    return files;
}

/** { text, added, removed, truncated } from git's diff of one file, or null when it has no hunk (binary, mode only). */
function fileDiff(raw) {
    const all = String(raw || '').replace(/\n$/, '').split('\n');
    const at = all.findIndex((l) => l.startsWith('@@'));
    if (at < 0) return null;
    const body = all.slice(at);
    return {
        text: body.slice(0, MAX_LINES).join('\n'),
        added: body.filter((l) => l.startsWith('+')).length,
        removed: body.filter((l) => l.startsWith('-')).length,
        truncated: Math.max(0, body.length - MAX_LINES),
    };
}

/** Git's bytes as text: UTF-8 when they are, else Windows-1252 (an older Oracle script). */
function decode(buf) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
        return new TextDecoder('windows-1252').decode(buf);
    }
}

/** The diff of one file, its text read by decode(). */
function diffOf(args, cwd) {
    const r = spawnSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return { status: r.status, raw: r.stdout ? decode(r.stdout) : '' };
}

/** The commit the build is diffed against, or null when there is none. */
function diffBase(cwd, settings) {
    if (!git(['rev-parse', '--is-inside-work-tree'], cwd).ok) return null;
    const head = git(['rev-parse', '--verify', '-q', 'HEAD^{commit}'], cwd);
    if (!head.ok) return null;
    if (settings.mode !== 'sandbox') {
        const fallback = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd);
        // a bare `base_branch:` reads as an empty map: no base branch
        const branch = typeof settings.baseBranch === 'string' && settings.baseBranch.trim() ? settings.baseBranch.trim() : null;
        const refs = branch ? [`origin/${branch}`, branch] : fallback.ok ? [fallback.stdout] : [];
        for (const ref of refs) {
            const at = git(['merge-base', 'HEAD', `${ref}^{commit}`], cwd);
            if (at.ok && at.stdout) return at.stdout;
        }
    }
    return head.stdout;
}

/** The diff of every changed file, keyed by part.path; throws on a git error. */
function collect(files, cwd, base) {
    const wanted = [...new Set(files.values())];
    const changed = git([LITERAL, 'diff', '--name-only', '-z', '--relative', '--no-renames', base, '--', ...wanted], cwd);
    const untracked = git([LITERAL, 'ls-files', '-z', '--others', '--exclude-standard', '--', ...wanted], cwd);
    if (!changed.ok || !untracked.ok) throw new Error('git');
    const isChanged = nulList(changed);
    const isNew = nulList(untracked);
    const out = {};
    let size = 0;
    let full = false;
    for (const [key, f] of files) {
        let r = null;
        if (isChanged.has(f)) r = diffOf([LITERAL, 'diff', ...DIFF, base, '--', f], cwd);
        // an untracked file has no git diff: against /dev/null it is all added, exit code 1
        else if (isNew.has(f)) r = diffOf(['diff', '--no-index', ...DIFF, '--', '/dev/null', f], cwd);
        if (!r) continue;
        if (r.status !== 0 && !(r.status === 1 && isNew.has(f))) throw new Error('git');
        const d = fileDiff(r.raw);
        if (!d) continue;
        size += Buffer.byteLength(d.text);
        full = full || size > MAX_TEXT;
        out[key] = full ? { omitted: true } : d;
    }
    // a file more than one story changed: what each did to it, while the budget holds
    return addStoryDiffs(out, files, cwd, base, { fileDiff, decode, args: DIFF, used: size, max: MAX_TEXT });
}

/** The diffs of the parts' files after the build, {} when there are none or git fails. */
function designDiffs(parts, { cwd = process.cwd(), root = ARTIFACT_DIR, brief = {} } = {}) {
    try {
        const files = filesOf(parts);
        if (!files.size) return {};
        const base = diffBase(cwd, readSettings(path.resolve(cwd, root || ARTIFACT_DIR), brief || {}));
        return base ? collect(files, cwd, base) : {};
    } catch {
        return {};
    }
}

/** Put the diffs on model.build, only after a build and only when there is one. Returns the model. */
function addDiffs(model, options = {}) {
    if (!model || !model.build) return model;
    const diffs = designDiffs(model.parts, options);
    if (Object.keys(diffs).length) model.build.diffs = diffs;
    return model;
}

module.exports = { designDiffs, addDiffs, fileDiff, diffBase, decode, MAX_LINES, MAX_TEXT };
