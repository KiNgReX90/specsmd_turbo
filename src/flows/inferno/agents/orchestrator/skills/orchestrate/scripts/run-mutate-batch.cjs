'use strict';

/**
 * `run.cjs mutate --batch <file>`: every mistake of a review in one call.
 *
 * Each Rust mistake costs a build, so the Rust entries share one. Every switchable entry is
 * written into its file at once behind a switch that is off by default (run-mutate-rust.cjs).
 * A control run then proves each distinct test green with every switch off. A switch the build
 * refuses is blamed from the compiler's file:line and moved to its own build, and the control
 * runs again. A test that is red with every switch off stops the batch with no verdict at all,
 * because it is red before any mistake. Then each entry's test runs with only its own switch on:
 * the build is done, so a red run is the test noticing. An entry no switch can hold (an
 * attribute line, a string, a const item, a switch that did not compile) takes a classic
 * in-place build of its own, and every other language runs its test once in place. When the host
 * names a session of its test wrapper (run-mutate-session.cjs), the other entries whose test goes
 * through that wrapper share one session per test command instead, after every in-place entry.
 *
 * A clean tree only, every touched file restored in a finally, and signals held until then.
 * A held signal is read before every run, so the batch starts no run after it, and every entry
 * still to run reads not run. One journal covers every file (run-mutate-journal.cjs), so a run
 * killed outright is put back by the next step that reads the tree. A file the host seals is
 * resealed after each write, and its seal goes back before the next reseal and in the finally
 * (run-mutate-seal.cjs). A reseal that a signal or the timeout ended stops the batch, as a seal
 * that could not go back does, so no test runs against a stale seal.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { afterRecovery, openSession, recoverInterrupted } = require('./run-mutate-journal.cjs');
const { readBatch } = require('./run-mutate-entries.cjs');
const { applySwitches, blame, planRust } = require('./run-mutate-rust.cjs');
const { readLog, verdictOf } = require('./run-mutate-verdict.cjs');
const { reseal, sealOf } = require('./run-mutate-seal.cjs');
const { runGroup, sessionGroups, sessionOf, unsealedVerdict } = require('./run-mutate-session.cjs');
const { leftBehind, settle, snapshot } = require('./run-mutate-left.cjs');

const { RunError } = lib;
const OFF = 'unset INFERNO_MUTANT; ';
const ON = (k) => `export INFERNO_MUTANT=${k}; `;

/** The plan of every entry: a switch for the Rust ones that can hold one, the classic build otherwise. */
function planAll(tree, entries) {
  const plans = new Map(entries.filter((e) => !e.rust).map((e) => [e.k, { form: 'classic' }]));
  for (const rel of [...new Set(entries.filter((e) => e.rust).map((e) => e.rel))]) {
    const mine = entries.filter((e) => e.rust && e.rel === rel);
    const text = fs.readFileSync(path.join(tree, rel), 'utf8');
    planRust(text, mine).forEach((plan, index) => plans.set(mine[index].k, plan));
  }
  return plans;
}

function writeSwitches(session, switched, plans, written) {
  const files = new Set(switched.map((e) => e.rel));
  for (const rel of written) if (!files.has(rel)) session.putBack(rel);
  for (const rel of files) {
    const items = switched.filter((e) => e.rel === rel).map((e) => plans.get(e.k));
    session.write(rel, applySwitches(session.original(rel), items));
  }
  return files;
}

/** The stop line once a signal is held, so no run starts after it; null otherwise. */
async function signalled(session) {
  const signal = await session.received();
  return signal ? `the batch stopped on ${signal}, so every entry still to run reads not run` : null;
}

/** Each distinct test once with every switch off: ok, the failed build's text, or a reason to stop. */
async function control(session, switched, round) {
  const tests = [...new Set(switched.map((e) => e.test))];
  for (const [index, test] of tests.entries()) {
    const signal = await signalled(session);
    if (signal) return { signal };
    const run = lib.runShell(OFF + test, session.tree, session.log(`control-${round}-${index + 1}`));
    if (run.code === 0 && !run.signal) continue;
    const text = readLog(run.log);
    const verdict = verdictOf(run, text, null);
    if (verdict.why === 'did not build') return { text };
    if (verdict.caught) {
      return { stop: `the test ${test} is red with every switch off (exit ${run.code} -> ${run.log}), so it is red before any mistake and no entry has a verdict` };
    }
    return { stop: `the control run of ${test} has no verdict, ${verdict.why} (-> ${run.log}), so no entry has one` };
  }
  return { ok: true };
}

