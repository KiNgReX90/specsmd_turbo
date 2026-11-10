/**
 * Unit tests for intent-pages.cjs, the gate that gives every intent of an
 * inception its own Confluence page.
 *
 * An inception can start with one documentation page and one stories page
 * under it, and then be cut into several intents with the stories numbered
 * per intent: pages of several intents titled `Story 001 - ...` would sit side
 * by side under one stories page, and every overview would go onto that one
 * page. These guards keep it from happening:
 * - an inception of one intent passes: its documentation page is the
 *   intent's page; so does one without Confluence (skipped, or no page);
 * - with more than one intent folder every intent needs its own entry in
 *   `confluence.intents`, never the inception's page and never another
 *   intent's, with its own stories page;
 * - a story page under the shared stories page, or under the page of an
 *   intent it does not belong to, fails;
 * - the plan creates every missing page and moves each story page to the
 *   intent whose story has the same number and title; a page that matches
 *   no story is shown with what was found, never guessed; the user's own
 *   mapping (--map) wins;
 * - the titles of new pages follow the project's page names
 *   (`sync.page_names`, defaults `{name} - Documentation` and `{name} - Stories`);
 * - pageOf hands every writer the intent's own page, the inception's page
 *   only for an inception of one intent, and refuses the shared page;
 * - the command line prints one JSON object: exit 0 passes, 1 fails, 2 usage.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const SCRIPT = path.join(FLOW, 'scripts/intent-pages.cjs');
const req = createRequire(import.meta.url);
const render = req(path.join(FLOW, 'scripts/lib/yaml-subset.cjs'));
const ip = req(SCRIPT);

const made: string[] = [];
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

type Story = { id: string; title: string; sources?: string[] };
type Spec = { slug: string; title?: string; purpose?: string; stories?: Story[] };

const INC = 'checkout-revamp';
const PAGES = `docs/${INC}/pages`;
const DOC = { url: 'https://example.atlassian.net/wiki/spaces/SHOP/pages/100/checkout-revamp+-+Documentation', page_id: '100', name: INC };
const SUFFIX = ` - ${INC}`;
const row = (rel: string, id: string, title: string, extra: object = {}) => ({ path: `${PAGES}/${rel}`, page_id: id, title, version: 3, ...extra });
const BASE_ROWS = [
  row('index.md', '100', `${INC} - Documentation`),
  row('architecture/index.md', '110', `Architecture${SUFFIX}`),
  row('stories/index.md', '120', `${INC} - Stories`),
];

/** An artifact root with one inception: a record per intent, sync.yaml when `confluence` is given, and an optional config. */
function fixture(intents: Spec[], confluence: object | null, register?: object, config?: string) {
  const base = mkdtempSync(path.join(tmpdir(), 'turbo-intent-pages-'));
  made.push(base);
  const root = path.join(base, '.specs-aidlc-turbo');
  mkdirSync(path.join(root, 'repo'), { recursive: true });
  if (config) writeFileSync(path.join(root, 'repo', 'config.yaml'), config);
  for (const i of intents) {
    const dir = path.join(root, 'docs', INC, i.slug);
    mkdirSync(dir, { recursive: true });
    const record = {
      intent: { slug: i.slug, inception: INC, title: i.title ?? i.slug },
      ...(i.purpose ? { purpose: i.purpose } : {}),
      stories: (i.stories ?? []).map((s) => ({ id: s.id, slug: 'x', title: s.title, sources: s.sources ?? [] })),
    };
    writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
  }
  mkdirSync(path.join(root, 'docs', INC), { recursive: true });
  if (confluence) writeFileSync(path.join(root, 'docs', INC, 'sync.yaml'), render.dumpYaml({ confluence, jira: { project: 'SHOP' } }));
  if (register) writeFileSync(path.join(root, 'docs', INC, 'register.yaml'), render.dumpYaml(register));
  return { base, root };
}

function cli(root: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n').filter(Boolean);
  return { code: r.status, lines, json: lines.length ? JSON.parse(r.stdout) : null, err: r.stderr };
}

