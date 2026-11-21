const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { deferItem, closeIntent, completeItem, check, archiveIntent, main } = require("./state-transition.cjs");
const { sandbox, NOW } = require("./state-transition-fixture.cjs");
const { deferredItems } = require("./state-defer.cjs");
const { writeFile } = require("./test-write.cjs");
const { tempDir } = require("./test-temp.cjs");
const { intentItems } = require("./run-intent-owed.cjs");
const { CLOSING, REASON, defer, itemField, planned, refusal, snapshot } = require("./state-defer-fixture.cjs");

// A deferred item is closed for its intent: close-intent and check pass over it, nothing
// completes it, the archive keeps it with its reason, and an intent that would build nothing
// waits as a whole instead.

// --- an intent that would build nothing -----------------------------------

const UNBUILT = `intents:
  - id: loyalty
    title: "Loyalty"
    status: in_progress
    work_items:
      - id: points
        title: "Points"
        status: pending
        depends_on: []
      - id: tiers
        title: "Tiers"
        status: pending
        depends_on: []
`;

test("defer-item refuses the last item not deferred when none landed, and points at blocking the intent", () => {
  const box = sandbox(UNBUILT);
  deferItem({ file: box.file, intent: "loyalty", item: "points", reason: REASON, now: NOW });
  const before = fs.readFileSync(box.file, "utf8");
  assert.throws(() => deferItem({ file: box.file, intent: "loyalty", item: "tiers", reason: REASON, now: NOW }), (error) => {
    assert.equal(error.code, "NOTHING_BUILT");
    assert.match(error.message, /unclaim-intent --intent loyalty/);
    assert.match(error.message, /block-intent --reason "[^"]+" --intent loyalty/);
    return true;
  });
  assert.equal(fs.readFileSync(box.file, "utf8"), before);
});

test("close-intent still closes an intent with no work items", () => {
  const box = sandbox("intents:\n  - id: empty\n    title: Empty\n    status: in_progress\n");
  assert.equal(closeIntent({ file: box.file, intent: "empty", now: NOW }).changed, true);
});

test("close-intent refuses an intent whose every item is deferred: it built nothing", () => {
  const box = sandbox(UNBUILT.replace(/status: pending/g, "status: deferred"));
  refusal(() => closeIntent({ file: box.file, intent: "loyalty", now: NOW }), "NOTHING_BUILT");
});

// --- the readers -----------------------------------------------------------

test("complete-item refuses a deferred item", () => {
  const box = planned();
  defer(box, "gift-wrap");
  refusal(() => completeItem({ file: box.file, intent: "gift-cards", item: "gift-wrap", proof: "def5678", now: NOW }), "ITEM_DEFERRED");
  assert.equal(itemField(box.file, "gift-cards", "gift-wrap", "status"), "deferred");
});

test("check reads a deferred item as closed: an open intent over landed and deferred items is owed its close", () => {
  const box = planned(CLOSING, { "card-store": [], "gift-wrap": [] });
  defer(box, "gift-wrap");
  const drift = check({ file: box.file, intent: "gift-cards" }).drift;
  assert.deepEqual(drift.map((entry) => entry.kind), ["all-items-completed-intent-open"]);
  assert.match(drift[0].detail, /all 2 work items are completed or deferred \(1 deferred\)/);
  closeIntent({ file: box.file, intent: "gift-cards", now: NOW });
  assert.deepEqual(check({ file: box.file, intent: "gift-cards" }).drift, []);
});

test("a ledger write refused under the deferral leaves every spec as it was", () => {
  const box = planned();
  const specs = snapshot(box).slice(1);
  const outside = () => writeFile(box.file, `${fs.readFileSync(box.file, "utf8")}# another session\n`, "utf8");
  refusal(() => defer(box, "card-checkout", { rewire: ["card-mail=gift-wrap", "card-balance=none"], afterRead: outside }), "STATE_GENERATION");
  assert.deepEqual(snapshot(box).slice(1), specs);
});

test("archive-intent keeps a deferred item in the archived intent with its reason, spec and all", () => {
  const box = planned(CLOSING, { "card-store": [], "gift-wrap": [] });
  defer(box, "gift-wrap");
  closeIntent({ file: box.file, intent: "gift-cards", now: NOW });
  archiveIntent({ file: box.file, intent: "gift-cards", now: NOW });
  const archived = path.join(box.dir, "archive", "state.yaml");
  assert.equal(itemField(archived, "gift-cards", "gift-wrap", "status"), "deferred");
  assert.equal(itemField(archived, "gift-cards", "gift-wrap", "deferred_reason"), REASON);
  const moved = fs.readFileSync(path.join(box.dir, "archive/intents/gift-cards/work-items/gift-wrap.md"), "utf8");
  assert.match(moved, /^status: deferred$/m);
  // The gate and the ship still read the archived intent's deferred items, to leave them out.
  assert.deepEqual([...deferredItems(box.file, "gift-cards")], [["gift-wrap", REASON]]);
});

