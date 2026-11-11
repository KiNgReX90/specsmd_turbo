const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { deferFinding, main } = require("./state-transition.cjs");
const { sandbox } = require("./state-transition-fixture.cjs");
const { writeFile } = require("./test-write.cjs");
const { parseYaml } = require("./run-yaml.cjs");

// --- defer-finding -----------------------------------------------------------
// A finding the user put after the release leaves the recorded intent review the way an item
// leaves its intent: by one command of the orchestrator, with its reason, into a file of the intent
// folder the next plan reads. The host's rule says which severities may leave.

const LEDGER = `project:\n  name: demo\nintents:\n  - id: gift-cards\n    title: "Gift cards"\n    status: in_progress\n` +
  "    work_items:\n      - id: card-store\n        title: \"Card store\"\n        status: pending\n        depends_on: []\n";

const finding = (line, severity, extra = "") => `  - criterion: card-store:${line}\n    file: src/store.ts\n    line: ${line}\n` +
  `    evidence: the balance of card ${line} reads wrong\n    fix: read it from the ledger\n    severity: ${severity}\n    owner: card-store\n${extra}`;
const SURVIVOR = finding(4, "major", "    mutant: card-store:4\n");
const MUTANTS = "mutants:\n  - criterion: card-store:1\n    file: src/store.ts\n    line: 1\n    find: total\n    replace: sum\n    test: npm test\n    caught: yes\n" +
  "  - criterion: card-store:4\n    file: src/store.ts\n    line: 4\n    find: \"a + b\"\n    replace: \"a - b\"\n    test: npm test\n    caught: no\n";
const RECORDED = "tree: abc\ncommit: def\nreviewer: rev-1\n";
const REVIEW_BODY = `verdict: fix\nfindings:\n${finding(1, "blocker")}${finding(2, "minor")}${finding(3, "major")}${SURVIVOR}${MUTANTS}${RECORDED}`;
const LIST = "- src/store.ts:2 later\n- src/store.ts:3 later\n- src/store.ts:4 later\n";
const RULE = "standards/defer-findings.yaml";

function box({ review = REVIEW_BODY, list = LIST, rule = null } = {}) {
  const made = sandbox(LEDGER);
  const put = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(made.dir, rel)), { recursive: true });
    writeFile(path.join(made.dir, rel), body, "utf8");
  };
  if (review !== null) put("intents/gift-cards/review.yaml", review);
  if (list !== null) put("intents/gift-cards/first-update.md", list);
  if (rule !== null) put(RULE, rule);
  return { ...made, review: path.join(made.dir, "intents/gift-cards/review.yaml") };
}

const defer = (made, entry, extra = {}) => deferFinding({
  file: made.file, intent: "gift-cards", entry: String(entry), to: "first-update.md", reason: " the user put it\n  after the release ", ...extra,
});
const doc = (made) => parseYaml(fs.readFileSync(made.review, "utf8"));

function refused(fn, code, pattern) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code, error.message);
    assert.match(error.message, pattern);
    return true;
  });
}

test("defer-finding moves a minor finding into deferred with its file and reason, and the blocker keeps the review fix", () => {
  const made = box();
  const result = defer(made, 2);

  assert.deepEqual(
    [result.changed, result.entry, result.severity, result.at, result.to, result.reason, result.verdict, result.open],
    [true, 2, "minor", "src/store.ts:2", "first-update.md", "the user put it after the release", "fix", 3],
  );
  const after = doc(made);
  assert.deepEqual(after.findings.map((one) => one.line), ["1", "3", "4"]);
  assert.deepEqual(after.deferred, [{
    criterion: "card-store:2", file: "src/store.ts", line: "2", evidence: "the balance of card 2 reads wrong", fix: "read it from the ledger",
    severity: "minor", owner: "card-store", to: "first-update.md", reason: "the user put it after the release",
  }]);
  assert.equal(after.mutants.length, 2);
  assert.deepEqual([after.verdict, after.tree, after.commit, after.reviewer], ["fix", "abc", "def", "rev-1"]);
  assert.match(fs.readFileSync(made.review, "utf8"), /^deferred:\n {2}- criterion: card-store:2\n[\s\S]*\ntree: abc\ncommit: def\nreviewer: rev-1\n$/m);
});

