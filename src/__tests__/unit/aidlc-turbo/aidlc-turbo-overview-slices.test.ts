/**
 * Unit tests for the vertical slices of the overview page (intent-overview.cjs),
 * the roles of a story in each layer its slice names (the record says new or
 * used, the page's roles are new, uses and changes):
 * - new stays new, whatever the story touches there;
 * - used is uses, and becomes changes when the story touches a file (not a test file)
 *   whose own name or folder the layer's tip names (a code name: CamelCase,
 *   snake_case or with digits), or when its drawing builds a part there, by
 *   the part's name or its file;
 * - the note is what the drawing says the story builds there, in build order;
 * - a slice value other than new or used is no cell;
 * - what the slice delivers is the story drawing's summary, as plain text.
 * The seams between the slices are drawn by the page itself, from these roles.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const overview = req(path.join(FLOW, 'scripts/intent-overview.cjs'));
const render = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const paths = req(path.join(FLOW, 'scripts/lib/paths.cjs'));

const LAYERS = [
  { id: 't-users', group: 'Tables', label: 'Users', tip: 'table user_accounts' },
  { id: 'login', group: 'Code', label: 'Log in', tip: 'LoginService, PasswordCheck' },
  { id: 'mail', group: 'Code', label: 'Mail', tip: 'ResetMailer' },
  { id: 'audit', group: 'Code', label: 'Audit', tip: 'AuditLog' },
];

/** The template intent with a second story; `edit` changes the record before the stories are rendered. */
function fixture(edit: (record: any) => void) {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-slices-')), '.specs-aidlc-turbo');
  const dir = path.join(root, 'docs', 'user-auth', 'user-auth');
  mkdirSync(path.join(root, 'repo'), { recursive: true });
  mkdirSync(dir, { recursive: true });
  const record = render.parseYaml(readFileSync(path.join(FLOW, 'templates/inception/record-template.yaml'), 'utf8'));
  const second = JSON.parse(JSON.stringify(record.stories[0]));
  Object.assign(second, { id: '002', slug: 'reset-mail', title: 'Send the reset mail', depends_on: ['001'], integration: [] });
  record.stories.push(second);
  record.overview.layers = LAYERS;
  record.technical_design = {
    drawing: {
      parts: [
        { id: 'check', name: 'PasswordCheck', path: 'src/auth/PasswordCheck.java' },
        { id: 'svc', name: 'Service', path: 'src/auth/LoginService.java' },
      ],
    },
  };
  record.stories[0].slice = { 't-users': 'new', login: 'new' };
  edit(record);
  writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
  const intent = paths.findIntent(root, 'user-auth');
  // the story files carry touches in their frontmatter
  render.applyPlan(intent, render.planRender(intent));
  return overview.buildData(root, intent, 'inception').page.slices;
}

describe('aidlc-turbo overview slices: the role of a story in a layer', () => {
  it('a used layer is changes when the story touches a file its tip names, or its drawing builds a part there', () => {
    const slices = fixture((record) => Object.assign(record.stories[1], {
      // login only through the drawing, user_accounts through a file, AuditLog not at all
      touches: ['src/mail/ResetMailer.java', 'db/user_accounts.sql', 'src/mail/ResetMailerTest.java'],
      slice: { 't-users': 'used', login: 'used', mail: 'new', audit: 'used', ghost: 'something else' },
      drawing: { summary: 'A **reset mail** after logging in', builds: { check: 'a flag for the reset mail', svc: 'calls the mailer', gone: 'not drawn' } },
    }));
    expect(slices['001']).toEqual({ delivers: '', cells: { 't-users': { role: 'new', note: '' }, login: { role: 'new', note: '' } } });
    expect(slices['002']).toEqual({
      delivers: 'A reset mail after logging in',
      cells: {
        // db/user_accounts.sql: the file's own name is in the tip
        't-users': { role: 'changes', note: '' },
        // PasswordCheck by name, LoginService by its file: both notes, in the order the drawing builds them
        login: { role: 'changes', note: 'a flag for the reset mail; calls the mailer' },
        // a new layer stays new, whatever the story touches there
        mail: { role: 'new', note: '' },
        audit: { role: 'uses', note: '' },
      },
    });
  });

  it('a test file or a tip without a code name never makes a layer changes; the folder of a file counts', () => {
    const slices = fixture((record) => {
      record.overview.layers = [...LAYERS.slice(0, 3), { id: 'audit', group: 'Code', label: 'Audit', tip: 'the audit log' }];
      Object.assign(record.stories[1], {
        // PasswordCheck only in a test folder; audit/log.ts touched, but the tip's plain words are no code names
        touches: ['src/test/java/PasswordCheck.java', 'src/audit/log.ts', 'src/user_accounts/index.ts'],
        slice: { 't-users': 'used', login: 'used', audit: 'used' },
      });
    });
    expect(slices['002']).toEqual({
      delivers: '',
      cells: {
        // the folder of index.ts is user_accounts: the tip names it
        't-users': { role: 'changes', note: '' },
        login: { role: 'uses', note: '' },
        audit: { role: 'uses', note: '' },
      },
    });
  });
});
