#!/usr/bin/env node

/**
 * specsmd AI-DLC Turbo - run the mutants of one story.
 *
 * The story reviewer proposes one mutant per acceptance criterion a test
 * covers: one line of the story's code broken on purpose, and the narrow test
 * that should go red. This script runs
 * them and writes the result into the story's proof, so whether the tests
 * catch a broken line never rests on an agent's word. Sandbox mode runs them
 * exactly as production.
 *
 * 1. Gates: a mutant a cut-off run left behind is put back first
 *    (lib/mutant-marker.cjs, as story-verify.cjs does); the proof
 *    `{intent}/proof/{SSS}.json` exists and passed; `git add -N .` in the code
 *    root (so a file the story added shows up as `+` lines), and the diff
 *    hash still equals the proof's diff_sha.
 * 2. One per criterion (lib/mutant-criteria.cjs): `criterion` starts with the
 *    criterion's number in the story's list, `--untested` names the criteria
 *    no test covers, and `construction.mutants` of repo/config.yaml caps the
 *    criteria with a test that get one (no number is no cap); the mutants of
 *    the others do not run. A mutant is `invalid` when it names no criterion
 *    of the story by its number or one that has a mutant already, but a
 *    criterion whose mutant was invalid may have one new proposal in a later
 *    --only run. A story whose criteria cannot be read is not checked here:
 *    the cap keeps the first mutants of the list.
 *    Each mutant { id, file, line, from, to, test, criterion } is checked
 *    (lib/mutants.cjs). It is `invalid`, and never runs, when a field is
 *    missing or mistyped (`missing {fields}`, `{fields} must be text`; no
 *    usable id gives `#{position}`), from equals to, the file is outside the
 *    code root, a test file (lib/test-files.cjs) or missing, the test has
 *    shell operators or does not start with the program of a verification
 *    command of the brief (an optional `cd {dir} && ` is stripped on both
 *    sides), `from` is not exactly once on its line and not on exactly one
 *    other line (a fix may have moved it), or the line is not a `+` line of
 *    `git diff HEAD`.
 * 3. Baseline: every distinct test of the valid mutants runs once on the
 *    unchanged code. Exit not 0 makes its mutants `invalid` (test fails
 *    without the mutant); 0 passed tests in the output too (test runs no
 *    tests). Output without counts goes on.
 * 4. One mutant at a time: the marker `{proof dir}/{SSS}.mutant.json` first,
 *    then the file's bytes with `from` replaced by `to` on that one line, the
 *    test in the code root with the timeout (its whole process tree is
 *    killed then), the original bytes back in a `finally`, their sha256
 *    checked, and only then the marker deleted. lib/mutant-verdict.cjs
 *    reads the run: exit 0 is `survived`; `killed` only when a test failed
 *    (a failed count of at least 1, or a red exit without counts); a timeout
 *    (exit 124) is `invalid: timed out`, a run that did not build, parse or
 *    collect is `invalid` with that reason, counts with no failed test under
 *    a red exit `invalid: no test failed`. A SIGINT, SIGTERM or SIGHUP only
 *    sets a flag: once the current mutant is restored the run stops, prints
 *    the lines before it and `interrupted`, exits 1 and writes nothing.
 *    Before every test run (the baseline too) and once after the last, the
 *    story's test files get a newer modification time (lib/test-files.cjs), so
 *    an incremental build compiles them again: Java copies a `static final`
 *    constant into the test class, and Maven recompiles a test only when its
 *    own source changed, so a mutated constant would otherwise reach no test.
 * 5. The diff hash must still equal the proof's diff_sha; when a test command
 *    wrote files, nothing is written to the proof.
 * 6. The proof gets `mutants: [{ id, file, line, from, to, test, criterion,
 *    result, exit, reason }]` (`line` the line used, `reason` only for
 *    invalid), and `criteria: [{ criterion, result, mutants, reason }]`, one
 *    per acceptance criterion: survived, killed, invalid (with the reason),
 *    missing (a test and no mutant), untested or capped. Every other field
 *    stays as story-verify.cjs wrote it, so story-land.cjs still lands the
 *    story. --only replaces just those entries and recomputes `criteria`; a
 *    proof without `criteria` is read from its `mutants`.
 *
 * Stdout: one line per mutant `KILLED|SURVIVED|INVALID {id} {file}:{line}`,
 * with ` ({reason})` for invalid, then one line per criterion
 * `CRITERION {n} {result}[ {id}][ ({reason})]`, then `MUTANTS {story} {killed}/{ran} killed,
 * {survived} survived, {invalid} invalid`. Exit 0 also with survivors. Exit 1
 * on bad input (no proof, a proof that did not pass, a file that is not a
 * JSON array, an id used twice, an unknown --only id), on a cut-off run's file
 * changed since, on `restore failed: {file}`, on `diff changed: run
 * story-verify.cjs again`, and on `interrupted`. Exit 2 on bad usage.
 *
 * Usage:
 *   node .specsmd/aidlc-turbo/scripts/story-mutate.cjs <intent-slug> <SSS> --code-root <dir> \
 *     --mutants <json file> [--untested 3,5] [--only M1,M2] [--timeout <seconds per mutant, default 900>] \
 *     [--root .specs-aidlc-turbo]
 *
 * Node builtins only, plus ./frontmatter.cjs and ./lib/*.cjs: the target
 * project often has no node_modules at all.
 */

