'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Whether a red run caught the mistake. A mistake is caught only when its test ran and noticed it.
 * A build that failed, a file that does not parse and a run something killed never got that far,
 * so each reads no verdict, with the reason. Past those, a red run is caught only when it printed
 * a test summary that reports a failure: a run that never reached a test (remote-run refusing, a
 * disk-ceiling stop, a missing binary, a wrapper error) prints none, and a summary of `fail 0`
 * under a non-zero exit names no failing test, so both read no verdict too.
 *
 * The summaries read are node --test's `ℹ fail N` (node 24) or `# fail N` (TAP, older node), cargo's
 * `test result: FAILED`, vitest's `Tests  N failed` or `Test Files  N failed`, Playwright's
 * `N failed` and Jest's `Tests: N failed`, each with N at least 1.
 *
 * Cargo marks a failed build with `error: could not compile` or a rustc `error[E....]`, and a test
 * binary something killed with `(signal: 9, SIGKILL`. A compiler a signal ended fails the build the
 * same way, so a failed build whose compiler line reads `killed by signal N` or `terminated with
 * signal N` (sccache, rustc, the linker) is a kill: the machine's doing, not the mutant's. A
 * `could not compile` of a crate no mutated file belongs to is never the mutant's doing either. A
 * file belongs to the package of the nearest Cargo.toml above it; when any mutated file has none,
 * every failed build is the mutant's, as before. Node marks a file it could not parse with the
 * source frame `<file>:<line>` above a SyntaxError whose first stack frame is node's module loader,
 * under CommonJS, ES modules and type stripping alike. A SyntaxError the code throws while it runs
 * has the code's own frame there, so it stays caught. Vitest marks it with `Transform failed`
 * (esbuild, oxc) or `Parse failure` (rollup, rolldown) above `File: <file>`. Only a parse failure
 * in the mutated file counts. A module that cannot be resolved still reads caught, since no runner
 * ties that failure to the mutated line.
 *
 * A check (a contract script, a lint) prints no runner's summary. A host that lists it under
 * `mutate.checks` names the line it prints on a finding, and a red run of it that printed that line
 * is caught (run-mutate-host.cjs). For any other red run with no summary, of a command that starts no
 * runner read here, the reason says that a check cannot prove a mutant and names the way out.
 */

