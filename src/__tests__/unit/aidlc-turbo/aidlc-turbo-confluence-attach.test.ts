/**
 * Unit tests for confluence-attach.cjs of the AI-DLC Turbo flow. The REST
 * boundary is a fake transport that records every request; nothing reaches a
 * network.
 * - check reads the attachment list only and writes nothing;
 * - upload sends one PUT that creates the attachment or adds a version, never
 *   retried, reads it back, then splices the overview section (the
 *   `overview_section` page name, default `Interactive overview`) into the
 *   live body of the documentation page: a plain download link per .html
 *   attachment, each intent's overview (`overview-{slug}.html`) first, then
 *   any other name. The section always sits at the very top of the body, and
 *   the rest of the body stays byte for byte. An identical section writes
 *   nothing;
 * - upload --if-missing leaves a file that is already on the page alone;
 * - links only splices the section from the page's current attachments;
 * - there is no download command: nothing in the flow reaches one;
 * - no credentials is a failure that names both variables, before any call;
 * - a usage error prints one JSON object and exits 2;
 * - credentials resolve per key: the environment, then the project root's
 *   .env (CLAUDE_PROJECT_DIR, else the working directory), then
 *   ~/.claude/.env;
 * - there is no default site: ATLASSIAN_SITE names it, else the host of the
 *   project's own Jira or Confluence link; without either nothing is called.
 *
 * The words of the section (its heading, its one line and the text after an
 * overview) belong to lib/overview-section.cjs; these tests take them from
 * there.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const SCRIPT = path.join(FLOW, 'scripts/confluence-attach.cjs');
const req = createRequire(import.meta.url);
const ca = req(SCRIPT);
const ov = req(path.join(FLOW, 'scripts/lib/overview-section.cjs'));

const CREDS = ['me@example.com', 'secret'];
const BASE = 'https://example.atlassian.net/wiki';
const DOWNLOAD = `${BASE}/download/attachments/7`;
const HEAD = `<h2>${ov.HEADING}</h2>`;
/** The section's one line, as the section module writes it. */
const INTRO = (ca.section('example.atlassian.net', '7', ['x.html']).match(/<p>[\s\S]*?<\/p>/) ?? [''])[0];
const OVERVIEW = ov.OVERVIEW;
/** The page's own content: a status block and h3/h4 sections, as a real documentation page has. */
const PAGE = '<h2>Status of this intent</h2><p>In the inception.</p>\n'
  + '<h3>Goal</h3><p>Pay with a gift card.</p><h4>Scope</h4><ul><li>web</li></ul>';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'confluence-attach-'));
  dirs.push(d);
  return d;
};

type Req = { method: string; url: string; headers: Record<string, string>; body: Buffer | null };
type Res = { status: number; headers?: Record<string, string>; body?: string | Buffer };

function att(id: string, name: string, size = 10, version = 1) {
  return {
    id, title: name, extensions: { fileSize: size }, version: { number: version },
    _links: { download: `/download/attachments/7/${name}` },
  };
}

/** One list item of the section, as the script writes it for page 7. */
const li = (name: string, note = '') =>
  `<li><a href="${DOWNLOAD}/${encodeURIComponent(name)}"><strong>${name}</strong></a>${note ? `: ${note}` : ''}</li>`;
const sectionOf = (...items: string[]) => [HEAD, INTRO, '<ul>', ...items, '</ul>'].join('');

/**
 * Answers attachment listings from `listing`, the page from `page` (title,
 * version and storage body `body`); records every request. `error` fails
 * every call, `bodyError` only the page body update.
 */
function fakeTransport(opts: {
  listing?: ReturnType<typeof att>[];
  error?: number;
  bodyError?: number;
  body?: string;
  page?: object;
} = {}) {
  const requests: Req[] = [];
  const page = opts.page ?? {
    title: 'Gift cards & Vouchers - Documentation', version: { number: 4 },
    body: { storage: { value: opts.body ?? PAGE, representation: 'storage' } },
  };
  const transport = async (req: Req): Promise<Res> => {
    requests.push(req);
    if (opts.error) return { status: opts.error, body: '' };
    const attachments = req.url.includes('/child/attachment');
    if (req.method === 'PUT' && !attachments && opts.bodyError) return { status: opts.bodyError, body: '' };
    if (req.method === 'PUT') return { status: 200, body: '{}' };
    if (attachments) {
      const name = new URL(req.url).searchParams.get('filename');
      const results = (opts.listing ?? []).filter((a) => name === null || a.title === name);
      return { status: 200, body: JSON.stringify({ results }) };
    }
    if (req.url.includes('/rest/api/content/')) return { status: 200, body: JSON.stringify(page) };
    return { status: 404, body: '' };
  };
  return { requests, transport };
}

