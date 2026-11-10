/**
 * Unit tests for the way from a file in the Review tab to its merge request
 * (lib/review-links.cjs, TdReviewList.links, the head of the file in Review):
 * - the page carries the merge requests the push recorded (the brief's and
 *   every story's `merge_request`), only http(s) links, and per file of a
 *   diff GitLab's anchor of that file (the SHA-1 of its path);
 * - a file links to the merge request of every story that built or changed
 *   it; without one, to the intent's; without any, nothing;
 * - a GitLab merge request opens on the file in its changes; another link
 *   opens as it is;
 * - the head of the file shows each link in a new tab, "GitLab" with the
 *   story label when there are more, its tooltip saying where it goes.
 * - after the push relink() puts them into the data block of the approved
 *   page without rendering it again: the page of templates/overview on its
 *   `overview-data` block (page.design.build, never inside the C4 model it
 *   embeds); a page it cannot read is null, exit 1.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { createRequire } from 'module';
import path from 'path';
import { reviewModel, reviewDom, mountReview, v5Model, LOOP } from './aidlc-turbo-design-review-fixture';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const { addLinks } = req(path.join(FLOW, 'scripts/lib/review-links.cjs'));
const G = globalThis as any;
const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

const MR = (n: number) => `https://gitlab.example.com/acme/shop/-/merge_requests/${n}`;
const story = (id: string, mr?: unknown) => ({ id, data: mr === undefined ? {} : { merge_request: mr } });

describe('aidlc-turbo Review links: what the page carries', () => {
  it('the merge requests of the intent and of every story, and the anchor of every file with a diff', () => {
    const m: any = reviewModel();
    addLinks(m, { brief: { merge_request: MR(9) }, stories: [story('001', MR(1)), story('002', MR(2)), story('003')] });
    expect(m.build.links.intent).toBe(MR(9));
    expect(m.build.links.stories).toEqual({ '001': MR(1), '002': MR(2) });
    expect(Object.keys(m.build.links.anchors).sort()).toEqual(Object.keys(m.build.diffs).sort());
    expect(m.build.links.anchors[LOOP]).toBe(sha1(LOOP));
  });

  it('only http(s) links; nothing at all without one, before the build, or without a model', () => {
    const m: any = reviewModel();
    addLinks(m, { brief: { merge_request: 'javascript:alert(1)' }, stories: [story('001', ' '), story('002', 42)] });
    expect(m.build.links).toBeUndefined();
    const before: any = reviewModel();
    delete before.build;
    addLinks(before, { brief: { merge_request: MR(9) }, stories: [] });
    expect(before.build).toBeUndefined();
    expect(() => addLinks(null, { brief: {}, stories: [] })).not.toThrow();
  });

  it('the anchor of a path as git names it: no ./ in front, forward slashes', () => {
    const m: any = reviewModel();
    m.build.diffs = { './a\\b\\C.java': { text: '', added: 0, removed: 0, truncated: 0 } };
    addLinks(m, { brief: { merge_request: MR(9) }, stories: [] });
    expect(m.build.links.anchors['./a\\b\\C.java']).toBe(sha1('a/b/C.java'));
  });
});

describe('aidlc-turbo Review links: which link a file gets', () => {
  const L = () => G.TdReviewList;
  /** The model with the links addLinks puts on it, from the brief and the stories. */
  const linked = (stories: Record<string, string>, intent: string | null = MR(9)) => {
    reviewDom();
    const m: any = reviewModel();
    addLinks(m, { brief: intent ? { merge_request: intent } : {}, stories: Object.entries(stories).map(([id, u]) => story(id, u)) });
    return m;
  };
  const rowOf = (m: any, id: string) => L().rows(m, { built: true }).find((r: any) => r.id === id);

  it('the merge request of the story that built it, opened on the file in its changes', () => {
    const m = linked({ '001': MR(1), '002': MR(2) });
    expect(L().links({ ...rowOf(m, 'loop'), stories: ['001'] }, m.build.links)).toEqual([{ story: '001', host: 'GitLab', url: `${MR(1)}/diffs#${sha1(LOOP)}` }]);
  });

  it('one per story when more stories built it', () => {
    const m = linked({ '001': MR(1), '003': MR(3) });
    const r = { ...rowOf(m, 'loop'), stories: ['001', '003'] };
    expect(L().links(r, m.build.links).map((x: any) => x.story)).toEqual(['001', '003']);
  });

  it('the intent\'s merge request when no story has one; none without any', () => {
    const m = linked({});
    expect(L().links({ ...rowOf(m, 'loop'), stories: ['001'] }, m.build.links)).toEqual([{ story: null, host: 'GitLab', url: `${MR(9)}/diffs#${sha1(LOOP)}` }]);
    expect(L().links(rowOf(m, 'loop'), undefined)).toEqual([]);
  });

  it('a file without a diff opens the merge request itself; another host opens the link as it is', () => {
    const m = linked({ '002': MR(2) });
    const factory = { id: 'factory', part: m.parts.find((p: any) => p.id === 'factory'), stories: ['002'] };
    expect(m.build.diffs[factory.part.path]).toBeUndefined();
    expect(L().links(factory, m.build.links)).toEqual([{ story: '002', host: 'GitLab', url: MR(2) }]);
    const gh = linked({ '001': 'https://github.com/acme/shop/pull/4' });
    expect(L().links({ ...rowOf(gh, 'loop'), stories: ['001'] }, gh.build.links)).toEqual([{ story: '001', host: 'GitHub', url: 'https://github.com/acme/shop/pull/4' }]);
  });
});

