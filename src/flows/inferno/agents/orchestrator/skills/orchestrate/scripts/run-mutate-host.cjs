'use strict';

/**
 * Where and how a host's mutant tests run, under `mutate` beside `sealed` and `session`.
 *
 * `mutate.run` is the wrapper every mutant test runs through: one command that holds `{tree}` and
 * `{test}` once each after the wrapper's own words, such as `bash tools/remote-test.sh auto {tree}
 * {test}`. A reviewer writes the bare test and the host decides the machine. Each part goes in as
 * one single-quoted shell word, as a session command gets INFERNO_TREE and INFERNO_TEST, so the
 * wrapper gets the whole test as one argument and runs it under bash. A test that already starts
 * with the wrapper's own words runs as written, never wrapped twice. A host whose recorded reviews
 * spell the wrapper in other ways (behind an environment prefix, by its path under `~`, in quotes)
 * sets `mutate.wrapped`, a regex of those spellings: a test it matches at its start, as the
 * reviewer wrote it, also runs as written. A regex an empty test matches would mark every test, so
 * it is refused, and so is the key without `mutate.run`. `mutate.session.match` is not read for
 * this: it may match the wrapped command loosely enough to reach a bare test too.
 * `mutate.session` matches on the command as wrapped, as it does on a hand-written one, and a
 * session of a wrapped test runs the bare test. A Rust switch is exported before the wrapper, as
 * for a hand-written one, so the wrapper passes INFERNO_MUTANT on to the test.
 *
 * `mutate.checks` names the host's checks. A contract check or a lint prints no test runner's
 * summary, so its red run reads no verdict. Each entry is `{match, finding}`: `match`, a regex
 * that marks a test command as that check where it matches the command as the reviewer wrote it,
 * and `finding`, a regex of the line the check prints on a finding. A red run of a check that
 * printed that line reads caught (run-mutate-verdict.cjs). A wrapper that refused prints no such
 * line, so it still reads no verdict.
 */

const { RunError } = require('./run-lib.cjs');

const PART = /\{(tree|test)\}/g;
const RUN_SHAPE = 'the wrapper\'s command with {tree} and {test} once each, after its own words';

/** One single-quoted shell word holding `value`, as a session command's variables are exported. */
const quote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;

function regexOf(bad, key, source) {
  if (!nonEmpty(source)) throw bad(key, 'a non-empty regex');
  try {
    return new RegExp(source, 'm');
  } catch (error) {
    throw bad(key, `a regex (${error.message})`);
  }
}

/** Refuse a `mutate.run`, `mutate.wrapped` or `mutate.checks` this runner cannot use, naming the file. */
function validateHost(mutate, file) {
  const bad = (key, what) => new RunError(`${key} in ${file} must be ${what}.`, 'BAD_CONFIG');
  if (mutate.run !== undefined) {
    const text = mutate.run;
    const count = (part) => (typeof text === 'string' ? text.split(`{${part}}`).length - 1 : 0);
    if (!nonEmpty(text) || count('tree') !== 1 || count('test') !== 1 || text.slice(0, text.search(PART)).trim() === '') {
      throw bad('mutate.run', RUN_SHAPE);
    }
  }
  if (mutate.wrapped !== undefined) {
    if (regexOf(bad, 'mutate.wrapped', mutate.wrapped).test('')) {
      throw bad('mutate.wrapped', 'a regex that an empty test does not match, or every test reads as wrapped');
    }
    if (mutate.run === undefined) throw bad('mutate.wrapped', 'set beside mutate.run, the wrapper whose spellings it marks');
  }
  if (mutate.checks === undefined) return;
  if (!Array.isArray(mutate.checks)) throw bad('mutate.checks', 'a list of {match, finding}');
  mutate.checks.forEach((entry, i) => {
    const at = `mutate.checks[${i}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw bad(at, 'a map of match and finding');
    const extra = Object.keys(entry).filter((key) => key !== 'match' && key !== 'finding');
    if (extra.length > 0) throw bad(at, `a map of match and finding only, not ${extra.join(', ')}`);
    regexOf(bad, `${at}.match`, entry.match);
    regexOf(bad, `${at}.finding`, entry.finding);
  });
}

/**
 * The host's wrapper and checks a config names: `run` null without one, with `wrapped` the regex of
 * the other spellings of an already wrapped test, null without it; `checks` empty without any.
 */
function hostOf(config) {
  const mutate = (config && config.mutate) || {};
  const run = mutate.run ? {
    text: mutate.run,
    words: mutate.run.slice(0, mutate.run.search(PART)).trim(),
    wrapped: mutate.wrapped ? new RegExp(mutate.wrapped) : null,
  } : null;
  const checks = (mutate.checks || []).map((entry) => ({ match: new RegExp(entry.match, 'm'), finding: new RegExp(entry.finding, 'm') }));
  return { run, checks };
}

/** Whether `test` already starts with the wrapper's own words, or with a spelling `mutate.wrapped` marks. */
function startsWrapped(run, test) {
  const text = test.trimStart();
  if (text.startsWith(run.words) && (text.length === run.words.length || /\s/.test(text[run.words.length]))) return true;
  const marked = run.wrapped && run.wrapped.exec(text);
  return Boolean(marked) && marked.index === 0;
}

/** The command `test` runs as on `tree`: through the host's wrapper, or as written. */
function commandOf(host, tree, test) {
  if (!host.run || startsWrapped(host.run, test)) return test;
  return host.run.text.replace(PART, (all, part) => quote(part === 'tree' ? tree : test));
}

module.exports = { commandOf, hostOf, quote, validateHost };
