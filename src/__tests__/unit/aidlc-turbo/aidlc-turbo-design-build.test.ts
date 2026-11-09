/**
 * Unit tests for lib/design-build.cjs: where the build deviated from the Code
 * Scaffold, computed from each built story's changed files and its build
 * notes. The drawing itself is never changed.
 * - buildNotesOf reads Outside and Different, as sub-bullets or on one line,
 *   "none." as nothing, and an item without a path as only a reason;
 * - a part is as planned when a file lies at its path, a module when a file
 *   lies under its path or is one of its registered_in files, else different;
 * - the notes win: a part named under Different is different, with the reason;
 * - a part in another repository and a changed table are not checkable;
 * - a file the scaffold does not name is extra, with the Outside reason or
 *   none; the migration of a changed table and .specs-aidlc-turbo/ are not;
 * - an Outside item without a matching file is listed all the same;
 * - an empty built leaves the model untouched;
 * - the page after the build in the builder's words: the Built line of a
 *   story, an item's "Why:" splitting what was built from why, a part
 *   under "Not built", what was planned taken from the story's drawing, a named
 *   new file drawn as a new part in its module, and a module "as planned"
 *   only when all its parts were;
 * - the one line after the build, in the record's language.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const { designModel } = req(path.join(FLOW, 'scripts/lib/design-model.cjs'));
const { buildNotesOf, applyBuild, buildLine } = req(path.join(FLOW, 'scripts/lib/design-build.cjs'));
const lang = req(path.join(FLOW, 'scripts/lib/lang.cjs'));

const record = () => ({
  technical_design: {
    drawing: {
      summary: 'A monitor on the orders.',
      modules: [
        { id: 'monitor', name: 'monitor', status: 'new', path: 'src/monitor', registered_in: [{ file: 'src/app/Modules.java', lines: '10' }] },
        { id: 'orders', name: 'orders', status: 'existing', path: 'src/orders' },
        { id: 'partner', name: 'partner', status: 'changed', path: 'lib/partner', repo: 'other-repo' },
      ],
      parts: [
        { id: 'screen', name: 'MonitorScreen', module: 'monitor', layer: 'screen', status: 'new', path: 'src/monitor/MonitorScreen.java' },
        { id: 'service', name: 'MonitorService', module: 'monitor', layer: 'server', status: 'new', path: 'src/monitor/MonitorService.java' },
        { id: 'repo', name: 'OrderRepository', module: 'orders', layer: 'server', status: 'changed', path: 'src/orders/OrderRepository.java', lines: '1-40' },
        { id: 'table', name: 'order', module: 'orders', layer: 'database', status: 'changed', path: 'db/order.sql', lines: '1-9' },
        { id: 'client', name: 'PartnerClient', module: 'partner', layer: 'external', status: 'changed', path: 'lib/partner/Client.java', lines: '1-5', repo: 'other-repo' },
        { id: 'old', name: 'Old', module: 'orders', layer: 'server', status: 'existing', path: 'src/orders/Old.java', lines: '1-3' },
      ],
      links: [],
    },
  },
  stories: [
    { id: '001', title: 'Monitor', drawing: { summary: 'x', builds: { monitor: 'new', screen: 'the screen', service: 'the service' }, uses: ['old'] } },
    { id: '002', title: 'Look up', drawing: { summary: 'y', builds: { repo: 'looks up', table: 'adds a column', client: 'calls', partner: 'signs on' } } },
    { id: '003', title: 'Nothing', drawing: { summary: 'z', builds: {} } },
  ],
});
const fresh = () => designModel(record());
const by = (m: any, id: string) => m.parts.find((p: any) => p.id === id) || m.modules.find((x: any) => x.id === id);
const notes = (outside: string, different: string) =>
  `## For the agent\n\n### Build notes\n\n- Built the screen.\n- **Outside the Code Scaffold**:${outside}\n- **Different from the Code Scaffold**:${different}\n`;

describe('buildNotesOf', () => {
  it('reads sub-bullets with the path first and the reason after it', () => {
    const md = notes(
      '\n  - `src/auth/TokenCache.java`: needed because the session would be fetched twice otherwise (D-3).',
      '\n  - `./src/auth/LoginService.java`: built in `src/auth/login/LoginService.java`, because the package login existed already.',
    );
    expect(buildNotesOf(md)).toEqual({
      outside: [{ path: 'src/auth/TokenCache.java', why: 'needed because the session would be fetched twice otherwise (D-3).' }],
      different: [{ path: 'src/auth/LoginService.java', why: 'built in `src/auth/login/LoginService.java`, because the package login existed already.' }],
      gone: [],
      built: null,
      changed: [],
    });
  });

  it('reads the single-line form', () => {
    expect(buildNotesOf(notes(' `a/B.java`: reason.', ' none.'))).toEqual({ outside: [{ path: 'a/B.java', why: 'reason.' }], different: [], gone: [], built: null, changed: [] });
  });

  it('reads "none." as no item', () => {
    expect(buildNotesOf(notes(' none.', ' none.'))).toEqual({ outside: [], different: [], gone: [], built: null, changed: [] });
  });

  it('keeps an item without a backticked path, as its reason', () => {
    expect(buildNotesOf(notes('\n  - an extra index on the table, for speed.', ' none.')).outside)
      .toEqual([{ path: null, why: 'an extra index on the table, for speed.' }]);
  });

  it('looks only inside the Build notes section when the file has one', () => {
    const md = '## Story\n\n- **Outside the Code Scaffold**: `not/This.java`: no.\n\n' + notes(' `yes/This.java`: yes.', ' none.') + '\n### Next\n\n- **Different from the Code Scaffold**: `also/Not.java`: no.\n';
    expect(buildNotesOf(md)).toEqual({ outside: [{ path: 'yes/This.java', why: 'yes.' }], different: [], gone: [], built: null, changed: [] });
  });

  it('gives empty lists for no notes at all', () => {
    expect(buildNotesOf('')).toEqual({ outside: [], different: [], gone: [], built: null, changed: [] });
    expect(buildNotesOf(undefined)).toEqual({ outside: [], different: [], gone: [], built: null, changed: [] });
  });
});

describe('applyBuild', () => {
  it('leaves the model untouched for an empty built', () => {
    const m = fresh();
    expect(applyBuild(m, [])).toBe(m);
    expect(m).toEqual(fresh());
    expect(m.build).toBeUndefined();
  });

  it('marks parts as planned when a file lies at their path', () => {
    const m = applyBuild(fresh(), [{ id: '001', files: ['src/monitor/MonitorScreen.java', 'src/monitor/MonitorService.java'], notes: notes(' none.', ' none.') }]);
    expect(by(m, 'screen').build).toEqual({ state: 'as_planned', story: '001', why: null });
    expect(by(m, 'service').build.state).toBe('as_planned');
    expect(m.build).toEqual({ stories: [{ id: '001', n: '1', built: null, different: [], extra: [], gone: [] }], different: 0, extra: 0, gone: 0, changes: {} });
    expect(buildLine(m.build)).toBe('Code Scaffold: built as planned');
  });

  it('marks a part different when no file lies at its path', () => {
    const m = applyBuild(fresh(), [{ id: '001', files: ['src/monitor/MonitorScreen.java'], notes: '' }]);
    expect(by(m, 'service').build).toEqual({ state: 'different', story: '001', story_name: '1. Monitor', plan: 'the service', built: null, why: null });
    expect(m.build.stories[0].different).toEqual([{ id: 'service', name: 'MonitorService', path: 'src/monitor/MonitorService.java', plan: 'the service', built: null, why: null }]);
  });

  it('marks a part different when the notes name it under Different, with the reason, even with its file there', () => {
    const md = notes(' none.', '\n  - `src/monitor/MonitorScreen.java`: a tab instead of a screen of its own.');
    const m = applyBuild(fresh(), [{ id: '001', files: ['src/monitor/MonitorScreen.java', 'src/monitor/MonitorService.java'], notes: md }]);
    expect(by(m, 'screen').build).toEqual({ state: 'different', story: '001', story_name: '1. Monitor', plan: 'the screen', built: null, why: 'a tab instead of a screen of its own.' });
    expect(m.build.different).toBe(1);
  });

  it('checks a module by a file under its folder or by a registered_in file', () => {
    const both = ['src/monitor/MonitorScreen.java', 'src/monitor/MonitorService.java'];
    const under = applyBuild(fresh(), [{ id: '001', files: both }]);
    expect(by(under, 'monitor').build.state).toBe('as_planned');
    const registered = applyBuild(fresh(), [{ id: '001', files: ['src/app/Modules.java', ...both] }]);
    expect(by(registered, 'monitor').build.state).toBe('as_planned');
    expect(registered.build.stories[0].extra).toEqual([]);
    const neither = applyBuild(fresh(), [{ id: '001', files: ['src/elsewhere/X.java'] }]);
    expect(by(neither, 'monitor').build.state).toBe('different');
  });

  it('does not check a part in another repository or a changed table, unless the notes name it', () => {
    const m = applyBuild(fresh(), [{ id: '002', files: ['src/orders/OrderRepository.java'] }]);
    expect(by(m, 'client').build).toBeUndefined();
    expect(by(m, 'partner').build).toBeUndefined();
    expect(by(m, 'table').build).toBeUndefined();
    expect(by(m, 'repo').build.state).toBe('as_planned');
    const noted = applyBuild(fresh(), [{ id: '002', files: ['src/orders/OrderRepository.java'], notes: notes(' none.', ' `db/order.sql`: a new table instead of a column.') }]);
    expect(by(noted, 'table').build).toEqual({ state: 'different', story: '002', story_name: '2. Look up', plan: 'adds a column', built: null, why: 'a new table instead of a column.' });
  });

  it('counts the .sql migration of a changed table as on the scaffold', () => {
    const m = applyBuild(fresh(), [{ id: '002', files: ['src/orders/OrderRepository.java', 'db/migrations/2026-10-20-order.sql'] }]);
    expect(m.build.stories[0].extra).toEqual([]);
    const without = applyBuild(fresh(), [{ id: '001', files: ['src/monitor/MonitorScreen.java', 'src/monitor/MonitorService.java', 'db/migrations/x.sql'] }]);
    expect(without.build.stories[0].extra).toEqual([{ file: 'db/migrations/x.sql', name: 'x', built: null, why: null }]);
  });

  it('counts a part built in another place once: the place its reason names is no extra', () => {
    const md = notes(' none.', '\n  - `src/monitor/MonitorService.java`: built in `src/monitor/service/MonitorService.java`, because the package service existed already.');
    const m = applyBuild(fresh(), [{ id: '001', files: ['src/monitor/MonitorScreen.java', 'src/monitor/service/MonitorService.java'], notes: md }]);
    expect(by(m, 'service').build.state).toBe('different');
    expect(m.build.stories[0].extra).toEqual([]);
    expect(buildLine(m.build)).toBe('Code Scaffold: 1 different from the design, 0 added');
  });

  it('lists extra files with the Outside reason, or without one', () => {
    const md = notes('\n  - `src/monitor/cache`: needed for speed.', ' none.');
    const m = applyBuild(fresh(), [{ id: '001', files: ['src/monitor/MonitorScreen.java', 'src/monitor/MonitorService.java', 'src/monitor/cache/Cache.java', 'pom.xml'], notes: md }]);
    expect(m.build.stories[0].extra).toEqual([
      { file: 'src/monitor/cache/Cache.java', name: 'Cache', built: null, why: 'needed for speed.' },
      { file: 'pom.xml', name: 'pom', built: null, why: null },
    ]);
    expect(buildLine(m.build)).toBe('Code Scaffold: 0 different from the design, 2 added');
  });

  it('drops .specs-aidlc-turbo paths', () => {
    const m = applyBuild(fresh(), [{ id: '001', files: ['src/monitor/MonitorScreen.java', 'src/monitor/MonitorService.java', '.specs-aidlc-turbo/docs/a/b/stories/001-x.md'] }]);
    expect(m.build.extra).toBe(0);
  });

  it('lists Outside items that match no file, and items without a path', () => {
    const md = notes('\n  - `src/gone/Gone.java`: turned out not to be needed.\n  - an extra role for the admin.', ' none.');
    const m = applyBuild(fresh(), [{ id: '001', files: ['src/monitor/MonitorScreen.java', 'src/monitor/MonitorService.java'], notes: md }]);
    expect(m.build.stories[0].extra).toEqual([
      { file: 'src/gone/Gone.java', name: 'Gone', built: null, why: 'turned out not to be needed.' },
      { file: null, name: null, built: null, why: 'an extra role for the admin.' },
    ]);
  });

  it('keeps a reported deviation that names no part of the drawing', () => {
    const m = applyBuild(fresh(), [{ id: '001', files: ['src/monitor/MonitorScreen.java', 'src/monitor/MonitorService.java'], notes: notes(' none.', ' `src/nowhere/X.java`: otherwise.') }]);
    expect(m.build.stories[0].different).toEqual([{ id: null, name: null, path: 'src/nowhere/X.java', plan: null, built: null, why: 'otherwise.' }]);
  });

  it('leaves parts no built story builds without a state, and lists every built story in order', () => {
    const m = applyBuild(fresh(), [
      { id: '003', files: ['README.md'] },
      { id: '1', files: ['src/monitor/MonitorScreen.java'] },
    ]);
    expect(by(m, 'repo').build).toBeUndefined();
    expect(by(m, 'old').build).toBeUndefined();
    expect(m.build.stories.map((s: any) => s.n)).toEqual(['1', '3']);
    expect(m.build.stories[1]).toEqual({ id: '003', n: '3', built: null, different: [], extra: [{ file: 'README.md', name: 'README', built: null, why: null }], gone: [] });
    expect(buildLine(m.build)).toBe('Code Scaffold: 1 different from the design, 1 added');
  });
});

/** The record with what each part of story 1 was drawn to do. */
function drawn() {
  const r: any = record();
  const parts = r.technical_design.drawing.parts;
  parts.find((p: any) => p.id === 'service').what = 'Delivers the orders to the screen.';
  parts.find((p: any) => p.id === 'screen').sub = 'shows the orders';
  return designModel(r);
}
const MONITOR = ['src/monitor/MonitorScreen.java', 'src/monitor/MonitorService.java'];
const story1 = (lines: string) => `### Build notes\n\n- **Files changed**: x\n${lines}\n`;