test("defer-finding keeps the entries deferred before and says clean once no finding stays open", () => {
  const made = box({ review: `verdict: fix\nfindings:\n${finding(2, "minor")}${finding(3, "minor")}${RECORDED}`, list: LIST });
  assert.equal(defer(made, 1, { to: "./first-update.md" }).to, "first-update.md");
  const result = defer(made, 1);
  assert.deepEqual([result.verdict, result.open], ["clean", 0]);
  const after = doc(made);
  assert.deepEqual(after.deferred.map((one) => one.line), ["2", "3"]);
  assert.deepEqual(after.findings, []);
  assert.equal(after.verdict, "clean");
});

test("defer-finding refuses an entry the recorded review does not hold", () => {
  for (const entry of ["5", "0", "x", "0x2", " 2"]) {
    refused(() => defer(box(), entry), "NO_ENTRY", new RegExp(`intents/gift-cards/review\\.yaml has no findings entry ${entry}: its findings are numbered 1 to 4`));
  }
  refused(() => defer(box({ review: `verdict: clean\n${RECORDED}` }), 1), "NO_ENTRY", /numbered 1 to 0/);
});

test("defer-finding refuses a to file that is missing, outside the intent folder, or silent about the finding", () => {
  const made = box();
  const before = fs.readFileSync(made.review, "utf8");
  refused(() => defer(made, 2, { to: "later.md" }), "BAD_TO", /to names later\.md, which is no file in .*intents\/gift-cards; write the findings the user put after the release there first/);
  refused(() => defer(made, 2, { to: "." }), "BAD_TO", /to names \., which is no file in/);
  refused(() => defer(made, 2, { to: "../../state.yaml" }), "BAD_TO", /to names \.\.\/\.\.\/state\.yaml; name a file in the intent folder, relative to it/);
  refused(() => defer(made, 2, { to: path.join(made.dir, "state.yaml") }), "BAD_TO", /name a file in the intent folder, relative to it/);
  refused(() => defer(box({ list: "- src/store.ts:3 later\n" }), 2), "BAD_TO", /to names first-update\.md, which does not name src\/store\.ts:2; write the finding there by its file and line first/);
  assert.equal(fs.readFileSync(made.review, "utf8"), before);
});

