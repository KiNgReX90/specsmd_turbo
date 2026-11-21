/**
 * specsmd AI-DLC Turbo - the verdict of one mutant run.
 *
 * A mutant is `killed` only when a test ran and noticed it. A red exit alone
 * proves nothing: a mutant that does not build, does not parse, stops the
 * test collection or runs into the timeout is red as well, while no test saw
 * it. Read in this order, on the run as story-verify.cjs's runCommand returns
 * it (`exit`, `failed_count` from its parser, `tail`, `timed_out`):
 *
 * 1. Exit 0 is `survived`.
 * 2. A timeout (exit 124) is `invalid: timed out`.
 * 3. A run a signal ended (exit 130, 137 or 143, or cargo's `(signal: 9,
 *    SIGKILL`) is `invalid: ended by ...`.
 * 4. A build failure is `invalid: did not build`: javac `File.java:12:
 *    error:`, Gradle's `Compilation failed; see the compiler error output`,
 *    Maven's maven-compiler-plugin goal or `COMPILATION ERROR`, tsc `error
 *    TS1109:` (also inside ts-jest and ts-node), go's `FAIL {pkg} [build
 *    failed]` or `[setup failed]`, dotnet `error CS1002:` (FS, BC too), cargo
 *    `error: could not compile` or `error[E0308]`.
 *    A file node cannot parse is `invalid: did not parse`: the source frame
 *    `{mutated file}:{line}` above a SyntaxError whose first stack frame is
 *    node's module loader (a SyntaxError the code throws while it runs has its
 *    own frame there and stays killed), or vitest's `Transform failed` or
 *    `Parse failure` above `File: {mutated file}`. Only the mutated file
 *    counts there. pytest's `ERROR collecting` or `Interrupted: N error
 *    during collection` is `invalid: did not collect`, although its counts
 *    show the error.
 * 5. Counts (story-verify.cjs parses vitest, jest, mocha, pytest, go test,
 *    dotnet test, phpunit and maven): a failed count of at least 1 is
 *    `killed`, 0 is `invalid: no test failed (exit {n})`.
 * 6. No counts: past the markers above, the red exit is `killed`.
 *
 * The markers are read in the tail the run keeps, where each of these
 * runners ends its output. Ported from the mutant verdict of the INFERNO
 * flow's orchestrator scripts, with the markers of Turbo's stacks added.
 *
 * Node builtins only: the target project often has no node_modules at all.
 */

const fs = require('fs');

const TIMEOUT_EXIT = 124;
/** Exit codes of a run a signal ended: SIGINT, SIGKILL, SIGTERM. */
const SIGNAL_EXITS = new Set([130, 137, 143]);
const KILL_SIGNALS = new Set(['SIGINT', 'SIGKILL', 'SIGTERM']);
/** A compiler that refused the code, per stack. */
const BUILD_FAILED = [
    /^\S.*\.java:\d+: error: /m, // javac
    /^Compilation failed; see the compiler error output for details\./m, // Gradle's javac
    /\[ERROR\] COMPILATION ERROR\b/, // Maven
    /\[ERROR\] Failed to execute goal org\.apache\.maven\.plugins:maven-compiler-plugin:/, // Maven
    /(?:^|[\s:)])error TS\d{4,5}: /m, // tsc, ts-jest, ts-node
    /^FAIL\s+\S+\s+\[(?:build|setup) failed\]/m, // go
    /(?:^|[\s:)])error (?:CS|FS|BC)\d{4}: /m, // dotnet
    /^error: could not compile `/m, // cargo
    /^error\[E\d{4}\]/m, // rustc
];

/** pytest stopped before a test ran: its collection failed. */
const NOT_COLLECTED = [
    /^_+ ERROR collecting \S/m,
    /Interrupted: \d+ errors? during collection/,
];

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The mutated file's absolute path and, when it differs, its real path. */
function names(abs) {
    if (!abs) return [];
    let real = abs;
    try { real = fs.realpathSync(abs); } catch { /* the path as given */ }
    return real === abs ? [abs] : [abs, real];
}

/** node's source frame of the mutated file above a SyntaxError its module loader threw. */
function nodeParseFailed(lines, abs) {
    const header = new RegExp(`^\\s*(?:file://)?${escape(abs)}:\\d+\\s*$`);
    for (let i = 0; i < lines.length; i += 1) {
        if (!header.test(lines[i])) continue;
        for (let j = i + 1; j < Math.min(lines.length, i + 8); j += 1) {
            if (!/^\s*SyntaxError\b/.test(lines[j])) continue;
            const frame = lines.slice(j + 1).find((line) => line.trim().length > 0) || '';
            if (/^\s*at .*\(node:internal\/modules\//.test(frame)) return true;
            break;
        }
    }
    return false;
}

/** vitest's transform or parse failure naming the mutated file. */
function vitestParseFailed(lines, abs) {
    for (let i = 0; i < lines.length; i += 1) {
        if (!/Transform failed with \d+ error|Error: Parse failure\b/.test(lines[i])) continue;
        for (let j = i + 1; j < Math.min(lines.length, i + 30); j += 1) {
            if (/^\s*FAIL\s/.test(lines[j])) break;
            const file = /^\s*File: (\S+?)(?::\d+(?::\d+)?)?\s*$/.exec(lines[j]);
            // A root-relative `/src/calc.ts` names the same file as its absolute path.
            if (file && file[1].startsWith('/') && abs.endsWith(file[1])) return true;
        }
    }
    return false;
}

/**
 * The verdict of one mutant run: { result: 'killed' | 'survived' } or
 * { result: 'invalid', reason }. `abs` is the mutated file.
 */
function mutantVerdict(run, abs) {
    if (run.exit === 0) return { result: 'survived' };
    const invalid = (reason) => ({ result: 'invalid', reason });
    if (run.timed_out || run.exit === TIMEOUT_EXIT) return invalid('timed out');
    if (SIGNAL_EXITS.has(run.exit)) return invalid(`ended by a signal (exit ${run.exit})`);
    // runCommand's tail is already free of ANSI codes.
    const text = String(run.tail ?? '');
    const signal = /\(signal: \d+, (SIG[A-Z]+)/.exec(text);
    if (signal && KILL_SIGNALS.has(signal[1])) return invalid(`ended by ${signal[1]}`);
    if (BUILD_FAILED.some((re) => re.test(text))) return invalid('did not build');
    const lines = text.split(/\r?\n/);
    if (names(abs).some((name) => nodeParseFailed(lines, name) || vitestParseFailed(lines, name))) {
        return invalid('did not parse');
    }
    if (NOT_COLLECTED.some((re) => re.test(text))) return invalid('did not collect');
    if (typeof run.failed_count === 'number') {
        return run.failed_count >= 1 ? { result: 'killed' } : invalid(`no test failed (exit ${run.exit})`);
    }
    return { result: 'killed' };
}

module.exports = { TIMEOUT_EXIT, mutantVerdict };
