/**
 * Unit tests for jira-attach.cjs of the AI-DLC Turbo flow: the approved
 * overview onto the intent's epic, with the artifact link as a web link. The
 * REST boundary is a fake transport that records every request; nothing
 * reaches a network.
 * - upload attaches first and only then removes the older copies with the
 *   same name, so the issue is never without one; it reads the new one back;
 * - --link adds a web link with a fixed global id, so a second run updates it;
 * - a failed link or a failed removal is a failure that keeps the upload's row;
 * - no credentials is a failure before any call, and so is no site: there is
 *   no default one;
 * - a usage error prints one JSON object and exits 2.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const ja = createRequire(import.meta.url)(path.join(FLOW, 'scripts/jira-attach.cjs'));

const API = 'https://example.atlassian.net/rest/api/3';
const ART = 'https://claude.ai/code/artifact/0b1c';
const lookup = (values: Record<string, string> = { ATLASSIAN_EMAIL: 'me@example.com', ATLASSIAN_API_TOKEN: 'secret', ATLASSIAN_SITE: 'example.atlassian.net' }) =>
  (key: string) => values[key] || null;

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
function page(text = '<html>overview</html>') {
  const d = mkdtempSync(path.join(tmpdir(), 'jira-attach-'));
  dirs.push(d);
  const file = path.join(d, 'overview.html');
  writeFileSync(file, text);
  return file;
}

type Req = { method: string; url: string; headers: Record<string, string>; body: Buffer | null };

/** A fake Jira issue: its attachments change with every POST and DELETE. */
function fakeJira(start: { id: string; filename: string; size: number }[] = [], fail: Record<string, number> = {}) {
  const reqs: Req[] = [];
  let atts = [...start];
  let next = 900;
  const transport = async (req: Req) => {
    reqs.push(req);
    const status = fail[`${req.method} ${req.url.replace(API, '')}`];
    if (status) return { status };
    if (req.method === 'GET') return { status: 200, body: JSON.stringify({ fields: { attachment: atts } }) };
    if (req.url.endsWith('/attachments')) {
      const name = /filename="([^"]+)"/.exec(String(req.body))![1];
      atts.push({ id: String(next++), filename: name, size: req.body!.length });
      return { status: 200, body: '[]' };
    }
    if (req.method === 'DELETE') {
      atts = atts.filter((a) => !req.url.endsWith(`/attachment/${a.id}`));
      return { status: 204 };
    }
    return { status: 201, body: '{}' };
  };
  return { reqs, transport, atts: () => atts };
}

const args = (extra: string[] = [], file = page()) =>
  ja.parseArgs(['upload', '--issue', 'SHOP-100', '--file', file, '--name', 'overview-user-auth.html', ...extra]);

