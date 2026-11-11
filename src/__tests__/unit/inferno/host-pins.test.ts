/**
 * Rules a host asked the flow to carry, pinned so a trim of the role texts cannot drop them, and
 * the landing of a direct build, pinned against the calls the scripts take.
 *
 * - The builder plans each round before it issues it.
 * - The planner says the orchestrator reruns every probe with `run.cjs probes`.
 * - The planner launcher names the oracle agent the oracle route prints on each host.
 * - A direct build lands on the base before its push, through the merge slot and the lanes the
 *   scripts give a driver that commits onto the base.
 * - The reviewer carries no rule of one host and no ownership check: a host's own rules live in
 *   its standards folder, and ownership is held by the attribution in `verify-item`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// src/ is the package root that vitest runs from.
const ROOT = path.resolve(__dirname, '../../..');
const INFERNO = path.join(ROOT, 'flows/inferno');
const SCRIPTS = path.join(INFERNO, 'agents/orchestrator/skills/orchestrate/scripts');
const read = (rel: string) => readFileSync(path.join(INFERNO, rel), 'utf8');
const USAGE = readFileSync(path.join(SCRIPTS, 'run.cjs'), 'utf8');
const CODEX_CONFIG = '--config .specs-inferno/config.codex.yaml';

/** The text of one `## ` section, up to the next one. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start < 0) return '';
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}

/** The numbered checks of a `## ` section, one string per item. */
function checks(text: string, heading: string): string[] {
  return section(text, heading).split('\n').filter((line) => /^\d+\. /.test(line));
}

const CLAUDE_BUILDERS = [
  'agents/builder/agent.md',
  'agents/builder-cheap/agent.md',
  'agents/builder-escalate/agent.md',
  'commands/inferno-builder.md',
  'commands/inferno-builder-cheap.md',
  'commands/inferno-builder-escalate.md',
];
const PLANNERS = [
  'agents/planner/agent.md',
  'commands/inferno-planner.md',
  'codex/skills/specsmd-inferno-planner/references/procedure.md',
];
const REVIEWERS = [
  'agents/reviewer/agent.md',
  'commands/inferno-reviewer.md',
  'codex/skills/specsmd-inferno-reviewer/SKILL.md',
  'codex/agents/specsmd_inferno_reviewer.toml',
];

describe('the rules a host pins in the flow text', () => {
  it.each(CLAUDE_BUILDERS)('%s plans the round before it issues it, in its Token discipline', (rel) => {
    expect(section(read(rel), 'Token discipline')).toContain('- Plan the round before you issue it:');
  });

  it('the Codex builder plans the round before it issues it, in its batching rule', () => {
    const procedure = read('codex/skills/specsmd-inferno-builder/references/procedure.md');
    const batch = procedure.split('\n').find((line) => line.startsWith('- **Batch:**'));
    expect(batch).toMatch(/plan the round before you issue it/);
  });

  it.each(PLANNERS)('%s says the orchestrator reruns every probe with run.cjs probes', (rel) => {
    expect(read(rel)).toMatch(/A probe is never an acceptance criterion: the orchestrator reruns it with `run\.cjs probes[^`]*` before the dispatch and hands the drift to the builder\./);
  });

  it('the probes the planner names are the command the runner takes and the orchestrator runs before a dispatch', () => {
    expect(USAGE).toContain('node run.cjs probes <item-id> [--tree <dir>]');
    expect(read('agents/orchestrator/agent.md')).toMatch(/^Run `run\.cjs probes \{item-id\} --tree \{path\}` for every item you are about to dispatch/m);
  });

  it('the planner launcher names the oracle agent the route prints on each host', () => {
    const { routes } = require(path.join(SCRIPTS, 'run-oracle-route.cjs'));
    const claude = routes({}).normal.agent;
    const codex = routes({ host: 'codex' }).normal.agent;
    expect([claude, codex]).toEqual(['specsmd-inferno-oracle', 'specsmd_inferno_oracle']);
    const oracle = section(read('claude/commands/inferno-planner.md'), '2. The `oracle:` paragraphs');
    expect(oracle).toContain(`Spawn the agent it prints, \`${claude}\` for a Claude builder and \`${codex}\` for a Codex one`);
    expect(read('codex/skills/specsmd-inferno-planner/SKILL.md')).toContain(`\`${codex}\``);
  });
});

