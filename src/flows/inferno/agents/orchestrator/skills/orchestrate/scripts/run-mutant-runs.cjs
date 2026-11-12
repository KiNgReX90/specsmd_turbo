'use strict';

/**
 * The runner's side of a review's mutants: run entries `{criterion, file, line, find, replace,
 * test}` through the batch on the tree as it stands, and write a review file back with what the
 * runs said.
 *
 * An entry runs only where the batch may run: nothing uncommitted on the tree but the review files
 * the record signs (both lenses of an item, or the one intent review) and another item's pending
 * review files, and no other mutate alive. Otherwise none runs and each stays owed, because a
 * mistake planted beside a sibling's uncommitted work could reach it and a test run there reads
 * that work. A review file is no test's input and no mutant's target, and the batch never writes
 * it. A sibling may still write during the batch: a verdict stands when the files the batch broke
 * and the paths its reseal changed are back, and any other path that moved is printed as a
 * warning (run-mutate-left.cjs). A path nobody else's work explains is the test command's own,
 * and with no other dispatch open, or in a file the item owns or the host seals, it records
 * nothing, as before. Every guard of the batch holds: the
 * journal, the restore on every exit, the signals held until the files are back
 * (run-mutate-batch.cjs). A line that moved since its entry was written is found again by its
 * text when that text marks exactly one line of the file; once its file holds the text nowhere, it
 * is followed into the one line, among the files the item changed since its first review, that
 * holds it once.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const lib = require('./run-lib.cjs');
const { batch } = require('./run-mutate-batch.cjs');
const { committedFile, readBatch } = require('./run-mutate-entries.cjs');
const { journalPath } = require('./run-mutate-journal.cjs');
const { notices, reviewedBy } = require('./run-mutate-left.cjs');
const { sealOf } = require('./run-mutate-seal.cjs');
const { MUTANT_KEYS, bad, isMap } = require('./run-review-file.cjs');

const { RunError } = lib;

/** Every path git calls changed or new, each file of a new directory by its own name. */
function changedFiles(tree) {
  const result = spawnSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], { cwd: tree, encoding: 'utf8' });
  if (result.status !== 0) throw new RunError(`git status failed in ${tree}`, 'GIT');
  const fields = (result.stdout || '').split('\0');
  const files = [];
  for (let i = 0; i < fields.length; i += 1) {
    if (fields[i].length < 4) continue;
    files.push(fields[i].slice(3));
    if (/^[RC]/.test(fields[i])) i += 1;
  }
  return files;
}

/**
 * Whether a mutant may run on the tree now, beside the review files `signs` this record signs and
 * another item's pending review files: `{ why }` when it may not, else `{ pending }`, the paths
 * the batch is to allow. Git names a new directory instead of the files in it, so that name is
 * allowed once every file under it proved to be one of those.
 */
function busy(tree, signs) {
  const own = signs.map(reviewedBy).filter(Boolean);
  const allowed = (file) => signs.includes(file) || (reviewedBy(file) !== null && !own.includes(reviewedBy(file)));
  const changed = changedFiles(tree);
  const dirty = changed.filter((file) => !allowed(file));
  if (dirty.length > 0) return { why: `the tree holds uncommitted work in ${dirty.slice(0, 3).join(', ')}` };
  // Every caller restored a dead run's leftover first, so a journal still there is a live mutate's.
  if (fs.existsSync(journalPath(tree))) return { why: 'another mutate is running on the tree' };
  const under = (dir) => dir.endsWith('/') && changed.some((rel) => rel.startsWith(dir));
  return { pending: lib.dirtyPaths(tree).filter((file) => allowed(file) || under(file)) };
}

/**
 * The paths among a batch's `left` that are its own for certain: a file it broke, a path the host
 * seals, or a file the item under review owns, which no sibling writes.
 */
