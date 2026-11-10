#!/usr/bin/env node

/**
 * specsmd AI-DLC Turbo - verify one story.
 *
 * Runs the brief's `## Verification` commands in the story's code root and
 * writes the proof, so the evidence never comes from the builder itself:
 *
 * 0. Story runs: a mutant a cut-off story-mutate.cjs run left behind
 *    (lib/mutant-marker.cjs) is put back first, with `restored {file}: a
 *    mutant run was cut off` on stderr. A file changed since that run is an
 *    error: `a cut-off mutant run left {file} changed since: compare it with
 *    {marker} by hand`, and nothing else happens.
 * 1. `git -C {code root} add -N .`, so `git diff HEAD` also shows new files.
 * 2. Every command in order, in the code root, each with a timeout that kills
 *    its whole process tree (exit 124). The first failing command stops the
 *    run; the rest are recorded as skipped.
 * 3. The diff hash, taken after the commands (with `add -N .` again), so a
 *    file a command rewrote (a formatter, generated sources, a lockfile) is in
 *    it: sha256 of `git diff HEAD` without the artifact root. The reviewer
 *    reads the same diff; story-land.cjs refuses a diff that changed.
 * 4. The tests the story changed (lib/test-files.cjs says what a test file
 *    is, codebase.playwright_test_dir of repo.yaml included): the test files
 *    at HEAD that the diff modifies or deletes (one the story added is not
 *    listed), and every line the diff adds to a test file, new ones included,
 *    that switches a test off (`.skip(`, `xit(`, `@Disabled`, `t.Skip(`, ...).
 *    A marker that was already there is no finding. Any switch-off fails the
 *    proof, whatever the commands did.
 * 5. `{intent}/proof/{SSS}.json`: { story, code_root, diff_sha, finished_at,
 *    passed, tests_changed: { modified: [path], deleted: [path], switched_off:
 *    [{ file, line, text }] }, commands: [{ command, exit, seconds,
 *    passed_count, failed_count, tail }] }. Paths are repo-relative with
 *    forward slashes, `line` is 1-based in the new file and `text` trimmed.
 *    The counts are parsed for vitest, jest, mocha, pytest, go test, dotnet
 *    test, phpunit and maven when the output shows them, else null. The tail is
 *    the last 40 lines. Full output is never printed or kept. story-mutate.cjs
 *    later adds `mutants` to the same file and leaves the rest alone.
 * 6. On stdout the line `PASS|FAIL {story} {n}/{m} commands[ ({counts})]`,
 *    then one line per switch-off: `switched off: {file}:{line}: {text}`.
 *
 * The story id `intent` is the full run at finish: no story, the proof goes to
 * `proof/intent.json`, with `tests_changed: null`. Sandbox mode verifies
 * exactly as production. Exit 1 when any command fails, a test is switched
 * off, or the brief has no verification commands.
 *
 * Usage:
 *   node .specsmd/aidlc-turbo/scripts/story-verify.cjs <intent-slug> <SSS|intent> --code-root <dir> \
 *     [--timeout <seconds per command, default 1800>] [--root .specs-aidlc-turbo]
 *
 * Node builtins only, plus ./frontmatter.cjs and ./lib/*.cjs: the target
 * project often has no node_modules at all.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { DEFAULT_ROOT, normId, resolveIntent, findStory, readBrief } = require('./intent-status.cjs');
const { git, artifactPrefix, parseYamlMap } = require('./story-start.cjs');
const paths = require('./lib/paths.cjs');
const { normPath, isTestFile, isSwitchOff } = require('./lib/test-files.cjs');
const { changedFiles, addedLines } = require('./lib/diff-lines.cjs');
const { recoverMarker } = require('./lib/mutant-marker.cjs');

const TAIL_LINES = 40;
const INTENT_RUN = 'intent';
const DEFAULT_TIMEOUT = 1800;

/** Parse argv into positionals and flags. */
function parseArgs(argv) {
    const out = { positional: [], codeRoot: null, timeout: DEFAULT_TIMEOUT, root: DEFAULT_ROOT };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--code-root') { out.codeRoot = argv[i + 1] || null; i += 1; }
        else if (arg === '--timeout') { out.timeout = Number(argv[i + 1]); i += 1; }
        else if (arg === '--root') { out.root = argv[i + 1] || DEFAULT_ROOT; i += 1; }
        else if (arg === '--help' || arg === '-h') out.help = true;
        else if (!arg.startsWith('--')) out.positional.push(arg);
    }
    return out;
}

// eslint-disable-next-line no-control-regex
const stripAnsi = (text) => String(text).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

