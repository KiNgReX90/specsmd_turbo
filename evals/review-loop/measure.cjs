'use strict';

/**
 * The numbers of the review loop: per item and in total, from the item review files and the
 * item specs between base and head, plus the oracle dispatches of the dispatch log.
 */

const fs = require('node:fs');
const path = require('node:path');

const { specsAt, versions } = require('./history.cjs');
const { comparable, criteriaOf, editableOf, numbered, readRound } = require('./rounds.cjs');

const S = path.join(__dirname, '..', '..', 'src', 'flows', 'inferno', 'agents', 'orchestrator', 'skills', 'orchestrate', 'scripts');

const keyOf = (change) => `${change.intent}/${change.item}`;
const ratio = (part, whole) => (whole === 0 ? 0 : Math.round((part / whole) * 10) / 10);
const sum = (list, pick) => list.reduce((total, entry) => total + pick(entry), 0);

/** Every round of every item: a version whose content differs from the version before it. */
function roundsByItem(tree, base, head, wanted) {
  const { changes, atBase } = versions(tree, base, head, 'reviews');
  const last = new Map([...atBase].map(([key, text]) => [key, text == null ? null : comparable(text)]));
  const items = new Map();
  for (const change of changes) {
    if (change.deleted || change.text == null || !wanted(change.intent)) continue;
    const key = keyOf(change);
    const content = comparable(change.text);
    if (last.get(key) === content) continue;
    last.set(key, content);
    if (!items.has(key)) items.set(key, { intent: change.intent, item: change.item, rounds: [] });
    items.get(key).rounds.push({ sha: change.sha, ...readRound(change.text) });
  }
  return items;
}

/** The commits that grow an item's editable list, by item: a new spec or a shrink grants nothing. */
function grantsByItem(tree, base, head, wanted) {
  const { changes, atBase } = versions(tree, base, head, 'work-items');
  const last = new Map([...atBase].map(([key, text]) => [key, text == null ? null : editableOf(text)]));
  const grants = new Map();
  for (const change of changes) {
    if (change.deleted || change.text == null || !wanted(change.intent)) continue;
    const key = keyOf(change);
    const editable = editableOf(change.text);
    if (editable === null) continue;
    const before = last.get(key);
    if (before && [...editable].some((file) => !before.has(file))) {
      if (!grants.has(key)) grants.set(key, new Set());
      grants.get(key).add(change.sha);
    }
    last.set(key, editable);
  }
  return grants;
}

const split = (mutants) => {
  const named = mutants.filter(numbered).length;
  return { mutants: mutants.length, numbered: named, freeText: mutants.length - named };
};
const add = (a, b) => ({ mutants: a.mutants + b.mutants, numbered: a.numbered + b.numbered, freeText: a.freeText + b.freeText });
const NONE = { mutants: 0, numbered: 0, freeText: 0 };

/** The later findings by severity. A finding with no severity the schema holds counts as unrated. */
function severities(findings) {
  const counts = { total: findings.length, blocker: 0, major: 0, minor: 0 };
  for (const finding of findings) {
    if (['blocker', 'major', 'minor'].includes(finding.severity)) counts[finding.severity] += 1;
    else counts.unrated = (counts.unrated || 0) + 1;
  }
  return counts;
}

function summarize(entry, grants, spec) {
  const { rounds } = entry;
  const read = rounds.filter((round) => round.readable);
  const kinds = rounds.map((round) => (round.readable ? round.kind : null));
  const count = (kind) => kinds.filter((value) => value === kind).length;
  const later = read.filter((round) => round !== rounds[0]);
  const first = rounds[0].readable ? rounds[0] : null;
  const withFiles = read.filter((round) => round.files.length > 0);
  return {
    intent: entry.intent,
    item: entry.item,
    rounds: rounds.length,
    unreadable: rounds.length - read.length,
    kinds,
    fix: read.filter((round) => round.verdict === 'fix').length,
    serious: count('serious'),
    survivorOnly: count('survivor'),
    minorOnly: count('minor'),
    laterFindings: severities(later.flatMap((round) => round.findings)),
    criteria: spec == null ? null : criteriaOf(spec),
    mutants: sum(read, (round) => round.mutants.length),
    mutantRounds: read.filter((round) => round.mutants.length > 0).length,
    firstRound: first ? split(first.mutants) : NONE,
    laterRounds: later.map((round) => split(round.mutants)).reduce(add, NONE),
    survivors: split(read.flatMap((round) => round.survivors)),
    largest: Math.max(0, ...read.map((round) => round.mutants.length)),
    filesFirst: withFiles.length ? withFiles[0].files.length : 0,
    filesLast: withFiles.length ? withFiles[withFiles.length - 1].files.length : 0,
    grants: grants ? grants.size : 0,
  };
}

