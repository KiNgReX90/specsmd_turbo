/**
 * Unit tests for the Confluence sync of the AI-DLC Turbo flow.
 *
 * Confluence is optional and off by default (a missing `sync.docs` is none).
 * With `sync.docs: confluence` the inception pulls the intent's documentation
 * page tree into .specs-aidlc-turbo/docs/{inception}/pages/ and the shared
 * project page tree into .specs-aidlc-turbo/project/pages/, puts every open
 * question in them to the user, writes the answers into the pages, and
 * pushes the changed pages back right after the approval. The page names are
 * the project's own (`sync.page_names`, lib/page-names.cjs). The sync agent
 * does the Atlassian work; the phase agents dispatch it with the skill file,
 * the intent slug and a mode. These guards keep that wiring in place:
 * - intake dispatches pull and resolve, review dispatches push, and a rerun
 *   skill exists;
 * - the sync agent runs on Sonnet without CLAUDE.md, with every tool but
 *   Bash and the edit tools;
 * - the pages live inside .specs-aidlc-turbo/, never in the repo's own docs/
 *   or project-docs/;
 * - an open question in a pulled page blocks the approval;
 * - nothing is pushed before the approval, and a newer page is never
 *   overwritten without applying the change on top of it;
 * - the intent overview sits on the documentation page itself, as an
 *   attachment, and a push that rewrote that page has its overview section
 *   put back by script;
 * - every intent has its own page. An inception cut into several intents
 *   gives each intent a documentation page of its own with its own stories
 *   page; the flow creates and moves those pages itself, only in mode
 *   `intent-pages` and only after the user said yes to one question that
 *   names every page, never deleting one; intent-pages.cjs gates it after the
 *   pull, before the approval and before the push and the upload; and every
 *   writer targets the intent's own page.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const read = (rel: string) => readFileSync(path.join(FLOW, rel), 'utf8');
const SKILL = 'skills/sync/confluence.md';
const dispatches = (text: string, mode: string) =>
  text.includes('.specsmd/aidlc-turbo/skills/sync/confluence.md') && new RegExp(`mode\\s+\`${mode}\``).test(text);

describe('aidlc-turbo Confluence sync', () => {
  it('ships the Confluence skill and the rerun skill', () => {
    expect(existsSync(path.join(FLOW, SKILL))).toBe(true);
    expect(existsSync(path.join(FLOW, 'skills/sync/rerun.md'))).toBe(true);
  });

  it('intake dispatches the pull and the resolve, review the push', () => {
    const intake = read('skills/inception/intake.md');
    expect(dispatches(intake, 'pull')).toBe(true);
    expect(dispatches(intake, 'resolve')).toBe(true);
    expect(dispatches(read('skills/inception/review.md'), 'push')).toBe(true);
  });

  it('keeps the pages inside .specs-aidlc-turbo/, in the new layout', () => {
    const skill = read(SKILL);
    expect(skill).toContain('`.specs-aidlc-turbo/docs/{inception}/pages/`');
    expect(skill).toContain('`.specs-aidlc-turbo/project/pages/`');
    expect(skill).toContain('`.specs-aidlc-turbo/docs/{inception}/sync.yaml`');
    expect(skill).not.toContain('intents/{intent-slug}');
  });

  it('pushes only what resolve marked changed: the sync agent has no shell to hash with', () => {
    const skill = read(SKILL);
    expect(skill).toContain('Set\n`changed: true` on the row of every page you wrote.');
    expect(skill).toContain('For every row with `changed: true`:');
    expect(skill).not.toContain('sha256');
  });

  it('never writes the repo\'s own docs', () => {
    expect(read(SKILL)).toContain("Never write the repo's own `docs/` or `project-docs/`:\nthose belong to the project, not to this flow.");
  });

  it('the inception can never be approved with an open question in a pulled page', () => {
    expect(read(SKILL)).toContain('Inception can never be approved while one is left.');
    expect(read('skills/inception/intake.md').replace(/\s+/g, ' ')).toMatch(/Nothing-open gate.*the resolve/);
    expect(read(SKILL)).toContain('one without an answer in the record goes into `open`');
  });

  it('pushes only after the approval and never overwrites a newer page blindly', () => {
    const skill = read(SKILL);
    expect(skill).toContain('Never push before the user approved the inception.');
    expect(skill).toContain('Never push a page that is not marked `changed`.');
    expect(skill).toContain('Never overwrite a newer page without applying your change on top of it.');
    expect(skill).toContain('Never create a page, never delete one, never move one.');
  });

  it('creates no page but an intent page: the overview is an attachment of the documentation page', () => {
    // The files of the intent overview are attachments of the documentation page. The one page the
    // sync makes is an intent's own page with its stories page, in mode intent-pages.
    const skill = read(SKILL);
    const intentPages = skill.slice(skill.indexOf('## Intent pages'), skill.indexOf('## Never'));
    expect(intentPages).toContain('createConfluencePage');
    expect(skill.replace(intentPages, '')).not.toContain('createConfluencePage');
    expect(skill).toContain('| The intent overview (`overview_file`, default `overview-{intent-slug}.html`) | Attachments of the intent\'s own documentation page, linked in its overview section |');
    expect(skill).not.toContain('confluence-attach.cjs download');
    const agent = read('commands/aidlc-turbo-sync.md');
    expect(agent.replace(/\s+/g, ' ')).toContain(
      'Never delete a Confluence page. Create or move one only in mode `intent-pages`, and only the pages its plan names.',
    );
  });

  it('reads the page names from the config, every key with its default', () => {
    const skill = read(SKILL);
    const names = skill.slice(skill.indexOf('## Page names'), skill.indexOf('## Where things live'));
    expect(names).toContain('`sync.page_names` in\n`.specs-aidlc-turbo/repo/config.yaml`');
    const lib = createRequire(import.meta.url)(path.join(FLOW, 'scripts/lib/page-names.cjs'));
    for (const [key, value] of Object.entries(lib.DEFAULTS)) expect(names).toContain(`| \`${key}\` | \`${value}\` |`);
    expect(skill).toMatch(/^ {2}documentation:$/m);
    expect(skill).toMatch(/^ {2}project_documentation:$/m);
  });

  it('a push that wrote the documentation page has its overview section put back by the caller', () => {
    // The push replaces the whole body with the local markdown, which can mangle or drop the section
    // confluence-attach.cjs keeps there. The sync agent has no shell, so it reports and the caller runs the script.
    const skill = read(SKILL);
    const push = skill.slice(skill.indexOf('## Push'), skill.indexOf('## Never'));
    expect(push).toContain('node .specsmd/aidlc-turbo/scripts/confluence-attach.cjs links --page {page_id}');
    expect(push).toContain('return `documentation_pushed: true`');
    expect(push).toMatch(/mode: push, status: done,[^\n]* documentation_pushed: true/);
    expect(push).toContain('A failed run is not a stop');
    expect(skill).toContain('Never change the overview section of a documentation page');
    for (const caller of ['skills/inception/review.md', 'skills/sync/rerun.md']) {
      expect(read(caller), caller).toContain('`documentation_pushed: true`');
    }
    expect(read('skills/inception/review.md')).toContain(
      'node .specsmd/aidlc-turbo/scripts/confluence-attach.cjs links --page {page_id}',
    );
  });

  it('project-init can pull the project page before any inception, and keeps its link', () => {
    const skill = read(SKILL);
    expect(skill).toContain('| `project` | project-init, before any inception |');
    expect(skill).toMatch(/## Project\n/);
    expect(skill.replace(/\s+/g, ' ')).toContain('Its title must be the `project` name (default `Project Documentation`) or start with that name and ` -`.');
    expect(skill).toMatch(/mode: project, status: done/);
    const init = read('skills/master/project-init.md');
    expect(init).toContain('mode `project` and the link');
    expect(init.replace(/\s+/g, ' ')).toContain('`project_docs_url`, so the first inception never asks for it');
    for (const offer of ['commands/aidlc-turbo.md', 'agents/master-agent.md']) {
      expect(read(offer).replace(/\s+/g, ' '), offer).toContain('paste the link of their shared project page on Confluence (`sync.page_names.project`, default `Project Documentation`)');
    }
    expect(read('commands/aidlc-turbo-sync.md')).toContain('`pull`, `resolve`, `push`, `project` or `intent-pages` for Confluence');
  });

  it('says an unsupported documentation tool is not supported, without naming a person, and is off without the key', () => {
    const skill = read(SKILL);
    expect(skill).toContain('"`{value}` is not supported yet." and go on as');
    expect(skill).toMatch(/`none`, the\ndefault when the key is missing, means it never runs/);
    expect(skill).not.toMatch(/Contact /);
  });
});

describe('aidlc-turbo every intent its own page', () => {
  const flat = (rel: string) => read(rel).replace(/\s+/g, ' ');
  const between = (text: string, from: string, to: string) => {
    const at = text.indexOf(from);
    expect(at, from).toBeGreaterThan(-1);
    const end = text.indexOf(to, at + from.length);
    return text.slice(at, end === -1 ? undefined : end);
  };
  const CALLER = 'skills/sync/intent-pages.md';

  it('the Confluence skill holds the rule and the mode', () => {
    const skill = flat(SKILL);
    expect(skill).toContain('Story pages of two intents never share a parent.');
    expect(skill).toContain('| `intent-pages` |');
    expect(skill).toContain('`.specs-aidlc-turbo/docs/{inception}/pages/{intent-slug}/`');
    // One intent: the inception page is its page, nothing changes.
    expect(skill).toContain("An inception of one intent has no `intents`: its documentation page is the intent's page.");
  });

  it('sync.yaml names each intent page under confluence.intents, and every row under one carries intent:', () => {
    const skill = read(SKILL);
    expect(skill).toMatch(/^ {2}intents:/m);
    expect(skill).toMatch(/\{ path: docs\/user-auth\/pages\/audit-log\/[^}]*intent: audit-log \}/);
    expect(flat(SKILL)).toContain('every row of a page under an intent page carries `intent: {intent-slug}`');
  });

  it('the pull puts an intent page and everything under it in the intent own folder', () => {
    const pull = between(flat(SKILL), '## Pull', '## Project');
    expect(pull).toContain('Its whole subtree goes under `docs/{inception}/pages/{intent-slug}/`');
    expect(pull).toContain("the page itself is that folder's `index.md`");
    expect(pull).toContain('`intents`');
  });

  it('mode intent-pages creates and moves only what the plan names, body sent back unchanged, and never deletes', () => {
    const section = between(flat(SKILL), '## Intent pages', '## Never');
    for (const phrase of ['createConfluencePage', '`parentId`', 'the same body back unchanged', 'never as markdown', '`stale`', '`not_synced`']) {
      expect(section, phrase).toContain(phrase);
    }
    expect(section).toMatch(/mode: intent-pages, status: done/);
    const never = between(flat(SKILL), '## Never', '\u0000');
    expect(never).toContain('Never create or move a page outside mode `intent-pages`');
    expect(never).toContain('Never delete a page');
    expect(never).toContain("Never put the story pages of two intents under one page");
  });

  it('the caller runs the gate, asks one question naming every page, and dispatches the plan the user approved', () => {
    const caller = flat(CALLER);
    expect(caller).toContain('node .specsmd/aidlc-turbo/scripts/intent-pages.cjs check --inception {inception}');
    for (const option of ['**Yes, do it**', '**Change the mapping**', '**Not now**']) expect(caller).toContain(option);
    expect(caller).toContain('--map {page_id}={intent-slug}');
    expect(caller).toMatch(/mode `intent-pages`/);
    expect(between(caller, '.specsmd/aidlc-turbo/skills/sync/confluence.md', 'mode `intent-pages`')).toContain('the inception slug');
    // The overview of an intent that was approved before it had a page goes to its own page, under the name review.md gives it.
    expect(caller).toContain('node .specsmd/aidlc-turbo/scripts/confluence-attach.cjs upload --intent {intent-slug} --file .specs-aidlc-turbo/docs/{inception}/{intent-slug}/overview.html');
    expect(caller).toContain('`sync.page_names.overview_file`');
  });

  it('the gate runs after the pull, before the approval, and before the push and the upload', () => {
    const intake = flat('skills/inception/intake.md');
    const docs = between(intake, '### 3. Docs, through the source register', '### 4.');
    expect(docs.indexOf(CALLER)).toBeGreaterThan(docs.indexOf('mode `pull`'));
    expect(docs.indexOf(CALLER)).toBeLessThan(docs.indexOf('**Extra sources, always asked**'));
    expect(flat('skills/inception/intake.md')).toContain('gets its own page under it, named by `sync.page_names.intent`');

    const review = flat('skills/inception/review.md');
    const gate = between(review, '### 1. Gate by script', '### 2.');
    expect(gate).toContain(CALLER);
    expect(gate).toContain('the approval is never asked while it fails');
    const approve = between(review, '### 5. On approve, stamp and sync', '### 6.');
    const check = approve.indexOf('intent-pages.cjs check --inception {inception}');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(approve.indexOf('mode `push`'));

    const rerun = flat('skills/sync/rerun.md');
    expect(rerun.indexOf(CALLER)).toBeGreaterThan(-1);
    expect(rerun.indexOf(CALLER)).toBeLessThan(rerun.indexOf('mode `push`'));
  });

  it('every writer targets the intent own page', () => {
    const approve = between(flat('skills/inception/review.md'), '### 5. On approve, stamp and sync', '### 6.');
    expect(approve).toContain('node .specsmd/aidlc-turbo/scripts/confluence-attach.cjs upload --intent {intent-slug} --file .specs-aidlc-turbo/docs/{inception}/{intent-slug}/overview.html');
    expect(flat('skills/sync/jira.md')).toContain("the link to the intent's own documentation page (`confluence.intents.{intent-slug}.url`)");
    expect(flat('skills/construction/mr-description.md')).toContain('`confluence.intents.{intent-slug}.url`');
  });

  it('a push that wrote an intent page puts its overview section back too', () => {
    const push = between(flat(SKILL), '## Push', '## Intent pages');
    expect(push).toContain('`intent_pages_pushed`');
    for (const caller of ['skills/inception/review.md', 'skills/sync/rerun.md']) {
      expect(flat(caller), caller).toContain('`intent_pages_pushed`');
    }
    expect(flat('skills/inception/review.md')).toContain('node .specsmd/aidlc-turbo/scripts/confluence-attach.cjs links --intent {slug}');
  });
});

describe('the sync agent', () => {
  const agent = read('commands/aidlc-turbo-sync.md');
  const frontmatter = agent.split(/^---\s*$/m)[1] ?? '';

  it('runs on Sonnet at medium effort without CLAUDE.md', () => {
    expect(frontmatter).toMatch(/^name: specsmd-aidlc-turbo-sync$/m);
    expect(frontmatter).toMatch(/^model: claude-sonnet-5-5$/m);
    expect(frontmatter).toMatch(/^effort: medium$/m);
    expect(frontmatter).toMatch(/^omitClaudeMd: true$/m);
  });

  it('takes every tool but Bash and the edit tools', () => {
    // A fixed list of mcp__atlassian__ names left the agent without Jira tools on a session whose
    // Atlassian server has another name, and without every tool the two skills did not name.
    expect(frontmatter).not.toMatch(/^tools:/m);
    const denied = (frontmatter.match(/^disallowedTools: (.*)$/m)?.[1] ?? '').split(/,\s*/);
    expect(denied).toEqual(['Bash', 'Edit', 'MultiEdit', 'NotebookEdit']);
    expect(agent).toContain('the tool name after the last `__` is what counts');
    expect(agent).toContain('Return `no_tools` only when that search finds no Atlassian tools at all.');
  });

  it('returns the skill result and hands questions and deletions to the caller', () => {
    expect(agent).toContain("Return the skill's result block and nothing else.");
    expect(agent).toContain('You cannot ask the user and you cannot delete a file.');
    for (const status of ['done', 'partial', 'skipped', 'needs_input', 'no_tools']) {
      expect(agent).toContain(`- \`${status}\``);
    }
  });
});
