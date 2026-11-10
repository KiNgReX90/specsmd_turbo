/**
 * Unit tests for the writers that put an intent's files on Confluence: they
 * target the intent's own documentation page.
 *
 * Every overview of an inception of several intents must land on the page of
 * its own intent, never on the one shared page of the inception:
 * - confluence-attach.cjs `upload --intent {slug}` and `links --intent {slug}`
 *   take the page from sync.yaml through intent-pages.cjs: the intent's own
 *   page, the inception's page only for an inception of one intent;
 * - an inception of several intents whose intent has no page of its own is
 *   refused before any call, so nothing lands on the shared page;
 * - exactly one of --page and --intent;
 * - the review skill attaches the intent's own overview page, overview.html,
 *   under the `overview_file` page name (default `overview-{slug}.html`): the
 *   upload names it so by itself, a project's own name wins, and --name still
 *   wins over both;
 * - without ATLASSIAN_SITE the site comes from the links under --root.
 * The REST boundary is a fake transport; nothing reaches a network.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const ca = req(path.join(FLOW, 'scripts/confluence-attach.cjs'));
const render = req(path.join(FLOW, 'scripts/lib/yaml-subset.cjs'));
const ov = req(path.join(FLOW, 'scripts/lib/overview-section.cjs'));

const made: string[] = [];
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'turbo-intent-writers-'));
  made.push(d);
  return d;
};

const INC = 'checkout';
const DOC = { url: 'https://example.atlassian.net/wiki/spaces/SHOP/pages/100/checkout+-+Documentation', page_id: '100', name: INC };
const PAGES = {
  'gift-cards': { url: 'https://example.atlassian.net/wiki/spaces/SHOP/pages/300', page_id: '300', name: 'gift-cards' },
  'order-status': { url: 'https://example.atlassian.net/wiki/spaces/SHOP/pages/400', page_id: '400', name: 'order-status' },
};

/** An artifact root with the given intent folders, the confluence block of sync.yaml and an optional config. */
function root(intents: string[], confluence: object, config?: string) {
  const r = path.join(tmp(), '.specs-aidlc-turbo');
  mkdirSync(path.join(r, 'repo'), { recursive: true });
  if (config) writeFileSync(path.join(r, 'repo', 'config.yaml'), config);
  for (const slug of intents) {
    mkdirSync(path.join(r, 'docs', INC, slug), { recursive: true });
    writeFileSync(path.join(r, 'docs', INC, slug, 'record.yaml'), render.dumpYaml({ intent: { slug, inception: INC, title: slug }, stories: [] }));
  }
  writeFileSync(path.join(r, 'docs', INC, 'sync.yaml'), render.dumpYaml({ confluence }));
  return r;
}

type Req = { method: string; url: string; body: Buffer | null };

/** Answers every listing with `names` (by name when asked), every page read with a plain page; records the requests. */
function fake(names = ['overview-order-status.html']) {
  const requests: Req[] = [];
  const transport = async (q: Req) => {
    requests.push(q);
    if (q.method === 'PUT') return { status: 200, body: '{}' };
    if (q.url.includes('/child/attachment')) {
      const asked = new URL(q.url).searchParams.get('filename');
      const results = names.filter((n) => asked === null || n === asked)
        .map((n, i) => ({ id: `att${i + 1}`, title: n, extensions: { fileSize: 9 }, version: { number: 1 }, _links: { download: '/x' } }));
      return { status: 200, body: JSON.stringify({ results }) };
    }
    return { status: 200, body: JSON.stringify({ title: 'x - Documentation', version: { number: 2 }, body: { storage: { value: '<p>x</p>', representation: 'storage' } } }) };
  };
  return { requests, transport };
}

async function runMain(argv: string[], transport: unknown, env: Record<string, string> = { ATLASSIAN_SITE: 'example.atlassian.net' }) {
  const lines: string[] = [];
  const code = await ca.main(argv, {
    env: { ATLASSIAN_EMAIL: 'me@example.com', ATLASSIAN_API_TOKEN: 'secret', ...env }, home: tmp(), cwd: tmp(),
    transport, print: (t: string) => lines.push(t),
  });
  expect(lines).toHaveLength(1);
  return { code, result: JSON.parse(lines[0]) };
}

const overview = () => {
  const f = path.join(tmp(), 'overview.html');
  writeFileSync(f, '<html></html>');
  return f;
};
const pagesHit = (requests: Req[]) => [...new Set(requests.map((q) => q.url.split('/rest/api/content/')[1]?.split(/[/?]/)[0]))];

