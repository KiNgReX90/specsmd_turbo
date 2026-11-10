/**
 * AI-DLC Turbo - the string tables (scripts/lib/lang.cjs, templates/lang).
 *
 * The flow has no language setting: the record carries the language it was
 * written in (intent.language) and every fixed text of the output comes from
 * the table of that language. en ships with the flow; a project can add its
 * own table under .specs-aidlc-turbo/repo/lang/, and every key a table lacks
 * comes from en. The tests use an invented language, `xx`, whose table is
 * English in capitals.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import path from 'path';

const req = createRequire(import.meta.url);
const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const lang = req(path.join(FLOW, 'scripts/lib/lang.cjs'));
const en = JSON.parse(readFileSync(path.join(FLOW, 'templates/lang/en.json'), 'utf8'));

/** Every dotted key of a table that holds a text or a list. */
function keys(t: any, at = ''): string[] {
  return Object.entries(t).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${at}${k}.`) : [`${at}${k}`]));
}

const project = () => {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-lang-')), '.specs-aidlc-turbo');
  mkdirSync(path.join(root, 'repo', 'lang'), { recursive: true });
  return root;
};

const table = (root: string, code: string, data: unknown) => writeFileSync(path.join(root, 'repo', 'lang', `${code}.json`), JSON.stringify(data));

describe('aidlc-turbo lang: the record language', () => {
  it('is intent.language, and en for a record without it', () => {
    expect(lang.languageOf({ intent: { language: 'de' } })).toBe('de');
    expect(lang.languageOf({ intent: { language: 'pt-BR' } })).toBe('pt-br');
    expect(lang.languageOf({ intent: { language: 'not a code' } })).toBe('en');
    expect(lang.languageOf({ intent: {} })).toBe('en');
    expect(lang.languageOf({})).toBe('en');
    expect(lang.languageOf(null)).toBe('en');
  });
});

describe('aidlc-turbo lang: the built-in tables', () => {
  it('only English ships with the flow', () => {
    expect(readdirSync(path.join(FLOW, 'templates/lang'))).toEqual(['en.json']);
    expect(en.language).toBe('English');
  });

  it('the markdown words are English', () => {
    expect(en.md).toMatchObject({
      product: 'For the product team', asA: 'As', iWant: 'I want', soThat: 'so that', why: 'Why this story',
      criteria: 'Acceptance criteria', given: 'Given', when: 'when', then: 'then', outOfScope: 'Out of scope', none: 'None.',
    });
    expect(Object.keys(en.md.via)).toEqual(['ui', 'api', 'db', 'log', 'none']);
  });
});

describe('aidlc-turbo lang: the loader', () => {
  it('fills every key a project table lacks from en', () => {
    const root = project();
    table(root, 'xx', { md: { criteria: 'ACCEPTANCE CRITERIA' } });
    const xx = lang.load('xx', root);
    expect(lang.text(xx, 'md.criteria')).toBe('ACCEPTANCE CRITERIA');
    expect(lang.text(xx, 'md.outOfScope')).toBe(en.md.outOfScope);
    expect(xx.lang).toBe('xx');
    expect(keys(xx).filter((k) => k !== 'lang').sort()).toEqual(keys(en).sort());
  });

  it('a project table overrides the built-in one, key by key', () => {
    const root = project();
    table(root, 'en', { md: { none: 'Nothing.' } });
    const t = lang.load('en', root);
    expect(lang.text(t, 'md.none')).toBe('Nothing.');
    expect(lang.text(t, 'md.criteria')).toBe('Acceptance criteria');
  });

  it('a map merges key by key, a list or a text replaces', () => {
    expect(lang.merge({ a: { b: 1, c: 2 }, l: [1, 2] }, { a: { c: 3 }, l: [9] })).toEqual({ a: { b: 1, c: 3 }, l: [9] });
  });

  it('an unknown language without a table falls back to en', () => {
    const root = project();
    const t = lang.load('fi', root);
    expect(lang.text(t, 'md.criteria')).toBe('Acceptance criteria');
    expect(t.lang).toBe('fi');
    expect(lang.find('fi', root).source).toBe('missing');
  });

  it('a region falls back to its language: xx-YY reads the xx table, its own table first', () => {
    const root = project();
    table(root, 'xx', { md: { criteria: 'ACCEPTANCE CRITERIA', none: 'NONE.' } });
    expect(lang.text(lang.load('xx-YY', root), 'md.criteria')).toBe('ACCEPTANCE CRITERIA');
    table(root, 'xx-yy', { md: { none: 'NOTHING AT ALL.' } });
    const region = lang.load('xx-YY', root);
    expect(lang.text(region, 'md.none')).toBe('NOTHING AT ALL.');
    expect(lang.text(region, 'md.criteria')).toBe('ACCEPTANCE CRITERIA');
    expect(lang.find('xx-YY', root)).toMatchObject({ code: 'xx-yy', source: 'project' });
  });

  it('fills {name} in a text', () => {
    expect(lang.text({ a: { b: 'Story {id} of {n}' } }, 'a.b', { id: 3, n: 5 })).toBe('Story 3 of 5');
    expect(lang.text({}, 'a.b')).toBe('a.b');
  });

  it('everyWord reads one key over the built-in tables and the one given', () => {
    const root = project();
    table(root, 'xx', { md: { criteria: 'ACCEPTANCE CRITERIA' } });
    expect(lang.everyWord(lang.load('xx', root), 'md.criteria').sort()).toEqual(['ACCEPTANCE CRITERIA', 'Acceptance criteria']);
  });
});

describe('aidlc-turbo lang: the cli', () => {
  const cli = (args: string[]) => spawnSync(process.execPath, [path.join(FLOW, 'scripts/lib/lang.cjs'), ...args], { encoding: 'utf8' });

  it('tells whether a language has a table, and names the file to write when not', () => {
    const root = project();
    expect(lang.find('en', root).source).toBe('built-in');
    expect(cli(['en', '--root', root]).status).toBe(0);
    const missing = cli(['xx', '--root', root]);
    expect(missing.status).toBe(1);
    expect(missing.stdout).toContain('missing: no table for xx');
    expect(missing.stdout).toContain(path.join(root, 'repo', 'lang', 'xx.json'));
    table(root, 'xx', {});
    expect(lang.find('xx', root).source).toBe('project');
    expect(cli(['xx', '--root', root]).stdout).toContain('project:');
  });

  it('shows one section of a table, every key filled, for the agent that writes in that language', () => {
    const root = project();
    table(root, 'xx', { md: { criteria: 'ACCEPTANCE CRITERIA' } });
    const shown = cli(['xx', '--root', root, '--show', 'md']);
    expect(shown.status).toBe(0);
    const md = JSON.parse(shown.stdout);
    expect(md.criteria).toBe('ACCEPTANCE CRITERIA');
    expect(md.outOfScope).toBe(en.md.outOfScope);
    expect(JSON.parse(cli(['en', '--root', root, '--show', 'md']).stdout)).toEqual(en.md);
    const none = cli(['en', '--root', root, '--show', 'nothing']);
    expect(none.status).toBe(2);
    expect(none.stderr).toContain('no section nothing');
  });

  it('refuses a wrong call', () => {
    expect(cli([]).status).toBe(2);
    expect(cli(['--show']).status).toBe(2);
  });
});