const GIFT: Spec = {
  slug: 'gift-cards', title: 'Gift cards',
  stories: [{ id: '001', title: 'Gift card balance' }, { id: '002', title: 'Redeem at checkout' }],
};
const STATUS: Spec = {
  slug: 'order-status', title: 'Order status', purpose: 'This intent shows customers where their order is.',
  stories: [
    { id: '001', title: 'Status page' },
    { id: '002', title: 'A status mail per shipment' },
    { id: '003', title: 'Late orders without a carrier', sources: ['S-007', 'S-008'] },
    { id: '004', title: 'Retries as a schedule' },
  ],
};
const STORY_ROWS = [
  row('stories/story-001-gift-card-balance.md', '201', `Story 001 - Gift card balance${SUFFIX}`),
  row('stories/story-002-redeem-at-checkout.md', '202', `Story 002 - Redeem at checkout${SUFFIX}`),
  // An old page: the work was renumbered after the last push, so number and title no longer agree.
  row('stories/story-005-order-status-in-queue-and-http.md', '205', `Story 005 - Late orders without a carrier${SUFFIX}`),
];
const REGISTER = {
  pages: {},
  items: [
    { id: 'S-007', page: '205', version: 2, line: 7, kind: 'requirement', quote: 'a', key: '205:a', status: 'current' },
    { id: 'S-008', page: '205', version: 2, line: 8, kind: 'requirement', quote: 'b', key: '205:b', status: 'current' },
  ],
};

describe('intent-pages check: what passes', () => {
  it('an inception of one intent passes: its documentation page is the intent page, stories and all', () => {
    const f = fixture([GIFT], { documentation: DOC, pages: [...BASE_ROWS, ...STORY_ROWS.slice(0, 2)] });
    const r = ip.checkInception(f.root, INC);
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.plan).toBeNull();
    expect(r.intents).toEqual(['gift-cards']);
  });

  it('an inception without Confluence passes: skipped, or no documentation page at all', () => {
    expect(ip.checkInception(fixture([GIFT, STATUS], { skipped: true }).root, INC)).toMatchObject({ ok: true, skipped: true });
    expect(ip.checkInception(fixture([GIFT, STATUS], null).root, INC)).toMatchObject({ ok: true, problems: [] });
  });

  it('every intent on its own page, its stories under its own Stories page, passes', () => {
    const f = fixture([GIFT, STATUS], {
      documentation: DOC,
      intents: {
        'gift-cards': { url: 'https://x/300', page_id: '300', name: 'gift-cards' },
        'order-status': { url: 'https://x/400', page_id: '400', name: 'order-status' },
      },
      pages: [
        ...BASE_ROWS,
        row('gift-cards/index.md', '300', 'gift-cards - Documentation', { intent: 'gift-cards' }),
        row('gift-cards/stories/index.md', '301', 'gift-cards - Stories', { intent: 'gift-cards' }),
        row('gift-cards/stories/story-001-gift-card-balance.md', '201', `Story 001 - Gift card balance${SUFFIX}`, { intent: 'gift-cards' }),
        row('order-status/index.md', '400', 'order-status - Documentation', { intent: 'order-status' }),
        row('order-status/stories/index.md', '401', 'order-status - Stories', { intent: 'order-status' }),
      ],
    });
    expect(ip.checkInception(f.root, INC)).toMatchObject({ ok: true, problems: [], plan: null });
  });
});