describe('buildNotesOf: the build in the builder\'s words', () => {
  it('reads the Built line, also when it wraps onto the next line', () => {
    const md = story1('- **Built**: An empty answer makes the order fail.\n  The check sits in the parser.\n- **Outside the Code Scaffold**: none.');
    expect(buildNotesOf(md).built).toBe('An empty answer makes the order fail. The check sits in the parser.');
    expect(buildNotesOf(story1('- **Built**: none.')).built).toBeNull();
  });

  it('splits an item at "Why:" into what was built and why, with or without "Built:" in front', () => {
    const md = story1('- **Different from the Code Scaffold**:\n  - `src/a/B.java`: Refuses an empty list too. Why: The worker read the content earlier already.\n'
      + '- **Outside the Code Scaffold**:\n  - `src/a/C.java`: Built: Remembers the answer. why: faster.');
    expect(buildNotesOf(md).different).toEqual([{ path: 'src/a/B.java', built: 'Refuses an empty list too.', why: 'The worker read the content earlier already.' }]);
    expect(buildNotesOf(md).outside).toEqual([{ path: 'src/a/C.java', built: 'Remembers the answer.', why: 'faster.' }]);
  });

  it('reads the parts under "Not built", with their reason', () => {
    const md = story1('- **Not built**:\n  - `src/monitor/MonitorService.java`: The name is on the order already.\n- **Different from the Code Scaffold**: none.');
    expect(buildNotesOf(md).gone).toEqual([{ path: 'src/monitor/MonitorService.java', why: 'The name is on the order already.' }]);
    expect(buildNotesOf(story1('- **Not built**: none.')).gone).toEqual([]);
  });
});

