'use strict';

/**
 * `run.cjs verify-item`: one item's own check plus its ownership, and the proof a reviewer
 * reads instead of running the item's checks again.
 *
 * The proof is one JSON file per reviewed item, at `proofPath(tree, intent, item)`:
 * `<cache>/item-proofs/<intent>/<item>.json`, beside the `green-commands/` proofs
 * run-proofs.cjs keeps. `readItemProof(tree, intent, item)` reads it back, or null. Each
 * verify-item rewrites it whole. A batch writes the same proof at each of its items. Fields:
 *
 *   item, intent     the item this file is for
 *   items            every item this verify-item checked as one unit (a batch names them all)
 *   passed           true when verify-item exited 0: every check passed, nothing changed
 *                    outside the ownership and no test was switched off
 *   finished_at      when it was written, ISO
 *   head             the commit HEAD stood on
 *   since            the baseline as verify-item named it: the dispatch's first baseline sha,
 *                    `--since`, or HEAD for an item the runner before signed records dispatched
 *   outside, unreported   as verify-item reports them
 *   commands         [{ item, command, exit, seconds, counts, tail, log }] per check it ran;
 *                    `counts` is { passed, failed } where the runner prints them (vitest, jest,
 *                    node --test, cargo, Playwright, mocha, pytest, go test -v, dotnet, phpunit,
 *                    maven), else null; `tail` is the last 40 lines, ANSI codes removed; the
 *                    full output stays in `log` and never in the proof
 *   diff             { from, paths, sha256 }: the item's diff is every path changed since the
 *                    baseline `from` (a full sha) that the item owns or its dispatch claimed,
 *                    never one under `.specs-inferno/`, sorted; sha256 hashes `git diff --full-index --binary --no-renames
 *                    --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/
 *                    <from> -- <paths>` as the tree stands, new files included. Once the item
 *                    is committed, the same diff from `from` to HEAD hashes the same: that is
 *                    the range its review reads. `diffHash` computes it. Null when the baseline
 *                    names no commit.
 *   tests_changed    { modified, deleted, switched_off }: the test files (run-test-files.cjs)
 *                    that existed at `from` and the item modified or deleted, a new one never,
 *                    and every line the diff adds to a test file, new ones included, that
 *                    switches a test off, as { file, line, text }, `line` 1-based in the new
 *                    file. A switch-off fails verify-item. Null when `diff` is.
 *   real_app         only on a host that sets `real_app.prove`: { command, journeys, exit,
 *                    seconds, counts, tail, log } of its run over the journeys the diff changed,
 *                    whose red fails verify-item, or null when the diff changed none
 *                    (run-real-app-prove.cjs)
 *
 * `proofAtHead(tree, intent, item, config)` tells whether the proof is of the state a review reads.
 */

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { spawnSync } = require('child_process');

const lib = require('./run-lib.cjs');
const { attribute } = require('./run-attribute.cjs');
const { resolveBase } = require('./run-intents.cjs');
const { changedPaths, treeOf } = require('./run-gate.cjs');
const { isSwitchOff, isTestFile, parseAddedLines } = require('./run-test-files.cjs');
const { owedProof, proveItem } = require('./run-real-app-prove.cjs');

const { RunError } = lib;

const TAIL_LINES = 40;
const DIFF_FLAGS = ['--full-index', '--binary', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv',
  '--src-prefix=a/', '--dst-prefix=b/'];
const DIFF = ['diff', '--cached', ...DIFF_FLAGS];
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const literal = (file) => `:(literal)${file}`;

/**
 * The ledger's paths, under `.specs-inferno/`: never part of an item's proof nor of the code its
 * review binds, also when the item owns one, as a host config it changes. The proof's writer
 * leaves them out of its paths and its reader out of what changed since, so both hold one rule.
 */
const inLedger = (file) => file.startsWith(`${lib.SPECS_DIR}/`);

// ---------------------------------------------------------------------------
// The proof file
// ---------------------------------------------------------------------------

/** Where the proof of `item` in `intent` lives. */
function proofPath(tree, intent, item) {
  return path.join(lib.cacheDir(tree), 'item-proofs', intent, `${item}.json`);
}

