'use strict';

/**
 * The oracle's route. Every oracle ask carries two grades, `impact` and `complexity`, each
 * `high` or `low` with the one rubric line that justifies it, passed as `high <clause>: <line>`
 * or `low: <line>`. A high grade names the rubric clause it meets, so a reader checks the line
 * against the files the ask bears on. Both grades high take the hard route; every other pair
 * takes the normal route. A normal oracle that returned `blocked` because the artifact does not
 * settle the call is asked once more on the hard route, and never twice.
 *
 * The hard route exists only where the host config names `models.oracle_hard`: a host sets it
 * when its account has that tier, and without it every ask takes the normal route. On Codex the
 * spawned agent's pin wins over any dispatch model and the oracle's pin is already the host's
 * top tier, so there every ask takes the normal route on that pin.
 *
 * `run.cjs dispatch-log --tier oracle` grades, routes and logs an ask. It takes no baseline: an
 * oracle edits nothing, and a record of its own would supersede the builder's. Its log line is
 * the builder's seven tab separated fields (time, intent, item, tier, agent, batch, dispatch id)
 * followed by `key=value` fields: `route`, `impact`, `complexity`, `impact_rubric`,
 * `complexity_rubric`, and `retry` with the blocked dispatch a hard retry answers. The
 * review-loop readout counts oracle dispatches by `route`.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');

const { RunError } = lib;

/** The clauses that make a grade high, by the name a high grade gives. */
const RUBRIC = {
  impact: {
    data: 'a wrong answer would lose or corrupt user data',
    security: 'it would weaken a security or privacy control',
    money: 'it would change money, licensing or a legal statement',
    contract: 'it would change a public contract: a schema, a file format, an API, a CLI',
    reach: 'it binds more than one item or intent',
  },
  complexity: {
    readings: 'three or more readings stay defensible after measuring',
    subsystems: 'the call spans more than one subsystem',
    earlier: 'an earlier decision on the same call was blocked, rejected by a review or repeated',
    asker: 'the asker already runs on the normal oracle model at effort xhigh',
  },
};

/** The normal route's model when the config names none, per host, and the effort of both routes. */
const DEFAULT_MODEL = { claude: 'claude-opus-5-5', codex: 'gpt-6-astra' };
const DEFAULT_EFFORT = 'xhigh';
const AGENT = { claude: 'specsmd-inferno-oracle', codex: 'specsmd_inferno_oracle' };

const GRADE = /^\s*(high|low)(?:\s+([a-z]+))?\s*:\s*(\S[\s\S]*)$/;

/** One grade as `{ grade, clause, line }`, or a refusal naming the form it takes. */
function parseGrade(kind, value) {
  const clauses = Object.keys(RUBRIC[kind]).join(', ');
  const form = `--${kind} takes "high <clause>: <rubric line>" or "low: <rubric line>", the clause one of ${clauses}`;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RunError(`an oracle dispatch needs its ${kind} grade: ${form}`, 'BAD_ARGS', 1);
  }
  const match = GRADE.exec(value);
  if (!match) throw new RunError(`the ${kind} grade "${value}" carries no rubric line: ${form}`, 'BAD_ARGS', 1);
  const [, grade, clause, line] = match;
  if (grade === 'high' && !Object.hasOwn(RUBRIC[kind], clause || '')) {
    throw new RunError(`a high ${kind} names the rubric clause it meets: ${form}`, 'BAD_ARGS', 1);
  }
  if (grade === 'low' && clause) throw new RunError(`a low ${kind} meets no clause, so it names none: ${form}`, 'BAD_ARGS', 1);
  return { grade, clause: clause || null, line: line.replace(/\s+/g, ' ').trim() };
}

const text = (value) => (typeof value === 'string' && value.trim()) || null;
const mapOf = (value) => (value && typeof value === 'object' ? value : {});

/** The agent, model and effort of each route on this host; `hard` is null where there is none. */
function routes(config = {}) {
  const host = config.host === 'codex' ? 'codex' : 'claude';
  const role = mapOf(mapOf(config.roles).oracle);
  if (host === 'codex') {
    const normal = { agent: AGENT.codex, model: text(role.model) || DEFAULT_MODEL.codex, effort: text(role.reasoning_effort) || DEFAULT_EFFORT };
    return { normal, hard: null };
  }
  const models = mapOf(config.models);
  const effort = text(role.effort) || DEFAULT_EFFORT;
  const normal = { agent: AGENT.claude, model: text(models.oracle) || text(role.model) || DEFAULT_MODEL.claude, effort };
  const hard = text(models.oracle_hard);
  return { normal, hard: hard ? { agent: AGENT.claude, model: hard, effort } : null };
}

/** The route two parsed grades take: hard when both are high and the host has a hard route. */
function oracleRoute({ impact, complexity }, config = {}) {
  const { normal, hard } = routes(config);
  if (impact.grade === 'high' && complexity.grade === 'high' && hard) return { route: 'hard', ...hard };
  return { route: 'normal', ...normal };
}

/**
 * The route of the one more ask a blocked oracle earns: the hard route, once, after a normal
 * one. `prior` is the blocked dispatch's `{ route, retried }`, read from the log.
 */
function retryRoute(prior, config = {}) {
  const { hard } = routes(config);
  if (prior.route === 'hard') {
    throw new RunError('that oracle took the hard route already, so it is not asked again: hold the item with its halt note', 'ORACLE_ROUTE');
  }
  if (prior.retried) {
    throw new RunError('that blocked oracle was already asked once more on the hard route: hold the item with its halt note', 'ORACLE_ROUTE');
  }
  if (!hard) {
    throw new RunError('this host has no hard route: models.oracle_hard is not set, so a blocked oracle is not asked again; ' +
      'hold the item with its halt note', 'ORACLE_ROUTE');
  }
  return { route: 'hard', ...hard };
}