describe('applyBuild: the build in the builder\'s words', () => {
  it('gives a part built otherwise what was planned from the story\'s drawing, what was built and why from the notes, and its story', () => {
    const md = story1('- **Different from the Code Scaffold**:\n  - `src/monitor/MonitorService.java`: Delivers only the new orders. Why: The screen refreshes by itself.');
    const m = applyBuild(drawn(), [{ id: '001', files: MONITOR, notes: md }]);
    // what the story's drawing says it builds there; the part's own description shows apart, under "What it does"
    const want = { plan: 'the service', built: 'Delivers only the new orders.', why: 'The screen refreshes by itself.' };
    expect(by(m, 'service').build).toEqual({ state: 'different', story: '001', story_name: '1. Monitor', ...want });
    expect(m.build.stories[0].different).toEqual([{ id: 'service', name: 'MonitorService', path: 'src/monitor/MonitorService.java', ...want }]);
  });

  it('takes a part\'s short line, then its description, as what was planned for a part the story\'s drawing says nothing of', () => {
    const md = story1('- **Different from the Code Scaffold**: `src/monitor/MonitorScreen.java`: A tab. Why: Fits better.');
    expect(by(applyBuild(drawn(), [{ id: '001', files: MONITOR, notes: md }]), 'screen').build.plan).toBe('the screen');
    const r: any = record();
    const said = r.technical_design.drawing.parts.find((p: any) => p.id === 'old');
    const unused = (x: any) => { Object.assign(said, x); return by(applyBuild(designModel(r), [{ id: '001', files: MONITOR, notes: story1('- **Not built**: `src/orders/Old.java`: Why: not needed.') }]), 'old').build.plan; };
    expect(unused({ sub: 'the old orders', what: 'Keeps the old orders. Nobody reads them any more.' })).toBe('the old orders');
    delete said.sub;
    expect(unused({})).toBe('Keeps the old orders. Nobody reads them any more.');
  });

  it('marks a part under "Not built" as not built, apart from the parts built otherwise, and counts it', () => {
    const md = story1('- **Not built**:\n  - `src/monitor/MonitorService.java`: The name is on the order already.');
    const m = applyBuild(drawn(), [{ id: '001', files: ['src/monitor/MonitorScreen.java'], notes: md }]);
    expect(by(m, 'service').build).toEqual({ state: 'gone', story: '001', story_name: '1. Monitor', plan: 'the service', built: null, why: 'The name is on the order already.' });
    expect(m.build.stories[0].different).toEqual([]);
    expect(m.build.stories[0].gone).toEqual([{ id: 'service', name: 'MonitorService', path: 'src/monitor/MonitorService.java', plan: 'the service', why: 'The name is on the order already.' }]);
    expect(m.build.gone).toBe(1);
    expect(buildLine(m.build)).toBe('Code Scaffold: 0 different from the design, 0 added, 1 not built or used');
  });

  it('says a module was built as planned only when every part in it was', () => {
    const md = story1('- **Not built**: `src/monitor/MonitorService.java`: not needed.');
    expect(by(applyBuild(drawn(), [{ id: '001', files: ['src/monitor/MonitorScreen.java'], notes: md }]), 'monitor').build).toBeUndefined();
    expect(by(applyBuild(drawn(), [{ id: '001', files: MONITOR }]), 'monitor').build.state).toBe('as_planned');
  });

  it('keeps the Built line of every story', () => {
    const m = applyBuild(drawn(), [{ id: '001', files: MONITOR, notes: story1('- **Built**: The screen shows the orders.') }]);
    expect(m.build.stories[0].built).toBe('The screen shows the orders.');
  });

  it('draws a new file the notes name under Outside as a new part in the module it lies in, built by its story', () => {
    const md = story1('- **Outside the Code Scaffold**:\n  - `src/monitor/cache/AnswerCache.java`: Remembers the answer per order. Why: Fetched twice otherwise.');
    const m = applyBuild(drawn(), [{ id: '001', files: [...MONITOR, 'src/monitor/cache/AnswerCache.java'], notes: md }]);
    const p = by(m, 'answercache');
    expect(p).toMatchObject({ name: 'AnswerCache', module: 'monitor', layer: 'server', status: 'new', kind: 'class',
      path: 'src/monitor/cache/AnswerCache.java', what: 'Remembers the answer per order.', stories: ['001'] });
    expect(p.build).toEqual({ state: 'added', story: '001', story_name: '1. Monitor', plan: null, built: 'Remembers the answer per order.', why: 'Fetched twice otherwise.' });
    expect(p.confidence.level).toBe('green');
    expect(m.frames.find((f: any) => f.id === 'monitor@server').parts).toContain('answercache');
    expect(m.stories[0].parts).toContain('answercache');
    expect(m.stories[0].builds.answercache).toBe('Remembers the answer per order.');
    expect(m.build.stories[0].extra).toEqual([{ file: 'src/monitor/cache/AnswerCache.java', name: 'AnswerCache', built: 'Remembers the answer per order.', why: 'Fetched twice otherwise.' }]);
  });

  it('draws every changed file in a drawn module as its own part, also one the notes do not name', () => {
    const md = story1('- **Outside the Code Scaffold**:\n  - `src/elsewhere/Loose.java`: Loose. Why: needed.');
    const m = applyBuild(drawn(), [{ id: '001', files: [...MONITOR, 'src/elsewhere/Loose.java', 'src/monitor/Extra.java'], notes: md }]);
    // the unnamed one gets a part, without a text: the builder did not say what it is
    expect(m.parts).toHaveLength(drawn().parts.length + 1);
    expect(by(m, 'extra')).toMatchObject({ name: 'Extra', module: 'monitor', status: 'new', path: 'src/monitor/Extra.java', what: null, stories: ['001'] });
    expect(by(m, 'extra').build).toMatchObject({ state: 'added', built: null, why: null });
    // outside every module there is no frame to draw it in: it stays in the list
    expect(m.parts.some((p: any) => p.path === 'src/elsewhere/Loose.java')).toBe(false);
    expect(m.build.stories[0].extra.map((e: any) => e.file)).toEqual(['src/elsewhere/Loose.java', 'src/monitor/Extra.java']);
  });
});