describe('intent-pages check: what fails, and the plan', () => {
  it('two intents without pages: every intent gets a page and a Stories page, story pages move by number and title', () => {
    const f = fixture([GIFT, STATUS], { documentation: DOC, pages: [...BASE_ROWS, ...STORY_ROWS] }, REGISTER);
    const r = ip.checkInception(f.root, INC);
    expect(r.ok).toBe(false);
    const kinds = r.problems.map((p: any) => `${p.kind}:${p.intent ?? p.page_id}`);
    expect(kinds).toEqual(expect.arrayContaining([
      'no_page:gift-cards', 'no_page:order-status', 'shared_stories:201', 'shared_stories:202', 'shared_stories:205',
    ]));
    expect(r.plan.parent).toEqual({ page_id: '100', title: `${INC} - Documentation`, url: DOC.url });
    expect(r.plan.create.map((c: any) => [c.intent, c.title, c.stories_title, c.page, c.stories])).toEqual([
      ['gift-cards', 'gift-cards - Documentation', 'gift-cards - Stories', true, true],
      ['order-status', 'order-status - Documentation', 'order-status - Stories', true, true],
    ]);
    expect(r.plan.create[1]).toMatchObject({
      path: `${PAGES}/order-status/index.md`,
      stories_path: `${PAGES}/order-status/stories/index.md`,
    });
    // The intent page says what it holds and what the inception page keeps, then the intent's purpose.
    expect(r.plan.create[1].body).toContain('Order status');
    expect(r.plan.create[1].body).toContain(`${INC} - Documentation`);
    expect(r.plan.create[1].body).toContain('This intent shows customers where their order is.');
    expect(r.plan.create[1].stories_body).toBe('The stories of the intent Order status.\n');
    expect(r.plan.move.map((m: any) => [m.page_id, m.intent, m.story, m.by, m.to])).toEqual([
      ['201', 'gift-cards', '001', 'match', `${PAGES}/gift-cards/stories/story-001-gift-card-balance.md`],
      ['202', 'gift-cards', '002', 'match', `${PAGES}/gift-cards/stories/story-002-redeem-at-checkout.md`],
    ]);
    expect(r.plan.move[0].from).toBe(`${PAGES}/stories/story-001-gift-card-balance.md`);
  });

  it('a story page whose number and title match no story is shown with what was found, never moved on a guess', () => {
    const f = fixture([GIFT, STATUS], { documentation: DOC, pages: [...BASE_ROWS, ...STORY_ROWS] }, REGISTER);
    const r = ip.checkInception(f.root, INC);
    expect(r.plan.move.map((m: any) => m.page_id)).not.toContain('205');
    expect(r.plan.unmatched).toEqual([{
      page_id: '205',
      title: `Story 005 - Late orders without a carrier${SUFFIX}`,
      path: `${PAGES}/stories/story-005-order-status-in-queue-and-http.md`,
      hints: [
        { intent: 'order-status', story: '003', why: 'title' },
        { intent: 'order-status', story: '003', why: 'sources' },
      ],
    }]);
  });

  it('the user mapping wins: --map moves a page the records could not place', () => {
    const f = fixture([GIFT, STATUS], { documentation: DOC, pages: [...BASE_ROWS, ...STORY_ROWS] }, REGISTER);
    const r = ip.checkInception(f.root, INC, { map: { 205: 'order-status', 202: 'order-status' } });
    const moves = Object.fromEntries(r.plan.move.map((m: any) => [m.page_id, [m.intent, m.by]]));
    expect(moves).toEqual({
      201: ['gift-cards', 'match'],
      202: ['order-status', 'user'],
      205: ['order-status', 'user'],
    });
    expect(r.plan.unmatched).toEqual([]);
  });

  it('matches a title without the Story number on its title alone, case and spaces aside; two candidates are no match', () => {
    const A: Spec = { slug: 'a-intent', stories: [{ id: '001', title: 'Log in with a code' }, { id: '002', title: 'Shared name' }] };
    const B: Spec = { slug: 'b-intent', stories: [{ id: '004', title: 'Shared name' }] };
    const f = fixture([A, B], {
      documentation: DOC,
      pages: [
        ...BASE_ROWS,
        row('stories/log-in-with-a-code.md', '501', `log in  with a CODE${SUFFIX}`),
        row('stories/shared-name.md', '502', `Shared name${SUFFIX}`),
      ],
    });
    const r = ip.checkInception(f.root, INC);
    expect(r.plan.move.map((m: any) => [m.page_id, m.intent, m.story])).toEqual([['501', 'a-intent', '001']]);
    expect(r.plan.unmatched.map((u: any) => [u.page_id, u.hints.map((h: any) => `${h.intent}/${h.story}/${h.why}`)])).toEqual([
      ['502', ['a-intent/002/title', 'b-intent/004/title']],
    ]);
  });

  it('a story page under the page of another intent fails and moves to its own intent', () => {
    const f = fixture([GIFT, STATUS], {
      documentation: DOC,
      intents: {
        'gift-cards': { url: 'https://x/300', page_id: '300', name: 'gift-cards' },
        'order-status': { url: 'https://x/400', page_id: '400', name: 'order-status' },
      },
      pages: [
        ...BASE_ROWS,
        row('gift-cards/index.md', '300', 'gift-cards - Documentation', { intent: 'gift-cards' }),
        row('gift-cards/stories/index.md', '301', 'gift-cards - Stories', { intent: 'gift-cards' }),
        row('order-status/index.md', '400', 'order-status - Documentation', { intent: 'order-status' }),
        row('order-status/stories/index.md', '401', 'order-status - Stories', { intent: 'order-status' }),
        row('order-status/stories/story-002-redeem-at-checkout.md', '202', `Story 002 - Redeem at checkout${SUFFIX}`, { intent: 'order-status' }),
      ],
    });
    const r = ip.checkInception(f.root, INC);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([expect.objectContaining({ kind: 'other_intent', page_id: '202', intent: 'order-status' })]);
    expect(r.plan.create).toEqual([]);
    expect(r.plan.move).toEqual([expect.objectContaining({
      page_id: '202', intent: 'gift-cards',
      from: `${PAGES}/order-status/stories/story-002-redeem-at-checkout.md`,
      to: `${PAGES}/gift-cards/stories/story-002-redeem-at-checkout.md`,
    })]);
  });

  it('two intents on one page, or an intent on the inception page, fail; the plan gives them pages of their own', () => {
    const shared = fixture([GIFT, STATUS], {
      documentation: DOC,
      intents: {
        'gift-cards': { url: 'https://x/300', page_id: '300', name: 'gift-cards' },
        'order-status': { url: 'https://x/300', page_id: '300', name: 'order-status' },
      },
      pages: BASE_ROWS,
    });
    const r = ip.checkInception(shared.root, INC);
    expect(r.problems.filter((p: any) => p.kind === 'shared_page').map((p: any) => p.intent).sort()).toEqual(['gift-cards', 'order-status']);
    expect(r.plan.create.map((c: any) => c.intent)).toEqual(['gift-cards', 'order-status']);

    const onInception = fixture([GIFT, STATUS], {
      documentation: DOC,
      intents: { 'order-status': { url: DOC.url, page_id: '100', name: 'order-status' } },
      pages: BASE_ROWS,
    });
    const kinds = ip.checkInception(onInception.root, INC).problems.map((p: any) => `${p.kind}:${p.intent}`);
    expect(kinds).toEqual(expect.arrayContaining(['inception_page:order-status', 'no_page:gift-cards']));
  });

  it('an intent page without its Stories page fails, and the plan makes only the Stories page', () => {
    const f = fixture([GIFT, STATUS], {
      documentation: DOC,
      intents: {
        'gift-cards': { url: 'https://x/300', page_id: '300', name: 'gift-cards' },
        'order-status': { url: 'https://x/400', page_id: '400', name: 'order-status' },
      },
      pages: [
        ...BASE_ROWS,
        row('gift-cards/index.md', '300', 'gift-cards - Documentation', { intent: 'gift-cards' }),
        row('gift-cards/stories/index.md', '301', 'gift-cards - Stories', { intent: 'gift-cards' }),
        row('order-status/index.md', '400', 'order-status - Documentation', { intent: 'order-status' }),
      ],
    });
    const r = ip.checkInception(f.root, INC);
    expect(r.problems).toEqual([expect.objectContaining({ kind: 'no_stories_page', intent: 'order-status' })]);
    expect(r.plan.create).toEqual([expect.objectContaining({ intent: 'order-status', page: false, stories: true, page_id: '400', stories_title: 'order-status - Stories' })]);
  });

  it('a row whose intent key and folder disagree fails: a pull writes them again', () => {
    const f = fixture([GIFT, STATUS], {
      documentation: DOC,
      intents: {
        'gift-cards': { url: 'https://x/300', page_id: '300', name: 'gift-cards' },
        'order-status': { url: 'https://x/400', page_id: '400', name: 'order-status' },
      },
      pages: [
        ...BASE_ROWS,
        row('gift-cards/index.md', '300', 'gift-cards - Documentation', { intent: 'gift-cards' }),
        row('gift-cards/stories/index.md', '301', 'gift-cards - Stories'),
        row('order-status/index.md', '400', 'order-status - Documentation', { intent: 'gift-cards' }),
        row('order-status/stories/index.md', '401', 'order-status - Stories', { intent: 'order-status' }),
      ],
    });
    const bad = ip.checkInception(f.root, INC).problems.filter((p: any) => p.kind === 'row_intent').map((p: any) => p.page_id);
    expect(bad.sort()).toEqual(['301', '400']);
  });

  it('a story page with pages under it moves as one, its children with it', () => {
    const f = fixture([GIFT, STATUS], {
      documentation: DOC,
      pages: [
        ...BASE_ROWS,
        row('stories/story-001-gift-card-balance/index.md', '201', `Story 001 - Gift card balance${SUFFIX}`),
        row('stories/story-001-gift-card-balance/measurement-plan.md', '211', `Measurement plan${SUFFIX}`),
      ],
    });
    const r = ip.checkInception(f.root, INC);
    expect(r.problems.filter((p: any) => p.kind === 'shared_stories').map((p: any) => p.page_id)).toEqual(['201']);
    expect(r.plan.move).toEqual([expect.objectContaining({
      page_id: '201',
      to: `${PAGES}/gift-cards/stories/story-001-gift-card-balance/index.md`,
      children: [{
        page_id: '211',
        from: `${PAGES}/stories/story-001-gift-card-balance/measurement-plan.md`,
        to: `${PAGES}/gift-cards/stories/story-001-gift-card-balance/measurement-plan.md`,
      }],
    })]);
  });

  it('an intent named like the inception page gets titles that cannot clash with that page', () => {
    const f = fixture([{ ...GIFT, slug: INC }, STATUS], { documentation: DOC, pages: BASE_ROWS });
    const create = ip.checkInception(f.root, INC).plan.create.find((c: any) => c.intent === INC);
    expect(create.title).toBe(`${INC} (intent) - Documentation`);
    expect(create.stories_title).toBe(`${INC} (intent) - Stories`);
  });

  it('titles new pages by the project own page names', () => {
    const config = 'sync:\n  docs: confluence\n  page_names:\n    intent: "Docs: {name}"\n    stories: "Stories of {name}"\n';
    const rows = [row('architecture/index.md', '110', `Architecture${SUFFIX}`), ...STORY_ROWS];
    const f = fixture([GIFT, STATUS], { documentation: DOC, pages: rows }, REGISTER, config);
    const r = ip.checkInception(f.root, INC);
    expect(r.plan.parent.title).toBe(`Docs: ${INC}`);
    expect(r.plan.create.map((c: any) => [c.title, c.stories_title])).toEqual([
      ['Docs: gift-cards', 'Stories of gift-cards'],
      ['Docs: order-status', 'Stories of order-status'],
    ]);
    expect(r.lines.join('\n')).toContain(`from "Stories of ${INC}" to "Stories of gift-cards"`);
  });

  it('says each step of the plan in one line, naming the pages by title', () => {
    const f = fixture([GIFT, STATUS], { documentation: DOC, pages: [...BASE_ROWS, ...STORY_ROWS] }, REGISTER);
    const lines = ip.checkInception(f.root, INC).lines.join('\n');
    expect(lines).toContain(`create "order-status - Documentation" under "${INC} - Documentation", with "order-status - Stories" under it`);
    expect(lines).toContain(`move "Story 001 - Gift card balance${SUFFIX}" from "${INC} - Stories" to "gift-cards - Stories"`);
    expect(lines).toContain(`not moved: "Story 005 - Late orders without a carrier${SUFFIX}"`);
    expect(lines).toContain('same title as story 003 of order-status');
  });
});