const fs = require('fs');
const path = require('path');
const { DEFAULT_ROOT, normId, resolveIntent, findStory, readBrief } = require('./intent-status.cjs');
const { git, artifactPrefix, parseYamlMap } = require('./story-start.cjs');
const paths = require('./lib/paths.cjs');
const { runCommand, diffSha, playwrightDir } = require('./story-verify.cjs');
const { addedLines, changedFiles } = require('./lib/diff-lines.cjs');
const { normPath, isTestFile, touchFiles } = require('./lib/test-files.cjs');
const {
    mutantId, checkList, fieldProblem, testProgram, testProblem, locate, mutateBuffer,
} = require('./lib/mutants.cjs');
const { markerPath, withMutant, recoverMarker } = require('./lib/mutant-marker.cjs');
const { mutantVerdict } = require('./lib/mutant-verdict.cjs');
const { capOf, criteriaCount, planMutants, criteriaResults } = require('./lib/mutant-criteria.cjs');

const DEFAULT_TIMEOUT = 900;
const DIFF_CHANGED = 'diff changed: run story-verify.cjs again';
const INTERRUPTED = 'interrupted';
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/** One turn of the event loop, so a signal that came during a blocking run is seen. */
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Parse argv into positionals and flags. */
function parseArgs(argv) {
    const out = { positional: [], codeRoot: null, mutants: null, only: null, untested: null, timeout: DEFAULT_TIMEOUT, root: DEFAULT_ROOT };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--code-root') { out.codeRoot = argv[i + 1] || null; i += 1; }
        else if (arg === '--mutants') { out.mutants = argv[i + 1] || null; i += 1; }
        else if (arg === '--only') { out.only = argv[i + 1] || ''; i += 1; }
        else if (arg === '--untested') { out.untested = argv[i + 1] || ''; i += 1; }
        else if (arg === '--timeout') { out.timeout = Number(argv[i + 1]); i += 1; }
        else if (arg === '--root') { out.root = argv[i + 1] || DEFAULT_ROOT; i += 1; }
        else if (arg === '--help' || arg === '-h') out.help = true;
        else if (!arg.startsWith('--')) out.positional.push(arg);
    }
    return out;
}