const num = (line, re) => {
    const m = line.match(re);
    return m ? Number(m[1]) : 0;
};

/** The last line matching re, or null. */
function lastLine(lines, re) {
    for (let i = lines.length - 1; i >= 0; i -= 1) if (re.test(lines[i])) return lines[i];
    return null;
}

/**
 * Passed and failed test counts from a runner's summary, or nulls when the
 * output shows none.
 */
function parseCounts(output) {
    const lines = stripAnsi(output).split(/\r?\n/);
    const counts = (passed, failed) => ({ passed, failed });
    let line;

    // vitest: " Tests  1 failed | 13 passed (14)"
    if ((line = lastLine(lines, /^\s*Tests\s{2,}.*\bpassed\b|^\s*Tests\s{2,}.*\bfailed\b/))) {
        return counts(num(line, /(\d+) passed/), num(line, /(\d+) failed/));
    }
    // jest: "Tests:       1 failed, 13 passed, 14 total"
    if ((line = lastLine(lines, /^\s*Tests:\s+.*\d+ total/))) {
        return counts(num(line, /(\d+) passed/), num(line, /(\d+) failed/));
    }
    // dotnet: "Passed!  - Failed:     0, Passed:    14, ..." per project, summed
    const dotnet = lines.filter((l) => /(Passed|Failed)!\s+-\s+Failed:\s+\d+,\s+Passed:\s+\d+/.test(l));
    if (dotnet.length) {
        return counts(
            dotnet.reduce((n, l) => n + num(l, /Passed:\s+(\d+)/), 0),
            dotnet.reduce((n, l) => n + num(l, /Failed:\s+(\d+)/), 0),
        );
    }
    // dotnet 8+: "Test summary: total: 14, failed: 0, succeeded: 14, skipped: 0"
    if ((line = lastLine(lines, /Test summary: total: \d+/))) {
        return counts(num(line, /succeeded: (\d+)/), num(line, /failed: (\d+)/));
    }
    // phpunit: "OK (14 tests, 30 assertions)" or "Tests: 14, Assertions: 30, Errors: 1, Failures: 1."
    if ((line = lastLine(lines, /^OK \(\d+ tests?,/))) return counts(num(line, /(\d+) tests?/), 0);
    if ((line = lastLine(lines, /^Tests: \d+, Assertions: \d+/))) {
        const failed = num(line, /Errors: (\d+)/) + num(line, /Failures: (\d+)/);
        return counts(num(line, /^Tests: (\d+)/) - failed, failed);
    }
    // maven surefire: "Tests run: 14, Failures: 1, Errors: 0, Skipped: 0" (the last one is the total)
    if ((line = lastLine(lines, /Tests run: \d+, Failures: \d+, Errors: \d+/))) {
        const failed = num(line, /Failures: (\d+)/) + num(line, /Errors: (\d+)/);
        return counts(num(line, /Tests run: (\d+)/) - failed - num(line, /Skipped: (\d+)/), failed);
    }
    // pytest: "==== 13 passed, 1 failed in 0.52s ====" or "13 passed in 0.10s"
    if ((line = lastLine(lines, /\b\d+ (passed|failed|error)s?\b.*\bin [\d.]+s\b/))) {
        return counts(num(line, /(\d+) passed/), num(line, /(\d+) failed/) + num(line, /(\d+) errors?/));
    }
    // mocha: "  14 passing (20ms)" and "  1 failing"
    const passing = lastLine(lines, /^\s*\d+ passing\b/);
    if (passing) return counts(num(passing, /(\d+) passing/), num(lastLine(lines, /^\s*\d+ failing\b/) || '', /(\d+) failing/));
    // go test -v: one "--- PASS:" or "--- FAIL:" line per test
    const goPass = lines.filter((l) => /^\s*--- PASS: /.test(l)).length;
    const goFail = lines.filter((l) => /^\s*--- FAIL: /.test(l)).length;
    if (goPass + goFail > 0) return counts(goPass, goFail);
    return counts(null, null);
}

/** The last n non-empty-trailing lines of the output, ANSI codes removed. */
function tail(output, n = TAIL_LINES) {
    const lines = stripAnsi(output).replace(/\s+$/, '').split(/\r?\n/);
    return lines.slice(-n).join('\n');
}

/**
 * Runs the command in the shell, in a process group of its own (POSIX), and
 * at the timeout kills that whole group (taskkill /T on Windows), so no test
 * process outlives it. Exits 124 when it killed; an interrupt of the run
 * kills the group too. Run as `node -e`.
 */
const SUPERVISOR = `
const { spawn, spawnSync } = require('child_process');
const [command, ms] = process.argv.slice(1);
const win = process.platform === 'win32';
const child = spawn(command, { shell: true, stdio: 'inherit', detached: !win, windowsHide: true });
let killed = false;
const killAll = () => {
    killed = true;
    try {
        if (win) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
        else process.kill(-child.pid, 'SIGKILL');
    } catch { child.kill('SIGKILL'); }
};
const timer = setTimeout(killAll, Number(ms));
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { killAll(); process.exit(130); });
child.on('error', (e) => { console.error(e.message); process.exit(1); });
child.on('exit', (code) => { clearTimeout(timer); process.exit(killed ? 124 : (code === null ? 1 : code)); });
`;

/** Run one command in the shell, stdout and stderr into one temp file, with a timeout. */
function runCommand(command, cwd, timeoutSec) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turbo-verify-'));
    const file = path.join(dir, 'out.log');
    const fd = fs.openSync(file, 'w');
    const started = Date.now();
    const ms = timeoutSec * 1000;
    let r;
    try {
        r = spawnSync(process.execPath, ['-e', SUPERVISOR, command, String(ms)], {
            cwd, stdio: ['ignore', fd, fd], timeout: ms + 30000, killSignal: 'SIGKILL', windowsHide: true,
        });
    } finally {
        fs.closeSync(fd);
    }
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    const output = fs.readFileSync(file, 'utf8');
    fs.rmSync(dir, { recursive: true, force: true });
    const timedOut = (r.status === 124 && Date.now() - started >= ms) || Boolean(r.error && r.error.code === 'ETIMEDOUT')
        || (r.signal === 'SIGKILL' && r.status === null);
    const { passed, failed } = parseCounts(output);
    const result = {
        command,
        exit: timedOut ? 124 : (r.status === null ? 1 : r.status),
        seconds,
        passed_count: passed,
        failed_count: failed,
        tail: tail(output) + (timedOut ? `\n[timed out after ${timeoutSec}s]` : ''),
    };
    if (timedOut) result.timed_out = true;
    return result;
}

