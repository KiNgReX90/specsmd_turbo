'use strict';

/**
 * How one recorded version of a file is read, by the rules of the plan's appendix "how the
 * numbers were read". Pure functions over text: the git walk lives in history.cjs.
 */

const path = require('node:path');

const S = path.join(__dirname, '..', '..', 'src', 'flows', 'inferno', 'agents', 'orchestrator', 'skills', 'orchestrate', 'scripts');
const { parseYaml } = require(path.join(S, 'run-yaml.cjs'));
const { weightOf } = require(path.join(S, 'run-review-file.cjs'));
const { acceptanceCriteria } = require(path.join(S, 'run-mutant-coverage.cjs'));

/** The lines run.cjs appends when it records a review. Two versions are compared without them. */
const RECORDED = /^(?:tree|commit|reviewer):.*$/;

/** A version's content as two recordings are compared: without the recorded lines. */
function comparable(text) {
  return text.split('\n').filter((line) => !RECORDED.test(line)).join('\n').trimEnd();
}

/**
 * A finding whose evidence is a surviving mutant: its evidence names a mutant and says that no
 * test caught it. The reviewer writes `caught: no` as a finding too, so such a finding repeats
 * the survivor and makes a round no more serious than the survivor does.
 */
const MUTANT = /\bmutant|\bmutation/i;
const SURVIVED = /surviv|caught:?\s*no\b|not caught|uncaught|no test fail|still pass|stay(?:s|ed)? green|went green/i;
const survivorEvidence = (finding) => MUTANT.test(String(finding.evidence || '')) && SURVIVED.test(String(finding.evidence || ''));

/** A mutant names a numbered criterion when its criterion starts with a number. */
const numbered = (mutant) => /^\s*\d/.test(String(mutant.criterion === undefined ? '' : mutant.criterion));

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const listOf = (value) => (Array.isArray(value) ? value : []);

/**
 * What a fix round weighs. `serious`: a blocker or major finding whose evidence is something
 * other than a surviving mutant. `survivor`: serious only because a mutant survived. `minor`:
 * every finding minor and no survivor, which is weightOf in run-review-file.cjs.
 */
function kindOf(findings, survivors) {
  if (!weightOf({ findings, survivors }).serious) return 'minor';
  const other = findings.some((finding) => finding.severity !== 'minor' && !survivorEvidence(finding));
  return other ? 'serious' : 'survivor';
}

/** One review version as a round: its verdict, findings, mutants, survivors, files and kind. */
function readRound(text) {
  let doc;
  try {
    doc = parseYaml(text);
  } catch (error) {
    return { readable: false, error: error.message };
  }
  if (!isMap(doc)) return { readable: false, error: 'not a map' };
  const findings = listOf(doc.findings).filter(isMap);
  const mutants = listOf(doc.mutants).filter(isMap);
  const survivors = mutants.filter((mutant) => mutant.caught === 'no');
  const files = [...new Set(listOf(doc.files).filter((file) => typeof file === 'string').map((file) => path.posix.normalize(file)))];
  const verdict = doc.verdict === 'fix' || doc.verdict === 'clean' ? doc.verdict : null;
  return { readable: true, verdict, findings, mutants, survivors, files, kind: verdict === 'fix' ? kindOf(findings, survivors) : null };
}

/** The editable paths of a spec version's execution manifest, or null when it does not read. */
function editableOf(text) {
  const section = /\n## Execution Manifest\s*\n([\s\S]*?)(?=\n## |\n?$)/.exec(text);
  if (!section) return null;
  try {
    const manifest = parseYaml(section[1].replace(/^\s*```(?:yaml)?\s*$/gm, ''));
    const editable = isMap(manifest) && isMap(manifest.ownership) ? listOf(manifest.ownership.editable) : [];
    return new Set(editable.filter((entry) => typeof entry === 'string').map((entry) => entry.trim()));
  } catch (error) {
    return null;
  }
}

/** The number of acceptance criteria a spec version lists. */
const criteriaOf = (text) => acceptanceCriteria(text).length;

module.exports = { comparable, criteriaOf, editableOf, kindOf, numbered, readRound, survivorEvidence };
