const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { closeIntent, loadState, locateIntents, locateWorkItems } = require("./state-transition.cjs");
const { multisetDifference, NOW } = require("./state-transition-fixture.cjs");
const { listValues } = require("./state-lists.cjs");
const { writeFile } = require("./test-write.cjs");
const { CLOSING, LEDGER, REASON, SPECS, defer, itemField, planned, refusal, snapshot, specPath } = require("./state-defer-fixture.cjs");

// --- defer-item ------------------------------------------------------------
// The owner of a running intent can decide that an item waits for a later plan. The writer
// had no transition for it and close-intent refuses while an item is open, so such an intent
// closed only by a hand edit of the ledger, which the flow forbids.

test("close-intent refuses over a pending item and closes once that item is deferred", () => {
  const box = planned(CLOSING, { "card-store": [], "gift-wrap": [] });
  refusal(() => closeIntent({ file: box.file, intent: "gift-cards", now: NOW }), "ITEMS_OUTSTANDING");

  const deferred = defer(box, "gift-wrap");
  assert.equal(deferred.changed, true);
  const closed = closeIntent({ file: box.file, intent: "gift-cards", now: NOW });
  assert.equal(closed.changed, true);
  assert.deepEqual(closed.deferred, ["gift-wrap"]);
  assert.match(fs.readFileSync(box.file, "utf8"), /- id: gift-cards\n {4}title: "Gift cards"\n {4}status: completed\n/);
});

test("defer-item writes the status, the moment and the reason under the item and nothing else", () => {
  const box = planned();
  const before = fs.readFileSync(box.file, "utf8").split("\n");
  const result = defer(box, "gift-wrap");

  assert.deepEqual([result.changed, result.previous, result.deferred_at, result.reason], [true, "pending", NOW, REASON]);
  const after = fs.readFileSync(box.file, "utf8").split("\n");
  assert.deepEqual(multisetDifference(before, after), ["        status: pending"]);
  assert.deepEqual(multisetDifference(after, before).sort(), [
    `        deferred_at: ${NOW}`,
    `        deferred_reason: "${REASON}"`,
    "        status: deferred",
  ]);
  // The colon and the hash in the reason reach the next reader whole.
  assert.equal(itemField(box.file, "gift-cards", "gift-wrap", "deferred_reason"), REASON);
  assert.match(after.join("\n"), /- id: gift-wrap\n {8}title: "Gift wrap"\n {8}status: deferred\n {8}deferred_at: \S+\n {8}deferred_reason: /);
});

test("defer-item marks the item's spec deferred with the same moment and reason", () => {
  const box = planned();
  const result = defer(box, "gift-wrap");
  const text = fs.readFileSync(specPath(box, "gift-wrap"), "utf8");
  assert.match(text, new RegExp(`^status: deferred\\ndeferred_at: ${NOW}\\ndeferred_reason: "${REASON}"\\ndepends_on: \\[\\]\\n`, "m"));
  assert.deepEqual(result.markdown, [path.join(path.basename(box.dir), "intents/gift-cards/work-items/gift-wrap.md")]);
});

test("defer-item folds a reason typed over several lines into one", () => {
  const box = planned();
  defer(box, "gift-wrap", { reason: "waits for\n  the first update " });
  assert.equal(itemField(box.file, "gift-cards", "gift-wrap", "deferred_reason"), "waits for the first update");
});

test("defer-item marks a spec whose front matter has no status line, and leaves one with no front matter alone", () => {
  const box = planned();
  writeFile(specPath(box, "gift-wrap"), "---\nid: gift-wrap\n---\n\n# Work Item: gift-wrap\n", "utf8");
  defer(box, "gift-wrap");
  assert.match(fs.readFileSync(specPath(box, "gift-wrap"), "utf8"), /^---\nstatus: deferred\ndeferred_at: \S+\ndeferred_reason: "[^"]+"\nid: gift-wrap\n---\n/);
  // A rule further down is no front matter: it does not open the file.
  const bare = "# Work Item: card-receipt\n\n---\n\nNo front matter.\n";
  writeFile(specPath(box, "card-receipt"), bare, "utf8");
  const result = defer(box, "card-receipt");
  assert.equal(fs.readFileSync(specPath(box, "card-receipt"), "utf8"), bare);
  assert.deepEqual(result.markdown, []);
});

