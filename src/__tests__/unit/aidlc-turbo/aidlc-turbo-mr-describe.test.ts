/**
 * Unit tests for mr-describe.cjs of the AI-DLC Turbo flow: the construction
 * agent writes a merge request's description with the mr-description skill,
 * and this script reads it from and writes it to GitLab.
 *
 * - read returns the title, the description and the state of a merge request
 *   link (push-branch.cjs reads the state);
 * - write sends the description only, never the title, labels or assignees;
 * - a description with double quotes and several lines arrives as written;
 * - patch replaces one section and keeps every other byte, a reviewer's edits
 *   included; --synced sets only the marker's sha; a missing section goes
 *   before the marker (a later update never rewrites the whole text);
 * - patch --line replaces only the value of one top line (Link to the world,
 *   Documentation), a missing one goes in at the top; --jira sets only the
 *   marker's jira field;
 * - write or patch that would change nothing sends nothing;
 * - the update flow of mr-description.md patches, it never writes;
 * - the key is GITLAB_TOKEN, looked up as the Atlassian keys are; without it nothing
 *   is sent and the result says why;
 * - a link that is not a GitLab merge request, or a refusal, is ok false.
 *
 * The REST boundary is a fake transport.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const md = req(path.join(FLOW, 'scripts/mr-describe.cjs'));

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const URL = 'https://gitlab.acme.test/acme/shop/web/-/merge_requests/164';
const API = 'https://gitlab.acme.test/api/v4/projects/acme%2Fshop%2Fweb/merge_requests/164';

type Req = { method: string; url: string; headers: Record<string, string>; body?: Buffer };

function fakeTransport(status = 200, answer: object = { title: 'SHOP-642 - Gift cards', description: 'One story of "Gift cards".', state: 'opened' }) {
  const requests: Req[] = [];
  const transport = async (r: Req) => {
    requests.push(r);
    return { status, headers: {}, body: Buffer.from(JSON.stringify(answer)) };
  };
  return { requests, transport };
}

const lookup = (token: string | null) => (k: string) => (k === 'GITLAB_TOKEN' ? token : null);

function bodyFile(text: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'turbo-mr-'));
  dirs.push(dir);
  const file = path.join(dir, 'body.md');
  writeFileSync(file, text);
  return file;
}

async function runMain(argv: string[], deps: { token?: string | null; transport?: unknown } = {}) {
  let printed = '';
  const code = await md.main(argv, {
    print: (t: string) => { printed += t; },
    lookup: lookup(deps.token === undefined ? 'glpat-x' : deps.token),
    transport: deps.transport ?? fakeTransport().transport,
  });
  return { code, result: JSON.parse(printed) };
}

describe('aidlc-turbo mr-describe, the link', () => {
  it('splits a GitLab merge request link into its API address', () => {
    expect(md.mrParts(URL)).toEqual({ api: 'https://gitlab.acme.test/api/v4', project: 'acme/shop/web', iid: '164' });
    expect(md.mrParts('https://gitlab.example.com/app/-/merge_requests/3?tab=x')).toEqual({ api: 'https://gitlab.example.com/api/v4', project: 'app', iid: '3' });
    expect(md.mrParts('https://github.com/acme/app/pull/7')).toBeNull();
  });
});

describe('aidlc-turbo mr-describe, read', () => {
  it('returns the title, the description and the state', async () => {
    const fake = fakeTransport();
    const { code, result } = await runMain(['read', '--url', URL], { transport: fake.transport });
    expect(code).toBe(0);
    expect(result).toEqual({ ok: true, url: URL, title: 'SHOP-642 - Gift cards', description: 'One story of "Gift cards".', state: 'opened' });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({ method: 'GET', url: API, headers: { 'PRIVATE-TOKEN': 'glpat-x' } });
  });

  it.each(['merged', 'closed', 'locked'])('returns the state %s as GitLab names it', async (state) => {
    const { result } = await runMain(['read', '--url', URL], { transport: fakeTransport(200, { title: 't', description: 'd', state }).transport });
    expect(result.state).toBe(state);
  });
});

describe('aidlc-turbo mr-describe, write', () => {
  it('sends the description only, with quotes and lines intact', async () => {
    const text = '**Link to the world:** [SHOP-642](https://example.atlassian.net/browse/SHOP-642)\n\n## Why\n\nOne story of "Gift cards".\n';
    const fake = fakeTransport();
    const { code, result } = await runMain(['write', '--url', URL, '--body-file', bodyFile(text)], { transport: fake.transport });
    expect(code).toBe(0);
    expect(result).toEqual({ ok: true, url: URL, written: true });
    expect(fake.requests.map((r) => r.method)).toEqual(['GET', 'PUT']);
    const sent = fake.requests[1];
    expect(sent).toMatchObject({ method: 'PUT', url: API, headers: { 'PRIVATE-TOKEN': 'glpat-x', 'Content-Type': 'application/json' } });
    expect(JSON.parse(String(sent.body))).toEqual({ description: text });
  });

  it('sends nothing when the description is there already', async () => {
    const text = '## Summary\n\nOne story.\n';
    const fake = fakeTransport(200, { title: 't', description: '## Summary\r\n\r\nOne story.', state: 'opened' });
    const { code, result } = await runMain(['write', '--url', URL, '--body-file', bodyFile(text)], { transport: fake.transport });
    expect(code).toBe(0);
    expect(result).toEqual({ ok: true, url: URL, written: false, unchanged: true });
    expect(fake.requests.map((r) => r.method)).toEqual(['GET']);
  });

  it('refuses an empty description', async () => {
    const fake = fakeTransport();
    const { code, result } = await runMain(['write', '--url', URL, '--body-file', bodyFile('  \n')], { transport: fake.transport });
    expect(code).toBe(1);
    expect(result.ok).toBe(false);
    expect(fake.requests).toHaveLength(0);
  });

  it('sends nothing without a GITLAB_TOKEN and says where it looked', async () => {
    const fake = fakeTransport();
    const { code, result } = await runMain(['write', '--url', URL, '--body-file', bodyFile('x\n')], { token: null, transport: fake.transport });
    expect(code).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('GITLAB_TOKEN');
    expect(fake.requests).toHaveLength(0);
  });

  it('says so when GitLab refuses', async () => {
    const { code, result } = await runMain(['write', '--url', URL, '--body-file', bodyFile('x\n')], { transport: fakeTransport(403, {}).transport });
    expect(code).toBe(1);
    expect(result).toMatchObject({ ok: false, detail: 'GitLab answered HTTP 403' });
  });

  it('refuses a link that is not a GitLab merge request', async () => {
    const fake = fakeTransport();
    const { code, result } = await runMain(['write', '--url', 'https://github.com/acme/app/pull/7', '--body-file', bodyFile('x\n')], { transport: fake.transport });
    expect(code).toBe(2);
    expect(result.ok).toBe(false);
    expect(fake.requests).toHaveLength(0);
  });

  it('names the usage on a missing flag', async () => {
    const { code, result } = await runMain(['write', '--url', URL]);
    expect(code).toBe(2);
    expect(result.detail).toContain('--body-file');
  });
});

/** A description the flow wrote, with a reviewer's edits in the top lines and in Evidence. */
const LIVE = [
  '**Link to the world:** [SHOP-642](https://example.atlassian.net/browse/SHOP-642)',
  '**Documentation:** [Gift cards](https://example.atlassian.net/wiki/x/1)',
  'Reviewer note: check the code check with Ann.',
  '',
  '## Summary',
  '',
  'Gift cards without a code are refused.',
  '',
  '```markdown',
  '## not a section, inside a fence',
  '```',
  '',
  '## Evidence',
  '',
  'refuses a gift card without a code: 1 failed before, 1 passed after.',
  'Edited by Ann: also checked by hand on test.',
  '',
  '## Merge danger',
  '',
  'Two-way door. Blast radius: local.',
  '',
  '<!-- turbo-mr-desc synced:1111111111111111111111111111111111111111 jira:ok -->',
  '',
].join('\n');