/** The proof of `item` in `intent`, or null when there is none or it does not parse. */
function readItemProof(tree, intent, item) {
  try {
    return JSON.parse(fs.readFileSync(proofPath(tree, intent, item), 'utf8'));
  } catch (error) {
    return null;
  }
}

function writeProof(file, proof) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const pending = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(pending, `${JSON.stringify(proof, null, 2)}\n`);
  fs.renameSync(pending, file);
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** The hash `diffHash` gave the item's diff, read once it is committed: from `from` to HEAD over `files`, or null. */
function headDiffHash(tree, from, files) {
  if (files.length === 0) return sha256('');
  const result = spawnSync('git', ['diff', ...DIFF_FLAGS, from, 'HEAD', '--', ...files.map(literal)],
    { cwd: tree, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return result.status === 0 ? sha256(result.stdout) : null;
}

/**
 * The proof of `item` as its review would read it, at HEAD, where the review reads the item.
 * `current` when it was taken over the item's paths as HEAD holds them: its baseline is a
 * commit, no path the proven items own changed since that baseline outside the proof's paths,
 * and the diff from it to HEAD over those paths hashes as the proof's. `stale` for a proof of
 * any other state, and `none` when there is no proof or it holds no diff. A path of the ledger
 * (`inLedger`) is in neither the proof nor this comparison. `items` are the items
 * the proof checked as one unit, and `paths` the proof's, cut to the item's own for a batch.
 * On a host with `real_app.prove` in `config` (the tree's own config when none is given), a
 * proof without the run of the journeys its diff changed is `stale` too, and so is no proof of an
 * item owning a journey; `why` then says so (run-real-app-prove.cjs).
 */
function proofAtHead(tree, intent, item, config = null) {
  const file = proofPath(tree, intent, item);
  const proof = readItemProof(tree, intent, item);
  const host = config || lib.readConfig(tree);
  // A dispatched item always has its editable list: the frontier refuses one without it.
  const editable = (id) => lib.readItemSpec(tree, intent, id).manifest.ownership.editable;
  if (!proof) {
    const owned = () => ((lib.readItemSpec(tree, intent, item).manifest || {}).ownership || {}).editable || [];
    const why = owedProof(tree, host, null, file, owned);
    return why ? { state: 'stale', file, items: [item], why } : { state: 'none', file, items: [item] };
  }
  if (!proof.diff) return { state: 'none', file, items: [item] };
  const { items, diff: { from, paths } } = proof;
  const stale = { state: 'stale', file, items };
  if (!lib.git(tree, ['rev-parse', '--verify', '--quiet', `${from}^{commit}`], { tolerate: true })) return stale;
  const owned = items.flatMap(editable);
  const changed = lib.gitLines(tree, ['diff', '--name-only', '--no-renames', from, 'HEAD'], { tolerate: true })
    .filter((entry) => !inLedger(entry) && lib.ownedBy(entry, owned, tree));
  if (changed.some((entry) => !paths.includes(entry))) return stale;
  if (headDiffHash(tree, from, paths) !== proof.diff.sha256) return stale;
  const why = owedProof(tree, host, proof, file, () => []);
  if (why) return { ...stale, why };
  const own = items.length > 1 ? paths.filter((entry) => lib.ownedBy(entry, editable(item), tree)) : paths;
  return { state: 'current', file, items, from, paths: own };
}

// ---------------------------------------------------------------------------
// What a check printed: its counts and its last lines
// ---------------------------------------------------------------------------

const num = (line, pattern) => {
  const match = pattern.exec(line || '');
  return match ? Number(match[1]) : 0;
};

function lastLine(lines, pattern) {
  for (let i = lines.length - 1; i >= 0; i -= 1) if (pattern.test(lines[i])) return lines[i];
  return null;
}

const sum = (lines, pattern) => lines.reduce((total, line) => total + num(line, pattern), 0);

/** Passed and failed test counts from a runner's summary, or null when the output shows none. */
function parseCounts(output) {
  const lines = String(output).replace(ANSI, '').split(/\r?\n/);
  const counts = (passed, failed) => ({ passed, failed });
  let line;
  // vitest: " Tests  1 failed | 13 passed (14)"
  if ((line = lastLine(lines, /^\s*Tests\s{2,}.*\b(?:passed|failed)\b/))) return counts(num(line, /(\d+) passed/), num(line, /(\d+) failed/));
  // jest: "Tests:       1 failed, 13 passed, 14 total"
  if ((line = lastLine(lines, /^\s*Tests:\s+.*\d+ total/))) return counts(num(line, /(\d+) passed/), num(line, /(\d+) failed/));
  // node --test: "ℹ pass 13" and "ℹ fail 1", or "# pass 13" under TAP
  if ((line = lastLine(lines, /^(?:ℹ|#) pass \d+/))) return counts(num(line, /pass (\d+)/), num(lastLine(lines, /^(?:ℹ|#) fail \d+/), /fail (\d+)/));
  // cargo: "test result: ok. 4 passed; 0 failed; ..." per test binary, summed
  const cargo = lines.filter((entry) => /^test result: \w+\. \d+ passed; \d+ failed;/.test(entry));
  if (cargo.length > 0) return counts(sum(cargo, /(\d+) passed/), sum(cargo, /(\d+) failed/));
  // dotnet: "Passed!  - Failed:     0, Passed:    14, ..." per project, summed
  const dotnet = lines.filter((entry) => /(Passed|Failed)!\s+-\s+Failed:\s+\d+,\s+Passed:\s+\d+/.test(entry));
  if (dotnet.length > 0) return counts(sum(dotnet, /Passed:\s+(\d+)/), sum(dotnet, /Failed:\s+(\d+)/));
  // dotnet 8+: "Test summary: total: 14, failed: 0, succeeded: 14, skipped: 0"
  if ((line = lastLine(lines, /Test summary: total: \d+/))) return counts(num(line, /succeeded: (\d+)/), num(line, /failed: (\d+)/));
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
  // Playwright: "  8 passed (4.2s)" and "  1 failed"
  if ((line = lastLine(lines, /^\s*\d+ passed \([\d.]+m?s\)/))) return counts(num(line, /(\d+) passed/), num(lastLine(lines, /^\s*\d+ failed\s*$/), /(\d+) failed/));
  // mocha: "  14 passing (20ms)" and "  1 failing"
  if ((line = lastLine(lines, /^\s*\d+ passing\b/))) return counts(num(line, /(\d+) passing/), num(lastLine(lines, /^\s*\d+ failing\b/), /(\d+) failing/));
  // go test -v: one "--- PASS:" or "--- FAIL:" line per test
  const goPass = lines.filter((entry) => /^\s*--- PASS: /.test(entry)).length;
  const goFail = lines.filter((entry) => /^\s*--- FAIL: /.test(entry)).length;
  return goPass + goFail > 0 ? counts(goPass, goFail) : null;
}

/** The last `count` lines of an output, ANSI codes and trailing blank lines removed. */
function tailLines(output, count = TAIL_LINES) {
  const text = String(output).replace(ANSI, '').replace(/\s+$/, '');
  return text ? text.split(/\r?\n/).slice(-count) : [];
}

function readLog(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    return '';
  }
}

// ---------------------------------------------------------------------------
// The item's diff, read through an index of its own
// ---------------------------------------------------------------------------

/**
 * Run `read(git)` against a scratch index holding HEAD plus the tree's current `files`, so a
 * new file is in the diff and the tree's own index is never touched: a builder may be staging
 * beside this call.
 */
function withScratchIndex(tree, files, read) {
  const dir = path.join(lib.cacheDir(tree), 'item-proofs');
  fs.mkdirSync(dir, { recursive: true });
  const index = path.join(dir, `.index-${process.pid}-${Date.now()}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: tree, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (result.status !== 0) {
      throw new RunError(`git ${args[0]} failed in ${tree} while reading the item's diff: ${(result.stderr || '').trim().split('\n')[0]}`, 'GIT');
    }
    return result.stdout;
  };
  try {
    git(['read-tree', 'HEAD']);
    const exists = (file) => {
      try { fs.lstatSync(path.join(tree, file)); return true; } catch (error) { return false; }
    };
    const present = files.filter(exists);
    const gone = files.filter((file) => !exists(file));
    if (present.length > 0) git(['add', '-A', '--', ...present.map(literal)]);
    if (gone.length > 0) git(['rm', '--cached', '-q', '--ignore-unmatch', '--', ...gone.map(literal)]);
    return read(git);
  } finally {
    fs.rmSync(index, { force: true });
    fs.rmSync(`${index}.lock`, { force: true });
  }
}

function hashOf(git, from, files) {
  return sha256(files.length > 0 ? git([...DIFF, from, '--', ...files.map(literal)]) : '');
}

/** The sha256 of the diff from `from` to the tree as it stands, over `files`. */
function diffHash(tree, from, files) {
  return withScratchIndex(tree, files, (git) => hashOf(git, from, files));
}

/** The item's diff and the tests it changed, both from one scratch index. */
function readDiff(tree, from, files) {
  return withScratchIndex(tree, files, (git) => {
    const tests = files.filter((file) => isTestFile(file));
    const status = new Map();
    if (tests.length > 0) {
      const fields = git([...DIFF, '--name-status', '-z', from, '--', ...tests.map(literal)]).split('\0').filter(Boolean);
      for (let i = 0; i + 1 < fields.length; i += 2) status.set(fields[i + 1], fields[i][0]);
    }
    const changed = { modified: [], deleted: [], switched_off: [] };
    for (const file of tests) {
      const letter = status.get(file);
      if (letter === 'M' || letter === 'T') changed.modified.push(file);
      if (letter === 'D') changed.deleted.push(file);
      if (!letter || letter === 'D') continue;
      for (const added of parseAddedLines(git([...DIFF, '-U0', from, '--', literal(file)]))) {
        if (isSwitchOff(added.text)) changed.switched_off.push({ file, line: added.line, text: added.text.trim() });
      }
    }
    return { diff: { from, paths: files, sha256: hashOf(git, from, files) }, tests_changed: changed };
  });
}

/**
 * The paths of the item's diff: changed since the baseline, owned by the reviewed items or
 * claimed by their dispatches, never the ledger's.
 */
function itemFiles(tree, since, editable, claimed) {
  return changedPaths(tree, since)
    .filter((file) => !inLedger(file))
    .filter((file) => claimed.has(file) || lib.ownedBy(file, editable, tree))
    .sort();
}

// ---------------------------------------------------------------------------
// verify-item
// ---------------------------------------------------------------------------

/** The items under review: one id, or the explicitly batched chain in `--items a,b`. */
function reviewed(ledger, itemId, options) {
  const ids = options.items
    ? String(options.items).split(',').map((id) => id.trim()).filter((id) => id.length > 0)
    : [itemId];
  return ids.map((id) => {
    const intent = options.intent
      ? lib.findIntent(ledger, options.intent)
      : ledger.intents.find((entry) => entry.items.some((item) => item.id === id));
    if (!intent) throw new RunError(`work item not found in the live ledger: ${id}`, 'ITEM_NOT_FOUND');
    return { id, intent: intent.id };
  });
}

/** Every path changed since `since` that the union of the reviewed items does not own. */
function sinceOutside(tree, since, editable) {
  return changedPaths(tree, since).filter(
    (file) => !inLedger(file) && !lib.ownedBy(file, editable, tree)
  );
}

/**
 * One item's own check plus its ownership, and its proof. A batch is reviewed as the unit it
 * was built as: each item against its own dispatch, so a change one item of the batch reported
 * is that item's, and under `--since` against the union of its items' editable lists.
 */
function verifyItem(itemId, options) {
  const tree = treeOf(options);
  const ledger = lib.readLedger(tree);
  const items = reviewed(ledger, itemId, options).map((entry) => ({
    ...entry,
    spec: lib.readItemSpec(tree, entry.intent, entry.id),
  }));
  const label = items.map((entry) => entry.id).join(', ');
  const editable = [
    ...new Set(
      items.flatMap((entry) => (entry.spec.manifest.ownership && entry.spec.manifest.ownership.editable) || [])
    ),
  ];
  // `--since` names the baseline by hand; without it each item answers to its own dispatch,
  // and an item the runner before signed records dispatched is checked the old way.
  const out = [];
  const config = lib.readConfig(tree, options.config);
  let attribution = options.since ? null
    : attribute(tree, items, { ...options, base: options.base || resolveBase(config, null, tree) });
  if (attribution && attribution.legacy) {
    out.push(`no signed dispatch for ${attribution.legacy.join(', ')}: checked since HEAD as the runner before signed records did`);
    attribution = null;
  }
  const since = attribution ? attribution.since : options.since || 'HEAD';
  const outside = attribution ? attribution.outside : sinceOutside(tree, since, editable);
  const unreported = attribution ? attribution.unreported : [];
  const attributed = attribution ? attribution.attributed : [];
  let failed = outside.length > 0;
  const checks = [];
  const commands = [];
  for (const entry of items) {
    if (!entry.spec.manifest.finalize_check) {
      out.push(`PASS ${entry.id} carries no finalize_check`);
      continue;
    }
    const log = path.join(lib.cacheDir(tree), lib.currentBranch(tree), `verify-${entry.id}-${lib.stamp()}.log`);
    const check = lib.runShell(entry.spec.manifest.finalize_check, tree, log);
    checks.push({ item: entry.id, ...check });
    const output = readLog(log);
    commands.push({ item: entry.id, command: check.command, exit: check.code, seconds: check.seconds,
      counts: parseCounts(output), tail: tailLines(output), log });
    out.push(
      check.code === 0
        ? `PASS ${check.seconds}s ${check.command}`
        : `FAIL ${check.seconds}s ${check.command} -> ${log}`
    );
    if (check.code !== 0) {
      out.push(...lib.tail(log, 5));
      failed = true;
    }
  }

  if (outside.length > 0) {
    out.push(`outside ${label} ownership.editable: ${outside.slice(0, 10).join(', ')}`);
  } else {
    out.push(`ownership clean since ${since}`);
  }
  if (unreported.length > 0) {
    out.push(`owned but not in changed_files: ${unreported.slice(0, 10).join(', ')}. If this item wrote them, run dispatch-log ` +
      'for it again and accept-dispatch its full list, or each sibling\'s review names them outside');
  }

  // The proof: what ran, and the item's diff since the same baseline the ownership was read from.
  const from = lib.git(tree, ['rev-parse', '--verify', '--quiet', `${since}^{commit}`], { tolerate: true });
  const claimed = new Set(attributed.flatMap((entry) => entry.changed || []));
  const read = from ? readDiff(tree, from, itemFiles(tree, from, editable, claimed)) : { diff: null, tests_changed: null };
  const switchedOff = read.tests_changed ? read.tests_changed.switched_off : [];
  if (switchedOff.length > 0) failed = true;
  for (const entry of switchedOff) out.push(`switched off: ${entry.file}:${entry.line}: ${entry.text}`);
  // On a host with real_app.prove the journeys the diff changed run here, and a red fails the item.
  const realApp = proveItem(tree, config, options.config || path.join(lib.SPECS_DIR, 'config.yaml'),
    read.diff ? read.diff.paths : [], items[0].id, (output) => ({ counts: parseCounts(output), tail: tailLines(output) }));
  if (realApp) out.push(...realApp.out);
  if (realApp && realApp.record && realApp.record.exit !== 0) failed = true;
  const proof = {
    items: items.map((entry) => entry.id), passed: !failed, finished_at: new Date().toISOString(),
    head: lib.git(tree, ['rev-parse', 'HEAD']), since, outside, unreported, commands, ...read,
    ...(realApp ? { real_app: realApp.record } : {}),
  };
  const files = items.map((entry) => proofPath(tree, entry.intent, entry.id));
  items.forEach((entry, index) => writeProof(files[index], { item: entry.id, intent: entry.intent, ...proof }));
  out.push(`proof ${files[0]}`);

  return {
    exit: failed ? 2 : 0,
    payload: {
      items: items.map((entry) => entry.id), item: items[0].id, intent: items[0].intent, since, outside, unreported, checks,
      dispatches: attributed, proof: files[0], tests_changed: read.tests_changed,
    },
    out,
  };
}

module.exports = { TAIL_LINES, diffHash, parseCounts, proofAtHead, proofPath, readItemProof, tailLines, verifyItem };
