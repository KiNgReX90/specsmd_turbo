/**
 * specsmd AI-DLC Turbo - read a story's diff against HEAD, per file.
 *
 * Builders never commit, so `git diff HEAD` in the story's code root is the
 * whole story (story-verify.cjs ran `git add -N .`, so new files are in it).
 * Paths are relative to the code root (`--relative`), with forward slashes.
 * Renames are off: a renamed file is a deleted one plus an added one.
 *
 * - changedFiles: every changed path with its status letter (A, M, D, T).
 * - addedLines: the lines the diff adds to one file, 1-based in the new file.
 *
 * Node builtins only: the target project often has no node_modules at all.
 */

const { spawnSync } = require('child_process');

const DIFF = ['diff', 'HEAD', '--relative', '--no-renames', '--no-color', '--no-ext-diff'];

/** Run git, never throwing. */
function git(args, cwd) {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return { ok: r.status === 0, stdout: r.stdout || '', out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

/** Every changed path, [{ status, file }], minus the artifact root. Or { error }. */
function changedFiles(codeRoot, prefix = null) {
    const args = [...DIFF, '--name-status', '-z', '--', '.'];
    if (prefix) args.push(`:(exclude)${prefix}`);
    const r = git(args, codeRoot);
    if (!r.ok) return { error: `git diff failed in ${codeRoot}: ${r.out}` };
    const parts = r.stdout.split('\0').filter(Boolean);
    const files = [];
    for (let i = 0; i + 1 < parts.length; i += 2) files.push({ status: parts[i][0], file: parts[i + 1] });
    return { files };
}

/** The added lines of a -U0 unified diff of one file: [{ line, text }], text without the line end. */
function parseAddedLines(diff) {
    const out = [];
    const lines = String(diff).split('\n');
    let oldLeft = 0;
    let newLeft = 0;
    let next = 0;
    for (const raw of lines) {
        if (oldLeft > 0 || newLeft > 0) {
            if (raw.startsWith('+')) {
                out.push({ line: next, text: raw.slice(1).replace(/\r$/, '') });
                next += 1;
                newLeft -= 1;
            } else if (raw.startsWith('-')) {
                oldLeft -= 1;
            } else if (raw.startsWith(' ')) {
                next += 1;
                oldLeft -= 1;
                newLeft -= 1;
            }
            continue;
        }
        const hunk = raw.match(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (!hunk) continue;
        oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
        next = Number(hunk[2]);
        newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
    }
    return out;
}

/** The lines `git diff HEAD` adds to one file. Returns { lines } or { error }. */
function addedLines(codeRoot, file) {
    const r = git([...DIFF, '-U0', '--', `:(literal)${file}`], codeRoot);
    if (!r.ok) return { error: `git diff failed in ${codeRoot}: ${r.out}` };
    return { lines: parseAddedLines(r.stdout) };
}

module.exports = { changedFiles, parseAddedLines, addedLines };
