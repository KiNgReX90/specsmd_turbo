const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { CONFIG, STATE, repo, run } = require("./run-fixture.cjs");
const { currentRecords } = require("./run-dispatch.cjs");
const { nextLine } = require("./run-review.cjs");
const { ladderComplexity, oracleRoute, parseGrade, retryRoute } = require("./run-oracle-route.cjs");

// The readout that counts oracle dispatches by route reads the log line with this parser.
const { oracleEntry } = require(path.join(__dirname, "../../../../../../../../evals/review-loop/measure.cjs"));

// --- every oracle ask carries two grades, each with its rubric line, and they set its route -----

const HIGH_IMPACT = "high contract: renames the balance field of the public gift card schema in schema/card.json";
const LOW_IMPACT = "low: only the private helper src/a.ts reads the value";
const HIGH_COMPLEXITY = "high readings: three roundings of the balance stay defensible after src/a.test.ts ran";
const LOW_COMPLEXITY = "low: one reading survives the measurement in src/a.test.ts";
const HARD = { models: { oracle_hard: "model-hard" } };

const grades = (impact, complexity) => ({ impact: parseGrade("impact", impact), complexity: parseGrade("complexity", complexity) });

test("both grades high take the hard route", () => {
  const route = oracleRoute(grades(HIGH_IMPACT, HIGH_COMPLEXITY), HARD);
  assert.deepEqual(route, { route: "hard", agent: "specsmd-inferno-oracle", model: "model-hard", effort: "xhigh" });
});

test("every other pair of grades takes the normal route", () => {
  for (const [impact, complexity] of [[HIGH_IMPACT, LOW_COMPLEXITY], [LOW_IMPACT, HIGH_COMPLEXITY], [LOW_IMPACT, LOW_COMPLEXITY]]) {
    const route = oracleRoute(grades(impact, complexity), HARD);
    assert.deepEqual(route, { route: "normal", agent: "specsmd-inferno-oracle", model: "claude-opus-5-5", effort: "xhigh" }, `${impact} / ${complexity}`);
  }
});

test("without models.oracle_hard every ask takes the normal route", () => {
  for (const config of [{}, { models: { strong: "model-strong" } }, { models: { oracle_hard: "  " } }]) {
    assert.equal(oracleRoute(grades(HIGH_IMPACT, HIGH_COMPLEXITY), config).route, "normal", JSON.stringify(config));
  }
});

test("the model and effort of each route come from the config, with the defaults", () => {
  const config = { models: { oracle: "model-normal", oracle_hard: "model-hard" }, roles: { oracle: { model: "pinned", effort: "max" } } };
  assert.deepEqual(oracleRoute(grades(LOW_IMPACT, LOW_COMPLEXITY), config), { route: "normal", agent: "specsmd-inferno-oracle", model: "model-normal", effort: "max" });
  assert.deepEqual(oracleRoute(grades(HIGH_IMPACT, HIGH_COMPLEXITY), config), { route: "hard", agent: "specsmd-inferno-oracle", model: "model-hard", effort: "max" });
  // Without models.oracle the role's pin names the normal model, as it does for every role.
  assert.equal(oracleRoute(grades(LOW_IMPACT, LOW_COMPLEXITY), { roles: { oracle: { model: "pinned" } } }).model, "pinned");
});

test("Codex has no tier above its oracle's pin, so every ask there takes the normal route on that pin", () => {
  const codex = { host: "codex", models: { oracle_hard: "model-hard" }, roles: { oracle: { model: "codex-top", reasoning_effort: "high" } } };
  assert.deepEqual(oracleRoute(grades(HIGH_IMPACT, HIGH_COMPLEXITY), codex), { route: "normal", agent: "specsmd_inferno_oracle", model: "codex-top", effort: "high" });
  assert.deepEqual(oracleRoute(grades(HIGH_IMPACT, HIGH_COMPLEXITY), { host: "codex" }), { route: "normal", agent: "specsmd_inferno_oracle", model: "gpt-6-astra", effort: "xhigh" });
});

test("a grade without its rubric line, or with a clause the rubric does not hold, is refused", () => {
  const refused = (kind, value, pattern) => assert.throws(() => parseGrade(kind, value), (error) => error.code === "BAD_ARGS" && pattern.test(error.message), String(value));
  refused("impact", undefined, /needs its impact grade/);
  refused("impact", "", /needs its impact grade/);
  refused("impact", "high", /carries no rubric line/);
  refused("impact", "high contract:", /carries no rubric line/);
  refused("impact", "medium: a value", /carries no rubric line/);
  refused("impact", "high: the schema changes", /names the rubric clause it meets.*data, security, money, contract, reach/);
  refused("complexity", "high hunch: it feels hard", /names the rubric clause it meets.*readings, subsystems, earlier, asker/);
  refused("complexity", "low readings: one reading", /a low complexity meets no clause/);
  assert.deepEqual(parseGrade("impact", HIGH_IMPACT), { grade: "high", clause: "contract", line: "renames the balance field of the public gift card schema in schema/card.json" });
  assert.deepEqual(parseGrade("complexity", "low:\tone reading\n survives"), { grade: "low", clause: null, line: "one reading survives" });
});