describe('confluence-attach --intent: the intent own page', () => {
  it('uploads to the intent own page, and says which page', async () => {
    const r = root(['gift-cards', 'order-status'], { documentation: DOC, intents: PAGES, pages: [] });
    const { requests, transport } = fake();
    const { code, result } = await runMain(['upload', '--intent', 'order-status', '--file', overview(), '--root', r], transport);
    expect(code).toBe(0);
    expect(result).toMatchObject({ ok: true, page: '400', name: 'overview-order-status.html' });
    expect(pagesHit(requests)).toEqual(['400']);
  });

  it('uses the inception page for an inception of one intent', async () => {
    const r = root(['gift-cards'], { documentation: DOC, pages: [] });
    const { requests, transport } = fake(['overview-gift-cards.html']);
    const { code, result } = await runMain(['upload', '--intent', 'gift-cards', '--file', overview(), '--root', r], transport);
    expect(code).toBe(0);
    expect(result.page).toBe('100');
    expect(pagesHit(requests)).toEqual(['100']);
  });

  it('refuses the shared page of an inception with several intents, before any call', async () => {
    const r = root(['gift-cards', 'order-status'], { documentation: DOC, pages: [] });
    const { requests, transport } = fake();
    const { code, result } = await runMain(['upload', '--intent', 'order-status', '--file', overview(), '--root', r], transport);
    expect(code).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('intent-pages.cjs check --inception checkout');
    expect(requests).toEqual([]);
  });

  it('links --intent puts the section back on the intent own page', async () => {
    const r = root(['gift-cards', 'order-status'], { documentation: DOC, intents: PAGES, pages: [] });
    const { requests, transport } = fake();
    const { code } = await runMain(['links', '--intent', 'gift-cards', '--root', r], transport);
    expect(code).toBe(0);
    expect(pagesHit(requests)).toEqual(['300']);
  });

  it('takes the site from the links under --root when ATLASSIAN_SITE is not set', async () => {
    const r = root(['gift-cards'], { documentation: DOC, pages: [] });
    const { requests, transport } = fake(['overview-gift-cards.html']);
    const { code } = await runMain(['upload', '--intent', 'gift-cards', '--file', overview(), '--root', r], transport, {});
    expect(code).toBe(0);
    expect(requests[0].url.startsWith('https://example.atlassian.net/wiki/')).toBe(true);
  });

  it('takes exactly one of --page and --intent, and --root only with --intent', () => {
    expect(ca.parseArgs(['upload', '--file', 'f.html']).error).toMatch(/--page or --intent/);
    expect(ca.parseArgs(['upload', '--page', '1', '--intent', 'a', '--file', 'f.html']).error).toMatch(/--page or --intent/);
    expect(ca.parseArgs(['links', '--page', '1', '--root', 'r']).error).toMatch(/--root/);
    expect(ca.parseArgs(['upload', '--intent', 'a', '--file', 'f.html', '--root', 'r'])).toMatchObject({ cmd: 'upload', intent: 'a', root: 'r' });
    expect(ca.parseArgs(['check', '--intent', 'a']).error).toMatch(/check takes no --intent/);
  });
});

describe('the intent overview page on the intent own page', () => {
  it('uploads overview.html under the overview_file name the way review.md step 5 runs it', async () => {
    const r = root(['gift-cards', 'order-status'], { documentation: DOC, intents: PAGES, pages: [] });
    const { requests, transport } = fake(['overview-order-status.html', 'extra.html']);
    const { code, result } = await runMain(['upload', '--intent', 'order-status', '--file', overview(), '--root', r], transport);
    expect(code).toBe(0);
    expect(result).toMatchObject({ ok: true, page: '400', name: 'overview-order-status.html' });
    const puts = requests.filter((q) => q.method === 'PUT');
    expect(puts[0].url).toContain('/400/child/attachment');
    expect(puts[0].body!.toString('utf8')).toContain('filename="overview-order-status.html"');
    const storage = JSON.parse(puts[1].body!.toString('utf8')).body.storage.value;
    expect(storage.startsWith(`<h2>${ov.HEADING}</h2>`)).toBe(true);
    expect(storage.indexOf('overview-order-status.html')).toBeLessThan(storage.indexOf('extra.html'));
    expect(storage.endsWith('</ul><p>x</p>')).toBe(true);
  });

  it('names the file by the project own overview_file, and --name still wins', async () => {
    const config = 'sync:\n  docs: confluence\n  page_names:\n    overview_file: "shop-{slug}.html"\n';
    const r = root(['gift-cards', 'order-status'], { documentation: DOC, intents: PAGES, pages: [] }, config);
    const own = fake(['shop-gift-cards.html']);
    const named = await runMain(['upload', '--intent', 'gift-cards', '--file', overview(), '--root', r], own.transport);
    expect(named.result).toMatchObject({ ok: true, page: '300', name: 'shop-gift-cards.html' });
    const given = fake(['mine.html']);
    const forced = await runMain(['upload', '--intent', 'gift-cards', '--file', overview(), '--name', 'mine.html', '--root', r], given.transport);
    expect(forced.result).toMatchObject({ ok: true, name: 'mine.html' });
  });

  it('confluence-attach.cjs says how an intent overview is named, and no longer downloads', () => {
    const header = readFileSync(path.join(FLOW, 'scripts/confluence-attach.cjs'), 'utf8').split('*/')[0];
    expect(header).toContain('overview-{intent-slug}.html');
    expect(header).toContain('sync.page_names.overview_file');
    expect(header).not.toMatch(/^ \*\s+download /m);
  });
});
