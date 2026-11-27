// Shared ledgers and helpers for the defer-item suites: an Acme Shop intent that sells gift cards,
// its item specs beside it, and the reads a refusal needs to prove it wrote nothing.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { deferItem, loadState, locateIntents, locateWorkItems, findKeyLine, unquote } = require("./state-transition.cjs");
const { sandbox, NOW } = require("./state-transition-fixture.cjs");
const { writeFile } = require("./test-write.cjs");

/** An Acme Shop intent that sells gift cards: one item landed, the rest still to build. */
const LEDGER = `project:
  name: demo
intents:
  - id: gift-cards
    title: "Gift cards"
    status: in_progress
    claimed_at: 2026-07-13T06:44:12Z
    claimed_by: inferno-intent/gift-cards-20260713-064412
    # INTENT. (a) the store, the checkout and the balance page are three screens.
    base_branch: main
    depends_on_intents: []
    work_items:
      - id: card-store
        title: "Card store"
        status: completed
        completed_at: 2026-07-14T10:00:00Z
        integrated_sha: abc1234
        review: clean
        depends_on: []
      - id: card-checkout
        title: "Card checkout"
        status: pending
        depends_on: [card-store]
      - id: card-balance
        title: "Card balance"
        status: pending
        depends_on: [card-checkout, card-store] # both land first
      - id: card-mail
        title: "Card mail"
        status: pending
        depends_on:
          - card-checkout # mails after checkout
      - id: card-receipt
        title: "Card receipt"
        status: pending
        depends_on: [card-balance]
      - id: gift-wrap
        title: "Gift wrap"
        status: pending
        depends_on: []
`;

const REASON = "the launch ships highs only: wrapping waits for the first update # after launch";

function spec(id, depends) {
  return `---
id: ${id}
title: "${id}"
intent: gift-cards
status: pending
depends_on: [${depends.join(", ")}]
created: 2026-07-13
---

# Work Item: ${id}

## Dependencies

${depends.length ? depends.map((dep) => `- ${dep}`).join("\n") : "(none)"}
`;
}

const SPECS = {
  "card-store": [],
  "card-checkout": ["card-store"],
  "card-balance": ["card-checkout", "card-store"],
  "card-mail": ["card-checkout"],
  "card-receipt": ["card-balance"],
  "gift-wrap": [],
};

const specPath = (box, id, intent = "gift-cards") => path.join(box.dir, "intents", intent, "work-items", `${id}.md`);

/** The ledger beside its specs, the way the planner leaves them. */
function planned(content = LEDGER, specs = SPECS) {
  const box = sandbox(content);
  for (const [id, depends] of Object.entries(specs)) {
    fs.mkdirSync(path.dirname(specPath(box, id)), { recursive: true });
    writeFile(specPath(box, id), spec(id, depends), "utf8");
  }
  return box;
}

/** Every file the deferral could write, so a refusal can prove it wrote none of them. */
function snapshot(box) {
  const files = [box.file, ...Object.keys(SPECS).map((id) => specPath(box, id))];
  return files.map((file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null));
}

function itemField(file, intentId, itemId, key) {
  const lines = loadState(file);
  const intent = locateIntents(lines).find((entry) => entry.id === intentId);
  const item = locateWorkItems(lines, intent).find((entry) => entry.id === itemId);
  const idx = findKeyLine(lines, item.start, item.end, item.keyIndent, key);
  return idx === -1 ? null : unquote(lines[idx].slice(item.keyIndent + `${key}:`.length));
}

const refusal = (fn, code) => assert.throws(fn, (error) => {
  assert.equal(error.code, code, error.message);
  return true;
});

const defer = (box, item, extra = {}) => deferItem({ file: box.file, intent: "gift-cards", item, reason: REASON, now: NOW, ...extra });

/** One landed item and one still pending that nothing depends on. */
const CLOSING = `intents:
  - id: gift-cards
    title: "Gift cards"
    status: in_progress
    work_items:
      - id: card-store
        title: "Card store"
        status: completed
        completed_at: 2026-07-14T10:00:00Z
        integrated_sha: abc1234
        review: clean
        depends_on: []
      - id: gift-wrap
        title: "Gift wrap"
        status: pending
        depends_on: []
`;

module.exports = { CLOSING, LEDGER, REASON, SPECS, defer, itemField, planned, refusal, snapshot, specPath };
