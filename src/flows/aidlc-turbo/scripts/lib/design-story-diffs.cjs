/**
 * specsmd AI-DLC Turbo - the change of a file per story.
 *
 * GitLab shows what a story changed in its own merge request. A file that
 * more than one story changed carries on the overview, beside its whole
 * change, what each story did to it, so the Review tab can show it per story:
 *
 *   model.build.diffs[path].stories   { [story id]: { text, added, removed, truncated } }
 *
 * A story's commits are those since the base whose subject ends in "(S001)",
 * as story-land.cjs and the fixes of finish write them, feat and fix alike. A
 * merge is never one: a story branch merged in brings its own commits along.
 * Per story the diff of each of its commits to the file, one after the other,
 * the counts summed. Only for a file at least two stories changed, never for
 * one the page left out for its size, and only while the page's budget of
 * text holds. Any git error is no stories: git never fails the overview.
 *
 * Node builtins only; design-diffs.cjs hands in how it reads a diff.
 */

const { spawnSync } = require('child_process');

const STORY = /\(S(\d+)\)\s*$/;

/** Git's output as bytes, or null on an error. */
function run(args, cwd) {
    const r = spawnSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return r.status === 0 && r.stdout ? r.stdout : null;
}

/** Story id ("001") -> its commits since `base`, oldest first. */
function storyCommits(cwd, base) {
    const out = new Map();
    const raw = run(['log', '--no-merges', '--reverse', '--format=%H%x09%s', `${base}..HEAD`], cwd);
    if (!raw) return out;
    for (const line of raw.toString('utf8').split('\n')) {
        const tab = line.indexOf('\t');
        const m = tab > 0 ? STORY.exec(line.slice(tab + 1)) : null;
        if (!m) continue;
        const id = m[1].padStart(3, '0');
        if (!out.has(id)) out.set(id, []);
        out.get(id).push(line.slice(0, tab));
    }
    return out;
}

/** The files one commit changed. */
function touched(cwd, sha) {
    const raw = run(['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '--no-renames', sha], cwd);
    return new Set(raw ? raw.toString('utf8').split('\0').filter(Boolean) : []);
}

/**
 * Put `stories` on every entry of `diffs` whose file two or more stories changed. `files` maps the key of an
 * entry (part.path) to the file git knows; `o` gives { fileDiff, decode, args, used, max }: how a diff is read,
 * git's diff options, the text the page holds already and its budget.
 */
function addStoryDiffs(diffs, files, cwd, base, o) {
    try {
        const by = storyCommits(cwd, base);
        if (by.size < 2) return diffs;
        const commits = [...by].flatMap(([id, shas]) => shas.map((sha) => ({ id, sha, files: touched(cwd, sha) })));
        let used = o.used || 0;
        for (const [key, f] of files) {
            const e = diffs[key];
            if (!e || e.omitted) continue;
            const mine = commits.filter((c) => c.files.has(f));
            const ids = [...new Set(mine.map((c) => c.id))];
            if (ids.length < 2) continue;
            const stories = {};
            for (const id of ids) {
                const parts = mine.filter((c) => c.id === id).map((c) => {
                    const raw = run(['--literal-pathspecs', 'diff', ...o.args, `${c.sha}^`, c.sha, '--', f], cwd);
                    return raw ? o.fileDiff(o.decode(raw)) : null;
                }).filter(Boolean);
                if (!parts.length) continue;
                stories[id] = {
                    text: parts.map((p) => p.text).join('\n'),
                    added: parts.reduce((n, p) => n + p.added, 0),
                    removed: parts.reduce((n, p) => n + p.removed, 0),
                    truncated: parts.reduce((n, p) => n + p.truncated, 0),
                };
            }
            const size = Object.values(stories).reduce((n, s) => n + Buffer.byteLength(s.text), 0);
            if (Object.keys(stories).length < 2 || used + size > o.max) continue;
            used += size;
            e.stories = stories;
        }
    } catch {
        // git never fails the overview: the whole change stays
    }
    return diffs;
}

module.exports = { storyCommits, addStoryDiffs };
