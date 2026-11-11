const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const SCRIPTS = "../../orchestrator/skills/orchestrate/scripts";
const { validateWorkItem } = require(`${SCRIPTS}/team-scheduler.cjs`);
const { readItemSpec } = require(`${SCRIPTS}/run-lib.cjs`);
const { acceptanceCriteria } = require(`${SCRIPTS}/run-mutant-coverage.cjs`);
const { tempDir } = require(`${SCRIPTS}/test-temp.cjs`);
const { writeFile } = require(`${SCRIPTS}/test-write.cjs`);
const { codexSkillFile } = require(`${SCRIPTS}/test-codex-text.cjs`);

const templatePath = path.resolve(__dirname, "../templates/work-item.md.hbs");
const briefPath = path.resolve(__dirname, "../templates/brief.md.hbs");
const agentPath = path.resolve(__dirname, "../agent.md");
const AGENTS = path.resolve(__dirname, "../..");
const headings = (text) => text.split("\n").filter((line) => /^## /.test(line));

test("planner body tells the planner to list the tests the change reaches", () => {
  const agent = fs.readFileSync(agentPath, "utf8");
  const template = fs.readFileSync(templatePath, "utf8");

  assert.match(agent, /blast-radius grep/);
  assert.match(agent, /git grep -n/);
  const manifest = template.split("## Execution Manifest")[1].split("## Technical Notes")[0];
  assert.doesNotMatch(manifest, /^#/m, "the manifest carries no comment lines; the rule lives in the planner body");
});

test("planner body carries the blast radius rule and the per-surface test count", () => {
  const agent = fs.readFileSync(agentPath, "utf8");

  assert.match(agent, /\*\*Blast radius is measured\.\*\*/);
  assert.match(agent, /one test per surface/);
});

test("work item template exposes the execution contract", () => {
  const template = fs.readFileSync(templatePath, "utf8");

  for (const token of [
    "depends_on:",
    "kind:",
    "context:",
    "required:",
    "patterns:",
    "tests:",
    "ownership:",
    "editable:",
  ]) {
    assert.match(template, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("work item contract accepts overlapping ownership", () => {
  const first = {
    id: "item-1",
    kind: "behavior",
    context: {
      required: [{ path: "src/feature.js", reason: "primary implementation" }],
      patterns: [{ path: "src/existing.js", reason: "local pattern" }],
      tests: [{ path: "test/feature.test.js", reason: "coverage target" }],
    },
    ownership: {
      editable: ["src/feature.js"],
    },
  };
  const second = {
    id: "item-2",
    kind: "behavior",
    context: {
      required: [{ path: "src/feature.js", reason: "shared implementation" }],
      patterns: [{ path: "src/existing.js", reason: "local pattern" }],
      tests: [{ path: "test/feature.test.js", reason: "coverage target" }],
    },
    ownership: {
      editable: ["src/feature.js"],
    },
  };

  assert.equal(validateWorkItem(first).valid, true);
  assert.equal(validateWorkItem(second).valid, true);
});

test("work item contract rejects missing required context", () => {
  const invalid = {
    id: "item-3",
    kind: "behavior",
    context: {
      required: [],
      patterns: [{ path: "src/existing.js", reason: "local pattern" }],
      tests: [{ path: "test/feature.test.js", reason: "coverage target" }],
    },
    ownership: {
      editable: ["src/feature.js"],
    },
  };

  assert.deepEqual(validateWorkItem(invalid), {
    valid: false,
    errors: ["item-3: context.required must contain at least one path"],
  });
});

test("work item template and planner body carry the wiring blocks", () => {
  const template = fs.readFileSync(templatePath, "utf8");
  const agent = fs.readFileSync(agentPath, "utf8");

  for (const token of ["provides:", "consumes:", "seam:"]) {
    assert.match(template, new RegExp(token));
    assert.match(agent, new RegExp(token));
  }
});

function wired(wiring) {
  return {
    id: "item-4",
    kind: "behavior",
    context: {
      required: [{ path: "src/feature.js", reason: "primary implementation" }],
      patterns: [{ path: "src/existing.js", reason: "local pattern" }],
      tests: [{ path: "test/feature.test.js", reason: "coverage target" }],
    },
    ownership: { editable: ["src/feature.js"] },
    ...wiring,
  };
}

test("work item contract accepts well-formed provides and consumes", () => {
  const item = wired({
    provides: [{ kind: "table", name: "dossiers" }],
    consumes: [
      { kind: "command", name: "save_dossier", seam: "e2e/save.spec.ts" },
      { kind: "table", name: "dossiers" },
    ],
  });

  assert.deepEqual(validateWorkItem(item), { valid: true, errors: [] });
});

test("work item contract rejects a consumed command or event with no seam", () => {
  const item = wired({
    consumes: [
      { kind: "command", name: "save_dossier" },
      { kind: "event", name: "scan_done", seam: " " },
    ],
  });

  assert.deepEqual(validateWorkItem(item).errors, [
    "item-4: consumes[0].seam must name the test that crosses the bridge for command save_dossier",
    "item-4: consumes[1].seam must name the test that crosses the bridge for event scan_done",
  ]);
});

test("work item contract rejects a wiring entry with an unknown kind or no name", () => {
  const item = wired({ provides: [{ kind: "query", name: "x" }, { kind: "event" }], consumes: [] });

  assert.deepEqual(validateWorkItem(item).errors, [
    "item-4: provides[0].kind must be command, table or event",
    "item-4: provides[1].name must be a non-empty string",
    "item-4: consumes must list at least one entry when the item declares it",
  ]);
});

// The spec says more before the build starts: four sections a script can read without guessing.
test("work item template carries the four sections in fixed headings and a fixed shape", () => {
  const template = fs.readFileSync(templatePath, "utf8");

  assert.deepEqual(headings(template), [
    "## Description",
    "## Acceptance Criteria",
    "## Edge Cases",
    "## Out of Scope",
    "## Test Plan",
    "## Reuse",
    "## Execution Manifest",
    "## Technical Notes",
    "## Dependencies",
  ]);
  assert.match(template, /^delivers: \[\{\{#each delivers\}\}/m, "the item names the brief's success criteria it delivers");
  for (const line of [
    "| Case | Expected behaviour | Test |",
    "| {{this.case}} | {{this.expected}} | {{this.test}} |",
    "- Adds: {{this}}",
    "- Integration with {{this.item}}: {{this.test}}",
    "- Integration: none",
    "- Breaks: {{this}}",
    "- Breaks: none",
    "| Structure | Decision | Evidence |",
    "| {{this.structure}} | {{this.decision}} | {{this.evidence}} |",
    "None.",
  ]) {
    assert.ok(template.split("\n").includes(line), `template line: ${line}`);
  }
});

test("brief template numbers its success criteria and carries the item map", () => {
  const brief = fs.readFileSync(briefPath, "utf8");

  assert.deepEqual(headings(brief), [
    "## Goal",
    "## Users",
    "## Problem",
    "## Success Criteria",
    "## Item Map",
    "## Constraints",
    "## Notes",
  ]);
  assert.ok(brief.split("\n").includes("- {{this.id}}: {{this.text}}"), "a success criterion line carries its SC-<n> id");
  assert.ok(brief.split("\n").includes("| Criterion | Items |"), "the item map is a table of criterion and items");
});

test("every planner text tells the planner to fill the four sections and number the criteria", () => {
  const texts = [agentPath, codexSkillFile("specsmd-inferno-planner", "references/procedure.md")];

  for (const file of texts) {
    const text = fs.readFileSync(file, "utf8");
    for (const token of ["`delivers:`", "Edge Cases", "Out of Scope", "Test Plan", "Reuse", "`SC-<n>`", "Item Map", "`None.`"]) {
      assert.ok(text.includes(token), `${path.basename(file)} names ${token}`);
    }
    assert.match(text, /a breaking test belongs to the item that breaks it/, path.basename(file));
    assert.match(text, /never what the code does today/, path.basename(file));
  }
});

test("the contract reviewer checks each edge-case row and every builder builds the rows and the test plan", () => {
  const reviewer = fs.readFileSync(path.join(AGENTS, "reviewer/agent.md"), "utf8");
  const check = reviewer.split("\n").find((line) => line.startsWith("1. **Every criterion is proven.**"));

  assert.match(check, /each row of its Edge Cases/);
  const builders = [
    path.join(AGENTS, "builder/agent.md"),
    codexSkillFile("specsmd-inferno-builder", "references/procedure.md"),
  ];
  for (const file of builders) {
    assert.match(fs.readFileSync(file, "utf8"), /each Edge Cases row and each Test Plan line/, path.relative(AGENTS, file));
  }
});

const MANIFEST = `## Execution Manifest

context:
  required:
    - path: src/cards.ts
      reason: primary implementation target
  patterns:
    - path: src/orders.ts
      reason: pattern to follow
  tests:
    - path: test/cards.test.ts
      reason: verification target
ownership:
  editable:
    - src/cards.ts
    - test/cards.test.ts
    - test/balance.test.ts
`;

const CRITERIA = `## Acceptance Criteria

- [ ] A gift card of 25 shows a balance of 25 (\`test/cards.test.ts\` :: shows the balance)
- [ ] A spent card shows 0 (\`test/cards.test.ts\` :: shows a spent card)
`;

// What an item written before the four sections looks like, and one written after.
const OLD_ITEM = `---
id: show-balance
intent: gift-cards
kind: behavior
depends_on: []
---

# Work Item: Show the balance

## Description

The card page shows the balance.

${CRITERIA}
${MANIFEST}
## Technical Notes

(none)
`;

const NEW_ITEM = `---
id: show-balance
intent: gift-cards
kind: behavior
depends_on: [card-store]
delivers: [SC-1, SC-2]
---

# Work Item: Show the balance

## Description

The card page shows the balance.

${CRITERIA}
## Edge Cases

| Case | Expected behaviour | Test |
| --- | --- | --- |
| A card number with spaces | The balance of the card without them | \`test/cards.test.ts\` :: strips spaces |

## Out of Scope

- Topping a card up

## Test Plan

- Adds: \`test/cards.test.ts\` :: the balance and a spent card
- Integration with card-store: \`test/cards.test.ts\` :: reads the balance the real store saved
- Breaks: \`test/balance.test.ts\` :: the balance line reads 25 where it read 25.00

## Reuse

| Structure | Decision | Evidence |
| --- | --- | --- |
| module balance formatter | reuse | \`src/money.ts:12\` formats every amount on the site |

${MANIFEST}
## Technical Notes

(none)
`;

test("every reader of an item reads one with the four sections and one without them alike", () => {
  const root = tempDir("inferno-contract-");
  const dir = (name) => path.join(root, name, ".specs-inferno/intents/gift-cards/work-items");
  for (const [name, body] of [["old", OLD_ITEM], ["new", NEW_ITEM]]) {
    fs.mkdirSync(dir(name), { recursive: true });
    writeFile(path.join(dir(name), "show-balance.md"), body);
  }
  const old = readItemSpec(path.join(root, "old"), "gift-cards", "show-balance");
  const now = readItemSpec(path.join(root, "new"), "gift-cards", "show-balance");

  assert.deepEqual(now.manifest, old.manifest);
  assert.equal(now.description, old.description);
  assert.deepEqual(now.frontmatter.delivers, ["SC-1", "SC-2"]);
  assert.equal(validateWorkItem({ id: "show-balance", kind: "behavior", ...now.manifest }).valid, true);
  assert.deepEqual(acceptanceCriteria(NEW_ITEM), acceptanceCriteria(OLD_ITEM));
  assert.equal(acceptanceCriteria(NEW_ITEM).length, 2, "an out-of-scope or test-plan line is never read as a criterion");
});