/**
 * The complexity grade, as `--complexity` takes it, of an item the review ladder sends to the
 * oracle, or null when the ladder does not send it there. Such a call is high by the rubric:
 * the fixes reviews rejected, or a finding that repeats, are earlier decisions on that call.
 */
function ladderComplexity(id, item) {
  // Required here, not at the top: run-review.cjs loads this file for its next line.
  const { nextActor } = require('./run-review.cjs');
  if (!item || item.review !== 'fix' || nextActor(item).actor !== 'oracle') return null;
  return item.review_weight === 'repeat'
    ? `high earlier: a finding of ${id} repeats an earlier round, so the fix design it was built on is wrong`
    : `high earlier: reviews rejected the earlier fixes of ${id}`;
}

/** The words the review ladder's oracle line adds: the complexity it fixes, the impact the asker grades. */
function ladderGrades(id, item) {
  const fixed = ladderComplexity(id, item);
  return fixed ? `, graded complexity "${fixed}" and impact by the rubric` : ', graded by the rubric';
}

/** An oracle dispatch, by its tier or by the agent it names. */
function isOracleDispatch(options) {
  return options.tier === 'oracle' || /oracle/i.test(String(options.agent || ''));
}

// The builder's log, the one run-intents.cjs dispatchLog appends to.
const logFile = (root, intent) => path.join(lib.cacheDir(root), 'dispatch', `${intent}.log`);

/** The `key=value` fields after the seventh field of one log line. */
function fieldsOf(line) {
  const fields = {};
  for (const field of line.split('\t').slice(7)) {
    const at = field.indexOf('=');
    if (at > 0) fields[field.slice(0, at)] = field.slice(at + 1);
  }
  return fields;
}

/** The blocked dispatch a retry answers, as `{ route, retried }`, from the intent's log. */
function priorAsk(log, id) {
  const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  const line = lines.find((other) => other.split('\t')[6] === id);
  if (!line || !isOracleDispatch({ tier: line.split('\t')[3], agent: line.split('\t')[4] })) {
    throw new RunError(`no oracle dispatch ${id} in ${log}: --blocked names the dispatch_id of the oracle that returned blocked`,
      'ORACLE_ROUTE');
  }
  return { route: fieldsOf(line).route || 'normal', retried: lines.some((other) => fieldsOf(other).retry === id) };
}

/** The ledger item an ask names, refused when it is not there. */
function askedItem(tree, intentId, id) {
  const intent = lib.findIntent(lib.readLedger(tree), intentId);
  const item = intent && intent.items.find((other) => other.id === id);
  if (!item) throw new RunError(`work item not found in the live ledger: ${intentId}/${id}`, 'ITEM_NOT_FOUND');
  return item;
}

const flat = (value) => String(value).replace(/\s+/g, ' ').trim();

/** `run.cjs dispatch-log --tier oracle`: grade, route and log one ask. */
function dispatchOracle(intentId, options) {
  const impact = parseGrade('impact', options.impact);
  const complexity = parseGrade('complexity', options.complexity);
  const root = lib.primaryRoot(options.cwd);
  const tree = options.tree || lib.repoRoot(options.cwd);
  const config = lib.readConfig(tree, options.config);
  const id = options.item ? String(options.item) : '';
  const fixed = id ? ladderComplexity(id, askedItem(tree, intentId, id)) : null;
  if (fixed && complexity.grade !== 'high') {
    throw new RunError(`the review ladder sent ${id} to the oracle, so its complexity is high: pass --complexity "${fixed}"`, 'BAD_ARGS', 1);
  }
  const log = logFile(root, intentId);
  let chosen;
  if (options.blocked) {
    if (complexity.grade !== 'high' || complexity.clause !== 'earlier') {
      throw new RunError('a retry of a blocked oracle is complexity high earlier by the rubric: the decision before it was blocked', 'BAD_ARGS', 1);
    }
    chosen = retryRoute(priorAsk(log, String(options.blocked)), config);
  } else {
    chosen = oracleRoute({ impact, complexity }, config);
  }
  const dispatchId = options.dispatch_id || crypto.randomUUID();
  const rubric = (grade) => flat(grade.clause ? `${grade.clause}: ${grade.line}` : grade.line);
  const line = [
    new Date().toISOString(), intentId, id, 'oracle', chosen.agent, '', dispatchId,
    `route=${chosen.route}`, `impact=${impact.grade}`, `complexity=${complexity.grade}`,
    `impact_rubric=${rubric(impact)}`, `complexity_rubric=${rubric(complexity)}`,
    ...(options.blocked ? [`retry=${flat(options.blocked)}`] : []),
  ].join('\t');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.appendFileSync(log, `${line}\n`, 'utf8');
  return {
    exit: 0,
    payload: {
      log, line, dispatch_id: dispatchId, tree, route: chosen.route, agent: chosen.agent, model: chosen.model, effort: chosen.effort,
      impact: impact.grade, complexity: complexity.grade,
    },
    out: [
      `oracle ${chosen.route} route: dispatch ${chosen.agent} model ${chosen.model} effort ${chosen.effort}`,
      `dispatch ${dispatchId}`,
      `logged ${id || intentId} -> ${log}`,
    ],
  };
}

module.exports = { RUBRIC, dispatchOracle, isOracleDispatch, ladderComplexity, ladderGrades, oracleRoute, parseGrade, retryRoute, routes };
