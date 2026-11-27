'use strict';

/**
 * The review ladder: who acts on an item next, and the agent each actor is on this host.
 *
 * Split from run-review.cjs when the ladder got its end (P3 of the improvement plan): the step
 * that records a review and the rule that reads the record are two questions. run-review.cjs
 * re-exports every name here, so frontier, the oracle route and the review step read one ladder.
 *
 * A miss is a fix review that weighs serious (weightOf in run-review-file.cjs). The ledger counts
 * an item's misses once and never starts over (missCount in state-review.cjs):
 *
 *   miss 1   the warm builder, or a fresh strong one when the cheap tier built it
 *   miss 2   a fresh escalate builder, which finds the root cause before it fixes
 *   miss 3   the oracle; the escalate builder builds its decision
 *   miss 4   the user: the ladder ends, the item is held, every item not depending on it builds
 *
 * A fix review whose findings are all minor is no miss: the warm builder corrects and the item
 * settles. A finding that repeats an earlier round goes to the oracle at once, below miss 4, and
 * the warm builder of its tier builds the decision; it counts as a miss when it weighs serious.
 */

const { missCount } = require('./state-review.cjs');
const { ladderGrades } = require('./run-oracle-route.cjs');

/** The miss that ends the ladder: from here the item waits for the user. */
const LAST_MISS = 4;

/**
 * The key of each actor's `roles` entry on each host: the one the installer renders that
 * role's pins from. The host dispatches the agent the key names, `specsmd-inferno-<key>` on
 * Claude and `specsmd_inferno_<key>` on Codex, the agents the flow's own files define. The
 * reviewer's and the scanner's agents arrive with their roles, and so does `quality`, the
 * quality lens beside the contract review of an item (run-review-quality.cjs).
 */
const ROLES = {
  claude: {
    cheap: 'builder-cheap', strong: 'builder', escalate: 'builder-escalate', oracle: 'oracle', reviewer: 'reviewer', scanner: 'scanner',
    quality: 'reviewer-quality',
  },
  codex: {
    cheap: 'builder_cheap', strong: 'builder_strong', escalate: 'builder_escalate', oracle: 'oracle', reviewer: 'reviewer', scanner: 'scanner',
    quality: 'reviewer_quality',
  },
};

/**
 * The config key that pins an actor's model on Claude ahead of its role entry. The quality lens
 * has none: `review.model` is the contract reviewer's, so its role entry or its own pin decides.
 */
const PINS = {
  reviewer: (config) => config.review && config.review.model, scanner: (config) => config.scan && config.scan.model, quality: () => null,
};

/** The tier that builds an item first. Complexity alone decides it. */
function tierOf(item) {
  return item.complexity === 'low' ? 'cheap' : 'strong';
}

/**
 * The agent and model this host dispatches for an actor. The agent is always the host's own
 * for that role, since the installer pins the role's model on exactly that agent. On Codex the
 * model is the role entry's alone, because the spawned agent's pin wins. On Claude it is
 * `models.<tier>`, `review.model` for the reviewer or `scan.model` for the scanner, before the
 * role entry's; the quality lens's is its role entry's. The user is no agent: both are null.
 */
function hostActor(actor, config = {}) {
  const host = config.host === 'codex' ? 'codex' : 'claude';
  const key = ROLES[host][actor];
  if (!key) return { agent: null, model: null };
  const roles = config.roles && typeof config.roles === 'object' ? config.roles : {};
  const role = roles[key] && typeof roles[key] === 'object' ? roles[key] : {};
  const roleModel = (typeof role.model === 'string' && role.model) || null;
  if (host === 'codex') return { agent: `specsmd_inferno_${key}`, model: roleModel };
  const pinned = PINS[actor] ? PINS[actor](config) : config.models && config.models[actor];
  return { agent: `specsmd-inferno-${key}`, model: pinned || roleModel };
}

/**
 * Whether the last review sent the item back: a fix that weighs serious or repeat, or one of a
 * ledger written before the weight. A clean or settled review, or a minor-only fix, sends nobody up.
 */
const sentBack = (item) => item.review === 'fix' && item.review_weight !== 'minor';

/**
 * Who acts on the item next: `actor` (a builder tier, `oracle` or `user`), its `agent` on this
 * host, `builder`, the tier that builds what comes next (the oracle's decision, the user's
 * answer), `fresh` when that builder never held the item, and `misses`, the count on record.
 */
function nextActor(item, config = {}) {
  const tier = item.review_tier || tierOf(item);
  const misses = missCount(item);
  let [actor, builder] = [tier, tier];
  if (sentBack(item)) {
    if (misses >= LAST_MISS) [actor, builder] = ['user', 'escalate'];
    else if (misses === LAST_MISS - 1) [actor, builder] = ['oracle', 'escalate'];
    else if (item.review_weight === 'repeat') actor = 'oracle';
    else if (misses === 2) [actor, builder] = ['escalate', 'escalate'];
    else if (misses === 1 && tier === 'cheap') [actor, builder] = ['strong', 'strong'];
  }
  return { actor, agent: hostActor(actor, config).agent, builder, fresh: builder !== tier, misses };
}

/** Whether the ladder ended at the user: no builder takes the item until the user answers. */
const isBlocked = (item) => nextActor(item).actor === 'user';

/** The tier that builds the version the next review reads: the warm builder, or the one the oracle or the user answers. */
const builtBy = (item) => nextActor(item).builder;

/** The actor with the model the host names for it, as frontier and review print it. */
function actorLabel(item, config) {
  const { actor } = nextActor(item);
  const { model } = hostActor(actor, config);
  return model ? `${actor} ${model}` : actor;
}

/** The one line frontier and review both print for a rejected item. */
function nextLine(id, item, config) {
  const next = nextActor(item, config);
  const label = next.agent ? `${actorLabel(item, config)} ${next.agent}` : next.actor;
  const loop = 'then commit and run review again';
  if (next.actor === 'user') {
    return `next user: ${id} missed ${next.misses} reviews, so the ladder ends and no builder takes it: put it before the user in ` +
      'two sentences, what still fails and why the fixes missed, with your recommendation, and keep building every item that ' +
      `does not depend on it. The user's answer goes to the escalate builder as one correction, ${loop}`;
  }
  if (next.actor === 'oracle') {
    const why = item.review_weight === 'repeat' && next.misses < LAST_MISS - 1
      ? 'a finding repeats an earlier round, so '
      : `${id} missed ${next.misses} reviews, so `;
    const to = next.fresh ? `a fresh ${next.builder} builder with every finding so far` : `the warm ${next.builder} builder as a correction`;
    return `next ${label}: ${why}ask it about ${id} with every finding so far${ladderGrades(id, item)}; its decision goes to ${to}, ${loop}`;
  }
  if (next.fresh && next.actor === 'escalate') {
    return `next ${label}: a fresh builder takes ${id} over with every finding so far, reproduces what still fails, names its root ` +
      `cause and why both fixes missed, then fixes, ${loop}`;
  }
  if (next.fresh) return `next ${label}: a fresh builder takes ${id} over with every finding so far, ${loop}`;
  if (item.review_weight === 'minor') {
    return `next ${label}: every finding is minor, so send them to the warm builder of ${id} as one correction, run verify-item on it, ` +
      'commit and run review again: a correction inside the files the review lists settles with no second review';
  }
  return `next ${label}: send every finding to the warm builder of ${id} as one correction, ${loop}`;
}

module.exports = { LAST_MISS, ROLES, actorLabel, builtBy, hostActor, isBlocked, nextActor, nextLine, tierOf };
