/**
 * AI-DLC Turbo - the version an intent was planned with.
 *
 * On a real run the inception ran on a test install of the plugin and the
 * construction on the installed release. At finish the newer version drew the
 * overview its own way, and much of what the user approved at the inception
 * was gone from it, without a word. Now:
 * - lib/flow-version.cjs reads the version of the flow that runs, from a
 *   Claude Code plugin, an install by the specsmd installer or the source;
 * - intent-status.cjs prints it with --version and puts it in its JSON;
 * - the approval stamps it into the brief as turbo_version, and construction
 *   names a different version before it builds and asks whether to go on.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const { flowVersion } = req(path.join(FLOW, 'scripts/lib/flow-version.cjs'));
const status = req(path.join(FLOW, 'scripts/intent-status.cjs'));
const SOURCE_VERSION = JSON.parse(readFileSync(path.resolve(FLOW, '../../package.json'), 'utf8')).version;
const flat = (rel: string) => readFileSync(path.join(FLOW, rel), 'utf8').replace(/\s+/g, ' ');

const tmp = mkdtempSync(path.join(tmpdir(), 'turbo-version-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
function put(rel: string, text: string) {
  const file = path.join(tmp, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

describe('flowVersion', () => {
  it('reads a Claude Code plugin, an installer copy and the source tree', () => {
    put('plugin/.claude-plugin/plugin.json', JSON.stringify({ name: 'aidlc-turbo', version: '0.12.1' }));
    expect(flowVersion(path.join(tmp, 'plugin/flow'))).toBe('0.12.1');
    put('project/.specsmd/manifest.yaml', "flow: aidlc-turbo\nversion: '0.1.75'\ninstalled_at: '2026-10-24'\n");
    expect(flowVersion(path.join(tmp, 'project/.specsmd/aidlc-turbo'))).toBe('0.1.75');
    put('repo/src/package.json', JSON.stringify({ name: 'specsmd', version: '0.1.76' }));
    expect(flowVersion(path.join(tmp, 'repo/src/flows/aidlc-turbo'))).toBe('0.1.76');
  });

  it('never takes the version of another package, and is null when nothing answers', () => {
    put('app/package.json', JSON.stringify({ name: 'customer-app', version: '9.9.9' }));
    expect(flowVersion(path.join(tmp, 'app/flows/aidlc-turbo'))).toBeNull();
    expect(flowVersion(path.join(tmp, 'nothing/here'))).toBeNull();
  });

  it('answers for the flow it runs in, without an argument', () => {
    expect(flowVersion()).toBe(SOURCE_VERSION);
  });
});

describe('intent-status and the version', () => {
  it('prints the version with --version, and puts it in the JSON', () => {
    const out = execFileSync('node', [path.join(FLOW, 'scripts/intent-status.cjs'), '--version'], { encoding: 'utf8' });
    expect(out.trim()).toBe(SOURCE_VERSION);
    put('p/.specs-aidlc-turbo/docs/auth/auth/brief.md', '---\nid: auth\nstatus: approved\nturbo_version: 0.5.0-ag260.17\n---\n\n# Auth\n');
    const intent = { slug: 'auth', inception: 'auth', dir: path.join(tmp, 'p/.specs-aidlc-turbo/docs/auth/auth'), brief: path.join(tmp, 'p/.specs-aidlc-turbo/docs/auth/auth/brief.md'), stories: path.join(tmp, 'p/.specs-aidlc-turbo/docs/auth/auth/stories') };
    const payload = status.statusPayload(intent);
    expect(payload.turbo_version).toBe(SOURCE_VERSION);
    expect(payload.brief.turbo_version).toBe('0.5.0-ag260.17');
  });
});

describe('the flow names a different version before it builds', () => {
  it('the approval stamps the version, construction compares it and asks', () => {
    const approve = flat('skills/inception/review.md');
    expect(approve).toContain('`turbo_version`, the version `node .specsmd/aidlc-turbo/scripts/intent-status.cjs --version` prints');
    const agent = flat('agents/construction-agent.md');
    expect(agent).toContain('**The version**');
    expect(agent).toContain('`brief.turbo_version` is set and differs from `turbo_version`');
    expect(agent).toContain('**Go on with this version**');
    expect(agent).toContain('No `brief.turbo_version`: say nothing');
  });
});