function ownLeft(tree, payload, { runnable, configFile, rel }) {
  const broken = new Set([...runnable.map((entry) => entry.file), ...(payload.entries || []).map((row) => row.file)]);
  const sealed = sealOf(lib.readConfig(tree, configFile)).entries.flatMap((entry) => entry.paths);
  const match = /^[^/]+\/intents\/([^/]+)\/reviews\/([^/]+)\.yaml$/.exec(rel.split(path.sep).join('/'));
  const editable = match ? editableOf(tree, match[1], match[2]) : [];
  return (payload.left || []).filter((file) => broken.has(file) || lib.matchesAny(file, sealed) || lib.ownedBy(file, editable, tree));
}

/** The item's editable paths, none when its spec cannot be read. */
function editableOf(tree, intentId, itemId) {
  try {
    const { manifest } = lib.readItemSpec(tree, intentId, itemId);
    return (manifest && manifest.ownership && manifest.ownership.editable) || [];
  } catch (error) {
    if (error instanceof RunError) return [];
    throw error;
  }
}

/** The entries as the batch reads them, written beside the batch's own logs, outside the tree. */
function batchFile(tree, entries) {
  const file = path.join(path.dirname(journalPath(tree)), `review-mutants-${lib.stamp()}-${process.pid}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(entries.map((entry) => Object.fromEntries(MUTANT_KEYS.map((key) => [key, entry[key]])))));
  return file;
}

/** Hold each proposal to the batch's own checks before anything runs; a bad one goes back to the reviewer. */
function checkTargets(tree, rel, proposals) {
  if (proposals.length === 0) return;
  const file = batchFile(tree, proposals);
  try {
    readBatch(tree, file);
  } catch (error) {
    if (error instanceof RunError && (error.code === 'BAD_BATCH' || error.code === 'BAD_TARGET')) throw bad(rel, `mutants ${error.message}`);
    throw error;
  } finally {
    fs.rmSync(file, { force: true });
  }
}

function occurrences(line, find) {
  let count = 0;
  for (let at = line.indexOf(find); at !== -1; at = line.indexOf(find, at + 1)) count += 1;
  return count;
}

/**
 * The lines of a committed file that hold `find`, under `lines` as `{ file, line, text }`; none,
 * with `gone` saying why, when the file is no committed one.
 */
function holding(tree, file, find) {
  try {
    const target = committedFile(tree, file);
    const lines = target.lines.slice(0, target.count).map((text, index) => ({ file: target.rel, line: String(index + 1), text }));
    return { lines: lines.filter(({ text }) => text.includes(find)) };
  } catch (error) {
    if (error instanceof RunError) return { gone: error.message, lines: [] };
    throw error;
  }
}

/**
 * The files an item changed since its first review, the one review that proposes its mutants:
 * changed from the commit that first recorded its review file `rel` to HEAD, owned by the item,
 * never the ledger's. None while `rel` has no committed version.
 */
function changedSince(tree, rel, editable) {
  const [first] = lib.gitLines(tree, ['log', '--format=%H', '--reverse', '--', rel.split(path.sep).join('/')]);
  if (!first) return [];
  return lib.gitLines(tree, ['-c', 'core.quotePath=off', 'diff', '--name-only', first, 'HEAD'])
    .filter((file) => !file.startsWith(`${lib.SPECS_DIR}/`) && lib.ownedBy(file, editable, tree));
}

/**
 * Where `entry.find` is now: its own line, else the one line of its file that holds it once. Once
 * its file holds it nowhere or is gone, the one line among the files `elsewhere()` names that holds
 * it once, as `{ file, line }`. Two such lines are no place. Otherwise `{ why }`.
 */
function locate(tree, entry, elsewhere = () => []) {
  const own = holding(tree, entry.file, entry.find);
  const at = own.lines.find((one) => one.line === String(Number(entry.line)));
  if (at && occurrences(at.text, entry.find) === 1) return { line: at.line };
  if (own.lines.length === 1 && occurrences(own.lines[0].text, entry.find) === 1) return { line: own.lines[0].line };
  const why = own.gone || `${entry.file}:${entry.line} changed, and find no longer marks one line of it`;
  if (own.lines.length > 0) return { why };
  const found = elsewhere().flatMap((file) => holding(tree, file, entry.find).lines);
  if (found.length === 1 && occurrences(found[0].text, entry.find) === 1) return { file: found[0].file, line: found[0].line };
  return { why: found.length > 1 ? `${why}; ${found.length} lines of the files the item changed since hold it, so none is its place` : why };
}

/** What one batch row says, in the words a review file keeps. */
const verdictOf = (row) => (row.caught === null ? { caught: 'none', why: row.why } : { caught: row.caught ? 'yes' : 'no', why: undefined });

/**
 * Run `toRun` in one batch and write each result onto its entry: `caught`, with `why` for none,
 * and the file and line it ran on. `signs` are the review files this record signs, `rel` alone
 * unless named; `elsewhere` lists the files `locate` may follow a moved line into. On a busy tree
 * nothing runs and each entry loses any verdict it had, so it reads owed. Returns `{ busy }` or
 * `{ ran, builds, warned }`, `warned` the lines on paths another item's work may have moved. A
 * batch that could not put back a file of its own, or that stopped before every entry had its
 * run, records nothing: it throws.
 */
async function runEntries(tree, toRun, { configFile, rel, signs = [rel], elsewhere }) {
  const clear = (entry) => {
    delete entry.caught;
    delete entry.why;
  };
  const state = toRun.length > 0 ? busy(tree, signs.map((file) => file.split(path.sep).join('/'))) : { pending: [] };
  if (state.why) {
    toRun.forEach(clear);
    return { busy: state.why };
  }
  const runnable = [];
  for (const entry of toRun) {
    const at = locate(tree, entry, elsewhere);
    if (at.why) Object.assign(entry, { caught: 'none', why: at.why, tried: true });
    else runnable.push(Object.assign(entry, at, { tried: true }));
  }
  if (runnable.length === 0) return { ran: 0, builds: 0 };
  const file = batchFile(tree, runnable);
  let result;
  try {
    result = await batch({ tree, batch: file, config: configFile, pending: state.pending });
  } catch (error) {
    if (!(error instanceof RunError) || (error.code !== 'DIRTY' && error.code !== 'MUTATE_RUNNING')) throw error;
    toRun.forEach(clear);
    return { busy: 'another mutate started on the tree' };
  } finally {
    fs.rmSync(file, { force: true });
  }
  const { payload } = result;
  const own = payload.restored === false ? ownLeft(tree, payload, { runnable, configFile, rel }) : [];
  // `beside` set: every path left may be another dispatch's work; without it, each is the batch's own.
  if (payload.restored === false && (payload.failed || !payload.beside || own.length > 0)) {
    const mine = own.length > 0 && payload.beside ? `${listed(own)} ${own.length === 1 ? 'is' : 'are'} the batch's own and not back; ` : '';
    throw new RunError(`the runner's mutants could not put every file back: ${mine}${result.out.join('; ')}. Nothing is recorded`, 'MUTATE_RESTORE', 2);
  }
  if (payload.stopped && /red with every switch off|control run of/.test(payload.stopped)) {
    throw bad(rel, `the runner's mutants stopped, every file is back and nothing is recorded: ${payload.stopped}. ` +
      'Name a test command that passes on the code as it stands, or report its red as a finding');
  }
  if (payload.stopped) {
    throw new RunError(`the runner's mutants stopped: ${payload.stopped}. Every file is back and nothing is recorded: run the same command again`,
      'MUTATE_STOPPED', 2);
  }
  runnable.forEach((entry, index) => Object.assign(entry, verdictOf(payload.entries[index]), { ran: true }));
  return { ran: runnable.length, builds: payload.builds, warned: notices(payload) };
}

