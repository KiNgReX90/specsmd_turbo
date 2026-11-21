import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { openSandbox, readLock } from './sandbox';

const { installFlow } = require('../../../lib/installer');

function body(text: string) {
  const match = text.match(/^---\n[\s\S]*?\n---\n?/);
  return (match ? text.slice(match[0].length) : text).trim();
}

function frontmatter(text: string) {
  return (text.match(/^---\n([\s\S]*?)\n---/) || ['', ''])[1];
}

describe.sequential('Claude command-only files', { timeout: 30_000 }, () => {
  let box: ReturnType<typeof openSandbox>;

  beforeEach(() => {
    box = openSandbox('specsmd-claude-layout-');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    box.close();
  });

  it('installs the intents command to the commands only, never as an agent', async () => {
    await installFlow('inferno', ['claude']);

    const command = readFileSync('.claude/commands/specsmd-inferno-intents.md', 'utf8');
    expect(command).toMatch(/run\.cjs select/);
    expect(existsSync('.claude/agents/specsmd-inferno-intents.md')).toBe(false);
    // A `!` line runs only under the command's own allowed-tools on a host with no permission rule for it.
    expect(frontmatter(command)).toMatch(
      /^allowed-tools: Bash\(node \.specsmd\/inferno\/agents\/orchestrator\/skills\/orchestrate\/scripts\/run\.cjs select\)$/m
    );
    expect(Object.keys(readLock().files)).toContain('.claude/commands/specsmd-inferno-intents.md');
  });

  it('installs the standards command to the commands only, never as an agent', async () => {
    await installFlow('inferno', ['claude']);

    const command = readFileSync('.claude/commands/specsmd-inferno-standards.md', 'utf8');
    expect(command).toMatch(/\.specs-inferno\/standards\//);
    expect(command).toMatch(/^standards:$/m);
    expect(existsSync('.claude/agents/specsmd-inferno-standards.md')).toBe(false);
    // It drafts in the user's own session, so it pins neither model nor effort.
    expect(frontmatter(command)).not.toMatch(/^(model|effort):/m);
    expect(Object.keys(readLock().files)).toContain('.claude/commands/specsmd-inferno-standards.md');
  });

  it('installs the planner command as a launcher and the planner agent as the full body', async () => {
    await installFlow('inferno', ['claude']);

    const launcher = readFileSync('.claude/commands/specsmd-inferno-planner.md', 'utf8');
    const agent = readFileSync('.claude/agents/specsmd-inferno-planner.md', 'utf8');
    const canonical = readFileSync('.specsmd/inferno/agents/planner/agent.md', 'utf8');

    expect(body(agent)).toBe(body(canonical));
    expect(body(launcher)).not.toBe(body(agent));
    expect(launcher).toMatch(/`specsmd-inferno-planner` subagent/);
    // The launcher runs on the session's own model, so it pins neither.
    expect(frontmatter(launcher)).not.toMatch(/^(model|effort):/m);
  });

  // The orchestrator dispatches the quality lens as a subagent beside the contract reviewer, so it
  // lands as an agent and a command with the canonical body, and the lock holds all three files.
  it('installs the quality reviewer as an agent and a command with the canonical body', async () => {
    await installFlow('inferno', ['claude']);

    const canonical = readFileSync('.specsmd/inferno/agents/reviewer-quality/agent.md', 'utf8');
    for (const rel of ['.claude/agents/specsmd-inferno-reviewer-quality.md', '.claude/commands/specsmd-inferno-reviewer-quality.md']) {
      const text = readFileSync(rel, 'utf8');
      expect(body(text), rel).toBe(body(canonical));
      expect(frontmatter(text), rel).toMatch(/^name: specsmd-inferno-reviewer-quality$/m);
      expect(Object.keys(readLock().files), rel).toContain(rel);
    }
    expect(Object.keys(readLock().files)).toContain('.specsmd/inferno/agents/reviewer-quality/agent.md');
  });

  it('gives a tool without agents the full planner body as its command', async () => {
    await installFlow('inferno', ['cursor']);

    const files = Object.keys(readLock().files);
    const planner = files.find((rel) => rel.endsWith('specsmd-inferno-planner.md'));
    expect(planner).toBeTruthy();
    const canonical = readFileSync('.specsmd/inferno/agents/planner/agent.md', 'utf8');
    expect(body(readFileSync(planner as string, 'utf8'))).toBe(body(canonical));
    expect(files.some((rel) => rel.endsWith('specsmd-inferno-intents.md'))).toBe(false);
  });
});