/** sha256 of the code root's diff against HEAD, without the artifact root. */
function diffSha(codeRoot, prefix) {
    const args = ['diff', 'HEAD', '--', '.'];
    if (prefix) args.push(`:(exclude)${prefix}`);
    const r = git(args, codeRoot);
    if (!r.ok) return { error: `git diff failed in ${codeRoot}: ${r.out}` };
    return { sha: crypto.createHash('sha256').update(r.stdout).digest('hex') };
}

/** codebase.playwright_test_dir of repo/repo.yaml, or null. */
function playwrightDir(absRoot) {
    const file = paths.layout(absRoot).repoYaml;
    if (!fs.existsSync(file)) return null;
    const codebase = parseYamlMap(fs.readFileSync(file, 'utf8')).codebase || {};
    const dir = codebase.playwright_test_dir;
    return typeof dir === 'string' && normPath(dir) ? normPath(dir) : null;
}

/**
 * The tests the story changed: existing test files it modified or deleted, and
 * every added line in a test file that switches a test off. Or { error }.
 */
function testsChanged(codeRoot, prefix, pwDir) {
    const changed = changedFiles(codeRoot, prefix);
    if (changed.error) return changed;
    const tests = changed.files.filter((c) => isTestFile(c.file, pwDir));
    const out = {
        modified: tests.filter((c) => c.status === 'M' || c.status === 'T').map((c) => c.file),
        deleted: tests.filter((c) => c.status === 'D').map((c) => c.file),
        switched_off: [],
    };
    for (const c of tests.filter((t) => t.status !== 'D')) {
        const added = addedLines(codeRoot, c.file);
        if (added.error) return added;
        for (const a of added.lines.filter((l) => isSwitchOff(l.text))) {
            out.switched_off.push({ file: c.file, line: a.line, text: a.text.trim() });
        }
    }
    return { tests: out };
}

/** One stdout line per switch-off: `switched off: {file}:{line}: {text}`. */
const switchedOffLines = (proof) => ((proof.tests_changed && proof.tests_changed.switched_off) || [])
    .map((s) => `switched off: ${s.file}:${s.line}: ${s.text}`);

/** The summary line: PASS|FAIL {story} {n}/{m} commands[ ({counts})]. */
function summaryLine(proof) {
    const ok = proof.commands.filter((c) => c.exit === 0).length;
    const counted = proof.commands.filter((c) => c.passed_count !== null || c.failed_count !== null);
    let counts = '';
    if (counted.length) {
        const p = counted.reduce((n, c) => n + (c.passed_count || 0), 0);
        const f = counted.reduce((n, c) => n + (c.failed_count || 0), 0);
        counts = ` (${p} passed${f ? `, ${f} failed` : ''})`;
    }
    return `${proof.passed ? 'PASS' : 'FAIL'} ${proof.story} ${ok}/${proof.commands.length} commands${counts}`;
}