test("a blocked normal oracle goes to the hard route once, and never twice", () => {
  assert.deepEqual(retryRoute({ route: "normal", retried: false }, HARD), { route: "hard", agent: "specsmd-inferno-oracle", model: "model-hard", effort: "xhigh" });
  assert.throws(() => retryRoute({ route: "normal", retried: true }, HARD), /already asked once more on the hard route/);
  assert.throws(() => retryRoute({ route: "hard", retried: false }, HARD), /took the hard route already/);
  assert.throws(() => retryRoute({ route: "normal", retried: false }, {}), /no hard route: models\.oracle_hard is not set/);
  assert.throws(() => retryRoute({ route: "normal", retried: false }, { host: "codex", models: { oracle_hard: "x" } }), /no hard route/);
});

// --- run.cjs dispatch-log is where an ask is graded, routed and logged -----------------------

const HARD_CONFIG = CONFIG.replace("  cheap: model-cheap\n", "  cheap: model-cheap\n  oracle_hard: model-hard\n");
const ask = (fixture, extra = []) => run(fixture, ["dispatch-log", "alpha", "--tier", "oracle", "--item", "a-one", ...extra, "--json"]);
const graded = (impact, complexity) => ["--impact", impact, "--complexity", complexity];
const anyLog = (fixture) => fs.existsSync(fixture.cache) &&
  fs.readdirSync(fixture.cache, { recursive: true, encoding: "utf8" }).some((file) => file.endsWith(".log"));
const logLines = (file) => fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
const fieldsOf = (line) => Object.fromEntries(line.split("\t").slice(7).map((field) => field.split(/=(.*)/s).slice(0, 2)));

test("the dispatch log line holds the route and both grades the way the readout reads them", () => {
  const fixture = repo({ config: HARD_CONFIG });
  const hard = JSON.parse(ask(fixture, graded(HIGH_IMPACT, HIGH_COMPLEXITY)).out);
  const normal = JSON.parse(ask(fixture, graded(HIGH_IMPACT, LOW_COMPLEXITY)).out);
  assert.equal(hard.route, "hard");
  assert.equal(hard.model, "model-hard");
  assert.equal(normal.route, "normal");

  const [first, second] = logLines(hard.log);
  assert.equal(first.split("\t").length > 7, true);
  assert.deepEqual(first.split("\t").slice(1, 7), ["alpha", "a-one", "oracle", "specsmd-inferno-oracle", "", hard.dispatch_id]);
  assert.deepEqual(oracleEntry(first), { route: "hard" });
  assert.deepEqual(oracleEntry(second), { route: "normal" });
  assert.deepEqual(fieldsOf(first), {
    route: "hard", impact: "high", complexity: "high",
    impact_rubric: "contract: renames the balance field of the public gift card schema in schema/card.json",
    complexity_rubric: "readings: three roundings of the balance stay defensible after src/a.test.ts ran",
  });
  assert.equal(fieldsOf(second).complexity, "low");
  assert.equal(fieldsOf(second).complexity_rubric, "one reading survives the measurement in src/a.test.ts");
});

test("an oracle dispatch without both grades, or a grade without its rubric line, is refused and logs nothing", () => {
  const fixture = repo({ config: HARD_CONFIG });
  const refused = (args, pattern) => {
    const result = run(fixture, ["dispatch-log", "alpha", "--item", "a-one", ...args]);
    assert.equal(result.code, 1, result.out + result.err);
    assert.match(result.err, pattern);
  };
  refused(["--tier", "oracle"], /BAD_ARGS.*needs its impact grade/);
  refused(["--tier", "oracle", "--impact", HIGH_IMPACT], /BAD_ARGS.*needs its complexity grade/);
  refused(["--tier", "oracle", "--impact", "high", "--complexity", LOW_COMPLEXITY], /BAD_ARGS.*impact grade "high" carries no rubric line/);
  refused(["--tier", "oracle", "--impact", HIGH_IMPACT, "--complexity", "high: it is hard"], /BAD_ARGS.*names the rubric clause/);
  // Once it is an oracle dispatch, by its tier or by its agent, it is graded.
  refused(["--tier", "escalate", "--agent", "specsmd-inferno-oracle"], /BAD_ARGS.*needs its impact grade/);
  refused(["--tier", "strong", "--agent", "specsmd_inferno_oracle"], /BAD_ARGS.*needs its impact grade/);
  assert.equal(anyLog(fixture), false);
});

