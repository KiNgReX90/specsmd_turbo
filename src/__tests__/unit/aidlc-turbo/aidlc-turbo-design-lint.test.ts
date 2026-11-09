/**
 * Unit tests for lib/design-lint.cjs, spec-lint's check of the Code
 * Scaffold in record.yaml. The fixture is the order status intent; a fake
 * disk stands in for the target project, so no test needs Acme Shop:
 * - the order status drawing is clean, and a record without a drawing too;
 * - ids unique over modules and parts, no @, every value a known one;
 * - a part's module exists, every module has a part;
 * - changed and existing parts carry a checked place (path and lines) that
 *   exists and holds those lines; a part in another repository only needs
 *   them given; a new part's path does not exist yet;
 * - every example (follows) and registration (registered_in) exists;
 * - stories build only what is new or changed, all of it, inside touches;
 * - links, builds and uses name known ids; a new right names its decision;
 * - every arrow proven: a call into an existing part has proof and no
 *   adds, into a changed part proof or adds, into a new part nothing;
 *   builds_on is exempt; a proof exists and holds its lines, unless the
 *   callee lives in another repository;
 *   an open choice is written out; the drawing and every story summarize;
 * - diskFsx reads the real disk for spec-lint.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const { lintDrawing, diskFsx } = req(path.join(FLOW, 'scripts/lib/design-lint.cjs'));
const { parseYaml } = req(path.join(FLOW, 'scripts/render-specs.cjs'));

const FIXTURE = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');
const record = () => parseYaml(readFileSync(FIXTURE, 'utf8'));

// Acme Shop as the explorers found it: every place the drawing points at, none of the new parts.
const FILES: Record<string, number> = {
  'shop-web-components/src/main/resources/static/web-components/components/shop-card/shop-card.js': 120,
  'shop-web-components/src/main/resources/static/web-components/components/shop-datatable/shop-datatable.js': 400,
  'shop-web-components/src/main/resources/static/web-components/services/api-client.js': 36,
  'shop-server/src/main/resources/admin-routes.yml': 700,
  'db/migrations/V2026_07_02_03__order_status_events.sql': 27,
  'db/migrations/V2026_07_02_01__orders.sql': 17,
  'db/migrations/V2026_07_01_02__returns_menu.sql': 40,
  'shop-server/src/main/webapp/admin/menu/AdminMenu.jsp': 200,
  'shop-returns-ui/src/main/resources/static/returns/returns-bootstrap.js': 90,
  'shop-returns-ui/src/main/resources/static/returns/services/returns-service.js': 60,
  'shop-server/src/main/java/com/acme/shop/settings/payment/PaymentSettingsProvider.java': 21,
  'shop-settings/src/main/java/com/acme/shop/settings/payment/PaymentSettings.java': 15,
  'shop-returns-adapters/src/main/java/com/acme/shop/returns/adapters/inbound/web/ReturnsController.java': 40,
  'shop-returns-adapters/src/main/java/com/acme/shop/returns/adapters/outbound/carrier/CarrierGatewayImpl.java': 80,
  'shop-returns-core/src/main/java/com/acme/shop/returns/core/ports/inbound/usecases/CreateReturnUseCase.java': 30,
  'shop-returns-ui/pom.xml': 60,
  'shop-returns-adapters/pom.xml': 60,
  'shop-returns-core/pom.xml': 60,
  'shop-parent/pom.xml': 300,
  'shop-server/pom.xml': 600,
  'shop-server/src/main/java/com/acme/shop/security/AdminRoles.java': 250,
};

/** A disk of files with their line counts; a folder exists when a file sits under it. */
function disk(files: Record<string, number> = FILES) {
  return {
    exists: (p: string) => p in files || Object.keys(files).some((f) => f.startsWith(`${p}/`)),
    lineCount: (p: string) => (p in files ? files[p] : null),
  };
}

function lint(r: any, files?: Record<string, number>) {
  const out: Array<{ file: string; rule: string; message: string }> = [];
  lintDrawing(r, (file: string, rule: string, message: string) => out.push({ file, rule, message }), disk(files));
  return out;
}
const messages = (r: any, files?: Record<string, number>) => lint(r, files).map((f) => f.message);

const D = 'technical_design.drawing';
const partOf = (r: any, id: string) => r.technical_design.drawing.parts.find((p: any) => p.id === id);
const moduleOf = (r: any, id: string) => r.technical_design.drawing.modules.find((m: any) => m.id === id);