describe('aidlc-turbo Review links: the head of the file', () => {
  function head(stories: Record<string, string>, intent: string | null = null, two = false) {
    const d = reviewDom();
    const m: any = reviewModel();
    addLinks(m, { brief: intent ? { merge_request: intent } : {}, stories: Object.entries(stories).map(([s, u]) => story(s, u)) });
    if (two) {
      const loop = m.stories.find((s: any) => s.id === '003');
      loop.builds = { ...(loop.builds || {}), loop: 'reads it too' };
    }
    const v = mountReview(d, { model: m });
    v.api.open('loop');
    return { d, box: v.box };
  }
  const links = (x: { d: any; box: any }) => x.d.all(x.box, 'td-rv-gl');

  it('"GitLab" opens the file in its merge request in a new tab, the tooltip says where', () => {
    const a = links(head({ '001': MR(1) }));
    expect(a).toHaveLength(1);
    expect(a[0].tag).toBe('a');
    expect(a[0].href).toBe(`${MR(1)}/diffs#${sha1(LOOP)}`);
    expect(a[0].target).toBe('_blank');
    expect(a[0].rel).toBe('noopener');
    expect(a[0].textContent).toBe('GitLab');
    expect(a[0].title).toBe('Open IncomingProcessor.java in the merge request of story 1 in GitLab');
  });

  it('the story label beside it when there are more; the intent\'s says so', () => {
    expect(links(head({ '001': MR(1), '003': MR(3) }, null, true)).map((a: any) => a.textContent)).toEqual(['GitLab US 001', 'GitLab US 003']);
    expect(links(head({}, MR(9)))[0].title).toBe('Open IncomingProcessor.java in the merge request of the intent in GitLab');
  });

  it('no link without a merge request', () => {
    expect(links(head({}))).toHaveLength(0);
  });
});

describe('aidlc-turbo Review links: the overview script', () => {
  it('puts the links on the drawing after the diffs, from the brief and the stories', () => {
    const src = readFileSync(path.join(FLOW, 'scripts/intent-overview.cjs'), 'utf8');
    expect(src).toMatch(/addDiffs\(design, \{ root, brief: brief\.data \}\);\n\s+addLinks\(design, \{ brief: brief\.data, stories: raw \}\);/);
  });
});

const { render } = req(path.join(FLOW, 'scripts/intent-overview.cjs'));
const { withEmbed } = req(path.join(FLOW, 'scripts/lib/overview-page.cjs'));
const { relink } = req(path.join(FLOW, 'scripts/lib/review-links.cjs'));
const DATA = /<script id="overview-data" type="application\/json">([\s\S]*?)<\/script>/;
const EMBED = /<script type="application\/json" id="v5-embed">([\s\S]*?)<\/script>/;
/** The overview page of templates/overview after the build, around a design model. */
const page = (design: any) => render({ phase: 'construction', lang: 'en', design });
const dataOf = (html: string) => JSON.parse(DATA.exec(html)![1].replace(/<\\!--/g, '<!--'));

