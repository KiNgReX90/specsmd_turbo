/**
 * specsmd AI-DLC Turbo - run the analysis and lint tools on one change.
 *
 * The change is what the code root holds beyond a base (default HEAD:
 * builders never commit, so that is the story): the files `git diff <base>`
 * names plus the untracked ones, without the artifact root. Every tool of
 * kind analysis or lint whose `files` globs match a changed file runs once,
 * in the code root, with `{files}` (space separated, quoted) or
 * `{files_comma}` in its command replaced by those files. A tool whose
 * programs are not on this machine is skipped and named.
 *
 * Old code is full of old findings, and those are not this change's. So the
 * output is cut to what the change made: a line that names a changed file
 * with a line number the change added is a finding (`touched`). The rest is
 * only counted. A tool that fails without one such line hands back the tail
 * of its output (`exit_nonzero`), so a broken command shows.
 *
 * Node builtins only: the target project often has no node_modules at all.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseAddedLines } = require('./diff-lines.cjs');
const { onPath } = require('./tooling-env.cjs');

const ARTIFACT_DIR = '.specs-aidlc-turbo';
const DEFAULT_TIMEOUT_S = 300;
const MAX_TOUCHED = 40;
const TAIL = 15;

function git(args, cwd) {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return { ok: r.status === 0, stdout: r.stdout || '', out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

/** A glob (`**`, `*`, `?`, `{a,b}`) as a RegExp over a forward-slash path. */
function globToRegExp(glob) {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*' && glob[i + 1] === '*') {
            const slash = glob[i + 2] === '/';
            re += slash ? '(?:.*/)?' : '.*';
            i += slash ? 2 : 1;
        } else if (c === '*') re += '[^/]*';
        else if (c === '?') re += '[^/]';
        else if (c === '{') {
            const end = glob.indexOf('}', i);
            if (end < 0) { re += '\\{'; continue; }
            re += `(?:${glob.slice(i + 1, end).split(',').map((p) => p.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`;
            i = end;
        } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${re}$`);
}

function matches(file, globs) {
    const list = [].concat(globs || []).filter(Boolean);
    if (list.length === 0) return true;
    return list.some((g) => globToRegExp(g).test(file) || (!g.includes('/') && globToRegExp(g).test(path.posix.basename(file))));
}

/** The change: { files: [{ file, added: Set<line> }] } or { error }. */
function change(codeRoot, base = 'HEAD') {
    const tracked = git(['diff', base, '--relative', '--no-renames', '--diff-filter=d', '--name-only', '-z', '--', '.', `:(exclude)${ARTIFACT_DIR}`], codeRoot);
    if (!tracked.ok) return { error: `git diff ${base} failed in ${codeRoot}: ${tracked.out}` };
    const untracked = git(['ls-files', '--others', '--exclude-standard', '-z', '--', '.', `:(exclude)${ARTIFACT_DIR}`], codeRoot);
    const names = [...new Set([...tracked.stdout.split('\0'), ...untracked.stdout.split('\0')].filter(Boolean))];
    const fresh = new Set(untracked.stdout.split('\0').filter(Boolean));
    const files = names.map((file) => {
        if (fresh.has(file)) {
            let count = 0;
            try {
                const text = fs.readFileSync(path.join(codeRoot, file), 'utf8');
                count = text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
            } catch { /* unreadable */ }
            return { file, added: new Set(Array.from({ length: count }, (_, i) => i + 1)) };
        }
        const d = git(['diff', base, '--relative', '--no-renames', '--no-color', '--no-ext-diff', '-U0', '--', `:(literal)${file}`], codeRoot);
        return { file, added: new Set(parseAddedLines(d.stdout).map((l) => l.line)) };
    });
    return { files };
}

function quote(file, platform) {
    if (platform === 'win32') return `"${file}"`;
    return `'${file.replace(/'/g, "'\\''")}'`;
}

/** Where a line of output points: the changed file it names and the line number after it. */
function pointsAt(text, files, current) {
    for (const f of files) {
        const idx = text.replace(/\\/g, '/').lastIndexOf(f.file);
        if (idx < 0) continue;
        const after = text.replace(/\\/g, '/').slice(idx + f.file.length);
        const m = after.match(/^["']?\s*(?::|\(|:\[|,\s*line\s*|\s+line\s+|\[line\s*)\s*(\d+)/i);
        return { file: f, line: m ? Number(m[1]) : null, header: after.trim() === '' };
    }
    // eslint-style blocks: a line with only the file, then "  12:5  error ..."
    const row = text.match(/^\s+(\d+):\d+\s/);
    if (row && current) return { file: current, line: Number(row[1]), header: false };
    return null;
}

/** Cut one tool's output to the change. */
function cut(output, files) {
    const touched = [];
    let elsewhere = 0;
    let other = 0;
    let current = null;
    for (const raw of output.split('\n')) {
        const text = raw.replace(/\r$/, '');
        if (!text.trim()) continue;
        const at = pointsAt(text, files, current);
        if (!at) { other += 1; continue; }
        if (at.header) { current = at.file; continue; }
        if (at.line !== null && at.file.added.has(at.line)) {
            if (touched.length < MAX_TOUCHED) touched.push(text.trim().slice(0, 300));
        } else elsewhere += 1;
    }
    return { touched, elsewhere, other };
}

/** Run every analysis and lint tool of `tooling` (or only `only`) on the change in `codeRoot`. */
function runTools(tooling, codeRoot, { base = 'HEAD', only = null, platform = process.platform, environment = process.env } = {}) {
    const ch = change(codeRoot, base);
    if (ch.error) return { error: ch.error };
    const tools = (tooling.tools || []).filter((t) => (t.kind === 'analysis' || t.kind === 'lint') && (!only || t.name === only));
    if (only && tools.length === 0) return { error: `no analysis or lint tool named ${only} in the tooling file` };
    const results = tools.map((tool) => {
        const missing = [].concat(tool.needs || []).filter((p) => !onPath(p, environment, platform));
        if (missing.length > 0) return { tool: tool.name, status: 'skipped', reason: `not on this machine: ${missing.join(', ')}` };
        const mine = ch.files.filter((f) => matches(f.file, tool.files));
        if (mine.length === 0) return { tool: tool.name, status: 'skipped', reason: 'no changed file for this tool' };
        const command = String(tool.run)
            .replace(/\{files_comma\}/g, mine.map((f) => f.file).join(','))
            .replace(/\{files\}/g, mine.map((f) => quote(f.file, platform)).join(' '));
        const timeout = Math.min(Number(tool.timeout) || DEFAULT_TIMEOUT_S, 1800) * 1000;
        const r = spawnSync(command, { cwd: codeRoot, shell: true, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, env: environment });
        const output = `${r.stdout || ''}\n${r.stderr || ''}`;
        const { touched, elsewhere, other } = cut(output, mine);
        const exit = r.error && r.error.code === 'ETIMEDOUT' ? 'timeout' : r.status;
        const result = { tool: tool.name, command, exit, status: touched.length > 0 ? 'findings' : 'clean', touched, elsewhere_in_changed_files: elsewhere, other_lines: other };
        if (touched.length === 0 && elsewhere === 0 && exit !== 0) {
            result.status = 'exit_nonzero';
            result.tail = output.trim().split('\n').slice(-TAIL);
        }
        return result;
    });
    return { code_root: path.resolve(codeRoot), base, changed_files: ch.files.length, results };
}

module.exports = { runTools, globToRegExp, matches, cut, change };
