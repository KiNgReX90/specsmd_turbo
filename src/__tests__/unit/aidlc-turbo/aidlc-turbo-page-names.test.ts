/**
 * Unit tests for lib/page-names.cjs of the AI-DLC Turbo flow.
 *
 * The Confluence sync looks for and gives page names from templates:
 * - without a config, or without sync.page_names, the defaults hold;
 * - a project's own sync.page_names overrides a key, the rest keep the default;
 * - fill puts the name and the slug in, nameFrom reads the name back out of a
 *   title, and a title that does not fit the template gives null;
 * - the CLI prints the names as JSON.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const names = createRequire(import.meta.url)(path.join(FLOW, 'scripts/lib/page-names.cjs'));

const bases: string[] = [];
afterAll(() => bases.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** An artifact root with this config.yaml text, or none. */
function root(config?: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'turbo-names-'));
  bases.push(dir);
  const art = path.join(dir, '.specs-aidlc-turbo');
  mkdirSync(path.join(art, 'repo'), { recursive: true });
  if (config !== undefined) writeFileSync(path.join(art, 'repo', 'config.yaml'), config);
  return art;
}

describe('pageNames', () => {
  it('gives the defaults without a config', () => {
    expect(names.pageNames(root())).toEqual({
      intent: '{name} - Documentation',
      stories: '{name} - Stories',
      project: 'Project Documentation',
      overview_section: 'Interactive overview',
      overview_file: 'overview-{slug}.html',
    });
  });

  it('gives the defaults for a config without page_names', () => {
    expect(names.pageNames(root('mode: sandbox\nsync:\n  docs: none\n'))).toEqual(names.DEFAULTS);
  });

  it('lets the project override a key and keeps the rest', () => {
    const art = root([
      'sync:',
      '  docs: confluence',
      '  page_names:',
      '    intent: "Docs: {name}"',
      '    project: Shop Handbook',
      '    stories: ""',
    ].join('\n'));
    const got = names.pageNames(art);
    expect(got.intent).toBe('Docs: {name}');
    expect(got.project).toBe('Shop Handbook');
    expect(got.stories).toBe('{name} - Stories');
    expect(got.overview_file).toBe('overview-{slug}.html');
  });

  it('never throws on a config it cannot read', () => {
    expect(names.pageNames(root('sync: [unclosed\n'))).toEqual(names.DEFAULTS);
  });
});

describe('fill and nameFrom', () => {
  it('fills the name and the slug', () => {
    expect(names.fill('{name} - Documentation', { name: 'Gift cards' })).toBe('Gift cards - Documentation');
    expect(names.fill('overview-{slug}.html', { slug: 'gift-cards' })).toBe('overview-gift-cards.html');
    expect(names.fill('{name} - Stories', {})).toBe('{name} - Stories');
  });

  it('reads the name back out of a title that fits', () => {
    expect(names.nameFrom('{name} - Documentation', 'Gift cards - Documentation')).toBe('Gift cards');
    expect(names.nameFrom('{name} - Documentation', '  Order status  -  documentation ')).toBe('Order status');
    expect(names.nameFrom('Docs: {name}', 'Docs: Gift cards')).toBe('Gift cards');
  });

  it('gives null for a title that does not fit', () => {
    expect(names.nameFrom('{name} - Documentation', 'Gift cards')).toBeNull();
    expect(names.nameFrom('{name} - Documentation', ' - Documentation')).toBeNull();
    expect(names.nameFrom('Project Documentation', 'Project Notes')).toBeNull();
  });

  it('gives an empty name for a title equal to a template without {name}', () => {
    expect(names.nameFrom('Project Documentation', 'Project Documentation')).toBe('');
  });
});

describe('the CLI', () => {
  it('prints the names as JSON', () => {
    const out: string[] = [];
    expect(names.main(['--root', root()], (t: string) => out.push(t))).toBe(0);
    expect(JSON.parse(out[0]).intent).toBe('{name} - Documentation');
  });

  it('refuses an unknown argument', () => {
    expect(names.main(['--what'], () => {})).toBe(2);
  });
});
