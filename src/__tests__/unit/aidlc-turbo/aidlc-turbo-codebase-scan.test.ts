/**
 * Unit tests for where scripts/codebase-scan.cjs writes.
 *
 * The scan describes the repo, so `--write` puts its `codebase:` block into
 * repo/repo.yaml. The `live_test:` block the finish step writes there is kept
 * verbatim, and so is every other key. An artifact root that still has the
 * old layout is refused with the migrate hint, so a scan never writes half of
 * one layout into the other. What the scan detects is covered by the flow
 * test; this file covers the CLI and the file it writes.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';
import yaml from 'js-yaml';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const SCAN = path.join(FLOW, 'scripts/codebase-scan.cjs');
const scanner = createRequire(import.meta.url)(SCAN);

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'turbo-scan-cli-'));
  made.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body, 'utf8');
  }
  return dir;
}

const run = (cwd: string, ...args: string[]) => {
  try {
    return { code: 0, out: execFileSync('node', [SCAN, ...args], { cwd, encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e: any) {
    return { code: e.status as number, out: `${e.stdout}${e.stderr}` };
  }
};

const APP = { 'package.json': JSON.stringify({ name: 'app', scripts: { build: 'tsc', test: 'vitest' } }) };

describe('codebase-scan --write', () => {
  it('writes the codebase block into repo/repo.yaml, never a project.yaml', () => {
    const dir = project(APP);
    const { code } = run(dir, '--write');
    expect(code).toBe(0);
    const repo = yaml.load(readFileSync(path.join(dir, '.specs-aidlc-turbo/repo/repo.yaml'), 'utf8')) as any;
    expect(repo.codebase.commands).toEqual({ build: 'npm run build', test: 'npm test' });
    expect(existsSync(path.join(dir, '.specs-aidlc-turbo/project.yaml'))).toBe(false);
    expect(existsSync(path.join(dir, '.specs-aidlc-turbo/project/project.yaml'))).toBe(false);
  });

  it('keeps the live_test block and every other key of an existing repo.yaml', () => {
    const dir = project(APP);
    const file = path.join(dir, '.specs-aidlc-turbo/repo/repo.yaml');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, [
      '# how this repo runs',
      'codebase:',
      '  languages: [cobol]',
      'live_test:',
      '  start_command: "npm start"',
      '  url: "http://localhost:3000"',
      '',
    ].join('\n'));
    run(dir, '--write');
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('# how this repo runs');
    expect(text).not.toContain('cobol');
    const parsed = yaml.load(text) as any;
    expect(parsed.live_test).toEqual({ start_command: 'npm start', url: 'http://localhost:3000' });
    expect(parsed.codebase.commands.test).toBe('npm test');
  });

  it('scans the --project folder and writes under the --root it is given', () => {
    const dir = project(APP);
    const elsewhere = project({});
    const root = path.join(elsewhere, 'artifacts');
    expect(run(elsewhere, '--project', dir, '--root', root, '--write').code).toBe(0);
    const repo = yaml.load(readFileSync(path.join(root, 'repo/repo.yaml'), 'utf8')) as any;
    expect(repo.codebase.commands.build).toBe('npm run build');
  });

  it('refuses to write into an artifact root with the old layout', () => {
    const dir = project({ ...APP, '.specs-aidlc-turbo/project.yaml': 'project_type: other\n' });
    const { code, out } = run(dir, '--write');
    expect(code).toBe(1);
    expect(out).toContain('migrate-layout.cjs --write');
    expect(readFileSync(path.join(dir, '.specs-aidlc-turbo/project.yaml'), 'utf8')).toBe('project_type: other\n');
  });

  it('prints the block without writing anything when --write is left out', () => {
    const dir = project(APP);
    const { code, out } = run(dir);
    expect(code).toBe(0);
    expect(out).toMatch(/^codebase:\n/);
    expect(existsSync(path.join(dir, '.specs-aidlc-turbo'))).toBe(false);
  });

  it('exits 2 on an unknown argument', () => {
    expect(run(project(APP), '--nonsense').code).toBe(2);
  });
});

describe('codebase-scan exports', () => {
  it('merges a block into yaml text and keeps the rest', () => {
    const merged = scanner.mergeBlock('codebase:\n  old: 1\nlive_test:\n  url: "x"\n', 'codebase:\n  new: 2\n');
    expect(merged).toBe('codebase:\n  new: 2\nlive_test:\n  url: "x"\n');
  });

  it('scans a folder without touching the disk', () => {
    const result = scanner.scan(project(APP));
    expect(result.commands).toEqual({ build: 'npm run build', test: 'npm test' });
  });
});
