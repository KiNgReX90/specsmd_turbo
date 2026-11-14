const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { tempDir } = require("./test-temp.cjs");
const { writeFile } = require("./test-write.cjs");

const RUN = path.join(__dirname, "run.cjs");

// A plan in the form the planner's templates render: an Acme Shop that sells gift cards.
const BRIEF = `---
id: gift-cards
title: "Gift cards"
status: pending
created: 2026-11-10
---

# Intent: Gift cards

## Goal

A shopper sees the balance of a gift card.

## Users

Shoppers of the Acme Shop.

## Problem

The card page shows no balance.

## Success Criteria

- SC-1: \`node --test test/store.test.ts\` reports 0 fail
- SC-2: \`node --test test/cards.test.ts\` reports 0 fail

## Item Map

| Criterion | Items |
| --- | --- |
| SC-1 | card-store |
| SC-2 | show-balance |

## Constraints

- Node stdlib only

## Notes

(none)
`;

/** One open item in the new form, rendered the way work-item.md.hbs renders it. */
function item({ id, depends = [], delivers, owns, adds, integration = [] }) {
  const tests = adds.split(" :: ")[0].replace(/`/g, "");
  return `---
id: ${id}
title: "${id}"
intent: gift-cards
kind: behavior
complexity: low
mode: autopilot
status: pending
depends_on: [${depends.join(", ")}]
delivers: [${delivers.join(", ")}]
created: 2026-11-10
---

# Work Item: ${id}

## Description

The card page shows the balance, so a shopper knows what is left.

## Acceptance Criteria

- [ ] A card of 25 shows 25 (${adds})

## Edge Cases

| Case | Expected behaviour | Test |
| --- | --- | --- |
| A card number with spaces | The balance of the card without them | ${adds} |

## Out of Scope

- Topping a card up

## Test Plan

- Adds: ${adds}
${integration.length ? integration.map((line) => `- Integration with ${line}`).join("\n") : "- Integration: none"}
- Breaks: none

## Reuse

| Structure | Decision | Evidence |
| --- | --- | --- |
| module balance formatter | reuse | \`src/money.ts:1\` formats every amount |

## Execution Manifest

context:
  required:
    - path: ${owns}
      reason: primary implementation target
  patterns:
    - path: src/money.ts
      reason: pattern to follow
  tests:
    - path: ${tests}
      reason: verification target
ownership:
  editable:
    - ${owns}
    - ${tests}

## Technical Notes

(none)

## Dependencies

${depends.length ? depends.map((dep) => `- ${dep}`).join("\n") : "(none)"}
`;
}

const ITEMS = {
  "card-store": item({
    id: "card-store",
    delivers: ["SC-1"],
    owns: "src/store.ts",
    adds: "`test/store.test.ts` :: saves a balance",
  }),
  "show-balance": item({
    id: "show-balance",
    depends: ["card-store"],
    delivers: ["SC-2"],
    owns: "src/cards.ts",
    adds: "`test/cards.test.ts` :: shows the balance",
    integration: ["card-store: `test/cards.test.ts` :: reads the balance the real store saved"],
  }),
};

function ledger(items) {
  const rows = Object.entries(items).map(([id, entry]) => `      - id: ${id}
        title: "${id}"
        kind: behavior
        complexity: low
        status: ${entry.status || "pending"}
        depends_on: [${(entry.depends || []).join(", ")}]${entry.extra || ""}`);
  return `project:
  name: demo
intents:
  - id: gift-cards
    title: "Gift cards"
    status: pending
    base_branch: main
    depends_on_intents: []
    work_items:
${rows.join("\n")}
`;
}

const DEPENDS = { "card-store": {}, "show-balance": { depends: ["card-store"] } };

function write(root, rel, body) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFile(path.join(root, rel), body, "utf8");
}

/** A project tree outside git holding the plan; every part can be swapped. */
function plan({ brief = BRIEF, items = ITEMS, state = DEPENDS } = {}) {
  const dir = tempDir("inferno-plan-lint-");
  const root = path.join(dir, "app");
  for (const file of ["src/store.ts", "src/cards.ts", "src/money.ts", "test/store.test.ts", "test/cards.test.ts"]) {
    write(root, file, "export {};\n");
  }
  write(root, ".specs-inferno/state.yaml", ledger(state));
  if (brief !== null) write(root, ".specs-inferno/intents/gift-cards/brief.md", brief);
  for (const [id, body] of Object.entries(items)) write(root, `.specs-inferno/intents/gift-cards/work-items/${id}.md`, body);
  return { dir, root };
}