describe('intent-pages pageOf: where a writer puts the intent overview', () => {
  const twoWithPages = () => fixture([GIFT, STATUS], {
    documentation: DOC,
    intents: {
      'gift-cards': { url: 'https://x/300', page_id: '300', name: 'gift-cards' },
      'order-status': { url: 'https://x/400', page_id: '400', name: 'order-status' },
    },
    pages: BASE_ROWS,
  });

  it('the intent own page when it has one', () => {
    expect(ip.pageOf(twoWithPages().root, 'order-status')).toMatchObject({ ok: true, page_id: '400', url: 'https://x/400', own: true, inception: INC });
  });

  it('the inception page for an inception of one intent', () => {
    const f = fixture([GIFT], { documentation: DOC, pages: BASE_ROWS });
    expect(ip.pageOf(f.root, 'gift-cards')).toMatchObject({ ok: true, page_id: '100', url: DOC.url, own: false });
  });

  it('never the shared page of an inception with several intents, and never with Confluence skipped', () => {
    const f = fixture([GIFT, STATUS], { documentation: DOC, pages: BASE_ROWS });
    const r = ip.pageOf(f.root, 'order-status');
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('intent-pages.cjs check --inception checkout-revamp');
    const onInception = fixture([GIFT, STATUS], {
      documentation: DOC, intents: { 'order-status': { url: DOC.url, page_id: '100', name: 'order-status' } }, pages: BASE_ROWS,
    });
    expect(ip.pageOf(onInception.root, 'order-status').ok).toBe(false);
    expect(ip.pageOf(fixture([GIFT], { skipped: true }).root, 'gift-cards').ok).toBe(false);
    expect(ip.pageOf(f.root, 'no-such-intent').ok).toBe(false);
  });
});