const client = (transport: unknown) => new ca.Client(CREDS, 'example.atlassian.net', transport);
const bodyPuts = (requests: Req[]) => requests.filter((r) => r.method === 'PUT' && !r.url.includes('/child/attachment'));
const attachmentPuts = (requests: Req[]) => requests.filter((r) => r.method === 'PUT' && r.url.includes('/child/attachment'));
const sentBody = (r: Req) => JSON.parse(r.body!.toString('utf8'));
const sentStorage = (requests: Req[]) => sentBody(bodyPuts(requests)[0]).body.storage.value;

function htmlFile(name = 'overview-gift-cards.html', text = '<html></html>') {
  const file = path.join(tmp(), name);
  writeFileSync(file, text);
  return file;
}

/** main() with injected credentials and transport; returns the exit code and the one JSON object. */
async function runMain(argv: string[], deps: { creds?: string[] | null; transport?: unknown; env?: object; cwd?: string } = {}) {
  const lines: string[] = [];
  const creds = deps.creds === undefined ? CREDS : deps.creds;
  const env: Record<string, string> = { ATLASSIAN_SITE: 'example.atlassian.net', ...(deps.env ?? {}) };
  if (creds) Object.assign(env, { ATLASSIAN_EMAIL: creds[0], ATLASSIAN_API_TOKEN: creds[1] });
  const code = await ca.main(argv, {
    env, home: tmp(), cwd: deps.cwd ?? tmp(),
    transport: deps.transport ?? fakeTransport().transport,
    print: (text: string) => lines.push(text),
  });
  expect(lines).toHaveLength(1);
  return { code, result: JSON.parse(lines[0]) };
}

describe('confluence-attach helpers', () => {
  it('builds a multipart body with the file and a minor edit', () => {
    const { body, ctype } = ca.multipart('overview-gift-cards.html', Buffer.from('<p>x</p>'));
    const boundary = ctype.split('boundary=')[1];
    expect(ctype.startsWith('multipart/form-data; boundary=')).toBe(true);
    const text = body.toString('utf8');
    expect(text).toContain('filename="overview-gift-cards.html"');
    expect(text).toContain('Content-Type: text/html');
    expect(text).toContain('<p>x</p>');
    expect(text).toContain('name="minorEdit"\r\n\r\ntrue');
    expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true);
  });

  it('refuses a name with a folder part', () => {
    expect(ca.safeName('overview-gift-cards.html')).toBe(true);
    for (const bad of ['', '.', '..', '../x.html', 'a/b.html', 'a\\b.html']) expect(ca.safeName(bad)).toBe(false);
  });

  it('has no download command any more', () => {
    expect(ca.download).toBeUndefined();
    expect(ca.parseArgs(['download', '--page', '7', '--dest', 'x']).error).toMatch(/unknown command/);
  });

  it('hands the project page names to the section', () => {
    expect(ca.sectionOptions()).toEqual({ heading: 'Interactive overview', overviewFile: 'overview-{slug}.html' });
    expect(ca.sectionOptions({ overview_section: 'Shop overview', overview_file: 'shop-{slug}.html' }))
      .toEqual({ heading: 'Shop overview', overviewFile: 'shop-{slug}.html' });
  });
});