/** Verify one story. Returns { proof, file, line, lines, notes } or { error }. */
function verifyStory({ root = DEFAULT_ROOT, intentSlug, storyId, codeRoot, timeout = DEFAULT_TIMEOUT, cwd = process.cwd() }) {
    const id = normId(storyId);
    const absRoot = path.resolve(cwd, root);
    const { intent, error } = resolveIntent(absRoot, intentSlug);
    if (error) return { error };
    const story = id === INTENT_RUN ? { id } : findStory(intent, id);
    if (!story) return { error: `story not found: ${id} in ${intent.stories}` };
    const dir = path.resolve(cwd, codeRoot);
    if (!fs.existsSync(dir)) return { error: `code root not found: ${dir}` };
    const notes = [];
    if (story.id !== INTENT_RUN) {
        const recovered = recoverMarker(intent.proof, story.id);
        if (recovered.error) return { error: recovered.error };
        if (recovered.note) notes.push(recovered.note);
    }

    const brief = readBrief(intent);
    const prefix = artifactPrefix(cwd, root);
    /** `git add -N .`, then the diff hash: the tree as the reviewer and story-land see it. */
    const hashTree = () => {
        const add = git(['add', '-N', '.'], dir);
        if (!add.ok) return { error: `git add -N failed in ${dir}: ${add.out}` };
        return diffSha(dir, prefix);
    };
    const before = hashTree();
    if (before.error) return before;

    const commands = [];
    let failed = false;
    for (const command of brief.verification) {
        if (failed) {
            commands.push({ command, exit: null, seconds: 0, passed_count: null, failed_count: null, tail: '', skipped: true });
            continue;
        }
        const result = runCommand(command, dir, timeout);
        commands.push(result);
        if (result.exit !== 0) failed = true;
    }

    // After the commands: a formatter, a generated source or a lockfile they
    // rewrote is part of the tree the proof covers.
    const after = hashTree();
    if (after.error) return after;
    let tests = null;
    if (story.id !== INTENT_RUN) {
        const changed = testsChanged(dir, prefix, playwrightDir(absRoot));
        if (changed.error) return changed;
        tests = changed.tests;
    }
    const switchedOff = Boolean(tests && tests.switched_off.length);

    const proof = {
        story: story.id,
        code_root: dir,
        diff_sha: after.sha,
        finished_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        passed: commands.length > 0 && !failed && !switchedOff,
        tests_changed: tests,
        commands,
    };
    if (!commands.length) proof.note = 'the brief has no ## Verification commands';
    fs.mkdirSync(intent.proof, { recursive: true });
    const file = path.join(intent.proof, `${story.id}.json`);
    fs.writeFileSync(file, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
    const line = summaryLine(proof);
    return { proof, file, line, lines: [line, ...switchedOffLines(proof)], notes };
}

module.exports = {
    TAIL_LINES, INTENT_RUN, stripAnsi, parseCounts, tail, runCommand, diffSha, summaryLine,
    playwrightDir, testsChanged, verifyStory,
};

if (require.main === module) {
    const options = parseArgs(process.argv.slice(2));
    const [intentSlug, storyId] = options.positional;
    const badTimeout = !Number.isFinite(options.timeout) || options.timeout <= 0;
    if (options.help || !intentSlug || !storyId || !options.codeRoot || badTimeout) {
        const usage = `
Usage: node story-verify.cjs <intent-slug> <SSS|intent> --code-root <dir> [options]

Options:
  --code-root <dir>   Where the story's code is: its worktree, or the project tree for the intent run (required)
  --timeout <sec>     Timeout per command, default ${DEFAULT_TIMEOUT}
  --root <dir>        Artifact root, default ${DEFAULT_ROOT}
  --help, -h          Show this message
`;
        if (options.help) console.log(usage); else console.error(usage);
        process.exitCode = options.help ? 0 : 2;
    } else {
        try {
            const result = verifyStory({ root: options.root, intentSlug, storyId, codeRoot: options.codeRoot, timeout: options.timeout });
            (result.notes || []).forEach((note) => console.error(note));
            if (result.error) {
                console.error(`Error: ${result.error}`);
                process.exitCode = 1;
            } else {
                console.log(result.lines.join('\n'));
                process.exitCode = result.proof.passed ? 0 : 1;
            }
        } catch (error) {
            console.error(`Error: ${error.message}`);
            process.exitCode = 1;
        }
    }
}
