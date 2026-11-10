/**
 * What an AI-DLC Turbo install leaves in the target project's artifact root
 * and in the tool folders.
 *
 * - A fresh install scaffolds repo/, project/ and docs/ under
 *   .specs-aidlc-turbo and writes the config to repo/config.yaml.
 * - An upgrade of a root with the old layout moves it first (migrate-layout
 *   --write), so the user's config is kept at its new place and no second
 *   config is scaffolded next to it.
 * - An existing repo/config.yaml is never overwritten.
 * - On Claude Code only the five entry points a person types are slash
 *   commands; every file with a `name:` in its frontmatter is a subagent and
 *   only an agent. Files a reinstall no longer writes are removed through the
 *   flow lock, as for every flow (flow-lock tests).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const { installFlow } = require('../../../lib/installer');
const { FLOW_CONFIGS, flowConfigExists } = require('../../../lib/flow-config');
const { isSubagent } = require('../../../lib/installers/ClaudeInstaller');

const FLOW_COMMANDS = path.resolve(__dirname, '../../../flows/aidlc-turbo/commands');

let projectRoot = '';
let previousCwd = '';

function put(rel: string, body = '') {
  const full = path.join(projectRoot, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

const has = (rel: string) => existsSync(path.join(projectRoot, rel));
const read = (rel: string) => readFileSync(path.join(projectRoot, rel), 'utf8');

async function install(tools: string[] = ['claude']) {
  process.chdir(projectRoot);
  try {
    await installFlow('aidlc-turbo', tools, {});
  } finally {
    process.chdir(previousCwd);
  }
}

beforeEach(() => {
  previousCwd = process.cwd();
  projectRoot = mkdtempSync(path.join(tmpdir(), 'specsmd-turbo-layout-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(previousCwd);
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('a fresh AI-DLC Turbo install', () => {
  it('scaffolds repo/, project/ and docs/ and writes the config to repo/config.yaml', async () => {
    await install();
    for (const dir of ['repo', 'project', 'docs']) {
      expect(has(`.specs-aidlc-turbo/${dir}`), dir).toBe(true);
    }
    expect(read('.specs-aidlc-turbo/repo/config.yaml')).toMatch(/^mode: production/m);
    expect(has('.specs-aidlc-turbo/config.yaml')).toBe(false);
  });

  it('puts only the five entry points behind the slash, and every subagent in the agents folder only', async () => {
    await install();
    const turbo = (dir: string) => readdirSync(path.join(projectRoot, '.claude', dir))
      .filter((f) => f === 'specsmd-aidlc-turbo.md' || f.startsWith('specsmd-aidlc-turbo-')).sort();
    expect(turbo('commands')).toEqual([
      'specsmd-aidlc-turbo-config.md',
      'specsmd-aidlc-turbo-construction.md',
      'specsmd-aidlc-turbo-inception.md',
      'specsmd-aidlc-turbo-review-fix.md',
      'specsmd-aidlc-turbo.md',
    ]);
    const subagents = readdirSync(FLOW_COMMANDS)
      .filter((f) => f.endsWith('.md') && isSubagent(readFileSync(path.join(FLOW_COMMANDS, f), 'utf8')))
      .map((f) => `specsmd-${f}`).sort();
    expect(subagents).toHaveLength(13);
    expect(turbo('agents')).toEqual(subagents);
  });

  it('a subagent is a file whose frontmatter has a name', () => {
    expect(isSubagent('---\nname: specsmd-aidlc-turbo-sync\ndescription: d\n---\n# Sync\n')).toBe(true);
    expect(isSubagent('---\ndescription: AI-DLC Turbo config\n---\n\nname: in the body\n')).toBe(false);
    expect(isSubagent('# No frontmatter\nname: x\n')).toBe(false);
  });

  it('never overwrites an existing repo/config.yaml', async () => {
    put('.specs-aidlc-turbo/repo/config.yaml', 'mode: sandbox\n');
    await install();
    expect(read('.specs-aidlc-turbo/repo/config.yaml')).toBe('mode: sandbox\n');
  });
});

describe('upgrading a root with the old layout', () => {
  beforeEach(() => {
    put('.specs-aidlc-turbo/config.yaml', 'mode: sandbox\ntester:\n  enabled: true\n  language: en\n');
    put('.specs-aidlc-turbo/project.yaml', 'project_type: cli-tool\ncodebase:\n  languages: [go]\n');
    put('.specs-aidlc-turbo/standards/tech-stack.md', '# Tech stack\n');
    put('.specs-aidlc-turbo/intents/a/brief.md', '---\nid: a\nstatus: done\n---\n');
    put('.specs-aidlc-turbo/tests/a/US-001 - Login.md', '# US-001\n');
  });

  it('moves the old tree first and keeps the user config at its new place', async () => {
    await install();
    expect(read('.specs-aidlc-turbo/repo/config.yaml')).toBe('mode: sandbox\ntester:\n  enabled: true\n  language: en\n');
    expect(read('.specs-aidlc-turbo/repo/repo.yaml')).toContain('languages: [go]');
    expect(read('.specs-aidlc-turbo/project/project.yaml')).toContain('project_type: cli-tool');
    expect(has('.specs-aidlc-turbo/repo/standards/tech-stack.md')).toBe(true);
    expect(has('.specs-aidlc-turbo/docs/a/a/brief.md')).toBe(true);
    expect(has('.specs-aidlc-turbo/docs/a/a/tests/US-001 - Login.md')).toBe(true);
    for (const old of ['config.yaml', 'project.yaml', 'standards', 'intents', 'tests']) {
      expect(has(`.specs-aidlc-turbo/${old}`), old).toBe(false);
    }
  });

  it('counts a config at the old place as existing, so the questionnaire is skipped', () => {
    process.chdir(projectRoot);
    try {
      expect(flowConfigExists(FLOW_CONFIGS['aidlc-turbo'])).toBe(true);
    } finally {
      process.chdir(previousCwd);
    }
  });
});