test("defer-item defers an item with no spec on the ledger alone", () => {
  const box = planned(LEDGER, { "card-store": [] });
  const result = defer(box, "gift-wrap");
  assert.equal(result.changed, true);
  assert.deepEqual(result.markdown, []);
  assert.equal(itemField(box.file, "gift-cards", "gift-wrap", "status"), "deferred");
});

test("defer-item says an item deferred twice is already deferred and writes nothing", () => {
  const box = planned();
  defer(box, "gift-wrap");
  const before = snapshot(box);
  const again = defer(box, "gift-wrap", { now: "2026-07-15T00:00:00Z" });
  assert.deepEqual([again.changed, again.note], [false, "already deferred"]);
  assert.deepEqual(snapshot(box), before);
});

test("defer-item refuses a completed item and writes nothing", () => {
  const box = planned();
  const before = snapshot(box);
  refusal(() => defer(box, "card-store"), "ITEM_COMPLETE");
  assert.deepEqual(snapshot(box), before);
});

test("defer-item refuses an item it cannot find, naming the items it knows", () => {
  const box = planned();
  assert.throws(() => defer(box, "card-wallet"), (error) => error.code === "ITEM_NOT_FOUND" && /card-checkout/.test(error.message));
});

test("defer-item refuses with no reason, a blank one included", () => {
  const box = planned();
  const before = snapshot(box);
  refusal(() => defer(box, "gift-wrap", { reason: "" }), "NO_REASON");
  refusal(() => defer(box, "gift-wrap", { reason: "  \n " }), "NO_REASON");
  assert.deepEqual(snapshot(box), before);
});

test("defer-item refuses an item a run already has in hand", () => {
  for (const status of ["in_progress", "awaiting-manual"]) {
    const box = planned(LEDGER.replace("Gift wrap\"\n        status: pending", `Gift wrap"\n        status: ${status}`));
    refusal(() => defer(box, "gift-wrap"), "NOT_PENDING");
  }
});

test("defer-item takes an item the planner wrote with no status line", () => {
  const box = planned(LEDGER.replace("Gift wrap\"\n        status: pending\n", "Gift wrap\"\n"));
  assert.equal(defer(box, "gift-wrap").previous, null);
  assert.equal(itemField(box.file, "gift-cards", "gift-wrap", "status"), "deferred");
});

test("defer-item takes an item parked on hold", () => {
  const box = planned(LEDGER.replace("Gift wrap\"\n        status: pending", "Gift wrap\"\n        status: on_hold"));
  assert.equal(defer(box, "gift-wrap").previous, "on_hold");
});

test("defer-item refuses an item whose review is recorded", () => {
  const box = planned(LEDGER.replace("Gift wrap\"\n        status: pending", "Gift wrap\"\n        status: pending\n        review: fix"));
  const before = snapshot(box);
  assert.throws(() => defer(box, "gift-wrap"), (error) => error.code === "ITEM_IN_FLIGHT" && /review is recorded/.test(error.message));
  assert.deepEqual(snapshot(box), before);
});

test("defer-item refuses an item whose reviewer already wrote its file", () => {
  const box = planned();
  const review = path.join(box.dir, "intents/gift-cards/reviews/gift-wrap.yaml");
  fs.mkdirSync(path.dirname(review), { recursive: true });
  writeFile(review, "verdict: fix\n", "utf8");
  assert.throws(() => defer(box, "gift-wrap"), (error) => error.code === "ITEM_IN_FLIGHT" && /review file/.test(error.message));
});

// --- dependents ------------------------------------------------------------