/** The text of `## {heading}` up to the next `## ` heading or the marker, outside fences. */
const section = (text: string, heading: string) => {
  const from = text.indexOf(`## ${heading}`);
  const rest = text.slice(from + 3 + heading.length);
  const stop = rest.search(/\n(## (?!not a section)|<!-- turbo-mr-desc)/);
  return stop < 0 ? rest : rest.slice(0, stop);
};

describe('aidlc-turbo mr-describe, patchSection', () => {
  it('replaces exactly one section and keeps every other byte, a reviewer\'s edits included', () => {
    const { text } = md.patchSection(LIVE, 'Summary', 'Gift cards without a code are refused, also on import.\n');
    const [before, after] = LIVE.split(section(LIVE, 'Summary'));
    expect(text).toBe(`${before}\n\nGift cards without a code are refused, also on import.\n${after}`);
    expect(text).toContain('Reviewer note: check the code check with Ann.\n');
    expect(text).toContain('Edited by Ann: also checked by hand on test.\n');
  });

  it('ends a section at the next ## heading or the marker, never at one inside a code fence', () => {
    const { text } = md.patchSection(LIVE, '## Merge danger', 'One-way door: the conversion deletes old rows.');
    expect(text).toBe(LIVE.replace('Two-way door. Blast radius: local.', 'One-way door: the conversion deletes old rows.'));
    const fenced = md.patchSection(LIVE, 'Summary', 'New summary.').text;
    expect(fenced).not.toContain('## not a section, inside a fence');
    expect(fenced).toContain('## Evidence\n\nrefuses a gift card without a code');
  });

  it('gives the same text back for the same section text', () => {
    expect(md.patchSection(LIVE, 'Evidence', 'refuses a gift card without a code: 1 failed before, 1 passed after.\nEdited by Ann: also checked by hand on test.\n').text).toBe(LIVE);
  });

  it('with --synced changes only the sha in the marker', () => {
    const sha = '2222222222222222222222222222222222222222';
    const same = 'Two-way door. Blast radius: local.';
    const { text } = md.patchSection(LIVE, 'Merge danger', same, sha);
    expect(text).toBe(LIVE.replace('synced:1111111111111111111111111111111111111111', `synced:${sha}`));
  });

  it('adds a missing section before the marker, or at the end without one', () => {
    const { text } = md.patchSection(LIVE, 'Lessons', 'One lesson.');
    expect(text).toBe(LIVE.replace('<!-- turbo-mr-desc', '## Lessons\n\nOne lesson.\n\n<!-- turbo-mr-desc'));
    expect(md.patchSection('One story of "Gift cards".', 'Summary', 'S.').text).toBe('One story of "Gift cards".\n\n## Summary\n\nS.\n');
  });

  it('keeps the line endings GitLab gave back', () => {
    const crlf = '## Summary\r\n\r\nOld.\r\n\r\n<!-- turbo-mr-desc synced:abcdef1 jira:none -->\r\n';
    expect(md.patchSection(crlf, 'Summary', 'New\nlines.', 'abcdef2').text)
      .toBe('## Summary\r\n\r\nNew\r\nlines.\r\n\r\n<!-- turbo-mr-desc synced:abcdef2 jira:none -->\r\n');
  });

  it('refuses --synced without a marker, and an empty section', () => {
    expect(md.patchSection('## Summary\n\nOld.\n', 'Summary', 'New.', 'abcdef1').error).toContain('marker');
    expect(md.patchSection(LIVE, 'Summary', '  \n').error).toContain('empty');
  });
});

describe('aidlc-turbo mr-describe, patch', () => {
  it('sends the description with only that section changed, and nothing else', async () => {
    const fake = fakeTransport(200, { title: 'SHOP-642 - Gift cards', description: LIVE, state: 'opened' });
    const sha = '3333333333333333333333333333333333333333';
    const argv = ['patch', '--url', URL, '--section', 'Evidence', '--body-file', bodyFile('Two tests now.\n'), '--synced', sha];
    const { code, result } = await runMain(argv, { transport: fake.transport });
    expect(code).toBe(0);
    expect(result).toEqual({ ok: true, url: URL, written: true });
    expect(fake.requests.map((r) => r.method)).toEqual(['GET', 'PUT']);
    const body = JSON.parse(String(fake.requests[1].body));
    expect(Object.keys(body)).toEqual(['description']);
    expect(body.description).toBe(LIVE
      .replace('refuses a gift card without a code: 1 failed before, 1 passed after.\nEdited by Ann: also checked by hand on test.', 'Two tests now.')
      .replace('synced:1111111111111111111111111111111111111111', `synced:${sha}`));
  });

  it('sends nothing when the section reads the same', async () => {
    const fake = fakeTransport(200, { title: 't', description: LIVE, state: 'opened' });
    const argv = ['patch', '--url', URL, '--section', 'Merge danger', '--body-file', bodyFile('Two-way door. Blast radius: local.\n')];
    const { code, result } = await runMain(argv, { transport: fake.transport });
    expect(code).toBe(0);
    expect(result).toEqual({ ok: true, url: URL, written: false, unchanged: true });
    expect(fake.requests.map((r) => r.method)).toEqual(['GET']);
  });

  it('needs a section, and a sha for --synced', () => {
    expect(md.parseArgs(['patch', '--url', URL, '--body-file', 'f']).error).toContain('--section');
    expect(md.parseArgs(['patch', '--url', URL, '--section', 'Summary', '--body-file', 'f', '--synced', 'x -->']).error).toContain('sha');
    expect(md.parseArgs(['write', '--url', URL, '--body-file', 'f', '--section', 'Summary']).error).toContain('unknown flag');
  });
});

/** A description the first finish wrote while the Jira sync was pending. */
const PENDING = [
  '**Link to the world:** Jira issue pending: the Jira sync of this intent has not finished',
  'Reviewer note: merge after !76.',
  '',
  '## Summary',
  '',
  'Gift cards without a code are refused.',
  '',
  '<!-- turbo-mr-desc synced:1111111 jira:pending -->',
  '',
].join('\n');
const LINK = '[SHOP-642](https://example.atlassian.net/browse/SHOP-642)';

describe('aidlc-turbo mr-describe, patchLine and the jira field', () => {
  it('replaces only the value after the label and keeps every other byte', () => {
    const { text } = md.patchLine(PENDING, 'Link to the world', LINK);
    expect(text).toBe(PENDING.replace('Jira issue pending: the Jira sync of this intent has not finished', LINK));
    const crlf = '**Link to the world:** no ticket ref  \r\n**Documentation:** [B](u)\r\n\r\n## Summary\r\n';
    expect(md.patchLine(crlf, 'Link to the world', LINK).text).toBe(crlf.replace('no ticket ref', LINK));
  });

  it('gives the same text back for the same value', () => {
    expect(md.patchLine(LIVE, 'Documentation', '[Gift cards](https://example.atlassian.net/wiki/x/1)').text).toBe(LIVE);
  });

  it('adds a missing Documentation line right after Link to the world', () => {
    expect(md.patchLine(PENDING, 'Documentation', '[Gift cards](u)').text)
      .toBe(PENDING.replace('has not finished\n', 'has not finished\n**Documentation:** [Gift cards](u)\n'));
  });

  it('adds a missing Link to the world line at the very top, before the Documentation line and the first ## heading', () => {
    expect(md.patchLine('**Documentation:** [B](u)\n\n## Summary\n\nS.\n', 'Link to the world', LINK).text)
      .toBe(`**Link to the world:** ${LINK}\n**Documentation:** [B](u)\n\n## Summary\n\nS.\n`);
    expect(md.patchLine('## Summary\n\nS.\n', 'Link to the world', LINK).text)
      .toBe(`**Link to the world:** ${LINK}\n\n## Summary\n\nS.\n`);
  });

  it('never takes a label below the first ## heading for the top line', () => {
    const lower = '## Summary\n\n**Documentation:** quoted in the summary\n';
    expect(md.patchLine(lower, 'Documentation', '[B](u)').text).toBe(`**Documentation:** [B](u)\n\n${lower}`);
  });

  it('with --jira changes only the jira field in the marker', () => {
    expect(md.setMarker(PENDING, { jira: 'ok' }).text).toBe(PENDING.replace('jira:pending', 'jira:ok'));
    expect(md.setMarker('x\n<!-- turbo-mr-desc synced:1111111 -->\n', { jira: 'none' }).text)
      .toBe('x\n<!-- turbo-mr-desc synced:1111111 jira:none -->\n');
    expect(md.setMarker('x\n', { jira: 'ok' }).error).toContain('marker');
  });

  it('patches the line and the marker in one call, and sends nothing when both are there already', async () => {
    const argv = ['patch', '--url', URL, '--line', 'Link to the world', '--text', LINK, '--jira', 'ok'];
    const fake = fakeTransport(200, { title: 't', description: PENDING, state: 'opened' });
    const first = await runMain(argv, { transport: fake.transport });
    expect(first.result).toEqual({ ok: true, url: URL, written: true });
    const sent = JSON.parse(String(fake.requests[1].body)).description;
    expect(sent).toBe(PENDING.replace('Jira issue pending: the Jira sync of this intent has not finished', LINK).replace('jira:pending', 'jira:ok'));
    const again = fakeTransport(200, { title: 't', description: sent, state: 'opened' });
    const second = await runMain(argv, { transport: again.transport });
    expect(second.result).toEqual({ ok: true, url: URL, written: false, unchanged: true });
    expect(again.requests.map((r) => r.method)).toEqual(['GET']);
  });

  it('refuses --section with --line, an unknown line, a second text line and an unknown jira state', () => {
    const base = ['patch', '--url', URL];
    expect(md.parseArgs([...base, '--section', 'Summary', '--body-file', 'f', '--line', 'Documentation', '--text', 'x']).error)
      .toContain('exclusive');
    expect(md.parseArgs([...base, '--line', 'Reviewer', '--text', 'x']).error).toContain('--line is one of');
    expect(md.parseArgs([...base, '--line', 'Documentation', '--text', 'a\nb']).error).toContain('one line');
    expect(md.parseArgs([...base, '--line', 'Documentation']).error).toContain('--text');
    expect(md.parseArgs([...base, '--line', 'Documentation', '--text', 'x', '--jira', 'done']).error).toContain('--jira');
    expect(md.parseArgs([...base, '--line', 'link to the world', '--text', 'x']).line).toBe('Link to the world');
  });
});

describe('aidlc-turbo mr-description.md, the update flow', () => {
  const skill = readFileSync(path.join(FLOW, 'skills/construction/mr-description.md'), 'utf8');
  const steps = skill.slice(skill.indexOf('## Process'));
  const update = steps.split('\n').filter((l) => /^\s*- \*\*Update\*\*/.test(l)).join('\n');

  it('patches one section at a time, with the sha on the last one, and never writes the whole text', () => {
    expect(update).toContain('mr-describe.cjs patch --url {url} --section "{heading}" --body-file {file}');
    expect(update).toContain('--synced {full-head-sha}');
    expect(update).toContain('--line "Link to the world" --text "{link}" --jira ok');
    expect(update).toContain('--line "Documentation" --text "{link}"');
    expect(update).toContain('A section the delta does not touch is never sent.');
    expect(update).toContain('No section needs a change: write nothing at all, not even the marker');
    expect(update).toContain('**Never delete or rewrite a sentence the delta doesn\'t contradict**');
    expect(update).not.toMatch(/mr-describe\.cjs write/);
    expect(update).toContain('Never `write` on an update, never the whole text.');
  });

  it('writes the whole text only to create it or to add the missing sections of a hand-written one', () => {
    const write = steps.split('\n').filter((l) => l.includes('mr-describe.cjs write'));
    expect(write).toHaveLength(1);
    expect(write[0]).toMatch(/^\s*- \*\*Create\*\* and \*\*Hand-written\*\*/);
    expect(steps).toContain('`description written`, `description updated`, `description unchanged`');
  });
});
