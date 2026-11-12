const assert = require("node:assert/strict");
const test = require("node:test");
const { fixture, item, run } = require("./run-frontier-fixture.cjs");
const { callLine } = require("./run-writes.cjs");

// An item names the functions its change writes through under `writes:`, and frontier prints
// every caller of one that the item does not cite: the wrapper a planner misses is where the
// side effects the store alone skips live (a ledger push, a sync, an event).

/** An Acme Shop that sells gift cards: one store write, two command wrappers, one checkout. */
const SOURCES = {
  "src/store/cards.rs":
    "// The one write path of a gift card: save_gift_card(card) stores it.\n" +
    "pub fn save_gift_card(card: &Card) -> Result<(), StoreError> {\n    write_row(card)\n}\n",
  "src/commands/issue.rs":
    "pub fn issue_card(amount: u32) {\n    let card = Card::new(amount);\n    store::save_gift_card(&card);\n}\n",
  "src/commands/redeem.rs":
    "pub fn redeem_card(id: u32) {\n    let card = store::load(id).redeemed();\n" +
    "    store::save_gift_card(&card);\n    ledger::push_balance(&card);\n}\n",
  "src/commands/refund.rs":
    "// refund never calls save_gift_card(card) itself\npub fn refund_card(id: u32) {\n" +
    "    ledger::reverse(id); // and not save_gift_card(id) either\n}\n",
  "src/store/cards_test.rs": "#[test]\nfn saves() {\n    save_gift_card(&Card::new(5));\n}\n",
  "docs/cards.md": "Call `save_gift_card(card)` to store a card.\n",
  "src/web/balance.ts":
    "export async function saveBalance(cardId: string, cents: number): Promise<void> {\n" +
    '  await post("/balance", { cardId, cents });\n}\n',
  "src/web/ledger.ts":
    "export class Ledger {\n  async saveBalance(cents: number): Promise<void> {\n    this.cents = cents;\n  }\n}\n",
  "src/web/store.ts": "export interface Store {\n  saveBalance(cardId: string, cents: number): Promise<void>;\n}\n",
  "src/web/checkout.ts":
    'import { saveBalance } from "./balance";\n\nexport async function checkout(cardId: string, total: number) {\n' +
    "  await saveBalance(cardId, total);\n}\n",
};
// Seven wrappers stamp a card, more than any one item can usefully be handed.
for (let i = 1; i <= 7; i += 1) SOURCES[`src/stamps/stamp_${i}.rs`] = `pub fn stamp_${i}() {\n    stamp_card(${i});\n}\n`;

const STORE = {
  editable: ["src/store/cards.rs"],
  required: ["src/store/cards.rs", "src/commands/issue.rs"],
  patterns: ["src/store/cards.rs"],
  tests: ["src/store/cards_test.rs"],
  writes: ["save_gift_card"],
};

function state(ids) {
  const rows = ids.map((id) =>
    `      - id: ${id}\n        title: "${id}"\n        kind: behavior\n        complexity: medium\n` +
    "        status: pending\n        depends_on: []\n").join("");
  return "project:\n  name: acme-shop\nintents:\n  - id: acme\n    title: \"Acme Shop\"\n    status: pending\n" +
    `    base_branch: main\n    depends_on_intents: []\n    work_items:\n${rows}`;
}

/** The Acme Shop with the given items of intent acme, each `{ id, ...spec }`, committed. */
function shop(...specs) {
  return shopWith({}, ...specs);
}

/** The same shop with `extra` source files beside its own. */
function shopWith(extra, ...specs) {
  const items = {};
  for (const spec of specs) items[`acme/${spec.id}`] = item({ intent: "acme", ...spec });
  return fixture({ sources: { ...SOURCES, ...extra }, state: state(specs.map((spec) => spec.id)), items });
}

const lines = (out, prefix) => out.split("\n").filter((line) => line.startsWith(prefix));