/** Exit codes of a run whose child a signal ended: SIGINT, SIGKILL, SIGTERM. */
const KILLED = new Set([130, 137, 143]);
const KILL_SIGNALS = new Set(['SIGINT', 'SIGKILL', 'SIGTERM']);
const SIGNAL_NAMES = { 2: 'SIGINT', 9: 'SIGKILL', 15: 'SIGTERM' };
const ANSI = /\x1b\[[0-9;]*m/g;

// A summary line that reports at least one failure, per runner, on the ANSI-stripped log.
const FAILED_SUMMARY = [
  /^(?:#|ℹ) fail [1-9]\d*\b/m,
  /^test result: FAILED\b/m,
  /^[ \t]*(?:Test Files|Tests)[ \t]+[1-9]\d* failed\b/m,
  /^[ \t]*[1-9]\d* failed\b/m,
  /^Tests:[ \t]+[1-9]\d* failed\b/m,
];

// A command that starts a runner whose summary is read above, or a package script named test.
const RUNNER = new RegExp([
  /(?:^|[\s;&|('"])node\b[^;&|]*\s--test(?=[\s=]|$)/.source,
  /(?:^|[\s;&|('"/])cargo\s+(?:\+\S+\s+)?(?:test|nextest)\b/.source,
  /(?:^|[\s;&|('"/])(?:vitest|jest)\b/.source,
  /(?:^|[\s;&|('"/])playwright\s+test\b/.source,
  /(?:^|[\s;&|('"])(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/.source,
].join('|'));
const CHECK_HINT = 'a check cannot prove a mutant, so end the criterion\'s line with (gate: <name>) instead, ' +
  'or have the host list the check and its finding line under mutate.checks';

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function rustBuildFailed(text) {
  return /^error: could not compile `/m.test(text) || /^error\[E\d{4}\]/m.test(text);
}

/** The signal a compiler line of a failed build says ended the compiler, or null. */
function compilerKilled(text) {
  for (const line of text.split('\n')) {
    const said = /\b(?:killed by|terminated with) signal (\d+)\b/i.exec(line);
    if (said && SIGNAL_NAMES[said[1]]) return SIGNAL_NAMES[said[1]];
    if (/\bKilled signal terminated program\b/.test(line)) return 'SIGKILL';
  }
  return null;
}

const crateName = (name) => name.replace(/-/g, '_');

/** The package of the nearest Cargo.toml above `file`, up to the repository's root, or null. */
function crateOf(file) {
  let dir = path.dirname(file);
  for (;;) {
    const manifest = path.join(dir, 'Cargo.toml');
    if (fs.existsSync(manifest)) {
      const text = fs.readFileSync(manifest, 'utf8');
      const section = /^\[package\][ \t]*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text);
      const name = section && /^[ \t]*name[ \t]*=[ \t]*["']([^"']+)["']/m.exec(section[1]);
      if (name) return crateName(name[1]);
    }
    const up = path.dirname(dir);
    if (up === dir || fs.existsSync(path.join(dir, '.git'))) return null;
    dir = up;
  }
}

/**
 * The crates a failed build names, when none is one a mutated file of `files` belongs to; null
 * when one is, when it names none, or when a file belongs to no crate this can tell.
 */
function othersFailed(text, files) {
  const failed = [...new Set([...text.matchAll(/^error: could not compile `([^`]+)`/gm)].map((m) => m[1]))];
  if (failed.length === 0 || files.length === 0) return null;
  const own = files.map(crateOf);
  if (own.some((name) => name === null)) return null;
  return failed.some((name) => own.includes(crateName(name))) ? null : failed;
}

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

function vitestParseFailed(lines, abs) {
  for (let i = 0; i < lines.length; i += 1) {
    if (!/Transform failed with \d+ error|Error: Parse failure\b/.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 30); j += 1) {
      if (/^\s*FAIL\s/.test(lines[j])) break;
      const file = /^\s*File: (\S+?)(?::\d+(?::\d+)?)?\s*$/.exec(lines[j]);
      // A root-relative `/src/s.ts` names the same file as its absolute path.
      if (file && file[1].startsWith('/') && abs.endsWith(file[1])) return true;
    }
  }
  return false;
}

/**
 * The verdict of one run: `caught` true or false, or null with `why`. `abs` is the mutated file;
 * without it only a build failure and a kill are read. `files` are the mutated files a failed build
 * is held to (`abs` alone by default), `test` the command as the reviewer wrote it, and `checks`
 * the host's checks, each `{match, finding}` as regexes.
 */
function verdictOf(run, text, abs, { files = abs ? [abs] : [], test = null, checks = [] } = {}) {
  if (run.signal) return { caught: null, why: `ended on ${run.signal}` };
  if (run.code === 0) return { caught: false };
  if (KILLED.has(run.code)) return { caught: null, why: `killed (exit ${run.code})` };
  const clean = String(text || '').replace(ANSI, '');
  const signal = /\(signal: \d+, (SIG[A-Z]+)/.exec(clean);
  if (signal && KILL_SIGNALS.has(signal[1])) return { caught: null, why: `killed (${signal[1]})` };
  if (rustBuildFailed(clean)) {
    const compiler = compilerKilled(clean);
    if (compiler) return { caught: null, why: `killed (${compiler})` };
    const others = othersFailed(clean, files);
    if (others) {
      return { caught: null, why: `the build of ${others.join(', ')} failed, and no mutated file belongs to ${others.length === 1 ? 'that crate' : 'those crates'}` };
    }
    return { caught: null, why: 'did not build' };
  }
  const lines = clean.split('\n');
  if (abs && (nodeParseFailed(lines, abs) || vitestParseFailed(lines, abs))) return { caught: null, why: 'did not parse' };
  const check = test === null ? null : checks.find((entry) => entry.match.test(test));
  if (check && check.finding.test(clean)) return { caught: true };
  if (!FAILED_SUMMARY.some((summary) => summary.test(clean))) {
    const why = `no test summary reports a failure (exit ${run.code})`;
    return { caught: null, why: test === null || check || RUNNER.test(test) ? why : `${why}: ${CHECK_HINT}` };
  }
  return { caught: true };
}

/** A run's log, or nothing when it cannot be read. */
function readLog(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    return '';
  }
}

module.exports = { readLog, rustBuildFailed, verdictOf };
