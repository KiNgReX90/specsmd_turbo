/**
 * Unit tests for lib/design-render.cjs, the markdown of the Code
 * Scaffold that render-specs.cjs puts in the brief and in every story. The
 * builder and the reviewer read it, so the shape is pinned exactly:
 * - the brief: the summary, then per lane its modules and their parts (name,
 *   kind, status, path:lines, what, example, deviation, right, open choice,
 *   confidence with its reasons), parts without a module after them, and
 *   the links, each with its proof in the code or what the change adds;
 * - the story: the summary, what it builds (with the story's own words, the
 *   example to follow and a deliberate deviation), what it uses, and the
 *   links between those; a part a story it waits for already builds new is
 *   changed there, new in that story, without the example, the deviation or
 *   the registration;
 * - nothing without a drawing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const { briefSection, storySection } = req(path.join(FLOW, 'scripts/lib/design-render.cjs'));
const { parseYaml } = req(path.join(FLOW, 'scripts/render-specs.cjs'));

const FIXTURE = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');
const record = () => parseYaml(readFileSync(FIXTURE, 'utf8'));
const partOf = (r: any, id: string) => r.technical_design.drawing.parts.find((p: any) => p.id === id);

const UI = 'shop-orderstatus-ui/src/main/resources/static/orderstatus';
const AD = 'shop-orderstatus-adapters/src/main/java/com/acme/shop/orderstatus/adapters';
const WC = 'shop-web-components/src/main/resources/static/web-components';

describe('briefSection', () => {
  const brief = briefSection(record());

  it('opens with the summary and has one heading per lane, then the links', () => {
    expect(brief.startsWith('### Code Scaffold\n\nAll five stories together. The screen talks only to Acme Shop.')).toBe(true);
    expect(brief.match(/^#{3,4} .+$/gm)).toEqual([
      '### Code Scaffold', '#### Screen in the browser', '#### Acme Shop server',
      '#### Acme Shop database', '#### Warehouse system, another application', '#### Links',
    ]);
    expect(brief.endsWith('\n- **WarehouseGatewayImpl** -> **IntakeController**: starts the actions, proof `warehouse-api/src/main/java/com/acme/warehouse/api/intake/IntakeController.java:44-290`')).toBe(true);
  });

  it('lists a module with its example and registrations, then its parts in that lane', () => {
    expect(brief).toContain([
      '- **shop-orderstatus-ui** (module, new) `shop-orderstatus-ui`: New module with the web components of the screen.',
      '  - Follows: `shop-returns-ui/pom.xml`, the same layout with components, services, locales and a bootstrap',
      '  - Registered in: `shop-parent/pom.xml:100-135`, `shop-server/pom.xml:149-167`',
      `  - **shop-chart** (web component, new) \`${UI}/components/shop-chart/shop-chart.js\`: The charts, shipped orders per hour, lead time per hour and errors per reason.`,
      '    - Extends: BaseComponent',
      '    - Open choice: which library? Which chart library the chart uses. The code has none, the component library has no chart. Choose it at the approval.',
      '    - Confidence: red. A choice is still open. You make it at the approval.',
      `  - **shop-orderstatus-page** (web component, new) \`${UI}/components/shop-orderstatus-page/shop-orderstatus-page.js\`: The screen itself,`,
    ].join('\n'));
    expect(brief).toContain([
      '- **shop-server** (module, changed) `shop-server`: The Acme Shop server. Gets a page, a migration for the menu item, a route in admin-routes.yml and a settings provider.',
      '  - **Order status menu item** (migration, new) `db/migrations/V2026_10_20_01__orderstatus_menu.sql`: Opens the order status screen from the menu.',
      '    - Follows: `db/migrations/V2026_07_01_02__returns_menu.sql:8-33`',
      '    - Right (existing): view right, exists. The view right on orders. It is already on the Orders menu item. No new right comes.',
      '    - Confidence: green. New, and it follows an example in the code.',
      '  - **OrderStatusHost.jsp** (JSP, new) `shop-server/src/main/webapp/admin/orderstatus/OrderStatusHost.jsp`: A page of its own in the admin frame that loads the web components.',
      '    - Follows: `shop-server/src/main/webapp/admin/menu/AdminMenu.jsp:89-116`, now the only page with the import map',
    ].join('\n'));
    // A module with parts in two lanes shows in both.
    expect(brief.match(/^- \*\*shop-server\*\* \(module, changed\)/gm)).toHaveLength(2);
  });

  it('shows the place of a changed part, a deviation, and parts without a module after the modules', () => {
    expect(brief).toContain([
      '  - **admin-routes.yml** (config, changed) `shop-server/src/main/resources/admin-routes.yml:395-465`: Gets a route of its own under /api/admin/orderstatus/*, behind the existing security of the admin.',
      '    - Follows: `shop-server/src/main/resources/admin-routes.yml`, the route of the returns under /api/admin/returns/*',
      '    - Confidence: green. Its place in the code was found and checked.',
    ].join('\n'));
    expect(brief).toContain([
      `  - **WarehouseGatewayImpl** (class, new) \`${AD}/outbound/warehouse/WarehouseGatewayImpl.java\`: Calls the API of the warehouse system, with timeouts, and passes the name of the user with an action.`,
      '    - Implements: the port to the warehouse from core',
      '    - Follows: `shop-returns-adapters/src/main/java/com/acme/shop/returns/adapters/outbound/carrier/CarrierGatewayImpl.java`',
      '    - Deviates: Sets timeouts, CarrierGatewayImpl does not. So the screen does not hang when the warehouse system does not answer.',
      '    - Confidence: green. New, and it follows an example in the code.',
    ].join('\n'));
    expect(brief).toContain([
      '#### Acme Shop database', '',
      '- **ORDER_STATUS_EVENTS** (table, changed) `db/migrations/V2026_07_02_03__order_status_events.sql:1-27`: Every status change of an order, with its time. Gets the index ose_window_i, so a time window does not read the whole table.',
      '  - Confidence: green. Its place in the code was found and checked.',
      '- **ORDERS** (table, existing) `db/migrations/V2026_07_02_01__orders.sql:1-17`: Every order placed in the webshop.',
      '  - Confidence: green. Its place in the code was found and checked.',
      '', '#### Warehouse system, another application', '',
      '- **warehouse-api** (module, existing, repo warehouse) `warehouse-api/src/main/java/com/acme/warehouse/api`: The warehouse-api module of the warehouse system, another application. The screen uses two controllers.',
      '  - **IntakeController** (class, existing, repo warehouse) `warehouse-api/src/main/java/com/acme/warehouse/api/intake/IntakeController.java:44-290`: The actions of the warehouse system. The screen uses three of them, pausing and resuming the order intake, and sending an order to the warehouse again.',
    ].join('\n'));
  });

  it('writes every link with its label, kind and code', () => {
    expect(brief).toContain([
      '#### Links', '',
      '- **Order status menu item** -> **OrderStatusHost.jsp**: opens',
      '- **OrderStatusHost.jsp** -> **shop-orderstatus-page**: loads',
      '- **shop-orderstatus-page** -> **orderstatus-service.js**: asks',
      `- **orderstatus-service.js** -> **api-client.js**: via, proof \`${WC}/services/api-client.js:1-36\``,
      '- **shop-orderstatus-page** -> **shop-chart**',
      '- **shop-orderstatus-page** -> **shop-kpi-tile**: shows with',
      `- **shop-orderstatus-page** -> **shop-datatable**, proof \`${WC}/components/shop-datatable/shop-datatable.js:1-80\``,
      '- **shop-kpi-tile** -> **shop-card** (builds on): builds on',
      '- **api-client.js** -> **OrderStatusController**: calls `/api/admin/orderstatus`',
    ].join('\n'));
    expect(brief).toContain('\n- **WarehouseSettingsProvider** -> **WarehouseSettings** (builds on)\n');
  });

  it('ends a link in its proof in the code, with its note, and in what the change adds', () => {
    expect(brief).toContain([
      '- **OrderTrendQuery** -> **ORDER_STATUS_EVENTS**: reads the changes, adds: the index ose_window_i for the time window',
      '- **OrderTrendQuery** -> **ORDERS**: reads orders, proof `db/migrations/V2026_07_02_01__orders.sql:1-17`',
      '- **WarehouseGatewayImpl** -> **FulfilmentController**: reads the live state, proof `warehouse-api/src/main/java/com/acme/warehouse/api/FulfilmentController.java:27-136` (the read endpoints exist already)',
    ].join('\n'));
    // Both on one link, a proof without lines, and a line break in a value: deterministic, on one line.
    const r = record();
    r.technical_design.drawing.links[0] = { from: 'menu', to: 'host', code: 'open()', proof: { file: 'a/B.java', note: 'exists\nalready' }, adds: 'a\nparameter' };
    expect(briefSection(r)).toContain('\n- **Order status menu item** -> **OrderStatusHost.jsp** `open()`, proof `a/B.java` (exists already), adds: a parameter\n');
    expect(briefSection(r)).toBe(briefSection(r));
  });

  it('gives the source, a new right with its decision, and the reasons a part is orange', () => {
    const r = record();
    Object.assign(partOf(r, 'trend'), { source: 'S-012', assumption: 'the table has a time index', doubt: 'maybe\ntwo queries' });
    partOf(r, 'menu').right = { short: 'own right', status: 'new', what: 'The screen gets a right of its own', file: 'shop-server/src/Rights.java', lines: 10, decision: 'D-2' };
    const out = briefSection(r);
    expect(out).toContain([
      '    - Source: S-012',
      '    - Confidence: orange. New, with its own design: no example in the code does it the same way. Known only from documentation, not from the code. Rests on an assumption: the table has a time index. But the agent has a doubt: maybe two queries.',
    ].join('\n'));
    expect(out).toContain('    - Right (new): own right. The screen gets a right of its own. In `shop-server/src/Rights.java:10`. Decision: D-2.\n');
  });

  it('is empty without a drawing', () => {
    expect(briefSection({ technical_design: { modules: ['auth'] } })).toBe('');
    expect(briefSection({})).toBe('');
  });
});

describe('storySection', () => {
  it('gives the story its summary, what it builds, what it uses and the links between them', () => {
    const r = record();
    expect(storySection(r, r.stories[3])).toBe([
      '### Code Scaffold',
      'The Failed and held tab. It shows the failed orders per reason and the held orders, as the warehouse system sees them now.',
      '#### Builds',
      [
        `- **shop-orderstatus-page** (web component, changed, new in story 002) \`${UI}/components/shop-orderstatus-page/shop-orderstatus-page.js\`: adds the Failed and held tab`,
        '  - Extends: BaseComponent',
        `- **OrderStatusController** (class, changed, new in story 001) \`${AD}/inbound/web/OrderStatusController.java\`: adds failed and held`,
        '  - Right (existing): view right + role, exist. Reading with the view right on orders, the actions only with the role Shop manager. Both exist already. In `shop-server/src/main/java/com/acme/shop/security/AdminRoles.java:190-198`.',
        '- **Order status use cases** (classes, changed, new in story 001) `shop-orderstatus-core/src/main/java/com/acme/shop/orderstatus/core/ports/inbound/usecases`: adds two use cases',
        '  - Implements: per use case a Command, a UseCase and a Result',
      ].join('\n'),
      '#### Uses',
      [
        `- **orderstatus-service.js** (JS module, new in story 002) \`${UI}/services/orderstatus-service.js\`: Fetches the figures from the Acme Shop server.`,
        `- **api-client.js** (JS module, existing) \`${WC}/services/api-client.js:1-36\`: Shared fetch with the session cookie. Throws on every answer that is not 2xx.`,
        `- **shop-datatable** (web component, existing) \`${WC}/components/shop-datatable/shop-datatable.js:1-80\`: Tables for the orders, the errors, the held orders and the action log.`,
        `- **WarehouseGatewayImpl** (class, new in story 001) \`${AD}/outbound/warehouse/WarehouseGatewayImpl.java\`: Calls the API of the warehouse system, with timeouts, and passes the name of the user with an action.`,
        '- **FulfilmentController** (class, existing, repo warehouse) `warehouse-api/src/main/java/com/acme/warehouse/api/FulfilmentController.java:27-136`: The read endpoints of the warehouse system, overview, errors, orders, held and the connection test.',
      ].join('\n'),
      '#### Links',
      [
        '- **shop-orderstatus-page** -> **orderstatus-service.js**: asks',
        `- **orderstatus-service.js** -> **api-client.js**: via, proof \`${WC}/services/api-client.js:1-36\``,
        `- **shop-orderstatus-page** -> **shop-datatable**, proof \`${WC}/components/shop-datatable/shop-datatable.js:1-80\``,
        '- **api-client.js** -> **OrderStatusController**: calls `/api/admin/orderstatus`',
        '- **OrderStatusController** -> **Order status use cases**: calls',
        '- **Order status use cases** -> **WarehouseGatewayImpl**: live state and actions',
        '- **WarehouseGatewayImpl** -> **FulfilmentController**: reads the live state, proof `warehouse-api/src/main/java/com/acme/warehouse/api/FulfilmentController.java:27-136` (the read endpoints exist already)',
      ].join('\n'),
    ].join('\n\n'));
  });

  it('builds a module with its registrations, a changed part at its lines, and a deviation', () => {
    const r = record();
    const out = storySection(r, r.stories[0]);
    expect(out).toContain([
      '- **shop-orderstatus-adapters** (module, new) `shop-orderstatus-adapters`: new, registered in shop-parent',
      '  - Follows: `shop-returns-adapters/pom.xml`, inbound/web for the controllers, outbound for the links, config for Spring',
      '  - Registered in: `shop-parent/pom.xml:100-135`, `shop-server/pom.xml:499-502`',
    ].join('\n'));
    expect(out).toContain([
      '- **admin-routes.yml** (config, changed) `shop-server/src/main/resources/admin-routes.yml:395-465`: adds the route',
      '  - Follows: `shop-server/src/main/resources/admin-routes.yml`, the route of the returns under /api/admin/returns/*',
    ].join('\n'));
    expect(out).toContain('  - Deviates: Sets timeouts, CarrierGatewayImpl does not. So the screen does not hang when the warehouse system does not answer.\n');
    // The story never shows the confidence or an open choice: the approval settled those.
    expect(out).not.toContain('Confidence');
    expect(storySection(r, r.stories[1])).not.toContain('Open choice');
  });

  // 001 builds mod, A and web.xml; 002 waits for 001 (a bare number), 003 for 002, 005 for 003; 004 waits for none.
  const later = () => ({
    technical_design: { drawing: {
      modules: [{ id: 'mod', status: 'new', path: 'mod', follows: { file: 'other/pom.xml' }, registered_in: [{ file: 'pom.xml', lines: '1-2' }] }],
      parts: [
        { id: 'a', name: 'A', kind: 'class', status: 'new', module: 'mod', layer: 'server', path: 'mod/A.java', follows: { file: 'B.java', lines: '1-9' }, deviates: 'otherwise', right: { status: 'existing', short: 'view right' } },
        { id: 'w', name: 'web.xml', kind: 'config', status: 'changed', layer: 'server', path: 'web.xml', lines: '1-5', follows: { file: 'web.xml' } },
      ],
      links: [],
    } },
    stories: [
      { id: '001', drawing: { summary: 'One.', builds: { mod: 'new', a: 'new', w: 'servlet' } } },
      { id: '002', depends_on: [1], drawing: { summary: 'Two.', builds: { a: 'more' } } },
      { id: '003', depends_on: ['002'], drawing: { summary: 'Three.', builds: { mod: 'adds a folder', a: 'more still', w: 'a filter' } } },
      { id: '004', drawing: { summary: 'Four.', builds: { a: 'apart from it' } } },
      { id: '005', depends_on: ['003'], drawing: { summary: 'Five.', uses: ['a'] } },
    ],
  });
  const builds = (r: any, i: number) => storySection(r, r.stories[i]).split('#### Builds\n\n')[1];

  it('builds a part new, with its example, deviation and registration, only in the first story that builds it', () => {
    const r = later();
    expect(builds(r, 0)).toBe([
      '- **mod** (module, new) `mod`: new',
      '  - Follows: `other/pom.xml`',
      '  - Registered in: `pom.xml:1-2`',
      '- **A** (class, new) `mod/A.java`: new',
      '  - Follows: `B.java:1-9`',
      '  - Deviates: otherwise',
      '  - Right (existing): view right.',
      '- **web.xml** (config, changed) `web.xml:1-5`: servlet',
      '  - Follows: `web.xml`',
    ].join('\n'));
  });

  it('shows a part a story it waits for already builds as changed there, new in the story that made it', () => {
    const r = later();
    expect(builds(r, 1)).toBe([
      '- **A** (class, changed, new in story 001) `mod/A.java`: more',
      '  - Right (existing): view right.',
    ].join('\n'));
    // 003 waits for 002 and, through it, for 001: the part is new in 001, not in 002.
    expect(builds(r, 2)).toBe([
      '- **mod** (module, changed, new in story 001) `mod`: adds a folder',
      '- **A** (class, changed, new in story 001) `mod/A.java`: more still',
      '  - Right (existing): view right.',
      '- **web.xml** (config, changed) `web.xml:1-5`: a filter',
    ].join('\n'));
  });

  it('keeps a part new in a story that waits for none of the stories that build it', () => {
    const r = later();
    expect(builds(r, 3)).toBe([
      '- **A** (class, new) `mod/A.java`: apart from it',
      '  - Follows: `B.java:1-9`',
      '  - Deviates: otherwise',
      '  - Right (existing): view right.',
    ].join('\n'));
  });

  it('names the story that made a new part it only uses', () => {
    const r = later();
    expect(storySection(r, r.stories[4])).toBe(['### Code Scaffold', 'Five.', '#### Uses', '- **A** (class, new in story 001) `mod/A.java`'].join('\n\n'));
  });

  it('is how the story template shows a part a story it waits for made', () => {
    expect(readFileSync(path.join(FLOW, 'templates/inception/story-template.md'), 'utf8')).toContain(
      '- **{part}** ({kind}, changed, new in story {NNN}) `{path}`: {what this story builds there}\n'
      + '  - Extends, Implements and Right as above; the example, the deviation and the registration stay with story {NNN}',
    );
  });

  it('names an unknown id as it is, folds a line break, and is empty without a drawing', () => {
    const r = record();
    r.stories[3].drawing.builds = { ghost: 'something\nnew' };
    r.stories[3].drawing.uses = [];
    expect(storySection(r, r.stories[3])).toBe([
      '### Code Scaffold',
      'The Failed and held tab. It shows the failed orders per reason and the held orders, as the warehouse system sees them now.',
      '#### Builds', '- **ghost**: something new',
    ].join('\n\n'));
    delete r.stories[3].drawing;
    expect(storySection(r, r.stories[3])).toBe('');
    expect(storySection({ stories: [{ id: '001', drawing: { summary: 'x' } }] }, { id: '001', drawing: { summary: 'x' } })).toBe('');
  });
});