function execute(session, e, prefix, label) {
  const run = lib.runShell(prefix + e.test, session.tree, session.log(label));
  return { ...verdictOf(run, readLog(run.log), e.abs), code: run.code, log: run.log, signal: run.signal };
}

async function runAll(session, sealed, entries, plans, groups) {
  const verdicts = new Map();
  let builds = 0;
  let switched = entries.filter((e) => plans.get(e.k).form === 'switch');
  let written = new Set();
  while (switched.length > 0) {
    written = writeSwitches(session, switched, plans, written);
    const failed = reseal(session, sealed, [...written], `build-${builds + 1}`);
    if (failed) {
      for (const e of switched) verdicts.set(e.k, unsealedVerdict(failed));
      if (failed.signal) return { builds, verdicts, stopped: `the reseal of the switched entries ended on ${failed.signal}, so the batch stopped` };
      switched = [];
      break;
    }
    builds += 1;
    const result = await control(session, switched, builds);
    if (result.ok) break;
    if (result.signal) return { builds, verdicts, stopped: result.signal };
    if (result.stop) return { builds, stopped: result.stop };
    const blamed = new Set(blame(result.text, switched));
    for (const k of blamed) plans.set(k, { form: 'classic', why: 'its switch did not compile' });
    switched = switched.filter((e) => !blamed.has(e.k));
  }
  for (const e of switched) {
    const signal = await signalled(session);
    if (signal) return { builds, verdicts, stopped: signal };
    const verdict = execute(session, e, ON(e.k), `switch-${e.k}`);
    verdicts.set(e.k, verdict);
    if (verdict.signal) return { builds, verdicts, stopped: `the test of entry ${e.k} ended on ${verdict.signal}, so the batch stopped` };
  }
  for (const rel of written) session.putBack(rel);
  for (const e of entries.filter((item) => plans.get(item.k).form === 'classic')) {
    const signal = await signalled(session);
    if (signal) return { builds, verdicts, stopped: signal };
    const line = session.original(e.rel).split('\n')[e.n - 1];
    session.write(e.rel, new Map([[e.n, line.slice(0, e.col) + e.replace + line.slice(e.col + e.find.length)]]));
    const failed = reseal(session, sealed, [e.rel], `own-${e.k}`);
    if (failed && failed.left) return { builds, verdicts, stopped: `the batch stopped, since ${failed.why}` };
    const verdict = failed ? unsealedVerdict(failed) : execute(session, e, OFF, `own-${e.k}`);
    session.putBack(e.rel);
    if (e.rust) builds += 1;
    verdicts.set(e.k, verdict);
    const what = failed ? 'reseal' : 'test';
    if (verdict.signal) return { builds, verdicts, stopped: `the ${what} of entry ${e.k} ended on ${verdict.signal}, so the batch stopped` };
  }
  const hosting = { session, sealed, hosted: groups.hosted, verdicts, notes: [], sessions: 0, signalled };
  for (const [index, group] of groups.list.entries()) {
    const out = await runGroup(hosting, group, index + 1);
    if (out.stopped) return { builds, verdicts, stopped: out.stopped, sessions: hosting.sessions, notes: hosting.notes };
  }
  return { builds, verdicts, sessions: hosting.sessions, notes: hosting.notes };
}

