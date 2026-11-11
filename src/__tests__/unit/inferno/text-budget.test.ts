/**
 * The standing text of each INFERNO role stays inside the word ceiling a host's budget script
 * holds it to. The installed files are what a host counts, so the flow is installed into a
 * sandbox on both hosts and each role is counted the way that script counts: words split on
 * white space, every file of the role together. A text that grows past its ceiling fails here,
 * not at a host's install.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { openSandbox } from '../installer/sandbox';

const { installFlow } = require('../../../lib/installer');
const CodexInstaller = require('../../../lib/installers/CodexInstaller');

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const count = (...files: string[]) => files.reduce((sum, file) => sum + words(readFileSync(file, 'utf8')), 0);

/** The managed block a host counts toward every Codex role: its start marker and body, without the end marker. */
function managedBlock(): number {
  const agents = readFileSync('AGENTS.md', 'utf8');
  const start = agents.indexOf(CodexInstaller.MANAGED_START);
  const end = agents.indexOf(CodexInstaller.MANAGED_END);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return words(agents.slice(start, end));
}

/** Each role as installed, its files and the ceiling. */
const ROLES: Array<[string, () => number, number]> = [
  ['the builder', () => count('.claude/agents/specsmd-inferno-builder.md'), 2353],
  ['the cheap builder', () => count('.claude/agents/specsmd-inferno-builder-cheap.md'), 2353],
  ['the escalate builder', () => count('.claude/agents/specsmd-inferno-builder-escalate.md'), 2353],
  ['the Claude planner', () => count('.claude/agents/specsmd-inferno-planner.md'), 3125],
  ['the orchestrator', () => count('.specsmd/inferno/agents/orchestrator/agent.md'), 3385],
  [
    'the Codex orchestrator, skill and procedure',
    () => count('.agents/skills/specsmd-inferno/SKILL.md', '.agents/skills/specsmd-inferno/references/procedure.md'),
    3406,
  ],
  [
    'the Codex planner, agent, skill and procedure',
    () => count(
      '.codex/agents/specsmd_inferno_planner.toml',
      '.agents/skills/specsmd-inferno-planner/SKILL.md',
      '.agents/skills/specsmd-inferno-planner/references/procedure.md'
    ),
    2906,
  ],
  ['the managed AGENTS.md block', managedBlock, 171],
];

describe.sequential('inferno role text budget', { timeout: 30_000 }, () => {
  let box: ReturnType<typeof openSandbox>;

  beforeEach(() => {
    box = openSandbox('specsmd-text-budget-');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    box.close();
  });

  it('keeps every role at or under its host ceiling', async () => {
    await installFlow('inferno', ['claude', 'codex']);
    const over = ROLES
      .map(([role, measure, ceiling]) => ({ role, size: measure(), ceiling }))
      .filter(({ size, ceiling }) => size > ceiling)
      .map(({ role, size, ceiling }) => `${role}: ${size} words, ceiling ${ceiling}`);
    expect(over).toEqual([]);
  });

  it('counts each role from the files the install wrote', async () => {
    await installFlow('inferno', ['claude', 'codex']);
    for (const [role, measure] of ROLES) expect(measure(), role).toBeGreaterThan(100);
  });
});