test("defer-item refuses while an open item depends on it, naming each and the call with its rewires", () => {
  const box = planned();
  const before = snapshot(box);
  assert.throws(() => defer(box, "card-checkout"), (error) => {
    assert.equal(error.code, "REWIRE_OWED");
    assert.match(error.message, /card-balance, card-mail/);
    assert.match(error.message, /defer-item --item card-checkout --reason "[^"]+" --rewire card-balance=<new-dep> --rewire card-mail=<new-dep> --intent gift-cards/);
    return true;
  });
  // Naming one dependent of two is still a dependent left hanging.
  refusal(() => defer(box, "card-checkout", { rewire: ["card-balance=card-store"] }), "REWIRE_OWED");
  assert.deepEqual(snapshot(box), before);
});

test("--rewire replaces a dependent's edge in the ledger and its spec, and none drops one", () => {
  const box = planned();
  const result = defer(box, "card-checkout", { rewire: ["card-mail=gift-wrap", "card-balance=none"] });
  const out = fs.readFileSync(box.file, "utf8");
  // A block list keeps its member comment; an inline one keeps its other members and its comment.
  assert.match(out, /- id: card-mail\n {8}title: "Card mail"\n {8}status: pending\n {8}depends_on:\n {10}- gift-wrap # mails after checkout\n/);
  assert.match(out, /- id: card-balance\n {8}title: "Card balance"\n {8}status: pending\n {8}depends_on: \[card-store\] # both land first\n/);
  assert.match(fs.readFileSync(specPath(box, "card-mail"), "utf8"), /^depends_on: \[gift-wrap\]$/m);
  assert.match(fs.readFileSync(specPath(box, "card-balance"), "utf8"), /^depends_on: \[card-store\]$/m);
  assert.deepEqual(result.rewired, [
    { item: "card-mail", from: "card-checkout", to: "gift-wrap" },
    { item: "card-balance", from: "card-checkout", to: null },
  ]);
  assert.equal(result.markdown.length, 3);
});

test("a dependent whose spec no longer names the edge keeps its spec as it is", () => {
  const box = planned(LEDGER, { ...SPECS, "card-mail": [] });
  const before = fs.readFileSync(specPath(box, "card-mail"), "utf8");
  const result = defer(box, "card-checkout", { rewire: ["card-mail=gift-wrap", "card-balance=none"] });
  assert.equal(fs.readFileSync(specPath(box, "card-mail"), "utf8"), before);
  assert.ok(!result.markdown.some((file) => file.endsWith("card-mail.md")), result.markdown.join(", "));
  assert.match(fs.readFileSync(box.file, "utf8"), /- gift-wrap # mails after checkout/);
});

test("a deferral over stale deferred fields at the end of an entry leaves one of each", () => {
  const box = planned(LEDGER.replace("Gift wrap\"\n        status: pending\n        depends_on: []\n",
    "Gift wrap\"\n        status: pending\n        depends_on: []\n        deferred_at: 2026-01-01T00:00:00Z\n"));
  defer(box, "gift-wrap");
  const out = fs.readFileSync(box.file, "utf8");
  assert.equal(out.match(/deferred_at:/g).length, 1);
  assert.match(out, new RegExp(`deferred_at: ${NOW}`));
});

test("a rewire onto an edge the dependent already has drops the old one and adds no second", () => {
  const box = planned();
  defer(box, "card-checkout", { rewire: ["card-mail=none", "card-balance=card-store"] });
  assert.match(fs.readFileSync(box.file, "utf8"), /- id: card-balance\n[\s\S]*?depends_on: \[card-store\] # both land first\n/);
  // A block list left empty reads as [] and keeps its member's comment.
  assert.match(fs.readFileSync(box.file, "utf8"), /- id: card-mail\n[\s\S]*?depends_on: \[\]\n {10}# mails after checkout\n/);
  assert.match(fs.readFileSync(specPath(box, "card-balance"), "utf8"), /^depends_on: \[card-store\]$/m);
});

test("a rewire onto an id that needs quotes is written so the ledger still reads", () => {
  const ledger = LEDGER.replace("      - id: gift-wrap\n", '      - id: "gift wrap"\n');
  const box = planned(ledger);
  defer(box, "card-checkout", { rewire: ["card-mail=none", "card-balance=gift wrap"] });
  assert.match(fs.readFileSync(box.file, "utf8"), /depends_on: \["gift wrap", card-store\] # both land first/);
  // The next read of the ledger parses the list.
  const lines = loadState(box.file);
  const balance = locateWorkItems(lines, locateIntents(lines)[0]).find((entry) => entry.id === "card-balance");
  assert.deepEqual(listValues(lines, balance, "depends_on"), ["gift wrap", "card-store"]);
});

const REWIRE_REFUSALS = [
  ["names a dependent that is no item", ["card-wallet=card-store", "card-mail=none", "card-balance=none"], "REWIRE_UNKNOWN"],
  ["names a target that is no item", ["card-mail=card-wallet", "card-balance=none"], "REWIRE_UNKNOWN"],
  ["names an item that does not depend on it", ["gift-wrap=card-store", "card-mail=none", "card-balance=none"], "REWIRE_NOT_DEPENDENT"],
  ["names a completed item as a dependent", ["card-store=none", "card-mail=none", "card-balance=none"], "REWIRE_NOT_DEPENDENT"],
  ["points a dependent at the item being deferred", ["card-mail=card-checkout", "card-balance=none"], "REWIRE_DEFERRED"],
  ["names a dependent twice", ["card-mail=none", "card-mail=card-store", "card-balance=none"], "REWIRE_TWICE"],
  ["has no equals sign", ["card-mail", "card-balance=none"], "REWIRE_FORM"],
  ["has nothing before the equals sign", ["=card-store", "card-mail=none", "card-balance=none"], "REWIRE_FORM"],
  ["has nothing after the equals sign", ["card-mail=", "card-balance=none"], "REWIRE_FORM"],
  ["closes a cycle through another dependent", ["card-mail=none", "card-balance=card-receipt"], "REWIRE_CYCLE"],
  ["points a dependent at itself", ["card-mail=card-mail", "card-balance=none"], "REWIRE_CYCLE"],
  ["points two dependents at each other", ["card-mail=card-balance", "card-balance=card-mail"], "REWIRE_CYCLE"],
];

for (const [label, rewire, code] of REWIRE_REFUSALS) {
  test(`a rewire that ${label} refuses and writes nothing`, () => {
    const box = planned();
    const before = snapshot(box);
    refusal(() => defer(box, "card-checkout", { rewire }), code);
    assert.deepEqual(snapshot(box), before);
  });
}

test("a rewire onto an item that is itself deferred refuses", () => {
  const box = planned();
  defer(box, "gift-wrap");
  const before = snapshot(box);
  refusal(() => defer(box, "card-checkout", { rewire: ["card-mail=gift-wrap", "card-balance=none"] }), "REWIRE_DEFERRED");
  assert.deepEqual(snapshot(box), before);
});

test("a cycle already elsewhere in the plan is not the rewire's, and the check still ends", () => {
  // card-receipt and gift-wrap wait on each other by hand; card-mail's new edge only reaches them.
  const box = planned(LEDGER
    .replace("depends_on: [card-balance]", "depends_on: [card-balance, gift-wrap]")
    .replace("Gift wrap\"\n        status: pending\n        depends_on: []", "Gift wrap\"\n        status: pending\n        depends_on: [card-receipt]"));
  const result = defer(box, "card-checkout", { rewire: ["card-mail=card-receipt", "card-balance=none"] });
  assert.equal(result.changed, true);
});

test("the cycle refusal names the loop the rewire would close", () => {
  const box = planned();
  assert.throws(
    () => defer(box, "card-checkout", { rewire: ["card-mail=none", "card-balance=card-receipt"] }),
    (error) => /card-balance -> card-receipt -> card-balance/.test(error.message),
  );
});

test("a deferred dependent needs no rewire, and keeps its edge", () => {
  const box = planned();
  defer(box, "card-receipt");
  defer(box, "card-balance", { rewire: [] });
  assert.match(fs.readFileSync(box.file, "utf8"), /- id: card-receipt\n[\s\S]*?depends_on: \[card-balance\]\n/);
});