/** The mutants from the JSON file. Returns { mutants } or { error }. */
function readMutants(file) {
    try {
        return { mutants: JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (error) {
        return { error: `cannot read the mutants file ${file}: ${error.message}` };
    }
}

/** The cap of `construction.mutants` in repo/config.yaml; null is no cap. */
function readCap(absRoot) {
    const file = paths.layout(absRoot).config;
    try {
        return fs.existsSync(file) ? capOf(parseYamlMap(fs.readFileSync(file, 'utf8'))) : null;
    } catch {
        return null;
    }
}

/** One stdout line per mutant. */
function mutantLine(m) {
    const reason = m.result === 'invalid' ? ` (${m.reason})` : '';
    return `${m.result.toUpperCase()} ${m.id} ${m.file ?? '?'}:${m.line ?? '?'}${reason}`;
}

/** Check one mutant. Returns { line, abs } to run it, or { line, reason }. */
function check(m, ctx) {
    const file = normPath(m.file);
    const abs = path.resolve(ctx.dir, file);
    const fail = (reason, line = m.line) => ({ file, line, reason });
    if (m.from === m.to) return fail('from equals to');
    const rel = path.relative(ctx.dir, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || path.isAbsolute(file)) return fail('file outside the code root');
    if (isTestFile(file, ctx.pwDir)) return fail('file is a test file');
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return fail('file not found');
    const problem = testProblem(m.test, ctx.programs);
    if (problem) return fail(problem);
    const line = locate(fs.readFileSync(abs), m.line, m.from);
    if (!line) return fail('from not on its line');
    const added = addedLines(ctx.dir, file);
    if (added.error) throw new Error(added.error);
    if (!added.lines.some((a) => a.line === line)) return fail('line not added by the story', line);
    return { file, line, abs };
}

/**
 * Run the mutants of one story. Resolves to { lines, exitCode, notes, proof }
 * or { error, notes }. `runner` is story-verify's runCommand; a test may pass
 * its own. A SIGINT, SIGTERM or SIGHUP only sets a flag: the run stops once
 * the current mutant is restored.
 */
async function mutateStory({
    root = DEFAULT_ROOT, intentSlug, storyId, codeRoot, mutants: given = null, mutantsFile = null,
    only = null, untested = null, timeout = DEFAULT_TIMEOUT, cwd = process.cwd(), runner = runCommand,
}) {
    const absRoot = path.resolve(cwd, root);
    const { intent, error } = resolveIntent(absRoot, intentSlug);
    if (error) return { error };
    const story = findStory(intent, normId(storyId));
    if (!story) return { error: `story not found: ${normId(storyId)} in ${intent.stories}` };
    const brief = readBrief(intent);
    const dir = path.resolve(cwd, codeRoot);
    if (!fs.existsSync(dir)) return { error: `code root not found: ${dir}` };
    const notes = [];
    const recovered = recoverMarker(intent.proof, story.id);
    if (recovered.error) return { error: recovered.error };
    if (recovered.note) notes.push(recovered.note);
    const fail = (message) => ({ error: message, notes });

    const proofFile = path.join(intent.proof, `${story.id}.json`);
    if (!fs.existsSync(proofFile)) return fail(`no proof: run story-verify.cjs first (${proofFile})`);
    const proof = JSON.parse(fs.readFileSync(proofFile, 'utf8'));
    if (proof.passed !== true) return fail(`the proof did not pass: fix the story and run story-verify.cjs again (${proofFile})`);

    const read = given ? { mutants: given } : readMutants(mutantsFile);
    if (read.error) return fail(read.error);
    const listProblem = checkList(read.mutants);
    if (listProblem) return fail(listProblem);
    const all = read.mutants.map((m, i) => ({ m, id: mutantId(m, i) }));
    const ids = only ? String(only).split(',').map((x) => x.trim()).filter(Boolean) : null;
    const unknown = (ids || []).filter((id) => !all.some((a) => a.id === id));
    if (unknown.length) return fail(`--only names unknown mutants: ${unknown.join(', ')}`);
    const listed = ids ? all.filter((a) => ids.includes(a.id)) : all;
    const plan = planMutants({
        count: criteriaCount(intent, story, absRoot), cap: readCap(absRoot), untestedFlag: untested,
        todo: listed, previous: ids ? proof : null,
    });
    const todo = listed.filter((a) => !plan.skipped.has(a.id));

    const prefix = artifactPrefix(cwd, root);
    const diffMoved = () => {
        if (!proof.diff_sha) return false;
        const d = diffSha(dir, prefix);
        if (d.error) throw new Error(d.error);
        return d.sha !== proof.diff_sha;
    };
    const add = git(['add', '-N', '.'], dir);
    if (!add.ok) return fail(`git add -N failed in ${dir}: ${add.out}`);
    if (diffMoved()) return { lines: [DIFF_CHANGED], exitCode: 1, notes };
    const pwDir = playwrightDir(absRoot);
    const changed = changedFiles(dir, prefix);
    if (changed.error) return fail(changed.error);
    const testFiles = changed.files.filter((c) => c.status !== 'D' && isTestFile(c.file, pwDir)).map((c) => c.file);

    let stopped = false;
    const onSignal = () => { stopped = true; };
    SIGNALS.forEach((sig) => process.on(sig, onSignal));
    try {
        return await runAll({
            todo, plan, proof, proofFile, story, dir, notes, diffMoved, stop: () => stopped,
            marker: markerPath(intent.proof, story.id),
            ctx: {
                dir, pwDir,
                programs: new Set(brief.verification.map((c) => testProgram(c).program)),
            },
            merge: ids !== null,
            // Every run compiles the story's tests anew, and so does the next build after the last.
            runTest: (test) => { touchFiles(dir, testFiles); return runner(test, dir, timeout); },
        });
    } finally {
        touchFiles(dir, testFiles);
        SIGNALS.forEach((sig) => process.removeListener(sig, onSignal));
    }
}

/** Baseline, every mutant, the diff check and the proof. Stops after a signal. */
async function runAll({ todo, plan, proof, proofFile, story, dir, notes, diffMoved, stop, marker, ctx, merge, runTest }) {
    const interrupted = (results) => ({ lines: [...results.map(mutantLine), INTERRUPTED], exitCode: 1, notes });
    const checked = todo.map(({ m, id }) => {
        const shape = plan.reasons.get(id) || fieldProblem(m);
        const c = shape ? { file: m && m.file, line: m && m.line, reason: shape } : check(m, ctx);
        return { m: m && typeof m === 'object' ? m : {}, id, c };
    });

    // Baseline: every distinct test once, on the unchanged code.
    const baseline = new Map();
    for (const { m, c } of checked) {
        if (c.reason || baseline.has(m.test)) continue;
        baseline.set(m.test, runTest(m.test));
        await tick();
        if (stop()) return interrupted([]);
    }

    const results = [];
    for (const { m, id, c } of checked) {
        const entry = { id, file: c.file, line: c.line, from: m.from, to: m.to, test: m.test, criterion: m.criterion };
        const base = baseline.get(m.test);
        let reason = c.reason;
        if (!reason && base.exit !== 0) reason = 'test fails without the mutant';
        else if (!reason && base.passed_count === 0) reason = 'test runs no tests';
        if (reason) {
            results.push({ ...entry, result: 'invalid', exit: c.reason ? null : base.exit, reason });
            continue;
        }
        const original = fs.readFileSync(c.abs);
        const mutated = mutateBuffer(original, c.line, m.from, m.to);
        let r;
        try {
            r = withMutant(c.abs, original, mutated, marker, () => runTest(m.test));
        } catch (err) {
            if (err.code !== 'RESTORE') throw err;
            return { lines: [...results.map(mutantLine), err.message], exitCode: 1, notes };
        }
        // A signal during this run may have reached the test too: its result is not kept.
        await tick();
        if (stop()) return interrupted(results);
        const v = mutantVerdict(r, c.abs);
        results.push({ ...entry, result: v.result, exit: r.exit, ...(v.reason ? { reason: v.reason } : {}) });
    }

    const lines = results.map(mutantLine);
    if (diffMoved()) return { lines: [...lines, DIFF_CHANGED], exitCode: 1, notes };
    if (stop()) return interrupted(results);

    const merged = merge && Array.isArray(proof.mutants) ? [...proof.mutants] : [];
    for (const r of results) {
        const at = merged.findIndex((e) => e.id === r.id);
        if (at === -1) merged.push(r); else merged[at] = r;
    }
    proof.mutants = merged;
    const perCriterion = plan.count ? criteriaResults(plan, merged) : null;
    if (perCriterion) proof.criteria = perCriterion.criteria;
    fs.writeFileSync(proofFile, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');

    const n = (result) => results.filter((r) => r.result === result).length;
    const killed = n('killed');
    const survived = n('survived');
    if (perCriterion) lines.push(...perCriterion.lines);
    lines.push(`MUTANTS ${story.id} ${killed}/${killed + survived} killed, ${survived} survived, ${n('invalid')} invalid`);
    return { lines, exitCode: 0, notes, proof };
}

module.exports = { DEFAULT_TIMEOUT, DIFF_CHANGED, INTERRUPTED, mutantLine, mutateStory };

if (require.main === module) {
    const options = parseArgs(process.argv.slice(2));
    const [intentSlug, storyId] = options.positional;
    const badTimeout = !Number.isFinite(options.timeout) || options.timeout <= 0;
    if (options.help || !intentSlug || !storyId || !options.codeRoot || !options.mutants || badTimeout) {
        const usage = `
Usage: node story-mutate.cjs <intent-slug> <SSS> --code-root <dir> --mutants <json file> [options]

Options:
  --code-root <dir>   Where the story's code is: its worktree (required)
  --mutants <file>    JSON array of { id, file, line, from, to, test, criterion } (required)
  --only <M1,M2>      Run just these mutants and update only their entries in the proof
  --untested <3,5>    The acceptance criteria no test covers, by number: no mutant is owed
  --timeout <sec>     Timeout per test run, default ${DEFAULT_TIMEOUT}
  --root <dir>        Artifact root, default ${DEFAULT_ROOT}
  --help, -h          Show this message
`;
        if (options.help) console.log(usage); else console.error(usage);
        process.exitCode = options.help ? 0 : 2;
    } else {
        mutateStory({
            root: options.root, intentSlug, storyId, codeRoot: options.codeRoot,
            mutantsFile: options.mutants, only: options.only, untested: options.untested, timeout: options.timeout,
        }).then((result) => {
            (result.notes || []).forEach((note) => console.error(note));
            if (result.error) {
                console.error(`Error: ${result.error}`);
                process.exitCode = 1;
            } else {
                console.log(result.lines.join('\n'));
                process.exitCode = result.exitCode;
            }
        }, (error) => {
            console.error(`Error: ${error.message}`);
            process.exitCode = 1;
        });
    }
}