describe('jira-attach upload', () => {
  it('attaches the file before it removes the older copy, and reads it back', async () => {
    const jira = fakeJira([{ id: '5', filename: 'overview-user-auth.html', size: 40 }, { id: '6', filename: 'other.pdf', size: 9 }]);
    const out = await ja.run(args(), { lookup: lookup(), transport: jira.transport });
    expect(out).toMatchObject({ ok: true, detail: 'uploaded', issue: 'SHOP-100', id: '900', name: 'overview-user-auth.html', link: null });
    expect(jira.reqs.map((r) => `${r.method} ${r.url.replace(API, '')}`)).toEqual([
      'GET /issue/SHOP-100?fields=attachment',
      'POST /issue/SHOP-100/attachments',
      'GET /issue/SHOP-100?fields=attachment',
      'DELETE /attachment/5',
    ]);
    expect(jira.reqs[1].headers['X-Atlassian-Token']).toBe('no-check');
    expect(jira.reqs[1].headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(String(jira.reqs[1].body)).toContain('<html>overview</html>');
    expect(jira.atts().map((a) => a.filename)).toEqual(['other.pdf', 'overview-user-auth.html']);
  });

  it('adds the artifact as a web link with a fixed global id', async () => {
    const jira = fakeJira();
    const out = await ja.run(args(['--link', ART]), { lookup: lookup(), transport: jira.transport });
    expect(out).toMatchObject({ ok: true, detail: 'uploaded, link added', link: ART });
    const last = jira.reqs[jira.reqs.length - 1];
    expect(`${last.method} ${last.url.replace(API, '')}`).toBe('POST /issue/SHOP-100/remotelink');
    expect(JSON.parse(String(last.body))).toEqual({
      globalId: 'aidlc-turbo:overview-user-auth.html',
      object: { url: ART, title: 'Interactive overview' },
    });
  });

  it('takes the link title from --title', async () => {
    const jira = fakeJira();
    await ja.run(args(['--link', ART, '--title', 'Login overview']), { lookup: lookup(), transport: jira.transport });
    expect(JSON.parse(String(jira.reqs[jira.reqs.length - 1].body)).object.title).toBe('Login overview');
  });

  it('fails when the file is not on the issue after the upload', async () => {
    const jira = fakeJira();
    const transport = async (req: Req) => (req.method === 'GET' ? { status: 200, body: '{"fields":{"attachment":[]}}' } : jira.transport(req));
    const out = await ja.run(args(), { lookup: lookup(), transport });
    expect(out).toEqual({ ok: false, detail: 'overview-user-auth.html is not on SHOP-100 after the upload' });
  });

  it('keeps the row when the old copy or the link could not be handled', async () => {
    const old = fakeJira([{ id: '5', filename: 'overview-user-auth.html', size: 40 }], { 'DELETE /attachment/5': 403 });
    expect(await ja.run(args(), { lookup: lookup(), transport: old.transport })).toMatchObject({
      ok: false, detail: 'uploaded, but an older overview-user-auth.html is still there (HTTP 403)', id: '900',
    });
    const link = fakeJira([], { 'POST /issue/SHOP-100/remotelink': 400 });
    expect(await ja.run(args(['--link', ART]), { lookup: lookup(), transport: link.transport })).toMatchObject({
      ok: false, detail: 'uploaded, but the link was not added (HTTP 400)', id: '900', link: null,
    });
  });

  it('refuses an empty file and a missing issue', async () => {
    const empty = fakeJira();
    expect(await ja.run(args([], page('')), { lookup: lookup(), transport: empty.transport })).toMatchObject({ ok: false });
    expect(empty.reqs).toEqual([]);
    const gone = fakeJira([], { 'GET /issue/SHOP-100?fields=attachment': 404 });
    expect(await ja.run(args(), { lookup: lookup(), transport: gone.transport })).toEqual({ ok: false, detail: 'HTTP 404' });
  });

  it('makes no call without credentials or without a site, and uses ATLASSIAN_SITE', async () => {
    const none = fakeJira();
    const out = await ja.run(args(), { lookup: lookup({}), transport: none.transport });
    expect(out.ok).toBe(false);
    expect(out.detail).toMatch(/ATLASSIAN_EMAIL \/ ATLASSIAN_API_TOKEN/);
    expect(none.reqs).toEqual([]);
    const site = fakeJira();
    await ja.run(args(), { lookup: lookup({ ATLASSIAN_EMAIL: 'a', ATLASSIAN_API_TOKEN: 'b', ATLASSIAN_SITE: 'x.atlassian.net' }), transport: site.transport });
    expect(site.reqs[0].url).toBe('https://x.atlassian.net/rest/api/3/issue/SHOP-100?fields=attachment');
    const nowhere = fakeJira();
    const lost = await ja.run(args(), { lookup: lookup({ ATLASSIAN_EMAIL: 'a', ATLASSIAN_API_TOKEN: 'b' }), transport: nowhere.transport });
    expect(lost.ok).toBe(false);
    expect(lost.detail).toMatch(/no Atlassian site known/);
    expect(nowhere.reqs).toEqual([]);
    const linked = fakeJira();
    const project = mkdtempSync(path.join(tmpdir(), 'jira-attach-'));
    dirs.push(project);
    mkdirSync(path.join(project, '.specs-aidlc-turbo', 'project'), { recursive: true });
    writeFileSync(path.join(project, '.specs-aidlc-turbo', 'project', 'project.yaml'),
      'jira_project_url: "https://board.atlassian.net/jira/software/projects/SHOP/boards/1"\n');
    await ja.run(args(), { lookup: lookup({ ATLASSIAN_EMAIL: 'a', ATLASSIAN_API_TOKEN: 'b' }), transport: linked.transport, root: project });
    expect(linked.reqs[0].url).toBe('https://board.atlassian.net/rest/api/3/issue/SHOP-100?fields=attachment');
  });
});

describe('jira-attach arguments', () => {
  it('defaults the name to the file name', () => {
    expect(ja.parseArgs(['upload', '--issue', 'SHOP-1', '--file', '/a/overview.html'])).toEqual({
      cmd: 'upload', issue: 'SHOP-1', file: '/a/overview.html', name: 'overview.html',
    });
  });

  it.each([
    [['upload', '--file', 'x.html'], 'upload needs --issue'],
    [['upload', '--issue', 'shop-1', '--file', 'x.html'], 'is not an issue key'],
    [['upload', '--issue', 'SHOP-1', '--file', 'x.html', '--link', 'http://a'], '--link needs an https URL'],
    [['upload', '--issue', 'SHOP-1', '--file', 'x.html', '--title', 'T'], '--title needs --link'],
    [['upload', '--issue', 'SHOP-1', '--file', 'x.html', '--page', '7'], 'upload takes no --page'],
    [['links'], 'unknown command'],
  ])('refuses %j', (argv, message) => {
    expect(ja.parseArgs(argv).error).toContain(message);
  });

  it('refuses a name with a folder in it', async () => {
    const out = await ja.run(args(['--name', '../x.html']), { lookup: lookup() });
    expect(out).toEqual({ ok: false, detail: 'refused attachment name "../x.html"' });
  });

  it('prints one JSON object and exits 2 on a usage error', async () => {
    const lines: string[] = [];
    expect(await ja.main(['upload'], { print: (t: string) => lines.push(t) })).toBe(2);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).ok).toBe(false);
  });
});
