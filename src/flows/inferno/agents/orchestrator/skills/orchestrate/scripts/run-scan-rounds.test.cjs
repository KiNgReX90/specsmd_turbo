const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { repo, run, write } = require("./review-fixture.cjs");
const { READER_WORDS } = require("./run-scan-slices.cjs");

// The cross-check's end: one pass over the whole plan, then at most two fix rounds. A fix round
// is one reader over the earlier findings and the parts the repair changed, never the whole plan
// again, and what is still open after the second goes to the oracle. The script counts the
// rounds, so no agent text has to.

const INSTALLED = { ".claude/agents/specsmd-inferno-scanner.md": "---\nname: specsmd-inferno-scanner\n---\n" };
const PLAN = ".specs-inferno/intents/beta";
const BIG = Math.floor(READER_WORDS / 2) + 100;

function item(id, words, depends = [], extra = "") {
  const body = Array.from({ length: words }, (_, index) => `w${index}`).join(" ");
  return `---\nid: ${id}\ntitle: "${id}"\nintent: beta\nstatus: pending\ndepends_on: [${depends.join(", ")}]\n---\n\n# Work Item: ${id}\n\n${extra}${body}\n`;
}

/** A beta plan of two chains too large for one reader, so its pass has two cuts. */
function twoCuts() {
  const files = { ...INSTALLED, [`${PLAN}/brief.md`]: "# Intent: Beta\n" };
  files[`${PLAN}/work-items/a-one.md`] = item("a-one", BIG);
  files[`${PLAN}/work-items/a-two.md`] = item("a-two", 40, ["a-one"]);
  files[`${PLAN}/work-items/b-one.md`] = item("b-one", BIG);
  files[`${PLAN}/work-items/b-two.md`] = item("b-two", 40, ["b-one"]);
  return repo({ files });
}

const scan = (fixture, args = []) => run(fixture, ["scan", "--tree", fixture.root, "--plan", "beta", ...args]);
const dispatchLines = (out) => [...out.matchAll(/^dispatch (\S+)(?: model \S+)? scan (\S+) brief (\S+)$/gm)];
const LINE = (claim, kind = "conflict") =>
  `  - file: ${PLAN}/work-items/a-two.md\n    line: 9\n    kind: ${kind}\n    claim: ${claim}\n    proof: "rg -n limit ${PLAN}"\n`;
const answer = (brief, lines = "") =>
  write(path.dirname(brief), path.basename(brief).replace(/\.md$/, ".yaml"), `question: cross-check\nlines:${lines ? `\n${lines}` : " []\n"}`);

/** Dispatch a round, answer its first reader with `lines` and the rest empty, then collect. */
function round(fixture, lines) {
  const sent = scan(fixture);
  assert.equal(sent.code, 3, sent.out + sent.err);
  const briefs = dispatchLines(sent.out).map((line) => line[3]);
  briefs.forEach((brief, index) => answer(brief, index === 0 ? lines : ""));
  return { sent, briefs, texts: briefs.map((brief) => fs.readFileSync(brief, "utf8")), collect: scan(fixture, ["--collect"]) };
}

