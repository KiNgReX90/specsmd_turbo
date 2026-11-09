/**
 * Unit tests for scripts/lib/paths.cjs, the one place that knows where every
 * AI-DLC Turbo artifact lives.
 *
 * - layout() names every fixed path under repo/, project/ and docs/;
 * - listIntents() finds intents across all inceptions and never mistakes a
 *   layout folder (pages, tests, ...) for an intent;
 * - findIntent() finds an intent by its slug alone and refuses a slug that
 *   sits under two inceptions;
 * - isLegacy() recognises every part of the old layout.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const paths = createRequire(import.meta.url)(path.join(FLOW, 'scripts/lib/paths.cjs'));

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function tree(files: string[]): string {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-paths-')), '.specs-aidlc-turbo');
  made.push(path.dirname(root));
  mkdirSync(root, { recursive: true });
  for (const rel of files) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, '', 'utf8');
  }
  return root;
}

describe('paths.layout', () => {
  it('defaults to .specs-aidlc-turbo and names every fixed path', () => {
    const L = paths.layout();
    expect(L.root).toBe('.specs-aidlc-turbo');
    expect(L.config).toBe(path.join('.specs-aidlc-turbo', 'repo', 'config.yaml'));
    expect(L.repoYaml).toBe(path.join('.specs-aidlc-turbo', 'repo', 'repo.yaml'));
    expect(L.standards).toBe(path.join('.specs-aidlc-turbo', 'repo', 'standards'));
    expect(L.projectYaml).toBe(path.join('.specs-aidlc-turbo', 'project', 'project.yaml'));
    expect(L.projectPages).toBe(path.join('.specs-aidlc-turbo', 'project', 'pages'));
    expect(L.digests).toBe(path.join('.specs-aidlc-turbo', 'project', 'digests'));
    expect(L.docs).toBe(path.join('.specs-aidlc-turbo', 'docs'));
  });

  it('names the paths of an inception and of an intent', () => {
    const L = paths.layout('r');
    expect(L.inception('auth')).toMatchObject({
      slug: 'auth',
      pages: path.join('r', 'docs', 'auth', 'pages'),
      register: path.join('r', 'docs', 'auth', 'register.yaml'),
      sync: path.join('r', 'docs', 'auth', 'sync.yaml'),
    });
    expect(L.intent('auth', 'login')).toMatchObject({
      slug: 'login',
      inception: 'auth',
      record: path.join('r', 'docs', 'auth', 'login', 'record.yaml'),
      brief: path.join('r', 'docs', 'auth', 'login', 'brief.md'),
      stories: path.join('r', 'docs', 'auth', 'login', 'stories'),
      tests: path.join('r', 'docs', 'auth', 'login', 'tests'),
      proof: path.join('r', 'docs', 'auth', 'login', 'proof'),
      overview: path.join('r', 'docs', 'auth', 'login', 'overview.html'),
      scaffold: path.join('r', 'docs', 'auth', 'login', 'code-scaffold.html'),
      scaffoldBuilt: path.join('r', 'docs', 'auth', 'login', 'code-scaffold-built.html'),
    });
  });

});

describe('paths.listIntents and findIntent', () => {
  it('lists intents across inceptions, sorted, and skips layout folders and non-intents', () => {
    const root = tree([
      'docs/b/two/record.yaml',
      'docs/a/one/brief.md',
      'docs/a/pages/brief.md',
      'docs/a/half/notes.md',
      'docs/a/register.yaml',
    ]);
    expect(paths.listIntents(root).map((i: any) => `${i.inception}/${i.slug}`)).toEqual(['a/one', 'b/two']);
  });

  it('finds an intent by slug alone, and returns null when there is none', () => {
    const root = tree(['docs/auth/login/record.yaml']);
    expect(paths.findIntent(root, 'login').dir).toBe(path.join(root, 'docs', 'auth', 'login'));
    expect(paths.findIntent(root, 'nope')).toBeNull();
  });

  it('refuses a slug that sits under two inceptions', () => {
    const root = tree(['docs/a/x/brief.md', 'docs/b/x/brief.md']);
    expect(() => paths.findIntent(root, 'x')).toThrow(/more than one inception/);
  });

  it('returns nothing for a root without docs/', () => {
    expect(paths.listIntents(tree([]))).toEqual([]);
  });
});

describe('paths.isLegacy', () => {
  it.each(['intents/a/brief.md', 'config.yaml', 'project.yaml', 'standards/x.md', 'digests/x.yaml', 'project-docs/x.md', 'tests/a/x.md'])(
    'sees %s as the old layout',
    (file) => {
      expect(paths.isLegacy(tree([file]))).toBe(true);
    },
  );

  it('sees the new layout as current', () => {
    expect(paths.isLegacy(tree(['repo/config.yaml', 'project/project.yaml', 'docs/a/a/brief.md']))).toBe(false);
  });

  it('names the migrate script in its message', () => {
    expect(paths.legacyMessage('r')).toContain('node .specsmd/aidlc-turbo/scripts/migrate-layout.cjs --write');
  });

  it('reserves the layout folder names as slugs', () => {
    for (const name of ['pages', 'digests', 'standards', 'tests', 'proof', 'stories', 'register-candidates']) {
      expect(paths.isReservedSlug(name)).toBe(true);
    }
    expect(paths.isReservedSlug('user-auth')).toBe(false);
  });
});
