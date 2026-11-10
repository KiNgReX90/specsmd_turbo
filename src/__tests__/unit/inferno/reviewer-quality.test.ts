/**
 * The quality lens, the second reviewer beside the contract review of every item.
 *
 * Guards:
 * - The command copy carries the canonical agent body.
 * - It holds the tools of a judge, writes only its own review file and teaches exactly its schema.
 * - It proposes no mutant and judges a host rule only from the rule files its dispatch names.
 * - Both config examples name its role and the lint key it runs.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// src/ is the package root that vitest runs from.
const ROOT = path.resolve(__dirname, '../../..');
const INFERNO = path.join(ROOT, 'flows/inferno');

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n?/);
  return (match ? content.slice(match[0].length) : content).trim();
}

function frontmatter(content: string): string {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
}

describe('inferno quality reviewer', () => {
  it('inferno-reviewer-quality command body is identical to the canonical quality reviewer agent body', () => {
    const command = readFileSync(path.join(INFERNO, 'commands/inferno-reviewer-quality.md'), 'utf8');
    const agent = readFileSync(path.join(INFERNO, 'agents/reviewer-quality/agent.md'), 'utf8');
    expect(stripFrontmatter(command)).toBe(stripFrontmatter(agent));
  });

  // The quality lens judges beside the contract reviewer and hands the runner the same kind of
  // file: it writes only its own review file, at its own path, and teaches exactly its schema.
  // It proposes no mutant and leaves the contract's checks to the contract reviewer.
  it('the quality reviewer carries the tools of a judge and teaches exactly its review schema', () => {
    const quality = readFileSync(path.join(INFERNO, 'commands/inferno-reviewer-quality.md'), 'utf8');
    const tools = (frontmatter(quality).match(/^tools:\s*(.*)$/m)?.[1] ?? '').split(/,\s*/);
    expect(tools.sort()).toEqual(['Bash', 'Glob', 'Grep', 'Read', 'Write']);
    expect(quality).toMatch(/never commit/);
    expect(quality).toContain('.specs-inferno/intents/<intent>/reviews/quality/<item>.yaml');
    const blocks = [...quality.matchAll(/```yaml\n([\s\S]*?)```/g)].map((match) => match[1]);
    expect(blocks).toHaveLength(1);
    const top = [...blocks[0].matchAll(/^([a-z_]+):/gm)].map((match) => match[1]);
    const nested = (key: string) => {
      const section = blocks[0].split(new RegExp(`^${key}:`, 'm'))[1].split(/^[a-z_]+:/m)[0];
      return [...section.matchAll(/^\s+-?\s*([a-z_]+):/gm)].map((match) => match[1]);
    };
    expect(top).toEqual(['item', 'verdict', 'files', 'findings', 'lint']);
    expect(nested('findings')).toEqual(['id', 'check', 'file', 'line', 'evidence', 'fix', 'severity', 'rule', 'oracle', 'repeat']);
    expect(nested('lint')).toEqual(['command', 'exit', 'taken']);
    for (const check of ['correctness', 'errors', 'security', 'fit', 'readability', 'cost', 'leftovers', 'lint', 'rule']) {
      expect(quality, check).toContain(`\`${check}\``);
    }
    for (const field of ['range', 'spec', 'brief', 'standards', 'lint', 'write']) {
      expect(quality, field).toMatch(new RegExp(`^  ${field} `, 'm'));
    }
    expect(quality).not.toMatch(/run\.cjs mutate/);
    expect(quality).toMatch(/proposes no mutant/);
    expect(quality).toMatch(/goes to the oracle/);
    expect(quality).toMatch(/Without a `standards` line you judge no rule of the host/);
  });

  // Each host gets the quality lens as its own role, and the lint commands it runs are a
  // verification key a host sets beside the other verification commands.
  it('both config examples name the quality reviewer role and the lint key', () => {
    const claude = readFileSync(path.join(INFERNO, 'agents/orchestrator/config.example.yaml'), 'utf8');
    expect(claude).toMatch(/^#\s+reviewer-quality:\s*\{model:\s*claude-opus-5-5, effort:\s*high\}/m);
    expect(claude).toMatch(/^\s*#?\s*lint:\s+#/m);
    const codex = readFileSync(path.join(INFERNO, 'codex/skills/specsmd-inferno-config/references/procedure.md'), 'utf8');
    expect(codex).toMatch(/^ {2}reviewer_quality:\n {4}agent: specsmd_inferno_reviewer_quality$/m);
    expect(codex).toMatch(/^ {2}lint:\n {4}- </m);
    expect(codex).toContain('`verification.lint`');
  });
});
