'use strict';

/**
 * `defer-finding`: the orchestrator moves one finding of the recorded intent review out of its
 * verdict, on a rule the user gave, the way `defer-item` takes an item out of its intent.
 *
 * The finding goes, as recorded, into the review's `deferred` list with `to`, a file in the intent
 * folder that names the finding's file and line so the next plan picks it up, and `reason`. A
 * surviving mutant takes its mutant along with `caught: no`, so it stops running. When no finding
 * stays open the review says clean; a criterion that still owes a proof then voids it, and the next
 * intent review is dispatched for it. The reviewer never defers (run-review-aside.cjs).
 *
 * Which findings may leave is the host's, in `.specs-inferno/standards/defer-findings.yaml`:
 *
 *   severities: [minor, major]   # the severities that may leave; minor alone without the file
 *   survivors: true              # a surviving mutant may leave too; never without the file
 *
 * It writes the review file and nothing else; the caller commits it.
 */

const fs = require('fs');
const path = require('path');

const { TransitionError } = require('./state-ledger.cjs');
const { atomicWrite } = require('./state-store.cjs');
const { parseYaml } = require('./run-yaml.cjs');

/** Beside the host's other rule files (run-standards.cjs), which this writer does not load: run-lib loads the writer. */
const RULE = '.specs-inferno/standards/defer-findings.yaml';
const SEVERITIES = ['blocker', 'major', 'minor'];
const RECORDED_ORDER = ['tree', 'tree_outside', 'commit', 'reviewer'];

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The host's rule: the severities that may leave, whether a survivor may, and the file that says so, if any. */
function readRule(specs) {
  const file = path.join(specs, 'standards', path.basename(RULE));
  if (!fs.existsSync(file)) return { file: null, severities: ['minor'], survivors: false };
  const refuse = (problem) => new TransitionError(`${RULE}: ${problem}`, 'BAD_RULE');
  let doc;
  try {
    doc = parseYaml(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw refuse(error.message);
  }
  if (!isMap(doc)) throw refuse('it is a map of severities and survivors');
  const unknown = Object.keys(doc).find((key) => key !== 'severities' && key !== 'survivors');
  if (unknown) throw refuse(`unknown key ${unknown}: it holds severities and survivors only`);
  const severities = doc.severities === undefined ? ['minor'] : doc.severities;
  if (!Array.isArray(severities)) throw refuse('severities must be a list, such as [minor, major]');
  const odd = severities.find((severity) => !SEVERITIES.includes(severity));
  if (odd !== undefined) throw refuse(`severities lists ${odd}; it lists blocker, major or minor`);
  const survivors = doc.survivors === undefined ? 'false' : doc.survivors;
  if (survivors !== 'true' && survivors !== 'false') throw refuse(`survivors reads ${survivors}; write survivors: true or false`);
  return { file: RULE, severities, survivors: survivors === 'true' };
}

/** Refuse a finding the rule keeps in the verdict. */
function refuseKept(rule, n, finding) {
  if (finding.mutant !== undefined) {
    if (rule.survivors) return;
    throw new TransitionError(`findings entry ${n} is the surviving mutant ${finding.mutant}, and ` +
      `${rule.file ? `${RULE} does not say survivors: true` : `a surviving mutant leaves only when ${RULE} says survivors: true`}; ` +
      'only a rule the user gave lets it leave, else its test is made to catch it', 'SURVIVOR_STAYS');
  }
  if (rule.severities.includes(finding.severity)) return;
  throw new TransitionError(`findings entry ${n} is ${finding.severity}, and ` +
    `${rule.file ? `${RULE} lets ${rule.severities.join(', ')} leave` : `without ${RULE} only minor leaves; the user's rule goes there as severities: [...]`}; ` +
    'send it to its item as a fix', 'SEVERITY_STAYS');
}

function deferFinding(options) {
  // Required here, so every other ledger command loads none of the review machinery.
  const { INTENT_KEYS } = require('./run-intent-review-file.cjs');
  const { toProblem } = require('./run-review-aside.cjs');
  const { dump } = require('./run-mutant-runs.cjs');
  const specs = path.dirname(path.resolve(options.file));
  const dir = path.join(specs, 'intents', options.intent);
  const abs = path.join(dir, 'review.yaml');
  const rel = path.relative(path.dirname(specs), abs);
  if (!fs.existsSync(abs)) {
    throw new TransitionError(`no intent review of ${options.intent} at ${rel}: defer-finding moves a finding of a recorded intent review`, 'NO_REVIEW');
  }
  const doc = parseYaml(fs.readFileSync(abs, 'utf8'));
  if (typeof doc.tree !== 'string') {
    throw new TransitionError(`${rel} is not recorded: record it with run.cjs review first, then defer from what it found`, 'NOT_RECORDED');
  }
  const findings = Array.isArray(doc.findings) ? doc.findings : [];
  const n = Number(options.entry);
  const finding = /^\d+$/.test(String(options.entry)) ? findings[n - 1] : undefined;
  if (finding === undefined) {
    throw new TransitionError(`${rel} has no findings entry ${options.entry}: its findings are numbered 1 to ${findings.length} in the order the file lists them`,
      'NO_ENTRY');
  }
  refuseKept(readRule(specs), n, finding);
  const problem = toProblem(dir, options.to, finding);
  if (problem) throw new TransitionError(problem, 'BAD_TO');

  const mutants = Array.isArray(doc.mutants) ? doc.mutants : [];
  const survivor = mutants.find((mutant) => mutant.criterion === finding.mutant && mutant.caught === 'no');
  const reason = String(options.reason).replace(/\s+/g, ' ').trim();
  const to = path.posix.normalize(options.to);
  const entry = { ...finding, ...(survivor ? { find: survivor.find, replace: survivor.replace, test: survivor.test, caught: 'no' } : {}), to, reason };
  const open = findings.filter((one) => one !== finding);
  const next = {
    ...doc,
    verdict: open.length > 0 ? doc.verdict : 'clean',
    findings: open,
    mutants: mutants.filter((mutant) => mutant !== survivor),
    deferred: [...(Array.isArray(doc.deferred) ? doc.deferred : []), entry],
  };
  const order = [...INTENT_KEYS, ...RECORDED_ORDER];
  atomicWrite(abs, dump(Object.fromEntries(order.filter((key) => next[key] !== undefined).map((key) => [key, next[key]]))));
  return {
    changed: true, intent: options.intent, entry: n, severity: finding.severity, at: `${finding.file}:${finding.line}`, to, reason,
    verdict: next.verdict, open: open.length, review: rel,
  };
}

module.exports = { RULE, deferFinding, readRule };