const listed = (items) => items.slice(0, 5).join(', ') + (items.length > 5 ? ` and ${items.length - 5} more` : '');

/** The lines that say what a run did, at most one per entry without a verdict. */
function ranLines(result, entries, owes) {
  if (result.busy) {
    const count = entries.filter((entry) => entry.caught === undefined && entry.find !== undefined).length;
    return [`no mutant ran: ${result.busy}, so ${count} ${count === 1 ? 'proposal stays' : 'proposals stay'} owed to the intent review`];
  }
  const tried = entries.filter((entry) => entry.tried);
  const count = (caught) => tried.filter((entry) => entry.caught === caught).length;
  const ran = tried.filter((entry) => entry.ran).length;
  const out = tried.length > 0 ? [`mutants: ${ran} ran, ${count('yes')} caught, ${count('no')} survived, ${count('none')} without a verdict`] : [];
  for (const entry of tried.filter((item) => item.caught === 'none')) {
    out.push(`MUTANT ${entry.criterion} no verdict: ${entry.why}; ${owes(entry)}`);
  }
  return [...out, ...(result.warned || [])];
}

/** The finding a surviving mutant is: its test stays green when its line changes. */
function survivorFinding(entry, extra = {}) {
  return {
    criterion: entry.criterion,
    file: entry.file,
    line: String(entry.line),
    evidence: `the runner broke ${entry.file}:${entry.line} from \`${entry.find}\` to \`${entry.replace}\`, and \`${entry.test}\` ` +
      `stayed green, so criterion ${entry.criterion} is not really covered`,
    fix: 'make that test turn red on that change; leave the production line as it is',
    severity: 'major',
    ...extra,
    mutant: entry.criterion,
  };
}