test("an oracle ask takes no baseline, so the builder's dispatch record stays current", () => {
  const fixture = repo({ config: HARD_CONFIG });
  const builder = JSON.parse(run(fixture, ["dispatch-log", "alpha", "--item", "a-one", "--tier", "cheap", "--agent", "builder", "--json"]).out);
  const oracle = JSON.parse(ask(fixture, graded(LOW_IMPACT, LOW_COMPLEXITY)).out);
  assert.notEqual(oracle.dispatch_id, builder.dispatch_id);
  const env = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = fixture.cache;
  try {
    assert.deepEqual(currentRecords(fixture.root).map((record) => record.dispatchId), [builder.dispatch_id]);
  } finally {
    if (env === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = env;
  }
});

test("dispatch-log retries a blocked normal oracle on the hard route once, and refuses a second retry", () => {
  const fixture = repo({ config: HARD_CONFIG });
  const normal = JSON.parse(ask(fixture, graded(LOW_IMPACT, LOW_COMPLEXITY)).out);
  assert.equal(normal.route, "normal");
  const blocked = ["--blocked", normal.dispatch_id];
  const EARLIER = "high earlier: the normal oracle returned blocked on this call";

  const low = ask(fixture, [...graded(LOW_IMPACT, LOW_COMPLEXITY), ...blocked]);
  assert.equal(low.code, 1);
  assert.match(low.err, /a retry of a blocked oracle is complexity high earlier/);

  const retry = JSON.parse(ask(fixture, [...graded(LOW_IMPACT, EARLIER), ...blocked]).out);
  assert.equal(retry.route, "hard");
  assert.equal(retry.model, "model-hard");
  const line = logLines(retry.log).at(-1);
  assert.deepEqual(oracleEntry(line), { route: "hard" });
  assert.equal(fieldsOf(line).retry, normal.dispatch_id);

  const again = ask(fixture, [...graded(LOW_IMPACT, EARLIER), ...blocked]);
  assert.equal(again.code, 2, again.out + again.err);
  assert.match(again.err, /already asked once more on the hard route/);
  const ofHard = ask(fixture, [...graded(LOW_IMPACT, EARLIER), "--blocked", retry.dispatch_id]);
  assert.match(ofHard.err, /took the hard route already/);
  const unknown = ask(fixture, [...graded(LOW_IMPACT, EARLIER), "--blocked", "no-such-dispatch"]);
  assert.match(unknown.err, /no oracle dispatch no-such-dispatch/);
  assert.equal(logLines(retry.log).length, 2);
});

test("without models.oracle_hard a blocked oracle is not asked again", () => {
  const fixture = repo();
  const normal = JSON.parse(ask(fixture, graded(HIGH_IMPACT, HIGH_COMPLEXITY)).out);
  assert.equal(normal.route, "normal");
  assert.equal(normal.model, "claude-opus-5-5");
  const retry = ask(fixture, [...graded(HIGH_IMPACT, "high earlier: the normal oracle returned blocked"), "--blocked", normal.dispatch_id]);
  assert.equal(retry.code, 2);
  assert.match(retry.err, /no hard route: models\.oracle_hard is not set/);
});

// --- the review ladder sends an item to the oracle with its complexity fixed high ------------

const REPEATED = STATE.replace(
  "        complexity: low\n        status: pending\n",
  "        complexity: low\n        status: pending\n        review: fix\n        review_commit: abc1234\n" +
    "        review_tier: strong\n        review_rejections: 1\n        review_weight: repeat\n",
);

test("a repeated finding sends the item to the oracle as complexity high, and its line says so", () => {
  const item = { complexity: "low", review: "fix", review_tier: "strong", review_rejections: 1, review_weight: "repeat" };
  const fixed = ladderComplexity("a-one", item);
  assert.match(fixed, /^high earlier: /);
  assert.deepEqual(parseGrade("complexity", fixed).clause, "earlier");
  assert.equal(ladderComplexity("a-one", { ...item, review_weight: "serious" }), null);
  assert.equal(ladderComplexity("a-one", { ...item, review: "clean" }), null);
  const line = nextLine("a-one", item, {});
  assert.match(line, /^next oracle specsmd-inferno-oracle: a finding repeats an earlier round, so ask it about a-one /);
  assert.ok(line.includes(`complexity "${fixed}"`), line);
  assert.match(line, /impact by the rubric/);

  const fixture = repo({ state: REPEATED, config: HARD_CONFIG });
  const low = ask(fixture, graded(HIGH_IMPACT, LOW_COMPLEXITY));
  assert.equal(low.code, 1);
  assert.match(low.err, /review ladder sent a-one to the oracle, so its complexity is high: pass --complexity "high earlier: /);
  assert.equal(JSON.parse(ask(fixture, graded(HIGH_IMPACT, fixed)).out).route, "hard");
  assert.equal(JSON.parse(ask(fixture, graded(LOW_IMPACT, fixed)).out).route, "normal");
});