test("deferredItems reads the live ledger, says when no reason was recorded, and is empty where no ledger is", () => {
  const box = sandbox(CLOSING.replace("status: pending", "status: deferred"));
  assert.deepEqual([...deferredItems(box.file, "gift-cards")], [["gift-wrap", "no reason recorded"]]);
  assert.deepEqual([...deferredItems(box.file, "never-planned")], []);
  assert.deepEqual([...deferredItems(path.join(box.dir, "nowhere", "state.yaml"), "gift-cards")], []);
});

test("a ledger with no intents key holds no deferred item, and the gate's items read from the spec files as before", () => {
  const specs = path.join(tempDir("inferno-state-"), ".specs-inferno");
  const items = path.join(specs, "intents", "gift-cards", "work-items");
  fs.mkdirSync(items, { recursive: true });
  writeFile(path.join(specs, "state.yaml"), "ledger\n");
  for (const id of ["gift-wrap", "card-mail"]) writeFile(path.join(items, `${id}.md`), `---\nid: ${id}\n---\n`);
  assert.deepEqual([...deferredItems(path.join(specs, "state.yaml"), "gift-cards")], []);
  assert.deepEqual(intentItems(path.dirname(specs), "gift-cards"), ["card-mail", "gift-wrap"]);
  // The archive still answers for the intent the live ledger does not hold.
  fs.mkdirSync(path.join(specs, "archive"));
  writeFile(path.join(specs, "archive", "state.yaml"), CLOSING.replace("status: pending", "status: deferred"));
  assert.deepEqual(intentItems(path.dirname(specs), "gift-cards"), ["card-mail"]);
});

// --- the CLI ---------------------------------------------------------------

function cli(args) {
  const out = [];
  const write = process.stdout.write;
  process.stdout.write = (chunk) => out.push(String(chunk));
  try {
    return { code: main(args), out: out.join("") };
  } finally {
    process.stdout.write = write;
  }
}

test("the CLI defers with every --rewire it is given and says what it wrote", () => {
  const box = planned();
  const result = cli([
    "defer-item", "--intent", "gift-cards", "--item", "card-checkout", "--reason", "waits for the first update",
    "--rewire", "card-mail=gift-wrap", "--rewire", "card-balance=none", "--file", box.file, "--now", NOW,
  ]);
  assert.equal(result.code, 0);
  assert.match(result.out, /^deferred card-checkout \(was pending\) at \S+: waits for the first update\n/);
  assert.match(result.out, /rewired card-mail from card-checkout to gift-wrap\n/);
  assert.match(result.out, /dropped card-balance's edge on card-checkout\n/);
  assert.match(result.out, /wrote .*state\.yaml, .*card-checkout\.md, .*card-mail\.md, .*card-balance\.md: commit them\n$/);
  assert.match(cli(["defer-item", "--intent", "gift-cards", "--item", "card-checkout", "--reason", "x", "--file", box.file]).out, /already deferred/);
});

test("the CLI names each flag defer-item requires", () => {
  const box = planned();
  const flags = ["--intent", "--item", "--reason"];
  for (const missing of flags) {
    const args = { "--intent": "gift-cards", "--item": "gift-wrap", "--reason": "later" };
    delete args[missing];
    assert.throws(() => main(["defer-item", ...Object.entries(args).flat(), "--file", box.file]), (error) =>
      error.code === "BAD_ARGS" && error.message.includes(missing) &&
      flags.filter((flag) => flag !== missing).every((flag) => !error.message.includes(flag)));
  }
  assert.equal(itemField(box.file, "gift-cards", "gift-wrap", "status"), "pending");
});

test("close-intent says how many items it closed over as deferred", () => {
  const box = planned(CLOSING, { "card-store": [], "gift-wrap": [] });
  defer(box, "gift-wrap");
  const result = cli(["close-intent", "--intent", "gift-cards", "--file", box.file, "--now", NOW]);
  assert.match(result.out, /; 1 work items completed, 1 deferred\n$/);
});