/** A scalar this runner's YAML reads back as the same text: plain when it plainly can, else double-quoted. */
function scalar(value) {
  const text = String(value);
  // A colon reads plain unless a space or the end follows it, which would read as a key.
  if (/^[\w./@+:-]+(?: [\w./@+:-]+)*$/.test(text) && !/:(?: |$)/.test(text)) return text;
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
}

/** A review document as text: scalars, lists of scalars and lists of flat maps, in key order. */
function dump(doc) {
  const lines = [];
  for (const [key, value] of Object.entries(doc)) {
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      lines.push(`${key}: ${scalar(value)}`);
      continue;
    }
    lines.push(value.length === 0 ? `${key}: []` : `${key}:`);
    for (const entry of value) {
      if (!isMap(entry)) {
        lines.push(`  - ${scalar(entry)}`);
        continue;
      }
      Object.entries(entry).filter(([, text]) => text !== undefined)
        .forEach(([name, text], index) => lines.push(`${index === 0 ? '  - ' : '    '}${name}: ${scalar(text)}`));
    }
  }
  return `${lines.join('\n')}\n`;
}

/** The mutant entries the last recorded version of `rel` holds, none when HEAD has no readable one. */
function previousEntries(tree, rel) {
  const text = lib.git(tree, ['show', `HEAD:${rel.split(path.sep).join('/')}`], { tolerate: true });
  if (text === null) return [];
  try {
    const doc = lib.parseYaml(text);
    return isMap(doc) && Array.isArray(doc.mutants) ? doc.mutants.filter(isMap).map((entry) => ({ ...entry })) : [];
  } catch (error) {
    return [];
  }
}

/** The findings the reviewer wrote: the runner writes every survivor finding again itself. */
const ownFindings = (doc) => (Array.isArray(doc.findings) ? doc.findings.filter((finding) => !isMap(finding) || finding.mutant === undefined) : []);

/** The entry as a review file keeps it: the proposal, then what the runner wrote, in that order. */
const kept = (entry) => Object.fromEntries([...MUTANT_KEYS, 'was', 'caught', 'why'].map((key) => [key, entry[key]]).filter(([, value]) => value !== undefined));

module.exports = { changedSince, checkTargets, dump, kept, locate, ownFindings, previousEntries, ranLines, runEntries, survivorFinding };
