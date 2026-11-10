/**
 * Install-tree integrity for the aidlc-turbo flow.
 *
 * installFlow copies agents, skills, templates, scripts and the two yaml files
 * into `.specsmd/<flow>/`, and the ClaudeInstaller copies the command files
 * into `.claude/commands/` and `.claude/agents/`. The flow's own `commands/`
 * folder is never copied into `.specsmd/`, so a file that points a reader at
 * `.specsmd/aidlc-turbo/commands/...` names a path no target project has. The
 * first real run of the flow hit exactly that.
 *
 * This installs the flow into a temp project, then reads every installed file
 * and asserts that every `.specsmd/aidlc-turbo/...` path it mentions exists in
 * the tree that was just installed.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const { installFlow } = require('../../../lib/installer');

const FLOW = 'aidlc-turbo';
const RESOURCE_PREFIX = `.specsmd/${FLOW}/`;

// Every `.specsmd/aidlc-turbo/...` path mentioned in prose, code fences or
// tables. Trailing punctuation and markdown fences are not part of the path.
const REFERENCE_RE = /\.specsmd\/aidlc-turbo\/[A-Za-z0-9_./-]+/g;

let projectRoot = '';
let previousCwd = '';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

beforeAll(async () => {
  previousCwd = process.cwd();
  projectRoot = mkdtempSync(path.join(tmpdir(), 'specsmd-turbo-install-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  process.chdir(projectRoot);
  await installFlow(FLOW, ['claude'], {});
  process.chdir(previousCwd);
  vi.restoreAllMocks();
});

afterAll(() => {
  if (previousCwd) process.chdir(previousCwd);
  if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
});

describe('aidlc-turbo install tree', () => {
  it('installs the flow resources and the Claude Code surfaces', () => {
    expect(existsSync(path.join(projectRoot, '.specsmd', FLOW, 'memory-bank.yaml'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.specsmd', FLOW, 'scripts/lib/paths.cjs'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.specsmd', FLOW, 'scripts/migrate-layout.cjs'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.claude/agents/specsmd-aidlc-turbo-sync.md'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.claude/commands/specsmd-aidlc-turbo.md'))).toBe(true);
    expect(existsSync(path.join(projectRoot, '.claude/agents/specsmd-aidlc-turbo-builder.md'))).toBe(
      true,
    );
    expect(
      existsSync(path.join(projectRoot, '.claude/commands/specsmd-aidlc-turbo-config.md')),
    ).toBe(true);
  });

  it('never copies the flow commands folder into .specsmd (so nothing may point there)', () => {
    expect(existsSync(path.join(projectRoot, '.specsmd', FLOW, 'commands'))).toBe(false);
  });

  it('every .specsmd/aidlc-turbo/... path an installed file names exists in the installed tree', () => {
    const installed = [
      ...walk(path.join(projectRoot, '.specsmd', FLOW)),
      ...walk(path.join(projectRoot, '.claude')),
    ].filter((f) => /\.(md|ya?ml|cjs)$/.test(f));

    expect(installed.length).toBeGreaterThan(30);

    const broken: string[] = [];
    for (const file of installed) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.match(REFERENCE_RE) ?? []) {
        // A reference written as a folder ("the skills/ folder") ends in a
        // slash; strip it and trailing markdown punctuation before resolving.
        const ref = match.replace(/[.,;:)`'"]+$/, '').replace(/\/$/, '');
        const target = path.join(projectRoot, ref);
        if (!existsSync(target)) {
          broken.push(`${path.relative(projectRoot, file)} -> ${ref}`);
          continue;
        }
        // A reference that ends in a file extension must resolve to a file.
        if (/\.[A-Za-z0-9]+$/.test(ref) && statSync(target).isDirectory()) {
          broken.push(`${path.relative(projectRoot, file)} -> ${ref} (directory, expected a file)`);
        }
      }
    }

    expect(broken).toEqual([]);
  });
});