function totalsOf(items, grants) {
  const rounds = sum(items, (item) => item.rounds);
  const criteria = sum(items, (item) => item.criteria || 0);
  const mutants = sum(items, (item) => item.mutants);
  const later = items.map((item) => item.laterFindings);
  const laterFindings = { total: 0, blocker: 0, major: 0, minor: 0 };
  for (const counts of later) {
    for (const [severity, value] of Object.entries(counts)) laterFindings[severity] = (laterFindings[severity] || 0) + value;
  }
  const top = items.reduce((best, item) => (item.largest > (best ? best.largest : 0) ? item : best), null);
  return {
    items: items.length,
    rounds,
    roundsPerItem: ratio(rounds, items.length),
    roundsSorted: items.map((item) => item.rounds).sort((a, b) => b - a),
    unreadable: sum(items, (item) => item.unreadable),
    fixRounds: sum(items, (item) => item.fix),
    serious: sum(items, (item) => item.serious),
    survivorOnly: sum(items, (item) => item.survivorOnly),
    minorOnly: sum(items, (item) => item.minorOnly),
    laterFindings,
    criteria,
    criteriaMissing: items.filter((item) => item.criteria === null).map((item) => item.item),
    mutants,
    mutantRounds: sum(items, (item) => item.mutantRounds),
    mutantsPerCriterion: ratio(mutants, criteria),
    firstRound: items.map((item) => item.firstRound).reduce(add, NONE),
    laterRounds: items.map((item) => item.laterRounds).reduce(add, NONE),
    survivors: items.map((item) => item.survivors).reduce(add, NONE),
    largest: top ? { mutants: top.largest, item: top.item, criteria: top.criteria } : null,
    grantCommits: new Set([...grants.values()].flatMap((shas) => [...shas])).size,
    filesGrowth: items.filter((item) => item.filesLast > item.filesFirst)
      .sort((a, b) => (b.filesLast - b.filesFirst) - (a.filesLast - a.filesFirst))
      .slice(0, 4)
      .map((item) => ({ item: item.item, first: item.filesFirst, last: item.filesLast })),
  };
}

/**
 * One dispatch-log line as an oracle dispatch with its route, or null for any other agent.
 * The log is tab separated (time, intent, item, tier, agent, batch, dispatch id); the route
 * rides after those as `route=<name>`. A JSON line is read by its agent, tier and route keys.
 */
function oracleEntry(line) {
  let agent;
  let tier;
  let route = null;
  if (line.trim().startsWith('{')) {
    try {
      const entry = JSON.parse(line);
      ({ agent, tier, route } = entry);
    } catch (error) {
      return null;
    }
  } else {
    const fields = line.split('\t');
    [, , , tier, agent] = fields;
    const named = fields.slice(7).map((field) => /^route[=:](.+)$/.exec(field.trim())).find(Boolean);
    route = named ? named[1] : null;
  }
  if (!/oracle/i.test(String(agent || '')) && tier !== 'oracle') return null;
  return { route: route ? String(route).trim() : 'unrouted' };
}

/** The oracle dispatches by route over the dispatch logs of the measured intents. */
function oracleDispatches(tree, intents, logFile) {
  const lib = require(path.join(S, 'run-lib.cjs'));
  const logs = logFile ? [path.resolve(logFile)] : intents.map((intent) => path.join(lib.cacheDir(tree), 'dispatch', `${intent}.log`));
  const present = logs.filter((file) => fs.existsSync(file));
  const byRoute = {};
  for (const file of present) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n').filter((text) => text.trim() !== '')) {
      const entry = oracleEntry(line);
      if (entry) byRoute[entry.route] = (byRoute[entry.route] || 0) + 1;
    }
  }
  const sorted = Object.fromEntries(Object.entries(byRoute).sort(([a], [b]) => a.localeCompare(b)));
  return { present: present.length > 0, logs, total: sum(Object.values(byRoute), (value) => value), byRoute: sorted };
}

/** The whole readout of one intent tree between two commits. */
function measure(tree, base, head, options = {}) {
  const wanted = (intent) => !options.intent || intent === options.intent;
  const reviewed = roundsByItem(tree, base, head, wanted);
  const grants = grantsByItem(tree, base, head, wanted);
  const specs = specsAt(tree, head, [...reviewed.values()]);
  const items = [...reviewed.entries()].map(([key, entry]) => summarize(entry, grants.get(key), specs.get(key)));
  const intents = options.intent ? [options.intent] : [...new Set(items.map((item) => item.intent))];
  return {
    tree, base, head, items, totals: totalsOf(items, grants), oracle: oracleDispatches(tree, intents, options.dispatchLog),
  };
}

module.exports = { measure, oracleEntry };