test("the plan is read whole once, each fix round is one reader over the earlier findings and the repair, and the second ends at the oracle", () => {
  const fixture = twoCuts();
  const pass = round(fixture, LINE("a-two caps the list at 10 and b-two at 20"));
  assert.equal(pass.briefs.length, 2, pass.sent.out);
  assert.match(pass.texts[0], /^# INFERNO cross-check: the pass, cut 1 of 2$/m);
  assert.equal(pass.collect.code, 2, pass.collect.out + pass.collect.err);
  assert.match(pass.collect.out, /^GAP r1-1 conflict /m);
  assert.match(pass.collect.out, /fix round 1 of 2/);
  assert.match(pass.collect.out, /^resume the planner with every GAP line in \S+ as one message, then run run\.cjs scan --plan beta .*again$/m);

  write(fixture.root, `${PLAN}/work-items/a-two.md`, item("a-two", 40, ["a-one"], "The list caps at 20.\n\n"));
  const first = round(fixture, LINE("a-two still caps the list at 10"));
  assert.equal(first.briefs.length, 1, first.sent.out);
  assert.match(first.texts[0], /^# INFERNO cross-check: fix round 1 of 2$/m);
  assert.match(first.texts[0], /^- earlier r1-1 conflict .*a-two caps the list at 10 and b-two at 20/m);
  assert.doesNotMatch(first.texts[0], /^- cut: /m);
  assert.equal(first.collect.code, 2, first.collect.out + first.collect.err);
  assert.match(first.collect.out, /^GAP r2-1 conflict /m);
  assert.match(first.collect.out, /fix round 2 of 2/);

  write(fixture.root, `${PLAN}/work-items/a-two.md`, item("a-two", 40, ["a-one"], "The list caps at 20, always.\n\n"));
  const second = round(fixture, LINE("a-two caps the list at 10 in its edge cases"));
  assert.equal(second.briefs.length, 1, second.sent.out);
  assert.match(second.texts[0], /^# INFERNO cross-check: fix round 2 of 2$/m);
  assert.match(second.texts[0], /^- earlier r2-1 conflict /m);
  assert.doesNotMatch(second.texts[0], /^- earlier r1-1 /m);
  assert.equal(second.collect.code, 2, second.collect.out + second.collect.err);
  assert.match(second.collect.out, /^GAP r3-1 conflict /m);
  assert.match(second.collect.out, /never checked again/);
  assert.match(second.collect.out, /run\.cjs dispatch-log beta --tier oracle --impact "<grade>: <line>" --complexity "high earlier: <GAP id> stayed open through both fix rounds of the cross-check" --tree /);
  assert.doesNotMatch(second.collect.out, /then run run\.cjs scan/);
  const payload = JSON.parse(scan(fixture, ["--collect", "--json"]).out);
  assert.equal(payload.round, 3);
  assert.equal(payload.oracle, true);

  const spent = scan(fixture);
  assert.equal(spent.code, 3, spent.out + spent.err);
  assert.equal(dispatchLines(spent.out).length, 0, spent.out);
  assert.match(spent.out, /pass and both fix rounds/);
  assert.match(spent.out, /--tier oracle/);
});

test("a fix round reads the repair as a diff of each changed file against the text the earlier round read, and the added and dropped items", () => {
  const fixture = twoCuts();
  round(fixture, LINE("a-two caps the list at 10"));
  write(fixture.root, `${PLAN}/work-items/a-two.md`, item("a-two", 40, ["a-one"], "The list caps at 20.\n\n"));
  write(fixture.root, `${PLAN}/work-items/c-one.md`, item("c-one", 10, ["a-two"]));
  fs.rmSync(path.join(fixture.root, `${PLAN}/work-items/b-two.md`));
  const sent = scan(fixture);
  const [line] = dispatchLines(sent.out);
  const text = fs.readFileSync(line[3], "utf8");
  const changed = /^- changed work-items\/a-two\.md: read only the hunks of diff -u (\S+) (\S+)$/m.exec(text);
  assert.ok(changed, text);
  assert.doesNotMatch(fs.readFileSync(changed[1], "utf8"), /caps at 20/);
  assert.match(fs.readFileSync(changed[2], "utf8"), /caps at 20/);
  assert.match(text, /^- added work-items\/c-one\.md: read it whole$/m);
  assert.match(text, /^- dropped work-items\/b-two\.md$/m);
  for (const same of ["a-one", "b-one", "brief"]) assert.doesNotMatch(text, new RegExp(`^- (changed|added) (work-items/)?${same}\\.md`, "m"));
  assert.match(text, /at most 12 tool calls/);
});

test("a fix round with no repair says so, and the reader still checks each earlier finding", () => {
  const fixture = twoCuts();
  round(fixture, LINE("a-two caps the list at 10"));
  const text = fs.readFileSync(dispatchLines(scan(fixture).out)[0][3], "utf8");
  assert.match(text, /^- changed: no plan file since the pass read it$/m);
  assert.match(text, /^- earlier r1-1 /m);
});

test("a clean round ends the cross-check, and the next call is a fresh pass over the whole plan", () => {
  const fixture = twoCuts();
  round(fixture, LINE("a-two caps the list at 10"));
  const clean = round(fixture, "");
  assert.equal(clean.collect.code, 0, clean.collect.out + clean.collect.err);
  assert.match(clean.collect.out, /no finding in the plan of beta after fix round 1 of 2: it goes to build/);
  const fresh = scan(fixture);
  assert.equal(dispatchLines(fresh.out).length, 2, fresh.out);
  assert.match(fs.readFileSync(dispatchLines(fresh.out)[0][3], "utf8"), /the pass, cut 1 of 2/);
});

test("a round counts once: a second dispatch or a second collect of the same round does not spend a fix round", () => {
  const fixture = twoCuts();
  scan(fixture);
  const again = round(fixture, LINE("a-two caps the list at 10"));
  assert.equal(again.collect.code, 2, again.collect.out + again.collect.err);
  assert.equal(scan(fixture, ["--collect"]).code, 2);
  const next = fs.readFileSync(dispatchLines(scan(fixture).out)[0][3], "utf8");
  assert.match(next, /fix round 1 of 2/);
});

const gapsFileOf = (out) => /^resume the planner with every GAP line in (\S+) as one message, then run .*scan --plan beta .*again$/m.exec(out);

test("a collect with more findings than the printout holds writes every one to the gaps file the planner is resumed from", () => {
  const fixture = twoCuts();
  const lines = Array.from({ length: 40 }, (_, index) => LINE(`finding ${index + 1}`, index % 2 === 0 ? "gap" : "misreading")).join("");
  const { collect } = round(fixture, lines);
  assert.equal(collect.code, 2, collect.out + collect.err);
  const printed = collect.out.trimEnd().split("\n");
  assert.ok(printed.length <= 30, collect.out);
  const named = gapsFileOf(collect.out);
  assert.ok(named, collect.out);
  const held = fs.readFileSync(named[1], "utf8").trimEnd().split("\n");
  assert.deepEqual(held.map((line) => /^GAP (\S+) /.exec(line)[1]), Array.from({ length: 40 }, (_, index) => `r1-${index + 1}`));
  for (const line of printed.filter((text) => text.startsWith("GAP "))) assert.ok(held.includes(line), line);
  const payload = JSON.parse(scan(fixture, ["--collect", "--json"]).out);
  assert.equal(payload.gaps.length, 40);
  assert.equal(payload.gapsFile, named[1]);
  const next = fs.readFileSync(dispatchLines(scan(fixture).out)[0][3], "utf8");
  assert.equal([...next.matchAll(/^- earlier r1-\d+ /gm)].length, 40, "the fix round checks every earlier finding, not the printed ones");
});

test("a clean collect removes the gaps file", () => {
  const fixture = twoCuts();
  const { collect } = round(fixture, LINE("a-two caps the list at 10"));
  const named = gapsFileOf(collect.out);
  assert.ok(named && fs.existsSync(named[1]), collect.out);
  assert.equal(round(fixture, "").collect.code, 0);
  assert.equal(fs.existsSync(named[1]), false);
});