describe('intent-pages command line', () => {
  it('prints one JSON object: exit 0 when it passes, 1 when it fails', () => {
    const one = fixture([GIFT], { documentation: DOC, pages: BASE_ROWS });
    const pass = cli(one.root, 'check', '--inception', INC);
    expect(pass.code).toBe(0);
    expect(pass.lines).toHaveLength(1);
    expect(pass.json).toMatchObject({ ok: true, inception: INC });

    const two = fixture([GIFT, STATUS], { documentation: DOC, pages: [...BASE_ROWS, ...STORY_ROWS] }, REGISTER);
    const fail = cli(two.root, 'check', '--inception', INC, '--map', '205=order-status');
    expect(fail.code).toBe(1);
    expect(fail.json.ok).toBe(false);
    expect(fail.json.plan.move.find((m: any) => m.page_id === '205')).toMatchObject({ intent: 'order-status', by: 'user' });
  });

  it('exit 2 on a usage error, still one JSON object', () => {
    const f = fixture([GIFT, STATUS], { documentation: DOC, pages: [...BASE_ROWS, ...STORY_ROWS] });
    for (const args of [
      [],
      ['nope', '--inception', INC],
      ['check'],
      ['check', '--inception', 'no-such-inception'],
      ['check', '--inception', INC, '--map', '205'],
      ['check', '--inception', INC, '--map', '205=no-such-intent'],
      ['check', '--inception', INC, '--map', '999=order-status'],
    ]) {
      const r = cli(f.root, ...args);
      expect(r.code, args.join(' ')).toBe(2);
      expect(r.json.ok, args.join(' ')).toBe(false);
      expect(r.json.detail, args.join(' ')).toBeTruthy();
    }
  });
});