describe('lintDrawing', () => {
  it('passes the order status drawing, every finding on record.yaml under the rule drawing', () => {
    expect(lint(record())).toEqual([]);
    const r = record();
    delete r.technical_design.drawing.summary;
    expect(lint(r)).toEqual([{ file: 'record.yaml', rule: 'drawing', message: `${D} has no summary: say in a few plain sentences, in the record's language, what the drawing shows` }]);
  });

  it('is clean for a record without a drawing', () => {
    expect(lint({ technical_design: { modules: ['auth'] }, stories: [{ id: '001' }] })).toEqual([]);
    expect(lint({})).toEqual([]);
  });

  it('wants ids unique over modules and parts, filled, and without @', () => {
    const r = record();
    partOf(r, 'kpi').id = 'ui';
    partOf(r, 'card').id = 'card@screen';
    delete partOf(r, 'table').id;
    const m = messages(r);
    expect(m).toContain(`${D}: id ui appears twice: module and part ids are unique together`);
    expect(m).toContain(`${D}: id card@screen holds an @: the drawing keeps @ for a module's frame per layer, pick another id`);
    expect(m).toContain(`${D}: parts[7] has no id`);
  });

  it('wants every layer, status, kind, link kind and right status to be a known value', () => {
    const r = record();
    partOf(r, 'menu').layer = 'browser';
    partOf(r, 'host').status = 'modified';
    partOf(r, 'chart').kind = 'widget';
    delete partOf(r, 'kpi').kind;
    moduleOf(r, 'ui').status = 'fresh';
    partOf(r, 'menu').right.status = 'maybe';
    r.technical_design.drawing.links[0].kind = 'uses';
    const m = messages(r);
    expect(m).toContain(`${D}: part menu has layer "browser", expected one of screen, server, database, external`);
    expect(m).toContain(`${D}: part host has status "modified", expected one of new, changed, existing`);
    expect(m.find((x: string) => x.startsWith(`${D}: part chart has kind "widget", expected one of class, abstract class,`))).toBeTruthy();
    expect(m.find((x: string) => x.startsWith(`${D}: part kpi has no kind, expected one of class,`))).toBeTruthy();
    expect(m).toContain(`${D}: module ui has status "fresh", expected one of new, changed, existing`);
    expect(m).toContain(`${D}: part menu has right.status "maybe", expected new or existing`);
    expect(m).toContain(`${D}: link menu -> host has kind "uses", expected calls or builds_on`);
  });

  it('wants a part\'s module to exist and every module to have a part', () => {
    const r = record();
    partOf(r, 'iface').module = 'settings';
    const m = messages(r);
    expect(m).toContain(`${D}: part iface names module settings, which is not a module id`);
    expect(m).toContain(`${D}: module setm has no part: give it its parts, or drop it`);
  });

  it('wants the place of a changed or existing part checked in the code', () => {
    const r = record();
    delete partOf(r, 'routes').lines;
    delete partOf(r, 'card').path;
    partOf(r, 'table').lines = '1-480';
    partOf(r, 'api').path = 'shop-web-components/services/api.js';
    partOf(r, 'orders').lines = 'top';
    const m = messages(r);
    const unchecked = (id: string, status: string) => `${D}: part ${id} is ${status} but the place in the code is not checked: give path and lines, an explorer looks it up`;
    expect(m).toContain(unchecked('routes', 'changed'));
    expect(m).toContain(unchecked('card', 'existing'));
    expect(m).toContain(`${D}: part table: lines 1-480 fall outside shop-web-components/src/main/resources/static/web-components/components/shop-datatable/shop-datatable.js, which has 400 lines`);
    expect(m).toContain(`${D}: part api: path shop-web-components/services/api.js does not exist: fix the path, or mark the part new`);
    expect(m).toContain(`${D}: part orders: lines "top" is not N or N-M`);
  });

  it('only wants path and lines of a part in another repository', () => {
    const r = record();
    partOf(r, 'whact').path = 'warehouse-api/src/elsewhere/IntakeController.java';
    partOf(r, 'whact').lines = '44-99999';
    delete partOf(r, 'whread').lines;
    expect(messages(r)).toEqual([`${D}: part whread is existing but the place in the code is not checked: give path and lines, an explorer looks it up`]);
  });

  it('refuses a new part or module whose path already exists, unless it lives in another repository', () => {
    const r = record();
    partOf(r, 'host').path = 'shop-server/src/main/webapp/admin/menu/AdminMenu.jsp';
    moduleOf(r, 'core').path = 'shop-returns-core';
    delete partOf(r, 'kpi').path;
    const m = messages(r);
    expect(m).toContain(`${D}: part host is new but shop-server/src/main/webapp/admin/menu/AdminMenu.jsp already exists: it is not new, mark it changed and give its lines`);
    expect(m).toContain(`${D}: module core is new but shop-returns-core already exists: mark it changed`);
    expect(m).toContain(`${D}: part kpi has no path: give the repo-relative file or folder it creates`);
    const other = record();
    partOf(other, 'host').repo = 'portal';
    partOf(other, 'host').path = 'shop-server/pom.xml';
    expect(lint(other)).toEqual([]);
  });

  it('refuses a .md file as a part: documentation is no part of the Code Scaffold', () => {
    const r = record();
    partOf(r, 'host').path = 'project-docs/payment-integration.md';
    partOf(r, 'kpi').path = 'docs/Key-Decisions.MD';
    const m = messages(r, { ...FILES, 'project-docs/payment-integration.md': 80 });
    expect(m).toContain(`${D}: part host is a .md file (project-docs/payment-integration.md): documentation is no part of the Code Scaffold, leave it out`);
    expect(m).toContain(`${D}: part kpi is a .md file (docs/Key-Decisions.MD): documentation is no part of the Code Scaffold, leave it out`);
  });

  it('wants a changed or existing module to exist', () => {
    const r = record();
    moduleOf(r, 'wc').path = 'shop-components';
    delete moduleOf(r, 'setm').path;
    const m = messages(r);
    expect(m).toContain(`${D}: module wc: path shop-components does not exist: fix the path, or mark the module new`);
    expect(m).toContain(`${D}: module setm is changed but has no path: give the folder it lives in`);
  });

  it('wants every example and every registration to exist and hold its lines', () => {
    const r = record();
    partOf(r, 'gw').follows.file = 'shop-returns-adapters/CarrierGateway.java';
    partOf(r, 'ctrl').follows.lines = '11-90';
    moduleOf(r, 'ui').registered_in[1].file = 'shop-server/build.gradle';
    moduleOf(r, 'ad').registered_in[0].lines = '100-900';
    moduleOf(r, 'core').follows.file = 'shop-return-core/pom.xml';
    const m = messages(r);
    expect(m).toContain(`${D}: part gw: follows.file shop-returns-adapters/CarrierGateway.java does not exist`);
    expect(m).toContain(`${D}: part ctrl: follows lines 11-90 fall outside shop-returns-adapters/src/main/java/com/acme/shop/returns/adapters/inbound/web/ReturnsController.java, which has 40 lines`);
    expect(m).toContain(`${D}: module ui: registered_in shop-server/build.gradle does not exist`);
    expect(m).toContain(`${D}: module ad: registered_in lines 100-900 fall outside shop-parent/pom.xml, which has 300 lines`);
    expect(m).toContain(`${D}: module core: follows.file shop-return-core/pom.xml does not exist`);
    expect(m).toHaveLength(5);
    // In another repository the example cannot be checked on disk.
    const other = record();
    partOf(other, 'whread').follows = { file: 'warehouse-api/src/Other.java', lines: '1-5' };
    expect(lint(other)).toEqual([]);
  });

  it('wants stories to build only what is new or changed, and all of it', () => {
    const r = record();
    r.stories[2].drawing.builds.table = 'adds a column';
    r.stories[0].drawing.builds.wh = 'adds an endpoint';
    delete r.stories[1].drawing.builds.kpi;
    delete r.stories[1].drawing.builds.ui;
    const m = messages(r);
    expect(m).toContain('story 003: drawing builds table, which is existing: move it to uses, or mark it changed');
    expect(m).toContain('story 001: drawing builds wh, which is existing: move it to uses, or mark it changed');
    expect(m).toContain(`${D}: part kpi is new but no story builds it: add it to a story's drawing.builds`);
    expect(m).toContain(`${D}: module ui is new but no story builds it: add it to a story's drawing.builds`);
  });

  it('wants the path of every part and module a story builds inside its touches', () => {
    const r = record();
    r.stories[4].touches = r.stories[4].touches.filter((t: string) => !t.endsWith('WarehouseGatewayImpl.java'));
    r.stories[2].touches = r.stories[2].touches.map((t: string) => t.replace('shop-orderstatus-page.js', 'shop-orderstatus-page.jsx'));
    const m = messages(r);
    expect(m).toContain('story 005: drawing builds part gw at shop-orderstatus-adapters/src/main/java/com/acme/shop/orderstatus/adapters/outbound/warehouse/WarehouseGatewayImpl.java, which no touches entry covers: add the path or a folder of it to touches');
    expect(m.filter((x: string) => x.startsWith('story 003: drawing builds part page at'))).toHaveLength(1);
    expect(m).toHaveLength(2);
    // A folder in touches covers the file, a file in touches covers the folder it sits in, and ./ or a trailing / do not count.
    const ok = record();
    ok.stories[4].touches = ['./shop-orderstatus-adapters/', 'shop-orderstatus-ui/src/main/resources/static/orderstatus/components/shop-orderstatus-page/shop-orderstatus-page.js', 'shop-orderstatus-core/src/main/java/com/acme/shop/orderstatus/core/ports/inbound/usecases/RunActionUseCase.java'];
    expect(lint(ok)).toEqual([]);
    // A module a story builds sits in its touches too.
    const mod = record();
    mod.stories[1].touches = mod.stories[1].touches.filter((t: string) => t !== 'shop-orderstatus-ui');
    expect(messages(mod)).toContain('story 002: drawing builds module ui at shop-orderstatus-ui, which no touches entry covers: add the path or a folder of it to touches');
  });

  it('lets a changed table be built from a new migration outside its path', () => {
    // The fixture's story 002 adds the index of ORDER_STATUS_EVENTS in a migration of its own.
    const r = record();
    expect(r.stories[1].touches.some((t: string) => t.startsWith(partOf(r, 'events').path))).toBe(false);
    expect(lint(r)).toEqual([]);
    partOf(r, 'orders').status = 'changed';
    r.stories[1].drawing.builds.orders = 'adds a column';
    r.stories[1].drawing.uses = r.stories[1].drawing.uses.filter((u: string) => u !== 'orders');
    expect(lint(r)).toEqual([]);
  });

  it('wants links, builds and uses to name known ids', () => {
    const r = record();
    r.technical_design.drawing.links.push({ from: 'page', to: 'ui' }, { from: 'ghost', to: 'host' }, { to: 'host' });
    r.stories[0].drawing.builds.api2 = 'new';
    r.stories[0].drawing.uses.push('whx');
    const m = messages(r);
    expect(m).toContain(`${D}: link page -> ui: to ui is not a part id`);
    expect(m).toContain(`${D}: link ghost -> host: from ghost is not a part id`);
    expect(m).toContain(`${D}: link 22 has no from`);
    expect(m).toContain('story 001: drawing builds api2, which is not a part or module id');
    expect(m).toContain('story 001: drawing uses whx, which is not a part or module id');
  });

  it('wants a call into an existing part proven in the code, and no addition to it', () => {
    const r = record();
    const link = (from: string, to: string) => r.technical_design.drawing.links.find((l: any) => l.from === from && l.to === to);
    delete link('svc', 'api').proof;
    link('trend', 'orders').adds = 'adds a column';
    expect(messages(r)).toEqual([
      `${D}: link svc -> api calls an existing part without proof: give proof.file and proof.lines where api already offers what is called, an explorer looks it up; when it is not there, mark api changed and say in adds what the change adds`,
      `${D}: link trend -> orders has adds, but orders is existing and changes nothing: mark orders changed, or drop adds`,
    ]);
    // A link without a kind calls; a part in another repository needs its proof too.
    delete link('gw', 'whact').proof;
    expect(messages(r)).toContain(`${D}: link gw -> whact calls an existing part without proof: give proof.file and proof.lines where whact already offers what is called, an explorer looks it up; when it is not there, mark whact changed and say in adds what the change adds`);
  });

  it('wants a call into a changed part proven, or the addition named', () => {
    const r = record();
    const link = r.technical_design.drawing.links.find((l: any) => l.to === 'events');
    delete link.adds;
    expect(messages(r)).toEqual([`${D}: link trend -> events calls a changed part with neither proof nor adds: give proof.file and proof.lines where events already offers what is called, an explorer looks it up, or say in adds what the change to events adds for this call`]);
    link.proof = { file: 'db/migrations/V2026_07_02_03__order_status_events.sql', lines: '1-27' };
    expect(lint(r)).toEqual([]);
  });

  it('wants a proof that exists and holds its lines, unless the callee lives in another repository', () => {
    const r = record();
    const link = (to: string) => r.technical_design.drawing.links.find((l: any) => l.to === to);
    link('api').proof.file = 'shop-web-components/services/api.js';
    link('table').proof.lines = '1-480';
    link('orders').proof.lines = 'top';
    delete link('whact').proof.lines;
    expect(messages(r)).toEqual([
      `${D}: link svc -> api: proof.file shop-web-components/services/api.js does not exist`,
      `${D}: link page -> table: proof lines 1-480 fall outside shop-web-components/src/main/resources/static/web-components/components/shop-datatable/shop-datatable.js, which has 400 lines`,
      `${D}: link trend -> orders: proof lines "top" is not N or N-M`,
      `${D}: link gw -> whact: proof has no lines: give the lines in warehouse-api/src/main/java/com/acme/warehouse/api/intake/IntakeController.java where whact offers it`,
    ]);
    // In another repository the proof is given, not checked on disk.
    const other = record();
    other.technical_design.drawing.links.find((l: any) => l.to === 'whread').proof = { file: 'warehouse-api/src/Elsewhere.java', lines: '1-99999' };
    expect(lint(other)).toEqual([]);
  });

  it('wants nothing of a call into a new part, nor of a builds_on link', () => {
    const r = record();
    // Every call into a new part in the fixture goes without proof or addition.
    const links = r.technical_design.drawing.links;
    expect(links.filter((l: any) => partOf(r, l.to).status === 'new').every((l: any) => !l.proof && !l.adds)).toBe(true);
    // kpi builds on the existing shop-card without a proof: its own path and lines prove the base.
    expect(links.find((l: any) => l.to === 'card')).toEqual({ from: 'kpi', to: 'card', kind: 'builds_on', label: 'builds on' });
    links.push({ from: 'page', to: 'api', kind: 'builds_on', adds: 'nothing' });
    expect(lint(r)).toEqual([]);
  });

  it('wants a new right to name a decision of the record', () => {
    const r = record();
    partOf(r, 'menu').right.status = 'new';
    partOf(r, 'ctrl').right = { short: 'new right', status: 'new', what: 'A right of its own.', decision: 'D-4' };
    const m = messages(r);
    expect(m).toContain(`${D}: part menu has a new right without a decision: name the D-n that creates it in right.decision`);
    expect(m).toContain(`${D}: part ctrl: right.decision D-4 is not in decisions`);
    r.decisions = [{ id: 'D-4', answer: 'The screen gets a right of its own' }];
    delete partOf(r, 'menu').right;
    expect(lint(r)).toEqual([]);
  });

  it('wants an open choice written out', () => {
    const r = record();
    delete partOf(r, 'chart').open_detail;
    expect(messages(r)).toEqual([`${D}: part chart has open without open_detail: write out the choice the approval asks`]);
  });

  it('wants every story to have a drawing with a summary', () => {
    const r = record();
    delete r.stories[3].drawing;
    delete r.stories[4].drawing.summary;
    r.stories[1].drawing.builds = ['ui'];
    const m = messages(r);
    expect(m).toContain('story 004: no drawing: give it a summary, what it builds and what it uses');
    expect(m).toContain("story 005: drawing has no summary: say in a few plain sentences, in the record's language, what this story builds");
    expect(m).toContain('story 002: drawing.builds must be a map of part or module id to what this story builds there');
  });
});

describe('diskFsx', () => {
  it('answers for paths relative to the project root', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'turbo-design-'));
    mkdirSync(path.join(root, 'src', 'auth'), { recursive: true });
    writeFileSync(path.join(root, 'src', 'auth', 'login.ts'), 'a\nb\nc\n');
    writeFileSync(path.join(root, 'src', 'auth', 'open.ts'), 'a\nb');
    writeFileSync(path.join(root, 'src', 'auth', 'empty.ts'), '');
    const fsx = diskFsx(root);
    expect(fsx.exists('src/auth/login.ts')).toBe(true);
    expect(fsx.exists('src/auth')).toBe(true);
    expect(fsx.exists('src/missing.ts')).toBe(false);
    expect(fsx.lineCount('src/auth/login.ts')).toBe(3);
    expect(fsx.lineCount('src/auth/open.ts')).toBe(2);
    expect(fsx.lineCount('src/auth/empty.ts')).toBe(0);
    expect(fsx.lineCount('src/auth')).toBeNull();
    expect(fsx.lineCount('src/missing.ts')).toBeNull();
  });
});