describe('applyBuild: a note on a part the story only uses', () => {
  it('marks a drawn part under "Not built" or Different by its path, also when the story only uses it', () => {
    const gone = applyBuild(drawn(), [{ id: '001', files: MONITOR, notes: story1('- **Not built**: `src/orders/Old.java`: Why: not needed.') }]);
    expect(by(gone, 'old').build).toEqual({ state: 'gone', story: '001', story_name: '1. Monitor', plan: null, built: null, why: 'not needed.' });
    expect(gone.build.stories[0].gone).toEqual([{ id: 'old', name: 'Old', path: 'src/orders/Old.java', plan: null, why: 'not needed.' }]);
    const other = applyBuild(drawn(), [{ id: '001', files: [...MONITOR, 'src/orders/Old.java'], notes: story1('- **Different from the Code Scaffold**: `src/orders/Old.java`: Extended. Why: needed.') }]);
    // its file is that part, not an extra
    expect(other.build.stories[0].extra).toEqual([]);
    expect(by(other, 'old').build).toMatchObject({ state: 'different', built: 'Extended.', why: 'needed.' });
    expect(other.build.stories[0].different).toEqual([{ id: 'old', name: 'Old', path: 'src/orders/Old.java', plan: null, built: 'Extended.', why: 'needed.' }]);
  });
});