function run(tree, args) {
  const result = spawnSync(process.execPath, [RUN, ...args, "--tree", tree.root], {
    cwd: tree.root,
    encoding: "utf8",
    env: { ...process.env, XDG_CACHE_HOME: path.join(tree.dir, "cache") },
  });
  return { code: result.status, out: result.stdout || "", err: result.stderr || "" };
}

const lint = (tree) => run(tree, ["plan-lint", "gift-cards"]);
const findings = (out) => out.split("\n").filter((line) => line.startsWith("FINDING "));
const withItem = (id, from, to) => ({ ...ITEMS, [id]: ITEMS[id].replace(from, to) });

/** A plan with exactly one defect: plan-lint exits 2 and prints the one finding that names it. */
function assertOneFinding(tree, pattern) {
  const result = lint(tree);
  assert.equal(result.code, 2, result.out + result.err);
  assert.deepEqual(findings(result.out).length, 1, result.out);
  assert.match(findings(result.out)[0], pattern);
}

test("a clean plan in the new form exits 0 and prints no finding", () => {
  const result = lint(plan());
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(findings(result.out), []);
  assert.match(result.out, /^clean gift-cards: 2 open items, 2 criteria$/m);
});

test("a success criterion no item delivers is a finding", () => {
  const brief = BRIEF.replace("- SC-2:", "- SC-3: the card page loads in 200 ms\n- SC-2:")
    .replace("| SC-2 | show-balance |", "| SC-2 | show-balance |\n| SC-3 | |");
  assertOneFinding(plan({ brief }), /^FINDING brief: SC-3 is delivered by no item$/);
});

test("an item that names no success criterion is a finding", () => {
  const brief = BRIEF.replace("| SC-1 | card-store |", "| SC-1 | show-balance |");
  const items = { ...withItem("card-store", "delivers: [SC-1]", "delivers: []"), "show-balance": ITEMS["show-balance"].replace("delivers: [SC-2]", "delivers: [SC-1, SC-2]") };
  assertOneFinding(plan({ brief, items }), /^FINDING card-store: delivers: names no success criterion$/);
});

test("an item map that disagrees with delivers: is a finding on each side", () => {
  const brief = BRIEF.replace("| SC-2 | show-balance |", "| SC-2 | show-balance, card-store |");
  assertOneFinding(plan({ brief }), /^FINDING brief: the Item Map names card-store for SC-2, but its delivers: does not$/);
  const items = withItem("show-balance", "delivers: [SC-2]", "delivers: [SC-1, SC-2]");
  assertOneFinding(plan({ items }), /^FINDING brief: show-balance delivers SC-1, but the Item Map row of SC-1 does not name it$/);
});

test("an Item Map row that names an id the intent does not have is a finding", () => {
  const brief = BRIEF.replace("| SC-2 | show-balance |", "| SC-2 | show-balance, gift-box |");
  assertOneFinding(plan({ brief }), /^FINDING brief: the Item Map names gift-box for SC-2, which is no item of this intent$/);
});

test("an acceptance criterion that names no test, case id or command is a finding", () => {
  const items = withItem("card-store", "- [ ] A card of 25 shows 25 (`test/store.test.ts` :: saves a balance)", "- [ ] A card of 25 shows 25");
  assertOneFinding(plan({ items }), /^FINDING card-store: acceptance criterion 1 names no test file, case id or command in a code span$/);
});