describe('a direct build lands the way the scripts land a commit on the base', () => {
  const RUN = 'node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs';

  it('the runner takes every call the landing names', () => {
    for (const line of [
      'node run.cjs integrate [--since <ref>] [--tree <dir>] [--config <file>]',
      'node run.cjs gate --detach --lanes-only [--since <ref>] [--tree <dir>]',
      'node run.cjs slot --take --holder <name> [--tree <dir>]',
      'node run.cjs slot --release --holder <name> [--tree <dir>]',
      'on the base branch the default is origin/<base>; with neither, every scoped check runs',
    ]) expect(USAGE).toContain(line);
  });

  it('the Claude launcher takes the slot, commits, integrates and starts the lanes before the push, then releases', () => {
    const steps = checks(read('claude/commands/inferno-planner.md'), '5. Land the direct build');
    const at = (pattern: RegExp) => steps.findIndex((step) => pattern.test(step));
    const order = [
      at(new RegExp(`\`${RUN} slot --take --holder direct-<slug>\``)),
      at(/^\d+\. One commit on the default branch in place, not pushed yet\.$/),
      at(new RegExp(`\`${RUN} integrate\` on this primary checkout, before the push\\.`)),
      at(new RegExp(`\`${RUN} gate --detach --lanes-only\``)),
      at(/^\d+\. Push, then release the slot/),
    ];
    expect(order.every((index) => index >= 0), order.join(',')).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const integrate = steps[order[2]];
    expect(integrate).toContain('`origin/<base>`');
    expect(integrate).toContain('`--since <the commit before yours>`');
    expect(steps[order[4]]).toContain(`\`${RUN} slot --release --holder direct-<slug>\``);
  });

  it('the Codex planner skill lands a direct build the same way, on the Codex config', () => {
    const skill = read('codex/skills/specsmd-inferno-planner/SKILL.md');
    const land = skill.split('\n').find((line) => line.startsWith('5. Land it on the default branch in place'));
    expect(land).toBeDefined();
    const calls = [
      `\`run.cjs slot --take --holder direct-<slug> ${CODEX_CONFIG}\``,
      `\`run.cjs integrate ${CODEX_CONFIG}\``,
      `\`run.cjs gate --detach --lanes-only ${CODEX_CONFIG}\``,
      '; push, then ',
      `\`run.cjs slot --release --holder direct-<slug> ${CODEX_CONFIG}\``,
    ];
    const order = calls.map((call) => (land as string).indexOf(call));
    expect(order.every((index) => index >= 0), order.join(',')).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(land).toContain('before the push');
  });
});

describe('the reviewer carries no host rule and no ownership check', () => {
  // The rules one host held and the reviewer text once carried in its last check: the line ceiling,
  // the dashes, the suppression of an unused-code warning and the first-time reader of copy.
  const HOST_RULE = /\b500\b|line (?:cap|ceiling)|\bem\b[^.\n]*\bdash|\ben dash|suppress|unused-code|first-time user/i;
  const OWNERSHIP = /ownership|outside the item|\beditable\b/i;

  it.each(REVIEWERS)('%s names no rule of one host', (rel) => {
    expect(read(rel)).not.toMatch(HOST_RULE);
  });

  it.each(REVIEWERS)('%s holds no ownership check', (rel) => {
    expect(read(rel)).not.toMatch(OWNERSHIP);
  });

  it.each(['agents/reviewer/agent.md', 'commands/inferno-reviewer.md'])('%s checks secrets in a check of its own and nothing else there', (rel) => {
    const list = checks(read(rel), 'What you check');
    const secrets = list.filter((line) => /secret/i.test(line));
    expect(secrets).toEqual(['6. **Secrets.** A secret is a finding.']);
  });

  it('the item check that ownership moved to is the attribution verify-item runs', () => {
    const attribution = readFileSync(path.join(SCRIPTS, 'run-attribute.cjs'), 'utf8');
    expect(attribution).toContain("verify-item's attribution: which dispatch record answers for each reviewed item, and what\n * changed since its baseline inside and outside the item's ownership.");
    expect(USAGE).toContain('node run.cjs verify-item <item-id> [--tree <dir>]      the item\'s own check plus its ownership');
  });
});
