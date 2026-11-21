import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSandbox } from './sandbox';

const { installFlow } = require('../../../lib/installer');
const { sessionLine } = require('../../../lib/install/session');

// Claude Code reads .claude/agents when a session starts, and Codex reads AGENTS.md and
// .codex/agents the same way, so a session started before a reinstall still dispatches the old
// definitions. The install says it in one line when it replaced an install of the same flow.
describe.sequential('install session hint', { timeout: 60_000 }, () => {
  let box: ReturnType<typeof openSandbox>;
  let logs: string[];

  beforeEach(() => {
    box = openSandbox('specsmd-session-hint-');
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    box.close();
  });

  const hinted = () => logs.filter((line) => line.includes('session started before'));

  it('prints nothing on a first install, and one line naming Claude Code on the install over it', async () => {
    await installFlow('inferno', ['claude']);
    expect(hinted()).toHaveLength(0);

    await installFlow('inferno', ['claude']);
    expect(hinted()).toHaveLength(1);
    expect(hinted()[0]).toContain('This install replaced an existing one.');
    expect(hinted()[0]).toContain('A Claude Code session started before it keeps the agent definitions it read when it started');
    expect(hinted()[0]).toContain('start a fresh session, or have the running session re-read the installed definition before it starts its next item');
    expect(hinted()[0]).not.toContain('Codex');
  });

  it('names Claude Code and Codex when the install writes for both', async () => {
    await installFlow('inferno', ['claude', 'codex']);
    await installFlow('inferno', ['claude', 'codex']);

    expect(hinted()).toHaveLength(1);
    expect(hinted()[0]).toContain('A Claude Code or Codex session started before it');
  });

  it('counts only an install of the same flow as an existing one', async () => {
    await installFlow('fire', ['claude']);
    expect(hinted()).toHaveLength(0);

    await installFlow('inferno', ['claude']);
    expect(hinted()).toHaveLength(0);
  });

  it('says it for any flow whose install writes a Claude agent', async () => {
    await installFlow('fire', ['claude']);
    await installFlow('fire', ['claude']);

    expect(hinted()).toHaveLength(1);
    expect(hinted()[0]).toContain('A Claude Code session started before it');
  });

  it('says nothing for a reinstall that writes no definition a host reads at session start', async () => {
    for (const tools of [['cursor'], ['codex'], ['gemini', 'opencode']]) {
      await installFlow('fire', tools);
      await installFlow('fire', tools);
    }

    expect(hinted()).toHaveLength(0);
  });

  it('holds the rule: a reinstall, and a written file a host reads when a session starts', () => {
    const claude = ['.claude/agents/specsmd-inferno-builder.md', '.claude/commands/specsmd-inferno.md'];
    const codex = ['.codex/agents/specsmd_inferno_builder_strong.toml', 'AGENTS.md', '.agents/skills/specsmd-inferno/SKILL.md'];

    expect(sessionLine(false, [...claude, ...codex])).toBeNull();
    expect(sessionLine(true, [])).toBeNull();
    expect(sessionLine(true, ['.claude/commands/specsmd-fire.md', '.cursor/commands/specsmd-fire.md', '.codex/skills/specsmd-fire/SKILL.md'])).toBeNull();
    expect(sessionLine(true, claude)).toContain('A Claude Code session started before it');
    expect(sessionLine(true, ['AGENTS.md'])).toContain('A Codex session started before it');
    expect(sessionLine(true, ['.codex/agents/specsmd_inferno_planner.toml'])).toContain('A Codex session started before it');
    expect(sessionLine(true, new Set([...codex, ...claude]))).toContain('A Claude Code or Codex session started before it');
  });
});