test("without a rule file only a minor finding leaves, and a surviving mutant never", () => {
  refused(() => defer(box(), 3), "SEVERITY_STAYS",
    /findings entry 3 is major, and without \.specs-inferno\/standards\/defer-findings\.yaml only minor leaves; the user's rule goes there/);
  refused(() => defer(box(), 1), "SEVERITY_STAYS", /findings entry 1 is blocker/);
  refused(() => defer(box(), 4), "SURVIVOR_STAYS",
    /findings entry 4 is the surviving mutant card-store:4, and a surviving mutant leaves only when \.specs-inferno\/standards\/defer-findings\.yaml says survivors: true/);
});

test("the host's rule file names the severities that may leave and whether a survivor may", () => {
  const major = box({ rule: "severities: [minor, major]\n" });
  assert.equal(defer(major, 3).severity, "major");
  refused(() => defer(major, 1), "SEVERITY_STAYS", /findings entry 1 is blocker, and \.specs-inferno\/standards\/defer-findings\.yaml lets minor, major leave/);
  refused(() => defer(major, 3), "SURVIVOR_STAYS", /the surviving mutant card-store:4, and \.specs-inferno\/standards\/defer-findings\.yaml does not say survivors: true/);
  assert.equal(defer(box({ rule: "survivors: false\nseverities: [minor]\n" }), 2).severity, "minor");
  refused(() => defer(box({ rule: "survivors: false\n" }), 4), "SURVIVOR_STAYS", /does not say survivors: true/);
  refused(() => defer(box({ rule: "survivors: true\n" }), 3), "SEVERITY_STAYS", /lets minor leave/);
});

test("a surviving mutant the rule lets leave takes its mutant along with caught: no", () => {
  const made = box({ rule: "survivors: true\n" });
  const result = defer(made, 4);
  assert.equal(result.severity, "major");
  const after = doc(made);
  assert.deepEqual(after.mutants.map((one) => one.criterion), ["card-store:1"]);
  assert.deepEqual(after.deferred[0], {
    criterion: "card-store:4", file: "src/store.ts", line: "4", evidence: "the balance of card 4 reads wrong", fix: "read it from the ledger",
    severity: "major", owner: "card-store", mutant: "card-store:4", find: "a + b", replace: "a - b", test: "npm test", caught: "no",
    to: "first-update.md", reason: "the user put it after the release",
  });
});

test("a rule file that says anything else is refused by name", () => {
  for (const [rule, pattern] of [
    ["severities: [minor, trivial]\n", /severities lists trivial; it lists blocker, major or minor/],
    ["severities: minor\n", /severities must be a list/],
    ["survivors: yes\n", /survivors reads yes; write survivors: true or false/],
    ["release: soon\n", /unknown key release: it holds severities and survivors only/],
    ["- minor\n", /it is a map of severities and survivors/],
    ["  severities: [minor]\nsurvivors: true\n", /\.specs-inferno\/standards\/defer-findings\.yaml: cannot parse line 2/],
  ]) {
    refused(() => defer(box({ rule }), 2), "BAD_RULE", pattern);
  }
  assert.equal(defer(box({ rule: "" }), 2).severity, "minor");
});

test("defer-finding refuses an intent with no recorded intent review", () => {
  refused(() => defer(box({ review: null }), 1), "NO_REVIEW", /no intent review of gift-cards at .*intents\/gift-cards\/review\.yaml: defer-finding moves a finding of a recorded intent review/);
  for (const review of ["verdict: fix\nfindings: []\n", ""]) {
    refused(() => defer(box({ review }), 1), "NOT_RECORDED", /review\.yaml is not recorded: run run\.cjs review --tree \S+ .*first, then defer from what it found$/);
  }
  // The call it names carries the caller's tree, intent and host config, so run as printed it stays on the caller's host.
  const made = box({ review: "verdict: fix\nfindings: []\n" });
  const root = path.dirname(made.dir);
  const args = ["defer-finding", "--intent", "gift-cards", "--entry", "1", "--to", "first-update.md", "--reason", "after the release",
    "--file", made.file, "--config", ".specs-inferno/config.codex.yaml"];
  refused(() => main(args), "NOT_RECORDED", new RegExp(`intents/gift-cards/review\\.yaml is not recorded: run run\\.cjs review --tree ${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} ` +
    "--intent gift-cards --config \\.specs-inferno/config\\.codex\\.yaml first, then defer from what it found$"));
});

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

test("the defer-finding command prints what moved, what stays open, and that the caller commits", () => {
  const argsFor = (made, entry = "2") => ["defer-finding", "--intent", "gift-cards", "--entry", entry, "--to", "first-update.md",
    "--reason", "after the release", "--file", made.file];
  const result = cli(argsFor(box()));
  assert.equal(result.code, 0);
  const lines = result.out.split("\n");
  assert.deepEqual(lines.slice(0, 2), [
    "deferred findings entry 2 of gift-cards (minor at src/store.ts:2) to first-update.md: after the release",
    "  3 findings stay open, numbered as the file lists them now",
  ]);
  assert.match(lines[2], /^ {2}wrote .*intents\/gift-cards\/review\.yaml: commit it before the next review call$/);
  assert.equal(lines.length, 4);
  const two = box({ review: `verdict: fix\nfindings:\n${finding(2, "minor")}${finding(3, "minor")}${RECORDED}` });
  assert.match(cli(argsFor(two, "1")).out, /\n {2}1 finding stays open, numbered as the file lists them now\n/);
  assert.match(cli(argsFor(two, "1")).out, /\n {2}no finding stays open, so the review now says clean\n/);
  assert.match(cli([...argsFor(box()), "--json"]).out, /^\{"changed":true,/);
  const args = argsFor(box());
  for (const flag of ["intent", "entry", "to", "reason"]) {
    const at = args.indexOf(`--${flag}`);
    refused(() => main([...args.slice(0, at), ...args.slice(at + 2)]), "BAD_ARGS", new RegExp(`^defer-finding requires --${flag}$`));
  }
  const usage = cli(["--help"]).out;
  assert.match(usage, /node state-transition\.cjs defer-finding --intent <id> --entry <n> --to <file> --reason "<why>"/);
  assert.match(usage, /defer-finding moves one finding of the recorded intent review/);
});
