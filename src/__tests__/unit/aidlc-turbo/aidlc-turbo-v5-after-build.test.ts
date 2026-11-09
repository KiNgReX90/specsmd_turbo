/**
 * Unit tests for the build half of the v5 page model (lib/v5-model-build.cjs addBuild, the afterBuild seam of
 * lib/v5-model.cjs), on the invented Acme Shop gift card intent built in a throwaway git repo as the flow builds one:
 * story 001 on the intent branch (a feat and a fix commit), story 002 on a branch of its own with its own merge
 * request, story 003 still building. Then:
 * - the build block is the one lib/design-build.cjs applyBuild makes from the stories' changed files and build notes;
 * - every drawn part carries its build (different, gone or as planned); a file the build added inside a drawn
 *   module joins the parts, or, while a change is open (plan), stands apart in build.parts;
 * - per story its files, its tests, its commits, the first and the last (from git, the flow's own commit subjects
 *   only), its branch and its merge request (its own, else the intent's);
 * - before the build the model stays as it is.
 * The model is built in a node of its own in the repo, as the overview script runs there (git reads the working
 * directory, which a test worker cannot change).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import path from 'path';
import { FLOW, FIX } from './aidlc-turbo-v5-boot';

const LIB = path.join(FLOW, 'scripts/lib');
const BRANCH = 'shop/gift-cards/intent';
const MR = (n: number) => `https://gitlab.example.com/acme/shop/-/merge_requests/${n}`;
const SERVER = 'shop-server/src/main/java/com/acme/shop';

const bases: string[] = [];
afterAll(() => bases.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Git with a fixed author and date, outside the user's own config. */
function git(cwd: string, date: string, ...args: string[]) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
const put = (file: string, body: string) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, body); };
const commit = (cwd: string, date: string, msg: string, files: string[]) => {
  for (const f of files) put(path.join(cwd, f), `${msg}\n`);
  git(cwd, date, 'add', '-A');
  git(cwd, date, 'commit', '-qm', msg);
};