const yamlText = (text) => `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function rowOf(e, plan, verdict) {
  const own = e.rust && plan.form === 'classic' ? plan.why : undefined;
  const base = { criterion: e.criterion, file: e.rel, line: e.n, test: e.test, form: plan.form, own };
  if (!verdict) return { ...base, caught: null, why: 'not run' };
  return { ...base, caught: verdict.caught, why: verdict.why, code: verdict.code, log: verdict.log };
}

function lineOf(row) {
  const said = row.caught === true ? 'caught yes' : row.caught === false ? 'caught no' : `no verdict: ${row.why}`;
  return `${said} | ${row.file}:${row.line} | ${row.criterion}${row.own ? ` | own build: ${row.own}` : ''}`;
}

function report(session, recovered, entries, plans, result) {
  if (!result.verdicts) {
    return { exit: 2, payload: { stopped: result.stopped, builds: result.builds, restored: true }, out: [...recovered, result.stopped, 'every file is restored'] };
  }
  const rows = entries.map((e) => rowOf(e, plans.get(e.k), result.verdicts.get(e.k)));
  const rust = entries.filter((e) => e.rust);
  const switched = rust.filter((e) => plans.get(e.k).form === 'switch').length;
  const hosted = rows.filter((row) => row.form === 'session');
  const others = entries.length - rust.length - hosted.length;
  const shared = plural(new Set(hosted.map((row) => row.test)).size, 'session', 'sessions');
  const counted = `${plural(result.builds, 'build', 'builds')} for ${plural(rust.length, 'Rust entry', 'Rust entries')} ` +
    `(${switched} switched, ${rust.length - switched} on a build of their own)` +
    (others > 0 ? `; ${plural(others, 'other entry', 'other entries')} ran a test once in place` : '') +
    (hosted.length > 0 ? `; ${plural(hosted.length, 'other entry', 'other entries')} shared ${shared} of the host's wrapper` : '');
  const notes = result.notes || [];
  const paste = rows.filter((row) => row.caught !== null)
    .flatMap((row) => [`  - criterion: ${yamlText(row.criterion)}`, `    test: ${yamlText(row.test)}`, `    caught: ${row.caught ? 'yes' : 'no'}`]);
  const file = session.log('mutants').replace(/\.log$/, '.yaml');
  fs.writeFileSync(file, paste.length > 0 ? `${paste.join('\n')}\n` : '');
  const out = [...recovered, ...rows.map(lineOf), counted, ...notes, ...(result.stopped ? [result.stopped] : [])];
  if (paste.length > 0 && out.length + paste.length + 1 <= 30) out.push('paste under mutants:', ...paste);
  else if (paste.length > 0) out.push(`paste under mutants: the lines in ${file}`);
  return {
    exit: result.stopped ? 2 : 0,
    payload: {
      builds: result.builds, rust: rust.length, switched, entries: rows, paste: file, restored: true, stopped: result.stopped,
      ...(hosted.length > 0 ? { sessions: result.sessions } : {}), ...(notes.length > 0 ? { notes } : {}),
    },
    out,
  };
}

/** The batch's result, a promise: the batch yields a tick before each run so a held signal stops it. */
async function batch(options) {
  const tree = options.tree || lib.repoRoot(options.cwd);
  const file = path.resolve(options.cwd || process.cwd(), options.batch);
  const config = lib.readConfig(tree, options.config);
  const sealed = sealOf(config);
  const recovered = recoverInterrupted(tree);
  const rel = path.relative(tree, file).split(path.sep).join('/');
  // `pending`: the review file a record step is recording, which runs this batch before it commits.
  const dirty = lib.dirtyPaths(tree, [...(rel.startsWith('../') || path.isAbsolute(rel) ? [] : [rel]), ...(options.pending || [])]);
  if (dirty.length > 0) {
    throw new RunError(afterRecovery(recovered,
      `refusing to mutate a dirty tree: ${dirty.slice(0, 5).join(', ')} is uncommitted. Mutate once the tree is clean.`), 'DIRTY');
  }
  const entries = readBatch(tree, file);
  const plans = planAll(tree, entries);
  const hosted = sessionOf(config);
  const groups = { hosted, list: sessionGroups(hosted, entries, plans) };
  // What git calls changed before the first write: the batch file and the review being recorded.
  const before = snapshot(tree);
  const session = openSession(tree);
  let result = null;
  let failed = [];
  try {
    result = await runAll(session, sealed, entries, plans, groups);
  } finally {
    failed = session.close();
  }
  // A batch that stopped says why, before the paths it could not put back.
  const stopped = result && result.stopped ? [result.stopped] : [];
  if (failed.length > 0) return { exit: 2, payload: { restored: false, failed, stopped: stopped[0] }, out: [...recovered, ...stopped, ...failed] };
  return settle(report(session, recovered, entries, plans, result), leftBehind(tree, before));
}

module.exports = { batch };