describe('aidlc-turbo Review links: on the page after the push', () => {
  it('relink(html, links) puts the merge requests on the page as it is: its diffs and the rest untouched', () => {
    const design = { ...reviewModel(), note: 'a </b> and <!-- x -->' };
    const html = page(design);
    const out = relink(html, { brief: { merge_request: MR(9) }, stories: [story('001', MR(1))] })!;
    const after = dataOf(out).design;
    expect(after.build.links.stories).toEqual({ '001': MR(1) });
    expect(after.build.diffs).toEqual(design.build.diffs);
    expect(after.note).toBe(design.note);
    expect(out.replace(DATA.exec(out)![0], '')).toBe(html.replace(DATA.exec(html)![0], ''));
    expect(DATA.exec(out)![1]).not.toMatch(/<\/b>|<!-- x/);
  });

  it('never reaches into the C4 model the page embeds', () => {
    const html = withEmbed(page(reviewModel()), { ...v5Model(), views: { context: { id: 'ctx', name: 'Context' } } });
    const out = relink(html, { brief: { merge_request: MR(9) }, stories: [story('001', MR(1))] })!;
    expect(dataOf(out).design.build.links).toMatchObject({ intent: MR(9), stories: { '001': MR(1) } });
    expect(Object.keys(dataOf(out).design.build.links.anchors).length).toBeGreaterThan(0);
    // the embedded page is one JSON string with every < escaped: relink never reaches into it
    expect(EMBED.exec(out)![1]).toBe(EMBED.exec(html)![1]);
    // a page without a drawing has nothing to link and stays exactly as it is
    const plain = render({ phase: 'construction', lang: 'en', design: null });
    expect(relink(plain, { brief: { merge_request: MR(9) }, stories: [] })).toBe(plain);
  });

  it('replaces links it put there before; no merge request takes them away; a page it cannot read is null', () => {
    const m: any = reviewModel();
    m.build.links = { intent: MR(1), stories: {}, anchors: {} };
    expect(dataOf(relink(page(m), { brief: { merge_request: MR(2) }, stories: [] })!).design.build.links.intent).toBe(MR(2));
    expect(dataOf(relink(page(m), { brief: {}, stories: [] })!).design.build.links).toBeUndefined();
    const bare: any = reviewModel();
    delete bare.build;
    expect(dataOf(relink(page(bare), { brief: { merge_request: MR(2) }, stories: [] })!).design.build).toBeUndefined();
    expect(relink('<html></html>', { brief: {}, stories: [] })).toBeNull();
    expect(relink('<script id="overview-data" type="application/json">{broken</script>', { brief: {}, stories: [] })).toBeNull();
  });

  it('overview-links.cjs <intent> writes them into the overview of that intent from its brief and its stories', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'turbo-links-'));
    try {
      const dir = path.join(root, 'docs', 'inc', 'my-intent');
      mkdirSync(path.join(dir, 'stories'), { recursive: true });
      writeFileSync(path.join(dir, 'brief.md'), `---\nstatus: done\nmerge_request: "${MR(9)}"\n---\n# Brief\n`);
      writeFileSync(path.join(dir, 'stories', '001-one.md'), `---\nid: "001"\nstatus: done\nmerge_request: "${MR(1)}"\n---\n# One\n`);
      writeFileSync(path.join(dir, 'overview.html'), page(reviewModel()));
      const r = spawnSync(process.execPath, [path.join(FLOW, 'scripts/overview-links.cjs'), 'my-intent', '--root', root], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({ overview: path.join(dir, 'overview.html'), links: 2 });
      const after = dataOf(readFileSync(path.join(dir, 'overview.html'), 'utf8')).design;
      expect(after.build.links.intent).toBe(MR(9));
      expect(after.build.links.stories).toEqual({ '001': MR(1) });
      const none = spawnSync(process.execPath, [path.join(FLOW, 'scripts/overview-links.cjs'), 'no-intent', '--root', root], { encoding: 'utf8' });
      expect(none.status).toBe(1);
      writeFileSync(path.join(dir, 'overview.html'), '<html></html>');
      const unread = spawnSync(process.execPath, [path.join(FLOW, 'scripts/overview-links.cjs'), 'my-intent', '--root', root], { encoding: 'utf8' });
      expect(unread.status).toBe(1);
      expect(unread.stderr).toContain('No page data in');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('finish puts them on the page after the push, commits that page and shows it again', () => {
    const finish = readFileSync(path.join(FLOW, 'skills/construction/finish.md'), 'utf8');
    expect(finish).toMatch(/node \.specsmd\/aidlc-turbo\/scripts\/overview-links\.cjs \{intent\}/);
  });
});

describe('aidlc-turbo overview: the page data stays readable', () => {
  it('a change with an HTML comment or a closing tag in it (a pom.xml) still reads as JSON in the browser, relinked too', () => {
    const m: any = reviewModel();
    const file = Object.keys(m.build.diffs)[0];
    m.build.diffs[file] = { ...m.build.diffs[file], text: '@@ -1 +1 @@\n-<!-- a -->\n+<!-- b --> </script>\n' };
    const html = page(m);
    expect(DATA.exec(html)![1]).not.toMatch(/<!--|<\/script/i);
    const out = relink(html, { brief: { merge_request: MR(9) }, stories: [] })!;
    expect(DATA.exec(out)![1]).not.toMatch(/<!--|<\/script/i);
    expect(dataOf(out).design.build.diffs[file].text).toContain('<!-- b --> </script>');
  });
});
