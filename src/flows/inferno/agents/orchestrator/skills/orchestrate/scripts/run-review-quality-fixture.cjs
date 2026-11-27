'use strict';

/**
 * Test fixtures for the quality lens beside the contract review: the two review files of a-one,
 * their bodies, a host config with rule files, lint commands and a role pin, and an intent
 * worktree in which a-one's work is committed. Shared by run-review-quality.test.cjs and
 * run-review-quality-merge.test.cjs.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { CONFIG, INTENT_TREE, git, repo, run, worktree, write } = require('./review-fixture.cjs');

const REVIEW = ".specs-inferno/intents/alpha/reviews/a-one.yaml";
const QUALITY = ".specs-inferno/intents/alpha/reviews/quality/a-one.yaml";
const CODEX = ".specs-inferno/config.codex.yaml";
const ledger = (tree) => fs.readFileSync(path.join(tree, ".specs-inferno/state.yaml"), "utf8");
const shown = (result) => result.out + result.err;

const CLEAN = "item: a-one\nverdict: clean\nfiles: [src/a.ts]\n";
const contractFix = (severity = "major", file = "src/a.ts", line = 1) => `item: a-one
verdict: fix
files: [src/a.ts]
findings:
  - criterion: AC1 the value reads two
    file: ${file}
    line: ${line}
    evidence: read ${file}, it exports the unchecked value
    fix: export the checked value
    severity: ${severity}
`;
const QCLEAN = "item: a-one\nverdict: clean\nfiles: [src/a.ts]\n";
const qualityFix = (severity = "major", { line = 1, files = "src/a.ts", extra = "" } = {}) => `item: a-one
verdict: fix
files: [${files}]
findings:
  - id: Q1
    check: security
    file: src/a.ts
    line: ${line}
    evidence: read src/a.ts, the gift card amount is never checked
    fix: check the amount before it is used
    severity: ${severity}
${extra}`;

const LINTED = CONFIG.replace("verification:\n", "verification:\n  lint:\n    - npm run lint\n    - cargo clippy\n");
const QUALITY_CONFIG = `${LINTED}roles:
  reviewer-quality:
    model: model-quality
standards:
  - file: code.md
    paths: ["src/**"]
  - file: docs.md
    paths: ["docs/**"]
real_app:
  paths: ["e2e/**"]
`;
const STANDARDS = {
  ".specs-inferno/standards/code.md": "# Code\n\n## Names\n\nA name says what it holds.\n",
  ".specs-inferno/standards/docs.md": "# Docs\n\n## Tone\n\nPlain words.\n",
};

/**
 * An intent worktree in which a-one's work is committed: by default one production line, else the
 * files `change` names. `review` runs the item review in it, both reviewers named.
 */
function host(options = {}) {
  const fixture = repo({ ...options, files: { ...STANDARDS, ...(options.files || {}) } });
  const tree = worktree(fixture, INTENT_TREE);
  const flags = options.args || [];
  const at = (args) => run(fixture, [...args, "--tree", tree, ...flags]);
  for (const [rel, body] of Object.entries(options.change || { "src/a.ts": "export const a = 2;\n" })) write(tree, rel, body);
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "a-one built"]);
  const review = (extra = []) => at(["review", "--item", "a-one", "--reviewer", "rev-1", "--quality-reviewer", "rev-q", ...extra]);
  return { fixture, tree, at, review };
}

/** The lines of one dispatch block: its dispatch line and the indented lines under it. */
function block(out, agent) {
  const lines = out.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^dispatch ${agent}\\b`).test(line));
  assert.ok(start >= 0, `no dispatch of ${agent} in: ${out}`);
  const end = lines.findIndex((line, index) => index > start && !line.startsWith("  "));
  return lines.slice(start, end === -1 ? undefined : end);
}

/** The first round of a-one recorded with both lenses: the dispatch printed, both files written, the record run. */
function firstRound(h, contract, qualityBody) {
  assert.equal(h.review().code, 3);
  write(h.tree, REVIEW, contract);
  write(h.tree, QUALITY, qualityBody);
  return h.review();
}

module.exports = {
  CLEAN, CODEX, LINTED, QCLEAN, QUALITY, QUALITY_CONFIG, REVIEW, STANDARDS, block, contractFix, firstRound, host, ledger, qualityFix, shown,
};