describe('buildLine and the added part in the record\'s language', () => {
  /** A project table in the pseudo-language xx: the English texts of the build line in capitals. */
  function xx() {
    const root = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-build-lang-')), '.specs-aidlc-turbo');
    mkdirSync(path.join(root, 'repo', 'lang'), { recursive: true });
    const en = lang.load('en');
    const up = (v: any): any => (typeof v === 'string' ? v.toUpperCase().replace(/\{(\w+)\}/g, (m: string, k: string) => `{${k.toLowerCase()}}`)
      : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, up(x)])));
    writeFileSync(path.join(root, 'repo', 'lang', 'xx.json'), JSON.stringify({ design: { buildLine: up(en.design.buildLine), added: up(en.design.added) } }));
    return lang.load('xx', root);
  }

  it('writes the one line after the build from the table it is given', () => {
    const table = xx();
    expect(buildLine({ stories: [], different: 0, extra: 0, gone: 0 }, table)).toBe('CODE SCAFFOLD: BUILT AS PLANNED');
    expect(buildLine({ stories: [], different: 2, extra: 1, gone: 3 }, table)).toBe('CODE SCAFFOLD: 2 DIFFERENT FROM THE DESIGN, 1 ADDED, 3 NOT BUILT OR USED');
  });

  it('gives a part the build added its reason from the table it is given', () => {
    const md = story1('- **Outside the Code Scaffold**:\n  - `src/monitor/cache/AnswerCache.java`: Remembers the answer.');
    const m = applyBuild(drawn(), [{ id: '001', files: [...MONITOR, 'src/monitor/cache/AnswerCache.java'], notes: md }], xx());
    expect(by(m, 'answercache').confidence.reasons).toEqual([lang.load('en').design.added.toUpperCase()]);
  });
});
