/**
 * Unit tests for the Jira sync of the AI-DLC Turbo flow.
 *
 * Jira is optional and off by default (a missing `sync.issues` is none).
 * With `sync.issues: jira` the flow creates the epic and one issue per story
 * right after the inception approval, and once the whole intent is built it
 * closes the story issues and adds the test cases. These guards keep that in
 * place:
 * - review dispatches the sync agent in mode after-inception, finish in mode
 *   after-build;
 * - the project comes from the board link, in project/project.yaml first;
 * - the keys live in the inception's sync.yaml, one block per intent, never in
 *   the classic flow's jira-sync.yaml;
 * - the product-team half goes to Jira as written, in the record's language, never translated;
 * - a rerun never creates an issue twice, only the human half of a story goes
 *   to Jira, and the epic is never closed by the flow;
 * - finish again (after-build with tests_only) sends only the test cases and
 *   the mismatches that run decided: the first finish already commented and
 *   closed the stories and the epic.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const read = (rel: string) => readFileSync(path.join(FLOW, rel), 'utf8');
const SKILL = 'skills/sync/jira.md';

describe('aidlc-turbo Jira sync', () => {
  it('ships the Jira skill', () => {
    expect(existsSync(path.join(FLOW, SKILL))).toBe(true);
  });

  it('review dispatches after-inception and finish dispatches after-build', () => {
    const dispatches = (rel: string, mode: string) => {
      const text = read(rel);
      return text.includes('.specsmd/aidlc-turbo/skills/sync/jira.md') && new RegExp(`mode\\s+\`${mode}\``).test(text);
    };
    expect(dispatches('skills/inception/review.md', 'after-inception')).toBe(true);
    expect(dispatches('skills/construction/finish.md', 'after-build')).toBe(true);
  });

  it('after the build comments the merge request links, so finish runs it after the push', () => {
    const skill = read(SKILL);
    const after = skill.slice(skill.indexOf('## After the build'), skill.indexOf('## Never')).replace(/\s+/g, ' ');
    expect(after).toContain("the story's `merge_request`");
    expect(after).toContain("the brief's `merge_request`");
    expect(skill).toContain('| `after-build` | finish, after the push');
    const finish = read('skills/construction/finish.md');
    const push = finish.indexOf('push-branch.cjs {intent} --all`. It pushes the intent branch');
    const jira = finish.indexOf('### 10. Jira');
    expect(push).toBeGreaterThan(0);
    expect(jira).toBeGreaterThan(push);
    expect(finish.slice(jira)).toContain('record the merge request and the Jira sync');
    expect(finish).not.toContain('### 7b. Jira');
  });

  it('finish again sends only the test cases and its own mismatches: no other story comment, no transition', () => {
    const skill = read(SKILL);
    const after = skill.slice(skill.indexOf('## After the build'), skill.indexOf('## Never')).replace(/\s+/g, ' ');
    expect(after).toContain('**Finish again** (`tests_only: true`)');
    expect(after).toContain('Only steps 2, 3 and 6 run: update every test-case sub-task that `sync.yaml` names, create the missing ones');
    expect(after).toContain('skip an `unreachable` one as above');
    expect(after).toContain('send a mismatch this run decided. No other story comment, no transition, no other epic comment');
    expect(skill).toContain('sync: { skill: jira, mode: after-build, tests_only: true, status: done, test_cases: 5, note: "" }');
    // The sync agent takes it as an input, and a re-finish that waits for Jira stays tests-only.
    expect(read('commands/aidlc-turbo-sync.md')).toContain('`tests_only: true` (after-build');
    expect(skill.replace(/\s+/g, ' ')).toContain('for a `tests_only: true` dispatch `tests_only: true` next to it');
    expect(read('skills/sync/rerun.md').replace(/\s+/g, ' ')).toContain('with `tests_only: true` when the block has it');
  });

  it('finds the project from the board link, project.yaml first, never from a bare key', () => {
    const skill = read(SKILL);
    expect(skill).toContain('`jira_project_url` in\n`.specs-aidlc-turbo/project/project.yaml`, or else `sync.jira_project_url` in the config');
    expect(skill).toContain('`/projects/{KEY}/`, `/browse/{KEY}` or a `projectKey=` query');
    expect(skill).not.toMatch(/sync\.jira_project\b(?!_url)/);
  });

  it('keeps the keys in the inception sync.yaml per intent, never in the classic flow files', () => {
    const skill = read(SKILL);
    expect(skill).toContain('`.specs-aidlc-turbo/docs/{inception}/sync.yaml`');
    expect(skill).toMatch(/intents:\n {4}user-auth:\n {6}epic: SHOP-100/);
    expect(skill).toContain("Never write the classic flow's `jira-sync.yaml`: it belongs to the\nclassic AI-DLC flow.");
  });

  it('sends the product-team half as written, in the record\'s language', () => {
    const skill = read(SKILL);
    expect(skill).toContain("story's product-team section as written");
    expect(skill).toContain("The product-team text is in the record's language");
    expect(skill).toContain('never translate it');
    expect(skill).toContain('`docs/{inception}/{intent}/tests/US-{SSS} - {story title}.md`');
  });

  it('never creates an issue twice, never copies the agent half, never closes the epic', () => {
    const skill = read(SKILL);
    expect(skill).toContain('Never create a second issue for a story, a test case or the intent');
    expect(skill).toContain('Never copy the agent half of a story into Jira.');
    expect(skill).toContain('Never close the epic.');
  });

  it('adds the test cases only when there is a tester', () => {
    expect(read(SKILL)).toContain('only when `tester.enabled` is true');
  });

  it('says an unsupported issue tool is not supported, without naming a person, and is off without the key', () => {
    const skill = read(SKILL);
    expect(skill).toContain('"`{value}` is not supported yet." and go on as');
    expect(skill).toMatch(/`none`, the\ndefault when the key is missing, means it never runs/);
    expect(skill).not.toMatch(/Contact /);
    expect(read('commands/aidlc-turbo-config.md')).toContain('tell the user, in their language, that it is not supported yet, and write `none`');
  });
});