test("frontier prints a caller of a written function the item does not cite", () => {
  const result = run(shop({ id: "c-store", ...STORE }), ["frontier", "acme"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(lines(result.out, "candidate "), [
    "candidate c-store src/commands/redeem.rs calls save_gift_card (line 3)",
  ]);
});

test("frontier is quiet once the item cites the caller's file", () => {
  const cited = { ...STORE, required: [...STORE.required, "src/commands/redeem.rs"] };
  const result = run(shop({ id: "c-store", ...cited }), ["frontier", "acme"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(lines(result.out, "candidate "), []);
  assert.deepEqual(lines(result.out, "skipped "), []);
});

test("a caller the item names in its notes or owns counts as cited", () => {
  const named = run(shop({ id: "c-store", ...STORE, notes: "`src/commands/redeem.rs` keeps its ledger push." }), ["frontier", "acme"]);
  assert.deepEqual(lines(named.out, "candidate "), []);
  const owned = run(shop({ id: "c-store", ...STORE, editable: ["src/store/cards.rs", "src/commands/"] }), ["frontier", "acme"]);
  assert.deepEqual(lines(owned.out, "candidate "), []);
});

test("removing a citation prints that caller's file", () => {
  const uncited = { ...STORE, required: ["src/store/cards.rs"] };
  const out = run(shop({ id: "c-store", ...uncited }), ["frontier", "acme"]).out;
  assert.deepEqual(lines(out, "candidate "), [
    "candidate c-store src/commands/issue.rs calls save_gift_card (line 3)",
    "candidate c-store src/commands/redeem.rs calls save_gift_card (line 3)",
  ]);
});

test("a test file, and a file under an e2e or integration folder, is no caller", () => {
  const tests = {
    "src/commands/redeem_test.rs": "#[test]\nfn redeems() {\n    store::save_gift_card(&Card::new(1));\n}\n",
    "web/e2e/redeem.ts": "save_gift_card(card);\n",
    "web/integration/redeem.ts": "save_gift_card(card);\n",
  };
  const out = run(shopWith(tests, { id: "c-store", ...STORE }), ["frontier", "acme"]).out;
  assert.deepEqual(lines(out, "candidate "), [
    "candidate c-store src/commands/redeem.rs calls save_gift_card (line 3)",
  ]);
});

test("a file is named once: the ownership check named it already, or it calls two listed names", () => {
  const extra = {
    "scripts/reissue.mjs": "save_gift_card(card);\n",
    "src/commands/gift.rs": "pub fn gift(card: &Card) {\n    log_gift_card(card);\n    store::save_gift_card(card);\n}\n",
    "src/store/log.rs": "pub fn log_gift_card(card: &Card) {\n    write_log(card)\n}\n",
  };
  const cited = { ...STORE, required: [...STORE.required, "src/commands/redeem.rs"], writes: ["save_gift_card", "log_gift_card"] };
  const out = run(shopWith(extra, { id: "c-store", ...cited }), ["frontier", "acme"]).out;
  assert.deepEqual(lines(out, "candidate "), [
    "candidate c-store scripts/reissue.mjs references src/store/cards.rs via save_gift_card",
    "candidate c-store src/commands/gift.rs calls save_gift_card (line 3)",
  ]);
});

test("a caller under a folder the item's context, reads or design contract names counts as cited", () => {
  const uncited = { ...STORE, required: ["src/store/cards.rs"] };
  const folder = "src/commands/";
  const ways = {
    required: { required: [...uncited.required, folder] },
    patterns: { patterns: [...uncited.patterns, folder] },
    tests: { tests: [...uncited.tests, folder] },
    reads: { reads: [folder] },
    design_contract: { design: [folder] },
  };
  for (const [way, citation] of Object.entries(ways)) {
    const result = run(shop({ id: "c-store", ...uncited, ...citation }), ["frontier", "acme"]);
    assert.equal(result.code, 0, `${way}: ${result.out}${result.err}`);
    assert.deepEqual(lines(result.out, "candidate "), [], way);
  }
});

test("a longer name is no call, in a file that also holds the bare name", () => {
  const extra = { "src/commands/resave.rs": "use store::save_gift_card;\npub fn resave(card: &Card) {\n    resave_gift_card(card);\n}\n" };
  const out = run(shopWith(extra, { id: "c-store", ...STORE }), ["frontier", "acme"]).out;
  assert.deepEqual(lines(out, "candidate "), [
    "candidate c-store src/commands/redeem.rs calls save_gift_card (line 3)",
  ]);
});

test("a definition, a method of the same name and an interface declaration are no callers", () => {
  const out = run(shop({
    id: "c-balance",
    editable: ["src/web/balance.ts"],
    required: ["src/web/balance.ts"],
    patterns: ["src/web/balance.ts"],
    tests: ["src/web/balance.ts"],
    writes: ["saveBalance"],
  }), ["frontier", "acme"]).out;
  assert.deepEqual(lines(out, "candidate "), ["candidate c-balance src/web/checkout.ts calls saveBalance (line 4)"]);
});

test("a caller another open item owns names that item", () => {
  const result = run(shop(
    { id: "c-store", ...STORE },
    { id: "c-redeem", editable: ["src/commands/redeem.rs"], required: ["src/commands/redeem.rs"] },
  ), ["frontier", "acme", "--json"]);
  const payload = JSON.parse(result.out);
  const hit = payload.candidates.find((entry) => entry.path === "src/commands/redeem.rs");
  assert.deepEqual(
    { item: hit.item, calls: hit.calls, line: hit.line, ownedBy: hit.ownedBy },
    { item: "c-store", calls: "save_gift_card", line: 3, ownedBy: "c-redeem" },
  );
  const out = run(shop(
    { id: "c-store", ...STORE },
    { id: "c-redeem", editable: ["src/commands/redeem.rs"], required: ["src/commands/redeem.rs"] },
  ), ["frontier", "acme"]).out;
  assert.match(out, /^candidate c-store src\/commands\/redeem\.rs owned-by c-redeem calls save_gift_card \(line 3\)$/m);
});

test("a function with more callers than one item can take is skipped, and a name found nowhere is counted", () => {
  const out = run(shop({ id: "c-wide", ...STORE, writes: ["stamp_card", "save_gift_cards"] }), ["frontier", "acme"]).out;
  assert.deepEqual(lines(out, "candidate "), []);
  assert.deepEqual(lines(out, "skipped "), ["skipped c-wide stamp_card (7 hits)", "skipped c-wide save_gift_cards (0 hits)"]);
});

test("a plan without writes prints no caller and dispatches as before", () => {
  const { writes, ...plain } = STORE;
  assert.ok(writes);
  const result = run(shop({ id: "c-store", ...plain, required: ["src/store/cards.rs"] }), ["frontier", "acme"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(result.out.trim().split("\n").map((line) => line.split(" ").slice(0, 4).join(" ")), ["ready c-store medium behavior"]);
});

test("a writes entry in a wrong shape is refused the way a wrong reads entry is", () => {
  const result = run(shop({ id: "c-store", ...STORE, writes: ["name: save_gift_card", "save_gift_card()", "src/store/cards.rs"] }), ["frontier", "acme"]);
  assert.equal(result.code, 2, result.out + result.err);
  for (const index of [0, 1, 2]) {
    assert.match(result.out, new RegExp(`^INVALID c-store: writes\\[${index}\\] must be one function name, such as save_item`, "m"));
  }
});

test("an empty writes key is refused", () => {
  const result = run(shop({ id: "c-store", ...STORE, writes: [] }), ["frontier", "acme"]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /^INVALID c-store: writes must list at least one function when the item declares it$/m);
});

// --- what counts as a call -------------------------------------------------
test("a call is the name before a parenthesis, outside a comment and outside a definition", () => {
  const cases = [
    ["store::save_gift_card(&card);", 1],
    ["    let ok = save_gift_card::<Card>(&card)?;", 1],
    ["self.save_gift_card(card)", 1],
    ["return save_gift_card(card);", 1],
    ["if (save_gift_card(card)) {", 1],
    ["pub fn save_gift_card(card: &Card) -> Result<()> {", 0],
    ["fn save_gift_card(&self) -> bool;", 0],
    ["def save_gift_card(card):", 0],
    ["export async function save_gift_card(card) {", 0],
    ["func (s *Store) save_gift_card(card Card) error {", 0],
    ["  public void save_gift_card(Card card) {", 0],
    ["  async save_gift_card(card: Card): Promise<void> {", 0],
    ["  save_gift_card(card: Card): Promise<void>;", 0],
    ["// save_gift_card(card) stores it", 0],
    ["# save_gift_card(card) stores it", 0],
    [" * save_gift_card(card) stores it", 0],
    ["ledger.push(); // not save_gift_card(card)", 0],
    ["const saveGiftCard = save_gift_card_later;", 0],
    ["save_gift_card_v2(card);", 0],
    ["resave_gift_card(card);", 0],
  ];
  for (const [text, expected] of cases) {
    assert.equal(callLine(text, "save_gift_card"), expected, text);
  }
  assert.equal(callLine("fn main() {\n    // first\n    save_gift_card(&card);\n}\n", "save_gift_card"), 3);
});