describe('confluence-attach the overview section', () => {
  it('is one string, no newlines: the heading, one line, and a plain download link per .html attachment', () => {
    const text = ca.section('example.atlassian.net', '7', ['overview-gift-cards.html']);
    expect(text).not.toContain('\n');
    expect(text).toBe(sectionOf(li('overview-gift-cards.html', OVERVIEW)));
    expect(INTRO).toMatch(/^<p>.+<\/p>$/);
  });

  it('lists each intent overview first, then any other page alphabetically, and no other file type', () => {
    const names = ['zz.html', 'overview-order-status.html', 'extra.html', 'overview-gift-cards.html', 'sketch.png'];
    expect(ca.section('example.atlassian.net', '7', names)).toBe(sectionOf(
      li('overview-gift-cards.html', OVERVIEW), li('overview-order-status.html', OVERVIEW), li('extra.html'), li('zz.html'),
    ));
  });

  it('escapes the name in the text and encodes it in the link, on the given site', () => {
    expect(ca.section('other.atlassian.net', '9', ['a"&b c.html'])).toContain(
      '<li><a href="https://other.atlassian.net/wiki/download/attachments/9/a%22%26b%20c.html"><strong>a&quot;&amp;b c.html</strong></a></li>',
    );
    expect(ca.section('other.atlassian.net', '9', ["it's.html"])).toContain(
      `<a href="https://other.atlassian.net/wiki/download/attachments/9/it's.html"><strong>it&#x27;s.html</strong></a></li>`,
    );
  });

  it('is empty without a .html attachment', () => {
    expect(ca.section('example.atlassian.net', '7', [])).toBe('');
    expect(ca.section('example.atlassian.net', '7', ['sketch.png'])).toBe('');
  });

  const NEW = sectionOf(li('overview-gift-cards.html', OVERVIEW));
  const OLD = sectionOf(li('extra.html'));

  it('goes at the very top of a body without one, above the status block, the rest byte for byte', () => {
    expect(ca.splice(PAGE, NEW)).toBe(NEW + PAGE);
    expect(ca.splice('', NEW)).toBe(NEW);
  });

  it('is replaced in place at the top, with only h3 and h4 after it, the rest byte for byte', () => {
    const rest = '\n<h3>Goal</h3><p>One</p>\n<h4>Detail</h4><ul><li>two</li></ul><p>three</p>';
    expect(ca.splice(OLD + rest, NEW)).toBe(NEW + rest);
  });

  it('is cut out anywhere else and put at the top, the rest byte for byte', () => {
    const before = '<h2>Status of this intent</h2><p>Done.</p>\n';
    const after = '\n<h3>Goal</h3><p>One</p>';
    expect(ca.splice(before + OLD + after, NEW)).toBe(NEW + before + after);
    expect(ca.splice(before + NEW + after, NEW)).toBe(NEW + before + after);
  });

  it('ends at its first </ul>, else right before the next heading of any level, else at the end of the body', () => {
    const mangled = `${HEAD}<p>links</p>`;
    expect(ca.splice(`${mangled}<h4>Detail</h4><ul><li>x</li></ul>`, NEW)).toBe(`${NEW}<h4>Detail</h4><ul><li>x</li></ul>`);
    expect(ca.splice(`<p>a</p>${mangled}`, NEW)).toBe(`${NEW}<p>a</p>`);
    expect(ca.splice(`${HEAD}<ul><li>a</li></ul><ul><li>b</li></ul>`, NEW)).toBe(`${NEW}<ul><li>b</li></ul>`);
  });

  it('finds the heading by its exact text, attributes, spaces and inner tags allowed, and no other h2', () => {
    expect(ca.splice(`<h2 local-id="x"><strong>${ov.HEADING}</strong></h2><ul><li>a</li></ul><p>b</p>`, NEW)).toBe(`${NEW}<p>b</p>`);
    expect(ca.splice(`<p>a</p><h2 id="io"> ${ov.HEADING} </h2><ul><li>a</li></ul>`, NEW)).toBe(`${NEW}<p>a</p>`);
    const other = `<h2>${ov.HEADING} of something</h2><ul><li>a</li></ul>`;
    expect(ca.splice(other, NEW)).toBe(NEW + other);
  });

  it('handles only the first section when the body holds two: the second stays where it is', () => {
    expect(ca.splice(`${OLD}<p>a</p>${OLD}<p>b</p>`, NEW)).toBe(`${NEW}<p>a</p>${OLD}<p>b</p>`);
    expect(ca.splice(`${NEW}<p>a</p>${OLD}<p>b</p>`, NEW)).toBeNull();
    expect(ca.splice(`<p>a</p>${OLD}<p>b</p>${OLD}`, '')).toBe(`<p>a</p><p>b</p>${OLD}`);
  });

  it('changes nothing when the section at the top is already identical, whitespace between tags aside', () => {
    expect(ca.splice(NEW + PAGE, NEW)).toBeNull();
    expect(ca.splice(NEW.replace(/></g, '>\n  <') + PAGE, NEW)).toBeNull();
    expect(ca.splice(`\n${NEW}${PAGE}`, NEW)).toBeNull();
  });

  it('is removed without a .html attachment, and nothing changes when there is none', () => {
    expect(ca.splice(OLD + PAGE, '')).toBe(PAGE);
    expect(ca.splice(`<p>a</p>${OLD}<p>b</p>`, '')).toBe('<p>a</p><p>b</p>');
    expect(ca.splice(PAGE, '')).toBeNull();
  });
});

