'use strict';

/**
 * The rounds of each item review, both lenses, and the numbers of one item. An item with
 * production code has a contract file and a quality file, and run.cjs records both in one
 * commit. A round of an item is one record: a commit that holds a new version of either lens
 * file, so a commit that holds both is one round and a later commit that changes only the
 * quality file is a round too. A version is new when its content differs from the lens file's
 * version before it, the recorded `tree`, `commit` and `reviewer` lines left out.
 */

const { versions } = require('./history.cjs');
const { countRounds } = require('./mutants.cjs');
const { comparable, criteriaOf, kindOf, numbered, readRound } = require('./rounds.cjs');

const LENSES = ['contract', 'quality'];
const REVIEWER = /^reviewer:[ \t]*(\S+)[ \t]*$/m;

const itemKey = (change) => `${change.intent}/${change.item}`;
const lensKey = (change) => `${itemKey(change)}#${change.lens}`;
const sum = (list, pick) => list.reduce((total, entry) => total + pick(entry), 0);

/** Findings by severity. A finding with no severity the schema holds counts as unrated. */
function severities(findings) {
  const counts = { total: findings.length, blocker: 0, major: 0, minor: 0 };
  for (const finding of findings) {
    if (['blocker', 'major', 'minor'].includes(finding.severity)) counts[finding.severity] += 1;
    else counts.unrated = (counts.unrated || 0) + 1;
  }
  return counts;
}

/**
 * One record of an item as a round: its lens versions read as one. It is a fix round when a
 * version it holds says fix; its findings are those of every version it holds, its mutants the
 * contract version's; its files are the files both lens files list as they stand after it. A
 * round with a version that does not read is a round without a verdict, as before.
 */
function combine(round, listed) {
  const held = LENSES.filter((lens) => round.lenses[lens]).map((lens) => [lens, round.lenses[lens]]);
  for (const [lens, version] of held) if (version.readable) listed[lens] = version.files;
  if (held.some(([, version]) => !version.readable)) return { ...round, readable: false };
  const contract = round.lenses.contract;
  const fix = held.some(([, version]) => version.verdict === 'fix');
  const findings = held.flatMap(([, version]) => version.findings);
  const survivors = contract ? contract.survivors : [];
  return {
    ...round,
    readable: true,
    fix,
    findings,
    mutants: contract ? contract.mutants : [],
    survivors,
    files: [...new Set([...listed.contract, ...listed.quality])],
    kind: fix ? kindOf(findings, survivors) : null,
  };
}

/**
 * Every round of every item, oldest first, and the reviewers every version in the range names,
 * by lens. `wanted` filters by intent.
 */
function roundsByItem(tree, base, head, wanted) {
  const { changes, atBase } = versions(tree, base, head, 'reviews');
  const last = new Map([...atBase].map(([key, text]) => [key, text == null ? null : comparable(text)]));
  const items = new Map();
  const reviewers = new Map();
  for (const change of changes) {
    if (change.deleted || change.text == null || !wanted(change.intent)) continue;
    if (!reviewers.has(itemKey(change))) reviewers.set(itemKey(change), { contract: [], quality: [] });
    const named = reviewers.get(itemKey(change))[change.lens];
    const reviewer = REVIEWER.exec(change.text);
    if (reviewer && !named.includes(reviewer[1])) named.push(reviewer[1]);
    const content = comparable(change.text);
    if (last.get(lensKey(change)) === content) continue;
    last.set(lensKey(change), content);
    if (!items.has(itemKey(change))) items.set(itemKey(change), { intent: change.intent, item: change.item, rounds: [] });
    const { rounds } = items.get(itemKey(change));
    if (rounds.length === 0 || rounds[rounds.length - 1].sha !== change.sha) rounds.push({ sha: change.sha, lenses: {} });
    rounds[rounds.length - 1].lenses[change.lens] = readRound(change.text);
  }
  for (const [key, entry] of items) {
    const listed = { contract: [], quality: [] };
    entry.rounds = entry.rounds.map((round) => combine(round, listed));
    entry.reviewers = reviewers.get(key);
  }
  return items;
}

/** One lens of an item: its versions, fix versions, findings by severity, and its first version's. */
function lensSummary(rounds, lens) {
  const own = rounds.map((round) => round.lenses[lens]).filter(Boolean);
  if (own.length === 0) return null;
  const read = own.filter((version) => version.readable);
  return {
    rounds: own.length,
    fix: read.filter((version) => version.verdict === 'fix').length,
    findings: severities(read.flatMap((version) => version.findings)),
    firstFindings: severities(own[0].findings || []),
  };
}

const split = (mutants) => {
  const named = mutants.filter(numbered).length;
  return { mutants: mutants.length, numbered: named, freeText: mutants.length - named };
};
const add = (a, b) => ({ mutants: a.mutants + b.mutants, numbered: a.numbered + b.numbered, freeText: a.freeText + b.freeText });
const NONE = { mutants: 0, numbered: 0, freeText: 0 };

/**
 * The numbers of one item. `mutants` counts each mutant once (mutants.cjs), and `mutantsRun` the
 * listings counted as run; on the released flow both are the sum of every round's mutants.
 */
function summarize(entry, grants, spec) {
  const { rounds } = entry;
  const read = rounds.filter((round) => round.readable);
  const kinds = rounds.map((round) => (round.readable ? round.kind : null));
  const count = (kind) => kinds.filter((value) => value === kind).length;
  const later = read.filter((round) => round !== rounds[0]);
  const withFiles = read.filter((round) => round.files.length > 0);
  const counted = new Map(countRounds(read.map((round) => round.mutants)).map((tally, index) => [read[index], tally]));
  const fresh = (round) => counted.get(round).fresh;
  return {
    intent: entry.intent,
    item: entry.item,
    rounds: rounds.length,
    unreadable: rounds.length - read.length,
    kinds,
    fix: read.filter((round) => round.fix).length,
    serious: count('serious'),
    survivorOnly: count('survivor'),
    minorOnly: count('minor'),
    laterFindings: severities(later.flatMap((round) => round.findings)),
    criteria: spec == null ? null : criteriaOf(spec),
    mutants: sum(read, (round) => fresh(round).length),
    mutantRounds: read.filter((round) => fresh(round).length > 0).length,
    firstRound: rounds[0].readable ? split(fresh(rounds[0])) : NONE,
    laterRounds: later.map((round) => split(fresh(round))).reduce(add, NONE),
    survivors: split(read.flatMap((round) => counted.get(round).survived)),
    largest: Math.max(0, ...read.map((round) => fresh(round).length)),
    filesFirst: withFiles.length ? withFiles[0].files.length : 0,
    filesLast: withFiles.length ? withFiles[withFiles.length - 1].files.length : 0,
    grants: grants ? grants.size : 0,
    mutantsRun: sum(read, (round) => counted.get(round).ran.length),
    lenses: { contract: lensSummary(rounds, 'contract'), quality: lensSummary(rounds, 'quality') },
    reviewers: entry.reviewers,
  };
}

module.exports = { LENSES, NONE, add, roundsByItem, severities, summarize };