/** A story file: its front matter and its build notes. */
function story(file: string, front: Record<string, string>, notes: string[]) {
  const head = Object.entries(front).map(([k, v]) => `${k}: ${v}`).join('\n');
  put(file, `---\n${head}\n---\n\n# ${front.title}\n${notes.length ? `\n### Build notes\n\n${notes.join('\n')}\n` : ''}`);
}

/** The gift card intent built in a git repo; gives the artifact root, the intent and the repo. */
function built() {
  const base = mkdtempSync(path.join(tmpdir(), 'turbo-v5-after-'));
  bases.push(base);
  put(path.join(base, '.gitignore'), '.specs-aidlc-turbo/\n');
  git(base, '2026-11-01T09:00:00+01:00', 'init', '-q', '-b', 'main');
  commit(base, '2026-11-01T09:00:00+01:00', 'init', ['README.md']);
  git(base, '2026-11-01T09:00:00+01:00', 'switch', '-q', '-c', BRANCH);
  const root = path.join(base, '.specs-aidlc-turbo');
  const dir = path.join(root, 'docs', 'shop', 'gift-cards');
  put(path.join(root, 'repo', 'config.yaml'), 'mode: production\nbranching:\n  base_branch: main\n');
  put(path.join(dir, 'record.yaml'), readFileSync(path.join(FIX, 'record.yaml'), 'utf8'));
  put(path.join(dir, 'brief.md'), `---\ntitle: Pay with a gift card\nstatus: done\nbranch: ${BRANCH}\nmerge_request: ${MR(40)}\n---\n\n# Pay with a gift card\n`);

  // story 001 on the intent branch: a feat and a fix
  const s001 = [`${SERVER}/giftcards/GiftCardController.java`, `${SERVER}/giftcards/GiftCardService.java`, `${SERVER}/giftcards/GiftCardCache.java`,
    'shop-ui/checkout/shop-giftcard-field.js', 'shop-db/tables/gift_cards.sql', 'shop-server/src/test/java/com/acme/shop/giftcards/GiftCardServiceTest.java'];
  commit(base, '2026-11-02T09:00:00+01:00', 'feat(gift-cards): Check the balance of a gift card (S001)', s001.slice(0, 4));
  commit(base, '2026-11-03T15:00:00+01:00', 'fix(gift-cards): the balance through the cache (S001)', s001.slice(4));
  // story 002 on its own branch, merged into the intent branch; then a commit that is no story's
  git(base, '2026-11-04T09:00:00+01:00', 'switch', '-q', '-c', 'shop/gift-cards/002-pay-with-gift-card');
  const s002 = ['shop-ui/checkout/shop-checkout-page.js', `${SERVER}/orders/OrderService.java`, `${SERVER}/giftcards/GiftCardService.java`, 'shop-db/tables/orders.sql',
    'shop-server/src/test/java/com/acme/shop/orders/OrderServiceTest.java'];
  commit(base, '2026-11-04T10:00:00+01:00', 'feat(gift-cards): Pay part of an order with a gift card (S002)', s002);
  git(base, '2026-11-05T16:30:00+01:00', 'switch', '-q', BRANCH);
  git(base, '2026-11-05T16:30:00+01:00', 'merge', '-q', '--no-ff', '-m', 'Merge story 002', 'shop/gift-cards/002-pay-with-gift-card');
  commit(base, '2026-11-05T17:00:00+01:00', 'docs(gift-cards): S002 done', ['NOTES.md']);
  // story 003 still building
  const s003 = ['shop-ui/orders/shop-order-status-page.js', `${SERVER}/orders/OrderStatusResource.java`];
  commit(base, '2026-11-06T09:30:00+01:00', 'feat(gift-cards): Show the gift card on the order status page (S003)', s003);

  const stories = path.join(dir, 'stories');
  const list = (files: string[]) => `[${files.join(', ')}]`;
  story(path.join(stories, '001-gift-card-balance.md'), { id: '"001"', title: 'Check the balance of a gift card', status: 'done', completed: '2026-11-03', changed_files: list(s001) }, [
    '- **Built**: The checkout shows the balance of a gift card.',
    '- **Outside the Code Scaffold**:',
    `  - \`${SERVER}/giftcards/GiftCardCache.java\`: Keeps the balances read in the last minute. Why: checkout reads a balance on every key press.`,
    '- **Different from the Code Scaffold**:',
    `  - \`${SERVER}/giftcards/GiftCardService.java\`: Reads the balance through \`GiftCardCache\`. Why: the table is read on every checkout.`,
    '- **Not built**:',
    '  - `shop-db/migrations/V2026_11_01__gift_cards.sql`: The table script creates the index too.',
  ]);
  story(path.join(stories, '002-pay-with-gift-card.md'), { id: '"002"', title: 'Pay part of an order with a gift card', status: 'done', completed: '2026-11-05',
    branch: 'shop/gift-cards/002-pay-with-gift-card', merge_request: MR(42), changed_files: list(s002) }, [
    '- **Built**: An order books the gift card part and charges the rest.',
    '- **Outside the Code Scaffold**: none.', '- **Different from the Code Scaffold**: none.', '- **Not built**: none.',
  ]);
  story(path.join(stories, '003-gift-card-on-order-status.md'), { id: '"003"', title: 'Show the gift card on the order status page', status: 'building', changed_files: list(s003) }, []);
  const at = (f: string) => path.join(dir, f);
  const intent = { slug: 'gift-cards', inception: 'shop', dir, record: at('record.yaml'), brief: at('brief.md'), stories, tests: at('tests') };
  return { base, root, intent };
}

/** The v5 model of the built intent, made in the repo as the overview script makes it. */
function modelOf(p: ReturnType<typeof built>, phase: string, opts: { plan?: boolean } = {}) {
  const code = `
    const { v5Model } = require(${JSON.stringify(path.join(LIB, 'v5-model.cjs'))});
    const { addBuild } = require(${JSON.stringify(path.join(LIB, 'v5-model-build.cjs'))});
    const [root, intent, phase, plan] = JSON.parse(process.argv[1]);
    process.stdout.write(JSON.stringify(v5Model(root, intent, phase, { afterBuild: addBuild, plan })));`;
  const r = spawnSync(process.execPath, ['-e', code, JSON.stringify([p.root, p.intent, phase, !!opts.plan])], { cwd: p.base, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

let once: { p: ReturnType<typeof built>; M: any } | null = null;
const after = () => { if (!once) { const p = built(); once = { p, M: modelOf(p, 'construction') }; } return once; };
const byPath = (M: any, end: string) => (Object.values(M.parts) as any[]).find((x) => String(x.path).endsWith(end));

describe('aidlc-turbo v5 after the build: the build block and the parts', () => {
  it('carries the build block applyBuild makes, a story per built story', () => {
    const { M } = after();
    expect(M.build.stories.map((s: any) => s.id)).toEqual(['001', '002', '003']);
    expect(M.build.stories.map((s: any) => [s.id, ...['different', 'extra', 'gone'].map((k) => s[k].map((x: any) => x.id || x.file))])).toEqual([
      ['001', ['giftcard-service'], [`${SERVER}/giftcards/GiftCardCache.java`], ['migration']],
      ['002', [], [], []],
      ['003', [], [], []],
    ]);
    expect(M.build.stories[0].built).toBe('The checkout shows the balance of a gift card.');
  });

  it('gives every drawn part its build: different, gone or as planned', () => {
    const { M } = after();
    expect(M.parts['giftcard-service'].build).toMatchObject({
      state: 'different', story: '001', built: 'Reads the balance through `GiftCardCache`.', why: 'the table is read on every checkout.',
    });
    expect(M.parts.migration.build).toMatchObject({ state: 'gone', story: '001', why: 'The table script creates the index too.' });
    for (const id of ['giftcard-controller', 'giftcard-field', 'giftcards-table', 'order-service']) expect(M.parts[id].build.state, id).toBe('as_planned');
  });

  it('lets a file the build added inside a drawn module join the parts', () => {
    const { M } = after();
    const cache = byPath(M, 'GiftCardCache.java');
    expect(cache).toBeTruthy();
    expect(cache.build).toMatchObject({ state: 'added', story: '001', why: 'checkout reads a balance on every key press.' });
    expect(cache.layer).toBe('server');
  });

  it('while a change is open, keeps the drawing to the plan: the added file stands apart in build.parts', () => {
    const P = modelOf(after().p, 'construction', { plan: true });
    expect(P.plan).toBe(true);
    expect(byPath(P, 'GiftCardCache.java')).toBeUndefined();
    const apart = (Object.values(P.build.parts) as any[]).find((x) => String(x.path).endsWith('GiftCardCache.java'));
    expect(apart.build.state).toBe('added');
    expect(P.parts['giftcard-service'].build.state).toBe('different');
  });
});

describe('aidlc-turbo v5 after the build: the facts of every story', () => {
  it('counts its files and tests, and its commits from git, the flow\'s own subjects only', () => {
    const [a, b, c] = after().M.stories;
    expect([a.files, a.tests, a.commits]).toEqual([6, 1, 2]);
    expect([b.files, b.tests, b.commits]).toEqual([5, 1, 1]);
    expect([c.files, c.tests, c.commits]).toEqual([2, 0, 1]);
  });

  it('dates its first commit and, once done, its last; a story still building has no merge date', () => {
    const [a, b, c] = after().M.stories;
    expect(Date.parse(a.first)).toBe(Date.parse('2026-11-02T09:00:00+01:00'));
    expect(Date.parse(a.merged)).toBe(Date.parse('2026-11-03T15:00:00+01:00'));
    expect(Date.parse(b.merged)).toBe(Date.parse('2026-11-04T10:00:00+01:00'));
    expect(c.merged).toBeNull();
  });

  it('names its branch and its merge request: its own, else the intent\'s', () => {
    const { M } = after();
    expect(M.stories.map((u: any) => [u.branch, u.url, u.mr])).toEqual([
      [BRANCH, MR(40), 40],
      ['shop/gift-cards/002-pay-with-gift-card', MR(42), 42],
      [BRANCH, MR(40), 40],
    ]);
  });
});

describe('aidlc-turbo v5 after the build: before it', () => {
  it('leaves the model as it is at the inception', () => {
    const M = modelOf(after().p, 'inception');
    expect(M).not.toHaveProperty('build');
    for (const p of Object.values(M.parts) as any[]) expect(p).not.toHaveProperty('build');
    for (const u of M.stories) expect(Object.keys(u).sort()).toEqual(['id', 'n', 'short', 'title', 'what']);
  });
});