describe('confluence-attach check', () => {
  it('reads the listing and writes nothing', async () => {
    const fake = fakeTransport({ listing: [att('a1', 'overview-gift-cards.html')] });
    const result = await ca.check(client(fake.transport), '7');
    expect(result).toEqual({ ok: true, detail: 'page 7 reachable', attachments: ['overview-gift-cards.html'] });
    expect(fake.requests.map((r) => r.method)).toEqual(['GET']);
    expect(fake.requests[0].headers.Authorization).toBe(`Basic ${Buffer.from('me@example.com:secret').toString('base64')}`);
  });

  it('reports a missing page as an HTTP failure', async () => {
    const { code, result } = await runMain(['check', '--page', '7'], { transport: fakeTransport({ error: 404 }).transport });
    expect({ code, result }).toEqual({ code: 1, result: { ok: false, detail: 'HTTP 404' } });
  });
});

describe('confluence-attach upload', () => {
  const NAME = 'overview-gift-cards.html';

  it('puts a new attachment once, reads it back, then splices the section into the live body', async () => {
    const fake = fakeTransport({ listing: [att('att9', NAME, 13, 1)] });
    const result = await ca.upload(client(fake.transport), '7', htmlFile(), NAME);
    expect(result).toEqual({ ok: true, detail: 'uploaded, page links updated', id: 'att9', name: NAME, size: 13, version: 1 });
    const [put, readBack, page, listing, body] = fake.requests;
    expect(fake.requests).toHaveLength(5);
    expect([put.method, put.url]).toEqual(['PUT', `${BASE}/rest/api/content/7/child/attachment`]);
    expect(put.headers['X-Atlassian-Token']).toBe('no-check');
    expect(put.headers.Authorization.startsWith('Basic ')).toBe(true);
    expect(put.body!.toString('utf8')).toContain(`filename="${NAME}"`);
    expect([readBack.method, new URL(readBack.url).searchParams.get('filename')]).toEqual(['GET', NAME]);
    expect([page.method, page.url]).toEqual(['GET', `${BASE}/rest/api/content/7?expand=body.storage,version`]);
    expect([listing.method, new URL(listing.url).searchParams.get('filename')]).toEqual(['GET', null]);
    expect([body.method, body.url]).toEqual(['PUT', `${BASE}/rest/api/content/7`]);
  });

  it('writes the next version as a minor edit, keeps the title, and leaves the rest of the body byte for byte', async () => {
    const fake = fakeTransport({ listing: [att('att9', NAME), att('a2', 'extra.html'), att('a3', 'sketch.png')] });
    await ca.upload(client(fake.transport), '7', htmlFile(), NAME);
    const puts = bodyPuts(fake.requests);
    expect(puts).toHaveLength(1);
    expect(puts[0].headers['Content-Type']).toBe('application/json');
    const sent = sentBody(puts[0]);
    expect(sent.version).toEqual({ number: 5, minorEdit: true });
    expect([sent.id, sent.type, sent.title]).toEqual(['7', 'page', 'Gift cards & Vouchers - Documentation']);
    expect(sent.body.storage.representation).toBe('storage');
    expect(sent.body.storage.value).toBe(sectionOf(li(NAME, OVERVIEW), li('extra.html')) + PAGE);
  });

  it('never writes a Confluence attachment macro: the sync reads the page as markdown', async () => {
    const fake = fakeTransport({ listing: [att('att9', NAME)] });
    await ca.upload(client(fake.transport), '7', htmlFile(), NAME);
    expect(sentStorage(fake.requests)).not.toContain('ri:attachment');
  });

  it('writes no body when the section is already what it should be', async () => {
    const body = sectionOf(li(NAME, OVERVIEW)) + PAGE;
    const fake = fakeTransport({ listing: [att('att9', NAME, 13, 2)], body });
    const result = await ca.upload(client(fake.transport), '7', htmlFile(), NAME);
    expect([result.ok, result.detail]).toEqual([true, 'uploaded, page links already up to date']);
    expect(bodyPuts(fake.requests)).toEqual([]);
  });

  it('writes nothing over a page that came back without its body', async () => {
    const fake = fakeTransport({ listing: [att('att9', NAME)], page: { title: 'Gift cards - Documentation', version: { number: 4 } } });
    const result = await ca.upload(client(fake.transport), '7', htmlFile(), NAME);
    expect(result.ok).toBe(false);
    expect(result.detail).toBe('uploaded, but the links on the page were not updated (page 7 came back without its body, nothing written)');
    expect(bodyPuts(fake.requests)).toEqual([]);
  });

  it('adds a new version with the same single PUT when the page already has the file', async () => {
    const fake = fakeTransport({ listing: [att('att9', NAME, 20, 3), att('a2', 'extra.html')] });
    const result = await ca.upload(client(fake.transport), '7', htmlFile(), NAME);
    expect([result.ok, result.id, result.version]).toEqual([true, 'att9', 3]);
    expect(attachmentPuts(fake.requests)).toHaveLength(1);
    expect(fake.requests.some((r) => r.method === 'POST' || r.method === 'DELETE')).toBe(false);
  });

  it('with --if-missing leaves a file that is already on the page alone, and sends nothing', async () => {
    const fake = fakeTransport({ listing: [att('a2', 'extra.html', 30, 2)] });
    const result = await ca.upload(client(fake.transport), '7', htmlFile('extra.html'), 'extra.html', { ifMissing: true });
    expect(result).toEqual({ ok: true, detail: 'already on the page, not uploaded', id: 'a2', name: 'extra.html', size: 30, version: 2 });
    expect(fake.requests.map((r) => r.method)).toEqual(['GET']);
  });

  it('with --if-missing uploads a file the page does not have yet', async () => {
    let uploaded = false;
    const inner = fakeTransport({ listing: [att('a2', 'extra.html')] });
    const transport = async (req: Req) => {
      if (req.method === 'PUT' && req.url.includes('/child/attachment')) uploaded = true;
      if (!uploaded && req.url.includes('/child/attachment') && req.method === 'GET') {
        inner.requests.push(req);
        return { status: 200, body: JSON.stringify({ results: [] }) };
      }
      return inner.transport(req);
    };
    const { code, result } = await runMain(
      ['upload', '--page', '7', '--file', htmlFile('extra.html'), '--if-missing'], { transport },
    );
    expect([code, result.detail]).toEqual([0, 'uploaded, page links updated']);
    expect(attachmentPuts(inner.requests)).toHaveLength(1);
  });

  it('fails when the file is not on the page after the upload, and leaves the body alone', async () => {
    const fake = fakeTransport({ listing: [] });
    const result = await ca.upload(client(fake.transport), '7', htmlFile(), NAME);
    expect(result).toEqual({ ok: false, detail: `${NAME} is not on page 7 after the upload` });
    expect(bodyPuts(fake.requests)).toEqual([]);
    expect(fake.requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
  });

  it('never sends an empty file', async () => {
    const fake = fakeTransport();
    const result = await ca.upload(client(fake.transport), '7', htmlFile(NAME, ''), NAME);
    expect(result.ok).toBe(false);
    expect(fake.requests).toEqual([]);
  });

  it('reports a failed body update after the upload, never retrying the upload', async () => {
    const fake = fakeTransport({ listing: [att('att9', NAME, 13, 2)], bodyError: 409 });
    const result = await ca.upload(client(fake.transport), '7', htmlFile(), NAME);
    expect(result.ok).toBe(false);
    expect(result.detail).toBe('uploaded, but the links on the page were not updated (HTTP 409)');
    expect([result.name, result.version]).toEqual([NAME, 2]);
    expect(fake.requests.filter((r) => r.url.endsWith('/child/attachment'))).toHaveLength(1);
  });

  it('a failed attachment PUT is one call and exit 1', async () => {
    const fake = fakeTransport({ error: 500 });
    const { code, result } = await runMain(['upload', '--page', '7', '--file', htmlFile()], { transport: fake.transport });
    expect({ code, result }).toEqual({ code: 1, result: { ok: false, detail: 'HTTP 500' } });
    expect(fake.requests).toHaveLength(1);
  });

  it('names the attachment after the file unless --name is given, and refuses a path as name', async () => {
    const fake = fakeTransport({ listing: [att('a', 'plan.html')] });
    const file = htmlFile('plan.html');
    expect((await runMain(['upload', '--page', '7', '--file', file], { transport: fake.transport })).code).toBe(0);
    expect(attachmentPuts(fake.requests)[0].body!.toString('utf8')).toContain('filename="plan.html"');
    const refused = await runMain(['upload', '--page', '7', '--file', file, '--name', '../x.html']);
    expect(refused.code).toBe(1);
    expect(refused.result.detail).toContain('refused');
  });
});

describe('confluence-attach links', () => {
  it('splices the section from the current attachments and uploads nothing', async () => {
    const fake = fakeTransport({ listing: [att('b', 'extra.html'), att('a', 'overview-gift-cards.html')] });
    const { code, result } = await runMain(['links', '--page', '7'], { transport: fake.transport });
    expect(code).toBe(0);
    expect(result).toEqual({ ok: true, detail: 'page links updated', attachments: ['overview-gift-cards.html', 'extra.html'] });
    expect(attachmentPuts(fake.requests)).toEqual([]);
    expect(sentStorage(fake.requests)).toBe(sectionOf(li('overview-gift-cards.html', OVERVIEW), li('extra.html')) + PAGE);
  });

  it('puts back a section the sync push mangled, below the status block', async () => {
    const mangled = `<h2>Status of this intent</h2><p>Done.</p>${HEAD}<p>Click a file</p>`
      + '<ul><li><p><a href="x">overview-gift-cards.html</a></p></li></ul><h3>Goal</h3><p>One</p>';
    const fake = fakeTransport({ listing: [att('b', 'overview-gift-cards.html')], body: mangled });
    await ca.links(client(fake.transport), '7');
    expect(sentStorage(fake.requests)).toBe(
      `${sectionOf(li('overview-gift-cards.html', OVERVIEW))}<h2>Status of this intent</h2><p>Done.</p><h3>Goal</h3><p>One</p>`,
    );
  });

  it('writes nothing when the section is already right, or when there is nothing to list and no section', async () => {
    const same = fakeTransport({ listing: [att('b', 'extra.html')], body: sectionOf(li('extra.html')) + PAGE });
    expect(await ca.links(client(same.transport), '7'))
      .toEqual({ ok: true, detail: 'page links already up to date', attachments: ['extra.html'] });
    expect(bodyPuts(same.requests)).toEqual([]);
    const none = fakeTransport({ listing: [att('p', 'sketch.png')] });
    expect((await ca.links(client(none.transport), '7')).attachments).toEqual([]);
    expect(bodyPuts(none.requests)).toEqual([]);
  });

  it('removes the section when the page has no .html attachment left', async () => {
    const fake = fakeTransport({ listing: [], body: sectionOf(li('extra.html')) + PAGE });
    await ca.links(client(fake.transport), '7');
    expect(sentStorage(fake.requests)).toBe(PAGE);
  });
});

describe('confluence-attach credentials and usage', () => {
  it('fails without credentials, naming both variables, before any call', async () => {
    const fake = fakeTransport();
    const { code, result } = await runMain(['check', '--page', '7'], { creds: null, transport: fake.transport });
    expect(code).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('ATLASSIAN_EMAIL');
    expect(result.detail).toContain('ATLASSIAN_API_TOKEN');
    expect(fake.requests).toEqual([]);
  });

  it.each([
    [[], 'no command given'],
    [['delete', '--page', '7'], 'unknown command'],
    [['download', '--page', '7', '--dest', 'x'], 'unknown command'],
    [['check'], 'check needs --page'],
    [['links'], 'links needs --page'],
    [['upload', '--page', '7'], 'upload needs --file'],
    [['check', '--page'], '--page needs a value'],
    [['check', '--page', '--file', 'x'], '--page needs a value'],
    [['check', '--page', '7', '--file', 'x'], 'check takes no --file'],
    [['links', '--page', '7', '--file', 'x'], 'links takes no --file'],
    [['links', '--page', '7', '--if-missing'], 'links takes no --if-missing'],
    [['upload', '--page', '7', '--file', 'x', '--if-missing=yes'], '--if-missing takes no value'],
    [['check', '--page', '7', 'extra'], 'unexpected argument'],
  ])('%j is a usage error', async (argv, why) => {
    const fake = fakeTransport();
    const { code, result } = await runMain(argv as string[], { transport: fake.transport });
    expect(code).toBe(2);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain(why);
    expect(result.detail).toContain('usage: confluence-attach.cjs');
    expect(fake.requests).toEqual([]);
  });

  it('takes --flag=value too, and --if-missing as a bare flag', () => {
    expect(ca.parseArgs(['upload', '--page=7', '--file=out.html', '--name=x.html']))
      .toEqual({ cmd: 'upload', page: '7', file: 'out.html', name: 'x.html' });
    expect(ca.parseArgs(['upload', '--if-missing', '--page', '7', '--file', 'f.html']))
      .toEqual({ cmd: 'upload', page: '7', file: 'f.html', 'if-missing': true });
    expect(ca.parseArgs(['links', '--page', '7'])).toEqual({ cmd: 'links', page: '7' });
  });

  it('reads the environment first, then the project .env, then ~/.claude/.env, per key', () => {
    const home = tmp();
    const cwd = tmp();
    mkdirSync(path.join(home, '.claude'));
    writeFileSync(path.join(home, '.claude', '.env'),
      'ATLASSIAN_EMAIL=home@example.com\nATLASSIAN_API_TOKEN=home-token\nATLASSIAN_SITE=home.atlassian.net\n');
    writeFileSync(path.join(cwd, '.env'), '# keys\nexport ATLASSIAN_EMAIL="cwd@example.com"\nATLASSIAN_API_TOKEN=\'cwd-token\'\n');
    const lookup = (env: object) => ca.envLookup({ env, home, cwd });
    expect(ca.credentials(lookup({}))).toEqual(['cwd@example.com', 'cwd-token']);
    expect(ca.credentials(lookup({ ATLASSIAN_API_TOKEN: 'env-token' }))).toEqual(['cwd@example.com', 'env-token']);
    expect(ca.credentials(lookup({ ATLASSIAN_EMAIL: '', ATLASSIAN_API_TOKEN: 'env-token' }))).toEqual(['cwd@example.com', 'env-token']);
    expect(lookup({})('ATLASSIAN_SITE')).toBe('home.atlassian.net');
    rmSync(path.join(cwd, '.env'));
    expect(ca.credentials(lookup({}))).toEqual(['home@example.com', 'home-token']);
    rmSync(path.join(home, '.claude', '.env'));
    expect(ca.credentials(lookup({}))).toBeNull();
  });

  it('takes the project root from CLAUDE_PROJECT_DIR, else the working directory', () => {
    const home = tmp();
    const cwd = tmp();
    const project = tmp();
    writeFileSync(path.join(cwd, '.env'), 'ATLASSIAN_EMAIL=cwd@example.com\nATLASSIAN_API_TOKEN=cwd-token\n');
    writeFileSync(path.join(project, '.env'), 'ATLASSIAN_EMAIL=project@example.com\nATLASSIAN_API_TOKEN=project-token\n');
    expect(ca.projectRoot({ env: { CLAUDE_PROJECT_DIR: project }, cwd })).toBe(path.resolve(project));
    expect(ca.projectRoot({ env: { CLAUDE_PROJECT_DIR: '' }, cwd })).toBe(path.resolve(cwd));
    expect(ca.credentials(ca.envLookup({ env: { CLAUDE_PROJECT_DIR: project }, home, cwd })))
      .toEqual(['project@example.com', 'project-token']);
    expect(ca.credentials(ca.envLookup({ env: {}, home, cwd }))).toEqual(['cwd@example.com', 'cwd-token']);
  });

  it('strips quotes from a value', () => {
    expect(ca.parseEnvFile('A="x"\nB=\'y\'\nC="\'z\'"\nD=plain # not a comment\n'))
      .toEqual({ A: 'x', B: 'y', C: 'z', D: 'plain # not a comment' });
  });

  it('uses ATLASSIAN_SITE for every call, else the site of the project\'s own link, and has no default site', async () => {
    const fake = fakeTransport();
    await runMain(['check', '--page', '7'], { transport: fake.transport, env: { ATLASSIAN_SITE: 'other.atlassian.net' } });
    expect(fake.requests[0].url.startsWith('https://other.atlassian.net/wiki/rest/api/content/7/child/attachment?')).toBe(true);

    // No ATLASSIAN_SITE: the Jira board link in the config names the site.
    const project = tmp();
    mkdirSync(path.join(project, '.specs-aidlc-turbo', 'repo'), { recursive: true });
    writeFileSync(path.join(project, '.specs-aidlc-turbo', 'repo', 'config.yaml'),
      'mode: production\nsync:\n  issues: jira\n  jira_project_url: "https://board.atlassian.net/jira/software/projects/SHOP/boards/1"\n');
    const linked = fakeTransport();
    await runMain(['check', '--page', '7'], { transport: linked.transport, env: { ATLASSIAN_SITE: '' }, cwd: project });
    expect(linked.requests[0].url.startsWith('https://board.atlassian.net/wiki/rest/api/content/7/child/attachment?')).toBe(true);

    // A Confluence page link in an inception's sync.yaml does too.
    const pages = tmp();
    mkdirSync(path.join(pages, '.specs-aidlc-turbo', 'docs', 'user-auth'), { recursive: true });
    writeFileSync(path.join(pages, '.specs-aidlc-turbo', 'docs', 'user-auth', 'sync.yaml'),
      'confluence:\n  documentation:\n    url: "https://wiki.atlassian.net/wiki/spaces/SHOP/pages/7/Login+-+Documentation"\n    page_id: "7"\n');
    const synced = fakeTransport();
    await runMain(['check', '--page', '7'], { transport: synced.transport, env: { ATLASSIAN_SITE: '' }, cwd: pages });
    expect(synced.requests[0].url.startsWith('https://wiki.atlassian.net/wiki/')).toBe(true);

    // Neither: nothing is called, and the result says how to name the site.
    const none = fakeTransport();
    const { code, result } = await runMain(['check', '--page', '7'], { transport: none.transport, env: { ATLASSIAN_SITE: '' } });
    expect([code, result.ok]).toEqual([1, false]);
    expect(result.detail).toBe(ca.NO_SITE);
    expect(result.detail).toMatch(/ATLASSIAN_SITE/);
    expect(result.detail).toMatch(/jira_project_url/);
    expect(none.requests).toHaveLength(0);
    expect(ca.DEFAULT_SITE).toBeUndefined();
  });

  it('links to the download address on ATLASSIAN_SITE', async () => {
    const fake = fakeTransport({ listing: [att('b', 'extra.html')] });
    await runMain(['links', '--page', '7'], { transport: fake.transport, env: { ATLASSIAN_SITE: 'other.atlassian.net' } });
    expect(sentStorage(fake.requests)).toContain('<a href="https://other.atlassian.net/wiki/download/attachments/7/extra.html">');
  });

  it('prints one JSON line from the command line, with exit 1 without credentials and 2 on a usage error', () => {
    const home = tmp();
    const env = { PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home };
    const none = spawnSync(process.execPath, [SCRIPT, 'check', '--page', '7'], { cwd: tmp(), env, encoding: 'utf8' });
    expect(none.status).toBe(1);
    expect(none.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(none.stdout).detail).toContain('ATLASSIAN_API_TOKEN');
    const usage = spawnSync(process.execPath, [SCRIPT], { cwd: tmp(), env, encoding: 'utf8' });
    expect(usage.status).toBe(2);
    expect(JSON.parse(usage.stdout).ok).toBe(false);
  });
});