test("a missing section is a finding, and so is one left empty", () => {
  const missing = withItem("show-balance", "## Out of Scope\n\n- Topping a card up\n\n", "");
  assertOneFinding(plan({ items: missing }), /^FINDING show-balance: no ## Out of Scope section$/);
  const empty = withItem("show-balance", "## Out of Scope\n\n- Topping a card up\n", "## Out of Scope\n");
  assertOneFinding(plan({ items: empty }), /^FINDING show-balance: ## Out of Scope is empty, give its lines or the line None\.$/);
  assert.equal(lint(plan({ items: withItem("show-balance", "- Topping a card up", "None.") })).code, 0);
});

test("a TBD or a TODO in an item is a finding", () => {
  const items = withItem("card-store", "(none)\n\n## Dependencies", "TODO pick the store\n\n## Dependencies");
  assertOneFinding(plan({ items }), /^FINDING card-store: line \d+ holds TBD or TODO$/);
});

test("a breaking test outside the item's ownership.editable is a finding", () => {
  const items = withItem("show-balance", "- Breaks: none", "- Breaks: `test/receipt.test.ts` :: the receipt reads 25 where it read 25.00");
  assertOneFinding(plan({ items }), /^FINDING show-balance: breaking test test\/receipt\.test\.ts is outside its ownership\.editable$/);
  const owned = withItem("show-balance", "- Breaks: none", "- Breaks: `test/cards.test.ts` :: the line reads 25 where it read 25.00");
  assert.equal(lint(plan({ items: owned })).code, 0);
});

test("each fixed line holds its form: a table header, a decision, a test reference, a dependency", () => {
  const cases = [
    ["card-store", "| Case | Expected behaviour | Test |", "| Case | Result |", /^FINDING card-store: ## Edge Cases table header is not \| Case \| Expected behaviour \| Test \|$/],
    ["card-store", "| reuse |", "| maybe |", /^FINDING card-store: Reuse row 1 decides maybe, a decision is reuse or create$/],
    ["card-store", "`src/money.ts:1` formats", "the money module formats", /^FINDING card-store: Reuse row 1 carries no `file:line` evidence$/],
    ["card-store", "- Adds: `test/store.test.ts` :: saves a balance", "- Adds: a store test", /^FINDING card-store: Test Plan line 1 names no test as `<path>` :: <case>$/],
    ["card-store", "- Breaks: none", "- Breaks: none\n- Also: the e2e suite", /^FINDING card-store: Test Plan line 4 has none of the prefixes Adds:, Integration with <item-id>:, Integration: none, Breaks:$/],
    ["show-balance", /- Integration with card-store: [^\n]*/, "- Integration: none", /^FINDING show-balance: Test Plan has no Integration with card-store line for its dependency card-store$/],
  ];
  for (const [id, from, to, pattern] of cases) assertOneFinding(plan({ items: withItem(id, from, to) }), pattern);
});

test("two items with no depends_on path that share an editable file are printed, and the lint stays green", () => {
  const wrap = item({ id: "gift-wrap", delivers: ["SC-2"], owns: "src/cards.ts", adds: "`test/cards.test.ts` :: wraps a card" });
  const brief = BRIEF.replace("| SC-2 | show-balance |", "| SC-2 | show-balance, gift-wrap |");
  const tree = plan({ brief, items: { ...ITEMS, "gift-wrap": wrap }, state: { ...DEPENDS, "gift-wrap": {} } });
  const result = lint(tree);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(findings(result.out), []);
  assert.match(result.out, /^overlap show-balance \+ gift-wrap \(shares src\/cards\.ts, test\/cards\.test\.ts\): no depends_on path between them, not a finding: order them on purpose or leave them to be serialized$/m);
  assert.doesNotMatch(result.out, /overlap card-store/, "an item ordered behind another is no overlap");
});

// The sign of the new form is a numbered success criterion in the brief. A plan without it
// was written before the lint and builds from its old items (section 7, "Rollout to a host").
test("a plan written before the lint is not refused: plan-lint says so in one line and frontier prints its ready set", () => {
  const OLD_ITEM = ITEMS["card-store"].split("## Edge Cases")[0] + ITEMS["card-store"].slice(ITEMS["card-store"].indexOf("## Execution Manifest"));
  const old = OLD_ITEM.replace("delivers: [SC-1]\n", "");
  const brief = BRIEF.replace("- SC-1: ", "- ").replace("- SC-2: ", "- ").split("## Item Map")[0] + "## Constraints\n\n(none)\n";
  for (const tree of [plan({ brief, items: { "card-store": old }, state: { "card-store": {} } }), plan({ brief: null, items: { "card-store": old }, state: { "card-store": {} } })]) {
    const result = lint(tree);
    assert.equal(result.code, 0, result.out + result.err);
    assert.deepEqual(result.out.trim().split("\n"), ["plan of gift-cards was written before the plan lint, so it is not linted"]);
    const frontier = run(tree, ["frontier", "gift-cards"]);
    assert.equal(frontier.code, 0, frontier.out + frontier.err);
    assert.match(frontier.out, /^ready card-store /m);
  }
});

test("a brief that numbers its criteria makes the whole plan new, so an item cannot escape by leaving its sections out", () => {
  const old = ITEMS["card-store"].split("## Edge Cases")[0] + ITEMS["card-store"].slice(ITEMS["card-store"].indexOf("## Execution Manifest"));
  const result = lint(plan({ items: { ...ITEMS, "card-store": old.replace("delivers: [SC-1]\n", "") } }));
  assert.equal(result.code, 2, result.out);
  for (const section of ["Edge Cases", "Out of Scope", "Test Plan", "Reuse"]) {
    assert.match(result.out, new RegExp(`^FINDING card-store: no ## ${section} section$`, "m"));
  }
  assert.match(result.out, /^FINDING card-store: delivers: names no success criterion$/m);
});

test("frontier stops on a plan finding before it prints a ready set, and never lints a completed item", () => {
  const items = withItem("card-store", "- [ ] A card of 25 shows 25 (`test/store.test.ts` :: saves a balance)", "- [ ] A card of 25 shows 25");
  const stopped = run(plan({ items }), ["frontier", "gift-cards"]);
  assert.equal(stopped.code, 2, stopped.out + stopped.err);
  assert.match(stopped.out, /^FINDING card-store: acceptance criterion 1 names no test file, case id or command in a code span$/m);
  assert.doesNotMatch(stopped.out, /^ready /m);

  const clean = run(plan(), ["frontier", "gift-cards"]);
  assert.equal(clean.code, 0, clean.out + clean.err);
  assert.match(clean.out, /^ready card-store /m);

  // A completed item keeps the form of the day it landed; the frontier reads only what it delivers.
  const done = { ...DEPENDS, "card-store": { status: "completed", extra: "\n        integrated_sha: abc1234\n        review: clean\n        completed_at: 2026-11-10T08:00:00Z" } };
  const landed = run(plan({ items: { ...items, "card-store": items["card-store"].replace("## Out of Scope\n\n- Topping a card up\n\n", "") }, state: done }), ["frontier", "gift-cards"]);
  assert.equal(landed.code, 0, landed.out + landed.err);
  assert.match(landed.out, /^ready show-balance /m);
});

test("a deferred item is never linted, and the criteria it delivers stay delivered", () => {
  // show-balance waits for a later plan: its spec lost a section, and it alone delivers SC-2.
  const items = { ...ITEMS, "show-balance": ITEMS["show-balance"].replace("## Out of Scope\n\n- Topping a card up\n\n", "") };
  assert.equal(lint(plan({ items })).code, 2);
  const deferred = { ...DEPENDS, "show-balance": { depends: ["card-store"], status: "deferred", extra: "\n        deferred_reason: later" } };
  const result = lint(plan({ items, state: deferred }));
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^clean gift-cards: 1 open items, 2 criteria$/m);
});

// A criterion no mutant can reach carries the command or lane that proves it at the gate. The
// lint holds the name to the verification block of the config the step runs with.
const MARK = "- [ ] A card of 25 shows 25 (`test/store.test.ts` :: saves a balance)";
const marked = (name) => withItem("card-store", MARK, `- [ ] Compiles on the Windows lane (gate: ${name})`);
const GATE_CONFIG = "verification:\n  finalize:\n    - npm run check\n  windows:\n    command: npm run test:windows\n    scope: [\"src/**\"]\n";

test("a gate mark names a finalize command or a lane of the selected config, at plan-lint and at frontier", () => {
  for (const name of ["npm run check", "verification.windows", "`npm run check`"]) {
    const tree = plan({ items: marked(name) });
    write(tree.root, ".specs-inferno/config.yaml", GATE_CONFIG);
    const result = lint(tree);
    assert.equal(result.code, 0, `${name}: ${result.out}${result.err}`);
  }
  const tree = plan({ items: marked("npm run windows-only") });
  write(tree.root, ".specs-inferno/config.yaml", GATE_CONFIG);
  write(tree.root, ".specs-inferno/config.lane.yaml", "verification:\n  finalize:\n    - npm run windows-only\n");
  const expected = /^FINDING card-store: acceptance criterion 1 is marked \(gate: npm run windows-only\), which the config's verification block does not hold/m;
  assertOneFinding(tree, expected);
  assert.equal(run(tree, ["plan-lint", "gift-cards", "--config", ".specs-inferno/config.lane.yaml"]).code, 0);
  const stopped = run(tree, ["frontier", "gift-cards"]);
  assert.equal(stopped.code, 2, stopped.out + stopped.err);
  assert.match(stopped.out, expected);
  const ready = run(tree, ["frontier", "gift-cards", "--config", ".specs-inferno/config.lane.yaml"]);
  assert.equal(ready.code, 0, ready.out + ready.err);
  assert.match(ready.out, /^ready card-store /m);
});

test("a lane the config does not set, or a command the gate never runs, is no gate name", () => {
  for (const name of ["verification.smoke", "verification.integrate", "npm run quick", "windows"]) {
    const tree = plan({ items: marked(name) });
    write(tree.root, ".specs-inferno/config.yaml", `${GATE_CONFIG}  integrate:\n    - npm run quick\n`);
    assertOneFinding(tree, new RegExp(`^FINDING card-store: acceptance criterion 1 is marked \\(gate: ${name.replace(/\./g, "\\.")}\\), which`));
  }
});

test("a plan without a mark lints as before and never reads the config", () => {
  const tree = plan();
  write(tree.root, ".specs-inferno/config.yaml", "verification: [npm run check]\n");
  const result = lint(tree);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^clean gift-cards: 2 open items, 2 criteria$/m);
});

// A later item may cite a file an earlier item it depends on creates; a path nobody creates is
// refused at plan time, as the frontier refuses it before a dispatch.
const STORE_OWNS = "ownership:\n  editable:\n    - src/store.ts";
const REQUIRED = "  required:\n    - path: src/cards.ts\n      reason: primary implementation target";
const NEEDS_BALANCE = `${REQUIRED}\n    - path: src/balance.ts\n      reason: the balance module card-store creates`;
const creates = { ...ITEMS, "card-store": ITEMS["card-store"].replace(STORE_OWNS, `${STORE_OWNS}\n    - src/balance.ts`) };
const needing = (body) => body.replace(REQUIRED, NEEDS_BALANCE);

test("a later item may cite a file the item it depends on owns and has not made yet", () => {
  const result = lint(plan({ items: { ...creates, "show-balance": needing(ITEMS["show-balance"]) } }));
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(findings(result.out), []);
});

test("a cited file no item it depends on owns is a finding", () => {
  const alone = item({ id: "show-balance", delivers: ["SC-2"], owns: "src/cards.ts", adds: "`test/cards.test.ts` :: shows the balance" });
  const tree = plan({ items: { ...creates, "show-balance": needing(alone) }, state: { "card-store": {}, "show-balance": {} } });
  assertOneFinding(tree, /^FINDING show-balance: context\.required path does not exist: src\/balance\.ts, and no item show-balance depends on owns it$/);
});

test("a cited file the dependency completed without making is a finding", () => {
  const done = { ...DEPENDS, "card-store": { status: "completed", extra: "\n        integrated_sha: abc1234\n        review: clean\n        completed_at: 2026-11-10T08:00:00Z" } };
  const tree = plan({ items: { ...creates, "show-balance": needing(ITEMS["show-balance"]) }, state: done });
  assertOneFinding(tree, /^FINDING show-balance: context\.required path does not exist: src\/balance\.ts, and card-store, which owns it, completed without creating it$/);
});

test("a dependency through a third item counts", () => {
  const wrap = item({
    id: "gift-wrap", depends: ["show-balance"], delivers: ["SC-2"], owns: "src/cards.ts", adds: "`test/cards.test.ts` :: wraps a card",
    integration: ["show-balance: `test/cards.test.ts` :: wraps the balance shown"],
  });
  const brief = BRIEF.replace("| SC-2 | show-balance |", "| SC-2 | show-balance, gift-wrap |");
  const tree = plan({ brief, items: { ...creates, "gift-wrap": needing(wrap) }, state: { ...DEPENDS, "gift-wrap": { depends: ["show-balance"] } } });
  const result = lint(tree);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(findings(result.out), []);
});

// A success criterion whose instrument runs only after the landing ends in `(after ship)`; only the
// brief carries that mark, spelled so the intent review's recorder reads it.
test("a success criterion marked (after ship) lints clean, a misspelled mark and an item criterion marked so are findings", () => {
  assert.equal(lint(plan({ brief: BRIEF.replace("reports 0 fail\n- SC-2", "reports 0 fail (after ship)\n- SC-2") })).code, 0);
  assertOneFinding(plan({ brief: BRIEF.replace("reports 0 fail\n- SC-2", "reports 0 fail (after-ship)\n- SC-2") }),
    /^FINDING brief: SC-1 carries an after-ship mark the scripts do not read; end its line in \(after ship\)$/);
  const items = withItem("card-store", "- [ ] A card of 25 shows 25 (`test/store.test.ts` :: saves a balance)", "- [ ] A card of 25 shows 25 (`test/store.test.ts` :: saves a balance) (after ship)");
  assertOneFinding(plan({ items }), /^FINDING card-store: acceptance criterion 1 is marked \(after ship\), which only a success criterion of the brief carries/);
});
