/**
 * Unit tests for the aidlc-turbo flow packaging invariants.
 *
 * aidlc-turbo is the slim AI-DLC flow: inception keeps a decision record on
 * disk, scripts render and lint the brief and the stories from it, and
 * construction builds every story through scripts and pinned agents. These
 * guards keep the flow coherent as a whole; the scripts have their own test
 * files next to this one.
 * - The flow is registered in FLOWS with path 'aidlc-turbo'.
 * - The four phase commands and the review fix exist, and every role is its own agent file in
 *   commands/ that pins the model, the effort and the tools of the tier table
 *   (design section 3). Nothing inherits the session model by accident.
 *   The roles that work from flow files, not from the repo's coding rules,
 *   carry omitClaudeMd. The explorer can only read.
 * - The writer is gone: a script renders the specs. No file names it, and no
 *   file names a council, a translation pass or another dropped step.
 * - The two builders share one body so they never drift, and build-story.md,
 *   the inline procedure for hosts without subagents, uses the same headings.
 * - Every script, skill, agent and template a flow file points at exists, and
 *   every agent type a flow file names has its agent file.
 * - The tree uses its own `.specs-aidlc-turbo/` artifact namespace and the
 *   `.specsmd/aidlc-turbo/` resource path - never the parent aidlc ones.
 * - No stale `/specsmd-*-agent` slash commands survive the rename, and nothing
 *   named after the removed ceremony (bolts, an operations phase) survives.
 * - Plan puts every test that asserts a changed value in the story that
 *   changes it, and the cross-checker flags one scoped to a later story. A
 *   real run scoped those fixes to a later story, the first builder broke them
 *   and the run stopped for the human.
 * - Intake keeps the codebase explorers bounded. On a 2M-line monorepo the
 *   unbounded version burned 23M cache-read tokens in three minutes, so intake
 *   keeps the cap of three and the explorer agent carries the per-explorer
 *   tool-call budget that replaced it.
 * - The flow scripts pull in no third-party module at load time. They run from
 *   the root of the target project, which often has no node_modules at all.
 * - The config command asks the human-tester question whenever the mode
 *   switches to production. A real run switched a sandbox project to production
 *   without ever asking, and the project ended up with a tester block nobody
 *   had chosen.
 * - No shipped file names a top-level `.tests` folder, and only the config
 *   command names a `tests_dir` setting, to drop it from an older file.
 *   Test cases live in the intent folder, `docs/{inception}/{intent}/tests/`,
 *   and a project without a tester gets no test folder at all.
 * - Nothing in the flow numbers an intent. The folder is the bare slug and the
 *   branch is `{project_key}/intent-{intent-slug}/intent`; a slug that is
 *   taken gets a `-2` suffix instead.
 * - codebase-scan.cjs detects a dependency-free Node project. A project built
 *   on node:http and node:test declares nothing in package.json, so the scan
 *   reads the source imports; without that it reported an empty stack and the
 *   brief was written against nothing.
 * - Nothing is ever left open. Construction closes no story and no intent with
 *   an open finding, a failed twin or a live test that did not run, unless the
 *   user decided it and the decision is in the brief. The standards guide may
 *   not invite a TBD either.
 * - No review document outlives its findings. The reviewers have no Write
 *   tool and write no report, the live tester writes nothing into the project,
 *   and finish fixes every finding in the code and reports it in the summary.
 * - The overview page is read straight from the product half of the specs, at
 *   the inception review and again at finish, and the one approval offers
 *   building in the same session only for a quick-lane intent.
 * - The agents name things, never ids. A real run asked its questions by
 *   register id (S-012) and the user could not tell what they were about, so
 *   every question a subagent returns, and every example of one, names the
 *   thing itself.
 * - The agent decides the story map and the verification commands. A real run
 *   asked the user to approve the split and to pick the test commands; both
 *   are the agent's to settle, and the approval stays the only stop.
 * - Inception asks where a user sees or starts every backend change: the
 *   locating pass greps for it, every explorer answers it, and intake does not
 *   hand over until each change has its answer. On a real run a backend story
 *   was judged not testable because nobody asked where its result shows up,
 *   while a tester could see it on a screen.
 * - The cross-checker has a sixth kind, `channel`: a criterion that names the
 *   wrong place for the tester, checked against the screen code on a budget of
 *   its own. On a real run a job a user starts on an admin screen was marked
 *   as nothing a tester can check, and no test case covered it.
 * - Regression has no maximum, and nothing is parked in `Notes for the
 *   agent` instead of a step. On a real run a cap of five regression steps
 *   parked the rest there, which Jira never gets, so no tester saw them.
 * - The steps decide the twin, never the story's surface: a step on a screen
 *   means a twin. On a real run a data story and a job story whose test cases
 *   ran entirely through screens got no twin "because the surface is data".
 * - Only the test writer writes in `aidlc-twins/`, and a twin that never
 *   reached the application is `unreachable`, never `not_run`: it is not
 *   proven until it runs. On a real run a builder wrote a twin on its story
 *   branch, so a test case named a twin the intent branch never got, and none
 *   of the twins ever ran.
 * - The test writer keeps one twin line in the story, replaced on every run,
 *   removes every older twin note, and rewrites the test case in full. On a
 *   real run a note "Not run: no application is running" stayed in the
 *   Build notes after the decision it named was gone.
 * - Plan decides per criterion where a tester checks it, its `observed_via`,
 *   never from where the code lives; lint checks it and `tester_verifiable`
 *   follows from it. On a real run `tester_verifiable` was decided once per
 *   story, "through the UI or an API call", so a job story whose collection
 *   file a user makes on a screen, with its result on a tab, got no test case
 *   and the live test skipped it.
 * - The live test checks what the criteria say, never what the surface says,
 *   and checks the database and the log when the project gives it a way. On a
 *   real run the live test and the twin went by the surface, which says where
 *   the code lives, not where a tester looks.
 * - Builders never write in `aidlc-twins/`, and dispatch sends a story that
 *   does back to its builder: the folder belongs to the test writer at
 *   finish. On a real run a builder wrote the twin its test plan asked for,
 *   and it stayed on the story branch.
 * - After any code fix at finish every test writer runs again, not only the
 *   one whose twin failed, and the writer's budget bounds only the reading of
 *   its own story's code. On a real run the twins were not run again after
 *   the live test and the fix loop.
 * - Every twin a test case names reaches the intent branch, carried over from
 *   its story branch when it is missing, and no fix commit carries one. On a
 *   real run a twin committed on its story branch never reached the intent
 *   branch: the close commit took only the uncommitted twins, and the test
 *   case pointed at a twin the branch did not hold.
 * - A done intent whose branch is not merged can be finished again: it proves
 *   the test cases once more and marks each decision it settled as
 *   superseded, never deleted. On a real run the intent was done and its
 *   branch not merged when these gaps were found, and the flow had no way to
 *   run the test cases again on it.
 * - The overview goes onto the intent's own documentation page. The approval
 *   attaches the approved overview after the push, under the name the
 *   config's page names give it, and keeps a failed upload pending for the
 *   sync rerun, never a stop. Intake downloads no attachment, every Confluence
 *   page name comes from the config, and no build-plan page exists: an older
 *   record with an overview key the flow no longer reads lints clean.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { builtinModules, createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';
import yaml from 'js-yaml';

const BUILTINS = new Set(builtinModules);
const isBuiltin = (id: string) => id.startsWith('node:') || BUILTINS.has(id);

const ROOT = path.resolve(__dirname, '../../..');
const FLOW = path.join(ROOT, 'flows/aidlc-turbo');
const req = createRequire(import.meta.url);

const read = (rel: string) => readFileSync(path.join(FLOW, rel), 'utf8');
/** The file with every run of whitespace collapsed, so a phrase may wrap. */
const flat = (rel: string) => read(rel).replace(/\s+/g, ' ');
const frontmatterText = (rel: string) => read(rel).split(/^---\s*$/m)[1] ?? '';
const frontmatter = (rel: string) => (yaml.load(frontmatterText(rel)) ?? {}) as Record<string, unknown>;
const body = (rel: string) => read(rel).split(/^---\s*$/m).slice(2).join('---');
const headings = (text: string) => text.split('\n').filter((l) => /^## /.test(l));

const PHASE_COMMANDS = [
  'commands/aidlc-turbo.md',
  'commands/aidlc-turbo-inception.md',
  'commands/aidlc-turbo-construction.md',
  'commands/aidlc-turbo-config.md',
  'commands/aidlc-turbo-review-fix.md',
];

const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
const BUILDER_TOOLS = 'Read, Write, Edit, MultiEdit, Bash, Grep, Glob, TodoWrite, LSP';
const READ_BASH = 'Read, Grep, Glob, Bash, LSP';
const READ_ONLY = 'Read, Grep, Glob';
const READ_LSP = 'Read, Grep, Glob, LSP';

/** The tier table of the design, section 3: role, model, effort, tools (null: checked on its own), omitClaudeMd. */
const TIERS: Array<[string, string, string, string | null, boolean]> = [
  ['builder', OPUS, 'high', BUILDER_TOOLS, false],
  ['builder-low', SONNET, 'high', BUILDER_TOOLS, false],
  ['reviewer', OPUS, 'high', READ_BASH, false],
  ['intent-reviewer', OPUS, 'xhigh', READ_BASH, false],
  ['debugger', OPUS, 'high', READ_BASH, false],
  ['cross-checker', OPUS, 'xhigh', READ_LSP, true],
  ['docs-verifier', OPUS, 'xhigh', READ_ONLY, true],
  ['docs-reader', SONNET, 'medium', 'Read, Grep, Glob, Write', true],
  ['explorer', OPUS, 'high', READ_LSP, true],
  ['test-writer', SONNET, 'high', 'Read, Write, Edit, Bash, Grep, Glob', false],
  ['live-tester', SONNET, 'high', 'Read, Write, Bash, Grep, Glob', false],
  ['breaker', OPUS, 'high', 'Read, Write, Bash', false],
  ['sync', SONNET, 'medium', null, true],
];

const agentFile = (role: string) => `commands/aidlc-turbo-${role}.md`;

function treeFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }) as string[];
}

function treeTextFiles(dir: string): string[] {
  return treeFiles(dir).filter((f) => /\.(md|cjs|yaml|yml|hbs|html)$/.test(f));
}

/** The commands/ files that define a subagent: they carry a `name:` in their frontmatter. */
function agentFiles(): string[] {
  return readdirSync(path.join(FLOW, 'commands'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `commands/${f}`)
    .filter((rel) => /^name:/m.test(frontmatterText(rel)));
}

describe('aidlc-turbo flow', () => {
  it('FLOWS registers aidlc-turbo', () => {
    const constants = readFileSync(path.join(ROOT, 'lib/constants.js'), 'utf8');
    expect(constants).toMatch(/'aidlc-turbo':\s*\{[\s\S]*?path:\s*'aidlc-turbo'/);
  });

  it.each([...PHASE_COMMANDS, ...TIERS.map(([role]) => agentFile(role))])('command %s exists', (rel) => {
    expect(existsSync(path.join(FLOW, rel))).toBe(true);
  });

  it('uses its own .specs-aidlc-turbo/ namespace, never the parent memory-bank/ path', () => {
    const offenders = treeTextFiles(FLOW).filter((f) => read(f).includes('memory-bank/'));
    expect(offenders).toEqual([]);
  });

  it('uses the .specsmd/aidlc-turbo/ resource path, never .specsmd/aidlc/', () => {
    const offenders = treeTextFiles(FLOW).filter((f) => /\.specsmd\/aidlc(?!-light)\//.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('no stale /specsmd-*-agent slash commands survive the rename', () => {
    const offenders = treeTextFiles(FLOW).filter((f) =>
      /\/specsmd-(master|inception|construction|operations)-agent/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it('no file is named after a bolt or an operations phase', () => {
    const offenders = treeFiles(FLOW).filter((f) => /bolt|operations/i.test(f));
    expect(offenders).toEqual([]);
  });

  it.each(
    treeFiles(path.join(FLOW, 'scripts')).filter((f) => f.endsWith('.cjs')).map((f) => `scripts/${f}`),
  )('%s loads without a third-party module', (rel) => {
    // A third-party require is allowed only as an optional one: inside a try
    // whose catch falls back (frontmatter.cjs uses js-yaml when the host has it).
    const source = read(rel);
    const thirdParty = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)]
      .filter((m) => !m[1].startsWith('.') && !isBuiltin(m[1]))
      .filter((m) => {
        const before = source.slice(Math.max(0, m.index! - 200), m.index);
        const after = source.slice(m.index, m.index! + 200);
        return !(/try\s*\{[^}]*$/.test(before) && /\}\s*catch\b/.test(after));
      })
      .map((m) => m[1]);
    expect(thirdParty).toEqual([]);
  });

  it('stories rate complexity as low, medium or hard, and story-start picks the builder from it', () => {
    expect(read('templates/inception/story-template.md')).toContain('`low`, `medium` or `hard`');
    expect(read('skills/inception/plan.md')).toContain('`low`, `medium` or `hard`');
    const dispatch = read('skills/construction/dispatch.md');
    expect(dispatch).toContain('`low` gets `specsmd-aidlc-turbo-builder-low`');
    expect(dispatch).toContain('gets `specsmd-aidlc-turbo-builder`');
    expect(read('scripts/story-start.cjs')).toMatch(/complexity === 'low' \? BUILDER_LOW : BUILDER/);
  });

  it('plan and the cross-checker keep breaking tests in the story that breaks them', () => {
    expect(read('skills/inception/plan.md')).toContain('Put every breaking test in the story that breaks it');
    expect(flat('commands/aidlc-turbo-cross-checker.md'))
      .toContain('an existing test that asserts a value a story changes, scoped to a later story');
  });

  it('intake caps the codebase explorers at three, and the explorer carries the tool-call budget', () => {
    const intake = read('skills/inception/intake.md');

    // The cap, in the heading and in the rule that sets it.
    expect(intake).toMatch(/### 4\. Codebase grounding: locate first, then at most three explorers/);
    expect(intake).toMatch(/\*\*at most three\*\*/);
    expect(intake).toMatch(/Intake may spend three explorers in total/);
    // The unbounded fan-out wording it replaced.
    expect(intake).not.toMatch(/Two to six areas/);
    expect(intake).not.toMatch(/at most 8 at a time/);

    // The cheap locating pass that runs before any explorer, and the host fallback.
    expect(intake).toMatch(/\*\*At most six grep calls\*\*/);
    expect(intake).toMatch(/dispatch no\n {2}explorer at all/);
    expect(intake).toMatch(/on hosts without subagents, explore the areas yourself/);

    // The budget every explorer runs under, verbatim, in its own agent file.
    const explorer = read('commands/aidlc-turbo-explorer.md');
    expect(explorer).toMatch(/Budget: at most 12 tool calls\./);
    expect(explorer).toMatch(/Grep before you read/);
    expect(explorer).toMatch(/Never read a whole file over 200 lines\./);
    expect(explorer).toMatch(/Never list or walk a directory tree\./);
    expect(explorer).toMatch(/Never read a file you have already read\./);
    expect(explorer).toMatch(/Never spawn a subagent of your own\./);
  });

  it('the config command must ask the tester question when the mode switches to production', () => {
    const config = read('commands/aidlc-turbo-config.md');

    // The rule itself, stated as a rule the display-and-confirm style cannot skip.
    expect(config).toMatch(/\*\*The tester question is mandatory whenever the mode becomes production\.\*\*/);
    expect(config).toMatch(/from `sandbox`, or from no config file at all/);
    expect(config).toMatch(/ask the human-tester question out loud in this same run/);
    expect(config).toMatch(/multiple-choice prompt/);
    expect(config).toMatch(/never leave it at `false` without asking/);
    // Test cases follow the record's language, so no language question follows the yes.
    expect(config).not.toMatch(/test-case language/i);
  });

  it('the config command drops the tester keys when the tester is off and adds them when it is on', () => {
    const config = read('commands/aidlc-turbo-config.md');
    expect(config).toMatch(/\*\*Tester off\*\*: the block is `enabled: false` and nothing else/);
    expect(config).toMatch(/\*\*Tester on\*\*: the block is `enabled: true` and nothing else/);
    expect(config).toMatch(/drop a `language` key from an older file \(test cases follow the record's language\)/);
    expect(config).toMatch(/Never create a test folder here/);
    // No folder question survives.
    expect(config).not.toMatch(/Test-case folder/);
  });

  it('no shipped file names a top-level .tests folder or a tests_dir setting', () => {
    // A path, not a property access: `out.tests` in a script is fine. No file
    // names a `.tests` folder, not even the leftovers script: it was never Turbo's.
    const dotTests = treeTextFiles(FLOW).filter((f) => /(^|[^\w.])\.tests\b/m.test(read(f)));
    expect(dotTests).toEqual([]);

    // `tests_dir` survives in exactly one place: the config command, which tells
    // the agent to delete a leftover key from an older config file.
    const testsDir = treeTextFiles(FLOW).filter((f) => read(f).includes('tests_dir'));
    expect(testsDir).toEqual(['commands/aidlc-turbo-config.md']);
  });

  it('the test-case path is the tests folder of the intent, everywhere it is named', () => {
    const memoryBank = yaml.load(read('memory-bank.yaml')) as any;
    expect(memoryBank.schema['test-case']).toBe(
      '.specs-aidlc-turbo/docs/{inception}/{intent-slug}/tests/US-{SSS} - {story title}.md',
    );
    expect(read('skills/construction/test-cases.md')).toContain(
      '.specs-aidlc-turbo/docs/{inception}/{intent-slug}/tests/US-{SSS} - {story title}.md',
    );
    expect(read('skills/sync/jira.md')).toContain('docs/{inception}/{intent}/tests/US-{SSS} - {story title}.md');
    // The old doc-root folder is gone from every file.
    const offenders = treeTextFiles(FLOW).filter((f) => /\.specs-aidlc-turbo\/tests\//.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('no intent is numbered, anywhere it is named', () => {
    const memoryBank = yaml.load(read('memory-bank.yaml')) as any;
    expect(memoryBank.naming.branches.format).toBe('{project_key}/intent-{intent-slug}/intent');
    expect(memoryBank.naming.branches.example).not.toMatch(/intent-\d{3}/);
    // The folder is the bare slug too: the number is gone everywhere.
    expect(memoryBank.naming.intents.format).toBe('{intent-slug}');
    expect(memoryBank.naming.intents.example).not.toMatch(/\d{3}/);

    // No shipped file numbers an intent, in either the placeholder spelling or
    // a worked example: not in a branch, not in an intent or test path.
    const offenders = treeTextFiles(FLOW).filter((f) => {
      const text = read(f);
      return /intent-(\{NNN\}|\d{3})/.test(text) || /(intents|docs|tests)\/(\{NNN\}-|\d{3}-)/.test(text);
    });
    expect(offenders).toEqual([]);

    // A slug can be taken by an earlier intent, so inception names the fallback
    // for both the folder and the branch.
    expect(read('skills/inception/intake.md')).toMatch(/already taken, append/);
    const review = read('skills/inception/review.md');
    expect(review).toMatch(/already exists locally or on the remote, append/);
    expect(review).toMatch(/record the branch actually used in the brief/);
  });

  it('every step that touches the test folder checks tester.enabled first', () => {
    // Dispatch writes no test cases at all: finish writes them against the finished code.
    expect(read('skills/construction/dispatch.md')).toMatch(/\*\*Test cases\*\*: none here\./);

    const finish = read('skills/construction/finish.md');
    expect(finish).toMatch(/\*\*Read `tester\.enabled` before anything else in this step\.\*\*/);
    expect(finish).toContain('Never create `{intent_dir}/tests/` when `tester.enabled` is false');

    expect(read('skills/construction/test-cases.md')).toMatch(/Otherwise write nothing, and create no folder\./);

    // The reviewer is told the folder may simply not exist.
    expect(read('skills/construction/review.md')).toMatch(/only when `tester\.enabled` is true/);
    expect(read('commands/aidlc-turbo-reviewer.md')).toMatch(/With `tester\.enabled` false neither exists/);
  });
});

describe('aidlc-turbo agents and their tiers', () => {
  it.each(TIERS)('specsmd-aidlc-turbo-%s pins %s at effort %s', (role, model, effort, tools, omit) => {
    const rel = agentFile(role);
    const fm = frontmatter(rel);
    expect(fm.name).toBe(`specsmd-aidlc-turbo-${role}`);
    expect(fm.model).toBe(model);
    expect(fm.effort).toBe(effort);
    if (tools !== null) expect(fm.tools).toBe(tools);
    if (omit) expect(fm.omitClaudeMd).toBe(true);
    else expect(fm).not.toHaveProperty('omitClaudeMd');
  });

  it('every agent file in commands/ is in the tier table, so none runs on the session model', () => {
    expect(agentFiles().sort()).toEqual(TIERS.map(([role]) => agentFile(role)).sort());
  });

  it('the phase commands are the user\'s own session and pin nothing', () => {
    for (const rel of PHASE_COMMANDS) {
      const fm = frontmatter(rel);
      expect(fm, rel).not.toHaveProperty('model');
      expect(fm, rel).not.toHaveProperty('effort');
    }
  });

  it('the explorer can only read, the language server included, and has no Skill tool', () => {
    const tools = String(frontmatter(agentFile('explorer')).tools).split(',').map((t) => t.trim());
    expect(tools).toEqual(['Read', 'Grep', 'Glob', 'LSP']);
  });

  it('the sync agent writes files and reaches Atlassian under any server name, but runs no Bash', () => {
    const fm = frontmatter(agentFile('sync'));
    expect(fm).not.toHaveProperty('tools');
    const denied = String(fm.disallowedTools).split(',').map((t) => t.trim());
    expect(denied).toEqual(['Bash', 'Edit', 'MultiEdit', 'NotebookEdit']);
    expect(denied).not.toContain('Write');
  });

  it('the reviewers cannot write a file', () => {
    for (const role of ['reviewer', 'intent-reviewer', 'debugger', 'cross-checker', 'docs-verifier']) {
      expect(String(frontmatter(agentFile(role)).tools), role).not.toMatch(/Write|Edit/);
    }
  });

  it('the writer is gone: a script renders the specs', () => {
    expect(existsSync(path.join(FLOW, 'commands/aidlc-turbo-writer.md'))).toBe(false);
    expect(existsSync(path.join(FLOW, 'skills/inception/write.md'))).toBe(false);
    expect(existsSync(path.join(FLOW, 'skills/inception/render.md'))).toBe(true);
    expect(read('skills/inception/render.md')).toContain('render-specs.cjs {intent-slug}');
  });

  it('the two builders share one body, and build-story.md uses its step headings', () => {
    const builder = body(agentFile('builder'));
    expect(body(agentFile('builder-low'))).toBe(builder);
    const steps = headings(builder);
    expect(steps).toContain('## Fix mode');
    expect(headings(read('skills/construction/build-story.md'))).toEqual(steps);
    // build-story.md is a preamble plus the builder body, verbatim.
    const from = (text: string) => text.slice(text.indexOf('## Paths and code root'));
    expect(from(read('skills/construction/build-story.md'))).toBe(from(builder));
  });

  it('a Sonnet role that fails runs once more on Opus, and the session agents never switch model', () => {
    expect(flat('agents/inception-agent.md')).toContain('`model: opus` override');
    const construction = flat('agents/construction-agent.md');
    expect(construction).toContain('`model: opus` override');
    expect(construction).toContain('A failed `builder-low` story goes to `builder` in fix mode instead.');
    expect(construction).toContain('Never run `/compact` and never switch model mid-run');
  });
});

describe('aidlc-turbo cross-references', () => {
  const texts = treeTextFiles(FLOW).filter((f) => !f.startsWith('templates/standards/'));

  it('every script, skill, agent and template a flow file points at exists', () => {
    const missing: string[] = [];
    for (const f of texts) {
      for (const m of read(f).matchAll(/\b((?:scripts|skills|agents|commands)\/[\w./-]+\.(?:cjs|md)|templates\/(?:inception|construction|overview)\/[\w.-]+\.(?:md|yaml|html))\b/g)) {
        if (!existsSync(path.join(FLOW, m[1]))) missing.push(`${f}: ${m[1]}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('every script a flow file runs exists', () => {
    const missing: string[] = [];
    for (const f of texts) {
      for (const m of read(f).matchAll(/\b([a-z][\w-]*\.cjs)\b/g)) {
        const script = m[1];
        if (!existsSync(path.join(FLOW, 'scripts', script)) && !existsSync(path.join(FLOW, 'scripts/lib', script))) {
          missing.push(`${f}: ${script}`);
        }
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('every agent type a flow file names has its agent file, and every agent is dispatched somewhere', () => {
    const phase = new Set(['specsmd-aidlc-turbo', 'specsmd-aidlc-turbo-inception', 'specsmd-aidlc-turbo-construction', 'specsmd-aidlc-turbo-config', 'specsmd-aidlc-turbo-review-fix']);
    const agents = new Map(agentFiles().map((rel) => [String(frontmatter(rel).name), rel]));
    const named = new Map<string, Set<string>>();
    for (const f of treeTextFiles(FLOW)) {
      for (const m of read(f).matchAll(/\bspecsmd-aidlc-turbo(?:-[a-z]+)*\b/g)) {
        if (!named.has(m[0])) named.set(m[0], new Set());
        named.get(m[0])!.add(f);
      }
    }
    const unknown = [...named.keys()].filter((n) => !phase.has(n) && !agents.has(n));
    expect(unknown).toEqual([]);
    const neverNamed = [...agents.entries()]
      .filter(([name, rel]) => ![...(named.get(name) ?? [])].some((f) => f !== rel))
      .map(([name]) => name);
    expect(neverNamed).toEqual([]);
  });

  it('no file carries a step the redesign dropped', () => {
    const dropped = [
      /specsmd-aidlc-turbo-writer/,
      /\bwrite\.md\b/,
      /--translations/,
      /--extract/,
      /\bcouncil\b/i,
      /\bdigester\b/i,
      /token ledger/i,
      /must keep working/i,
      /docs still current/i,
    ];
    const offenders = treeTextFiles(FLOW)
      .flatMap((f) => dropped.filter((re) => re.test(read(f))).map((re) => `${f}: ${re}`));
    expect(offenders).toEqual([]);
  });

  it('every sync dispatch passes the inception slug', () => {
    for (const rel of ['skills/inception/intake.md', 'skills/inception/review.md', 'skills/sync/rerun.md', 'skills/sync/intent-pages.md', 'skills/construction/finish.md']) {
      const text = flat(rel);
      const dispatches = text.split(/(?=\.specsmd\/aidlc-turbo\/skills\/sync\/(?:confluence|jira)\.md)/).slice(1);
      expect(dispatches.length, rel).toBeGreaterThan(0);
      for (const d of dispatches) expect(d.slice(0, 200), rel).toContain('the inception slug');
    }
  });

  it('the sync agent\'s questions and stale files are handled by the phase agent', () => {
    const inception = flat('agents/inception-agent.md');
    for (const phrase of ['`needs_input`', '`no_tools`', '`stale`', '`answer: skip`', '`answer: later`']) {
      expect(inception).toContain(phrase);
    }
    expect(flat('skills/construction/finish.md')).toContain('`answer: later`');
  });
});

const SCAN = path.join(FLOW, 'scripts/codebase-scan.cjs');
const fixtures: string[] = [];

type Codebase = {
  languages: string[];
  has_ui: boolean;
  ui_stack: string[];
  backend_stack: string[];
  test_runners: string[];
  commands: { build: string | null; test: string | null };
};

/** Build a throwaway project on disk and return its `codebase:` block. */
function scanFixture(files: Record<string, string>): Codebase {
  const root = mkdtempSync(path.join(tmpdir(), 'turbo-scan-'));
  fixtures.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text, 'utf8');
  }
  const out = execFileSync('node', [SCAN, '--project', root], { encoding: 'utf8' });
  return (yaml.load(out) as { codebase: Codebase }).codebase;
}

afterAll(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

describe('codebase-scan on a project with no dependencies', () => {
  it('detects a node:http server and the node:test runner from the source imports', () => {
    const scan = scanFixture({
      'package.json': JSON.stringify({
        name: 'dep-free',
        type: 'module',
        scripts: { build: 'node --check src/*.js', test: 'node --test' },
      }),
      'src/server.js': "import http from 'node:http';\nexport const server = http.createServer();\n",
      'src/server.test.js': "import { test } from 'node:test';\ntest('boots', () => {});\n",
    });

    expect(scan.languages).toContain('javascript');
    expect(scan.backend_stack).toContain('node-http');
    expect(scan.test_runners).toContain('node-test');
    expect(scan.commands).toEqual({ build: 'npm run build', test: 'npm test' });
    expect(scan.has_ui).toBe(false);
  });

  it('detects the CommonJS spelling of the same two builtins', () => {
    const scan = scanFixture({
      'package.json': JSON.stringify({ name: 'cjs-only' }),
      'index.js': "const http = require('http');\nhttp.createServer();\n",
      'index.test.js': "const { test } = require('node:test');\ntest('boots', () => {});\n",
    });

    expect(scan.backend_stack).toEqual(['node', 'node-http']);
    expect(scan.test_runners).toEqual(['node-test']);
  });

  it('reads node --test out of the package script when no test file imports it', () => {
    const scan = scanFixture({
      'package.json': JSON.stringify({ name: 'script-only', scripts: { test: 'node --test' } }),
      'src/lib.js': 'export const add = (a, b) => a + b;\n',
    });

    expect(scan.test_runners).toEqual(['node-test']);
    expect(scan.backend_stack).toEqual([]);
  });

  it('keeps naming the framework when there is one, and never adds node-http on top', () => {
    const scan = scanFixture({
      'package.json': JSON.stringify({ name: 'api', dependencies: { express: '^4.0.0' } }),
      'src/app.js': "import express from 'express';\nimport http from 'node:http';\n",
    });

    expect(scan.backend_stack).toEqual(['node', 'express']);
    expect(scan.backend_stack).not.toContain('node-http');
  });

  it('does not mistake a plain string literal for an import', () => {
    const scan = scanFixture({
      'package.json': JSON.stringify({ name: 'no-server' }),
      'src/url.js': "export const protocol = 'http';\nexport const base = 'https://example.com';\n",
    });

    expect(scan.backend_stack).toEqual([]);
    expect(scan.test_runners).toEqual([]);
  });
});

describe('aidlc-turbo story branches', () => {
  it('dispatch and finish carry the story-branch rules', () => {
    const dispatch = read('skills/construction/dispatch.md');
    const finish = read('skills/construction/finish.md');
    expect(dispatch).toContain('story-start.cjs {intent} {SSS}');
    expect(dispatch).toContain('story-land.cjs {intent} {SSS} --changed-files');
    expect(dispatch).not.toContain('merge_request_into');
    expect(finish).toContain('push-branch.cjs {intent}');
    expect(finish).not.toContain('git push -u origin {branch}');
    expect(finish).toContain('Integration branch (story branches only)');
    expect(finish).toContain('Never push the integration branch');
  });
});

describe('aidlc-turbo findings are fixed, not filed', () => {
  it('the live test always works out how the app starts: nothing reads it from config.yaml', () => {
    expect(read('skills/construction/live-test.md')).toContain('How the application starts and where it answers is always yours to work out');
    for (const f of ['skills/construction/live-test.md', 'skills/construction/finish.md', 'commands/aidlc-turbo-config.md', 'templates/config.example.yaml']) {
      expect(read(f), f).not.toMatch(/live_test\.(start_command|url)/);
    }
    expect(read('skills/construction/finish.md')).toContain('Never into `config.yaml`');
  });

  it('no shipped file names a review or live-test report on disk', () => {
    const offenders = treeTextFiles(FLOW).filter((f) =>
      /(intents|docs)\/[^\s`]*\/(review|live-test)\.md|\{intent_dir\}\/(review|live-test)\.md/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it('finish forbids leftover review documents and runs the live test with its own fix round', () => {
    const finish = read('skills/construction/finish.md');
    expect(finish).toContain('Never leave a review, live-test or break-test document behind');
    expect(finish).toContain('The live-test fix round');
    expect(read('skills/construction/live-test.md')).toContain('Write nothing to disk');
    expect(read('skills/construction/break-test.md')).toContain('never write a file into the project');
    expect(finish).toContain('The break-test fix round');
  });
});

describe('aidlc-turbo leaves nothing open', () => {
  it('construction never closes with an open item', () => {
    expect(read('skills/construction/dispatch.md')).toContain('A story is never committed with an open finding.');
    const finish = read('skills/construction/finish.md');
    expect(finish).toContain('The intent never closes with an open finding');
    expect(finish).toContain('A `failed` twin is never left open.');
    expect(finish).toContain('Never close with anything open');
    expect(finish).not.toMatch(/close anyway|left for the user to judge|does not block the close/);
  });

  it('no shipped file invites a TBD', () => {
    const offenders = treeTextFiles(FLOW).filter((f) => /okay to leave things TBD|or "TBD"\}/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe('aidlc-turbo checks the specs before approval', () => {
  it('render lints the specs and hands them to the cross-check', () => {
    const render = read('skills/inception/render.md');
    expect(render).toContain('spec-lint.cjs {intent-slug} --json');
    expect(render).toContain('`cross-check.md`');
    // The rules on where a tester checks each criterion, and on the twin folder.
    for (const rule of ['criteria-via', 'tester-verifiable', 'break-test', 'twin-dir', 'layers', 'slice', 'integration', 'lifecycle', 'short']) {
      expect(render).toContain(`(\`${rule}\`)`);
    }
  });

  it('the cross-check dispatches both checkers and fixes every finding before review', () => {
    const check = flat('skills/inception/cross-check.md');
    expect(check).toContain('`specsmd-aidlc-turbo-cross-checker`');
    expect(check).toContain('returns a mismatch as a `channel` finding');
    expect(check).toContain('`specsmd-aidlc-turbo-docs-verifier`');
    expect(check).toContain('At most two rounds.');
    expect(check).toContain('Never hand the specs to `review.md` with a finding open.');
  });

  it('the cross-checker covers the six kinds, reads the code and writes nothing', () => {
    const checker = read('commands/aidlc-turbo-cross-checker.md');
    for (const kind of ['conflict', 'gap', 'misreading', 'deviation', 'wrong_assumption', 'channel']) {
      expect(checker).toContain(`\`${kind}\``);
    }
    expect(checker).toContain('**Look for six kinds of problem**');
    expect(checker).toContain('Read-only. You write no file and ask the user nothing');
    expect(checker).toContain('one closed question');
    expect(checker).toContain('at most 12 tool calls');
    // The sixth kind greps the screen code for where a tester checks a criterion, on a budget of its own.
    expect(checker).toContain('**The channel check**');
    expect(checker).toContain('At most 6 extra tool calls for this, on top of the 12');
    expect(checker).toContain('kind: channel');
  });

  it('the docs-verifier checks the meaning only, with a cap on its findings', () => {
    const verifier = flat('commands/aidlc-turbo-docs-verifier.md');
    for (const kind of ['contradicts', 'partial', 'wrong_citation', 'bad_exclusion', 'split_meaning']) {
      expect(verifier).toContain(`\`${kind}\``);
    }
    expect(verifier).toContain('Read-only. You write no file');
    expect(verifier).toContain('at most about 30 findings');
  });

  it('builders and reviewers never read the pages or the register', () => {
    for (const rel of ['commands/aidlc-turbo-builder.md', 'skills/construction/build-story.md', 'skills/construction/review.md']) {
      expect(read(rel), rel).toMatch(/Never read `\.specs-aidlc-turbo\/docs\/\{inception\}\/pages\/`(,| or) `register\.yaml`/);
    }
  });
});

describe('aidlc-turbo intent overview and the approval', () => {
  it('opens at the inception review and again at finish, after the test cases', () => {
    expect(read('skills/inception/review.md')).toContain('intent-overview.cjs {intent-slug} --phase inception');
    const finish = read('skills/construction/finish.md');
    expect(finish).toContain('intent-overview.cjs {intent} --phase construction');
    expect(finish.indexOf('### 6. Test cases')).toBeGreaterThan(finish.indexOf('### 5. Fix loop'));
    expect(finish.indexOf('### 8. Overview')).toBeGreaterThan(finish.indexOf('### 6. Test cases'));
    expect(read('skills/construction/dispatch.md')).not.toContain('dispatch the test-case writer in the background');
    expect(read('skills/construction/test-cases.md')).toContain('### 1b. Find what the story could break');
    expect(read('templates/construction/test-case-template.md')).toContain('## Regression check');
  });

  it('asks whether the overview is right, and builds in the same session only in the quick lane', () => {
    const review = read('skills/inception/review.md');
    expect(review).toContain('### 3. Ask whether everything is right');
    expect(review).toContain('**Yes, approve**');
    expect(review).toContain('**Yes, and build it here now**: only for `lane: quick`');
    expect(review).toContain('Nothing is approved and nothing is committed until the user answers yes.');
    expect(review).toContain('continue in this same session as the construction agent');
    expect(review).toContain('/clear then /specsmd-aidlc-turbo-construction {intent-slug}');
  });

  it('plan writes the overview data, and builder and reviewer hold each integration test to the earlier story\'s real code', () => {
    const plan = flat('skills/inception/plan.md');
    const at = plan.indexOf('### 4b. Write the overview data');
    expect(at).toBeGreaterThan(plan.indexOf('### 4. Check coverage both ways'));
    expect(at).toBeLessThan(plan.indexOf('### 6. Show the map and go on'));
    for (const key of ['`short`', '`overview.layers`', '`slice`', '`integration`', '`overview.lifecycle`', '`under_all`']) expect(plan).toContain(key);
    expect(plan).toContain('add the dependency or drop the overlap');
    for (const rel of ['commands/aidlc-turbo-builder.md', 'commands/aidlc-turbo-builder-low.md', 'skills/construction/build-story.md']) {
      expect(read(rel), rel).toContain("- **Integration tests**: a test plan line `Integration with S{id} {title}: {test}` is written against that earlier story's real code");
    }
    expect(read('skills/construction/review.md')).toContain('6. **Integration tests**: every `Integration with S{id}` line of the test plan has its test');
    expect(read('templates/inception/story-template.md')).toContain('- Integration with S{SSS} {title of that story}:');
    // The page shows the pictures and the stories, no requirement or decision lists.
    const review = flat('skills/inception/review.md');
    expect(review).toContain('the integration tests as arrows from an earlier story to the later story that tests with it');
    expect(review).not.toContain('drawn as a route');
    expect(review).not.toContain('the requirements one line each');
  });

  it('the approval gates on the scripts and lists what is deliberately left out', () => {
    const review = read('skills/inception/review.md');
    expect(review).toContain('render-specs.cjs {intent-slug} --check');
    expect(review).toContain('spec-lint.cjs {intent-slug}');
    expect(review).toContain('`deliberately_not`');
  });
});

describe('aidlc-turbo names things and decides its own map and commands', () => {
  // Story numbers are zero-padded (003); a status code like 401 is not an id.
  const ID = /\b(?:S-\d+|N?FR-\d+|D-\d+|0\d\d)\b/;

  it('every phase agent names things, never ids', () => {
    expect(flat('agents/inception-agent.md')).toContain('**Name things, never ids.**');
    for (const rel of ['agents/master-agent.md', 'agents/construction-agent.md']) {
      expect(flat(rel), rel).toContain('Name things, never ids');
    }
    expect(flat('skills/inception/intake.md')).toContain('Never a register id or any other id in a question or an option.');
    expect(flat('skills/inception/review.md')).toContain('in plain words (the statement from the page, never its id)');
  });

  it('no question a subagent returns, nor its options, carries an id', () => {
    for (const rel of ['commands/aidlc-turbo-cross-checker.md', 'commands/aidlc-turbo-docs-verifier.md', 'commands/aidlc-turbo-debugger.md']) {
      const lines = read(rel).split('\n').filter((l) => /^\s*(?:question|text|options):/.test(l));
      expect(lines.length, rel).toBeGreaterThan(0);
      for (const line of lines) expect(line, rel).not.toMatch(ID);
    }
  });

  it('the story map is shown, never asked about', () => {
    const plan = flat('skills/inception/plan.md');
    expect(plan).toContain('the user is not asked about the split, the order or the lane');
    expect(plan).toContain('no question: go straight on to `render.md`');
    expect(plan).not.toMatch(/look right|quick ok|user insists/i);
    expect(flat('agents/inception-agent.md')).not.toMatch(/quick ok/i);
    expect(flat('templates/inception/story-template.md')).not.toMatch(/user insists/i);
  });

  it('the agent settles the verification commands from the build files, never asks for them', () => {
    const intake = flat('skills/inception/intake.md');
    expect(intake).toContain('Settle them yourself; never ask the user for them.');
    expect(intake).not.toMatch(/confirm or correct them|ask for them outright/);
    const init = flat('skills/master/project-init.md');
    expect(init).toContain('never ask the user for them');
    expect(init).not.toMatch(/especially the build and test commands|fall back to asking/);
  });

  it('a verification command starts only the service its tests use, after checking it runs', () => {
    const intake = flat('skills/inception/intake.md');
    expect(intake).toContain('**Start only what the tests use.**');
    expect(intake).toContain('checks first whether it runs and starts it only when it does not: `{check} || {start}`, never `{start} || {check}`');
    expect(intake).toContain('never the whole application for tests that use only its database');
  });
});

describe('aidlc-turbo tester coverage', () => {
  it('inception asks where a user sees or starts every backend change', () => {
    const intake = flat('skills/inception/intake.md');
    // The locating pass asks it first, on a few greps of its own.
    expect(intake).toContain('**Where does a user see or start it?**');
    expect(intake).toContain('**At most three more grep calls**');
    // An open answer makes its area dark, but never buys a fourth explorer.
    expect(intake).toContain('never to a fourth explorer');
    expect(intake).toContain(
      'Where does a user see or start what this area changes? Name the screen, menu path, tab, button, route or API, with file and lines, or say that none exists.',
    );
    expect(intake).toContain('The `seen_at` answers go with the rows');
    // The gate of step 8: no change leaves intake without its answer.
    expect(intake).toContain('Every backend change the intent makes has an answer to where a user sees or starts it');

    const explorer = read('commands/aidlc-turbo-explorer.md');
    expect(explorer).toContain('## Where a user sees or starts it');
    expect(explorer).toContain('seen_at:');
    expect(explorer).toContain('unanswered: where does a user see or start {change}');
  });

  it('regression has no maximum, and nothing is parked in the agent notes', () => {
    const cases = read('skills/construction/test-cases.md');
    expect(cases).toContain('**Every place found that no story of this intent tests gets a regression step for the tester. No maximum.**');
    expect(cases).toContain('**Nothing is parked in the `Notes for the agent` instead of a step.**');
    expect(cases).toContain('**No call limit**');
    expect(cases).toContain('Never cap the regression steps.');
    expect(cases).toContain('Never put a regression place in the `Notes for the agent` instead of a step.');
    // The cap of five and the search budget it came with.
    expect(cases).not.toMatch(/at most five|at most 8 more tool calls|one to three regression steps/);

    const template = read('templates/construction/test-case-template.md');
    expect(template).toContain('with no maximum');
    expect(template).toContain('Nothing is parked in the Notes for the agent instead of a step');
    expect(read('commands/aidlc-turbo-test-writer.md')).toContain('Regression has no maximum');
  });

  it('no shipped file caps the regression steps', () => {
    const offenders = treeTextFiles(FLOW).filter((f) => /at most (five|5) regression|one to three regression/i.test(flat(f)));
    expect(offenders).toEqual([]);
  });

  it('the steps decide the twin, never the story\'s surface', () => {
    const cases = read('skills/construction/test-cases.md');
    expect(cases).toContain('at least one step of the Steps or the Regression check runs on a screen');
    expect(cases).toContain('The story\'s `surface` plays no part');
    expect(cases).toContain('Never decide the twin by the surface.');
    expect(cases).not.toContain('the story\'s `surface` is `ui`');
    expect(read('commands/aidlc-turbo-test-writer.md')).toContain('Decide the twin from the steps, never from the story\'s surface.');
    expect(read('agents/construction-agent.md')).toContain(
      'One manual test case per tester-verifiable story and, when a step runs on a screen, its Playwright twin',
    );
    // The twin runs the Regression check too, in a test of its own, in the record's language.
    const twin = read('templates/construction/twin-template.md');
    expect(twin).toContain('// Regression');
    expect(twin).toContain(', regression\'');
    expect(twin).toContain("Written in the record's language, as the test case is");
  });

  it('only the test writer writes twins, and a twin that never reached the application is not proven', () => {
    const cases = read('skills/construction/test-cases.md');
    expect(cases).toContain('**Only the test writer writes in `aidlc-twins/`**');
    expect(cases).toContain('`twin_result: unreachable`, never `not_run`');
    expect(read('commands/aidlc-turbo-test-writer.md')).toContain('Only you write in `aidlc-twins/`, and there only your own twin.');
  });

  it('the story keeps one twin line, and the test case is rewritten in full on every run', () => {
    const cases = read('skills/construction/test-cases.md');
    expect(cases).toContain('### 3b. The twin line in the story');
    expect(cases).toContain('- **Twin**: none, no step runs on a screen');
    expect(cases).toContain('Write the test case in full on every run');
    expect(cases).toContain('This line is all you write in the story.');
  });

  it('plan decides per criterion where a tester checks it, never from where the code lives', () => {
    const plan = flat('skills/inception/plan.md');
    expect(plan).toContain('### 3b. Decide where a tester checks each criterion');
    expect(plan).toContain('Every criterion gets `observed_via`: where a tester checks it, never where the code lives.');
    expect(plan).toContain('This classification decides what a tester can check');
    expect(plan).toContain('Look past the layer where the change sits');
    // The once-per-story rule it replaced.
    expect(plan).not.toContain('when a human tester can verify it through the UI or an API call');

    // The record carries it per criterion; render derives tester_verifiable, so the record has no such key.
    const record = read('templates/inception/record-template.yaml');
    expect(record).toContain('observed_via: ui');
    expect(record).toContain('why_none:');
    expect(record).not.toMatch(/^\s*tester_verifiable:/m);

    const story = read('templates/inception/story-template.md');
    expect(story).toContain('## Observed-via values');
    expect(story).toContain('*(tester: screen)*');
    expect(story).toContain('It never decides what a tester checks');
  });

  it('no shipped file still limits the tester to the UI or an API call', () => {
    const offenders = treeTextFiles(FLOW).filter((f) => /through the UI or an API call/i.test(flat(f)));
    expect(offenders).toEqual([]);
  });

  it('the live test follows the criteria, never the story\'s surface', () => {
    const live = read('skills/construction/live-test.md');
    expect(live).toContain('What you check follows the criteria, never the story\'s `surface`');
    expect(live).toContain('**Database and log**');
    expect(live).toContain('A `not_observable` check carries its `reason`.');
  });

  it('builders never write a twin, and dispatch sends back a story that does', () => {
    for (const rel of ['commands/aidlc-turbo-builder.md', 'commands/aidlc-turbo-builder-low.md', 'skills/construction/build-story.md']) {
      expect(read(rel), rel).toContain(
        'A Playwright spec never goes under `{codebase.playwright_test_dir}/aidlc-twins/`: that folder belongs to the test writer at finish, and `story-land.cjs` refuses a story that changes it.',
      );
    }
    expect(read('skills/construction/dispatch.md')).toContain('a path with an `aidlc-twins` segment, which belongs to the test writer at finish');
  });

  it('after any code fix at finish every writer runs again, and its budget bounds only the reading', () => {
    const finish = read('skills/construction/finish.md');
    // The budget in the writer's prompt, verbatim: the reading of its own story's code, never the trace.
    expect(finish).toContain('Budget: at most 12 tool calls for reading the story\'s own code, for its labels, routes and messages.');
    expect(finish).toContain(
      'The regression trace has no call limit: grep only, scoped to a path or a file type, never a directory walk, never a whole file, never a file read twice.',
    );
    // The mirror sends back a result that leaves a regression place without its step or its story.
    expect(finish).toContain('neither `steps` nor `covered_by`');
    expect(finish).toContain('**After any code fix in this step**');
    expect(finish).toContain('dispatch **every** writer again, not only the one whose twin failed');
  });

  it('every twin a test case names reaches the intent branch, and no fix commit carries one', () => {
    const finish = read('skills/construction/finish.md');
    expect(finish).toContain('**Fix commits never carry a twin**');
    // Step 9 checks every twin on the intent branch and carries a missing one over from its story branch.
    expect(finish).toContain('**Twins on the intent branch**');
    expect(finish).toContain('git cat-file -e {intent branch}:{twin}');
    expect(finish).toContain('git show {story branch}:{twin} > {twin}');
    expect(finish).toContain('docs({intent-slug}): carry the twins');
    // push-branch.cjs refuses an intent branch that lacks one, and names it.
    expect(finish).toContain('missing_twins');
    expect(finish).toContain('Never commit a twin on a story branch or in a fix commit');
    // A twin an older story branch tracks is brought up to the version that ran before the switch.
    expect(finish).toContain('**Before the switch**, bring every twin a story branch tracks up to the version that ran.');
    expect(finish).toContain('test({intent-slug}): the twin that ran');
    expect(finish).toContain("The twin that ran ships, and the story's merge request does not conflict on it.");
    expect(finish).toContain('except the commit of step 9 that brings a twin a story branch already tracks up to the version that ran.');
    expect(finish).toContain('Never push an intent branch without every twin its test cases name.');
    expect(finish).toContain('| Story | Test case | Twin | Twin run | Regression |');
  });

  it('a done intent that is not merged can be finished again, and both menus offer it', () => {
    const finish = read('skills/construction/finish.md');
    expect(finish).toContain('## Finish again');
    // Not merged: the intent branch is no ancestor of the base branch on the remote.
    expect(finish).toContain('git fetch origin {base branch}');
    expect(finish).toContain('git merge-base --is-ancestor {intent branch} origin/{base branch}');
    // A decision the run settled is marked, never deleted, and the brief stays done.
    expect(finish).toContain('Superseded on {YYYY-MM-DD}: {what this run proved}.');
    expect(finish).toContain('the brief stays `done`');
    expect(finish).toContain('docs({intent-slug}): finish again');
    expect(finish).toContain('tests_only: true');

    const navigator = read('skills/construction/navigator.md');
    expect(navigator).toContain('1 - **Finish again**');
    expect(navigator).toContain('**Finish again** is the suggestion when a test case is not proven');
    expect(read('skills/master/analyze-context.md')).toContain('**finish again**');
    expect(read('agents/construction-agent.md')).toContain('the `Superseded on` note finish again appends to a `D-n` it settled');
  });
});

describe('aidlc-turbo overview on Confluence', () => {
  /** The text of one `### n.` section of a skill, whitespace collapsed. */
  const section = (rel: string, heading: string) => {
    const text = flat(rel);
    const at = text.indexOf(heading);
    expect(at, `${rel}: ${heading}`).toBeGreaterThan(-1);
    const next = text.indexOf('### ', at + heading.length);
    return text.slice(at, next === -1 ? undefined : next);
  };

  it('intake pulls the pages, gives every intent its own page, and downloads no attachment', () => {
    const docs = section('skills/inception/intake.md', '### 3. Docs, through the source register');
    const pull = docs.indexOf('mode `pull`');
    const pages = docs.indexOf('`.specsmd/aidlc-turbo/skills/sync/intent-pages.md`');
    expect(pull).toBeGreaterThan(-1);
    expect(pages).toBeGreaterThan(pull);
    expect(pages).toBeLessThan(docs.indexOf('**Extra sources, always asked**'));
    expect(docs).toContain('named by `sync.page_names.intent`, default `{name} - Documentation`');
    expect(flat('skills/inception/intake.md')).not.toContain('confluence-attach.cjs download');
    // Nothing reaches a download any more, so the script has none.
    const attach = req(path.join(FLOW, 'scripts/confluence-attach.cjs'));
    expect(attach.parseArgs(['download', '--page', '1', '--dest', 'x']).error).toMatch(/unknown command/);
  });

  it('the approval attaches the approved overview after the push, under the configured name', () => {
    const approve = section('skills/inception/review.md', '### 5. On approve, stamp and sync');
    const rerender = approve.indexOf('Render the overview again with the command of step 2');
    const push = approve.indexOf('mode `push`');
    const upload = approve.indexOf(
      'node .specsmd/aidlc-turbo/scripts/confluence-attach.cjs upload --intent {intent-slug} --file .specs-aidlc-turbo/docs/{inception}/{intent-slug}/overview.html',
    );
    const jira = approve.indexOf('mode `after-inception`');
    expect(rerender).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(rerender);
    expect(upload).toBeGreaterThan(push);
    expect(jira).toBeGreaterThan(upload);
    expect(approve).toContain('When it returns `documentation_pushed: true`');
    expect(approve).toContain('with the `page_id` of `confluence.documentation`');
    expect(approve).toContain('Without `--name` the script names the file as `sync.page_names.overview_file` says (default `overview-{intent-slug}.html`)');
    expect(approve).toContain('unless Confluence is skipped');
    expect(approve).toContain('add the intent slug to `pending_upload` under `confluence:` in `sync.yaml`');
    expect(approve).toContain('A sync or an upload that could not run is not a stop');
  });

  it('every Confluence page name comes from the config, with neutral defaults', () => {
    const names = req(path.join(FLOW, 'scripts/lib/page-names.cjs'));
    expect(names.DEFAULTS).toEqual({
      intent: '{name} - Documentation',
      stories: '{name} - Stories',
      project: 'Project Documentation',
      overview_section: 'Interactive overview',
      overview_file: 'overview-{slug}.html',
    });
    expect(flat('agents/inception-agent.md')).toContain('`overview-{intent-slug}.html` (`sync.page_names.overview_file`)');
    expect(flat('skills/inception/review.md')).toContain('`sync.page_names.overview_section`, default `Interactive overview`');
  });

  it('the sync rerun retries a pending overview upload', () => {
    const rerun = flat('skills/sync/rerun.md');
    expect(rerun).toContain('when `pending_upload` under `confluence:` names the intent, run the `confluence-attach.cjs upload` of `review.md` step 5 again');
    expect(rerun).toContain('take the slug off the list');
  });

  it('the layout names no build-plan artifact and no downloaded overview', () => {
    const layout = req(path.join(FLOW, 'scripts/lib/paths.cjs')).layout('.specs-aidlc-turbo');
    const intent = layout.intent('i', 's');
    expect(intent.overview).toBe(path.join('.specs-aidlc-turbo', 'docs', 'i', 's', 'overview.html'));
    expect(intent).not.toHaveProperty('overviewContent');
    expect(layout.inception('i')).not.toHaveProperty('functionalOverview');
    const memoryBank = yaml.load(read('memory-bank.yaml')) as any;
    expect(memoryBank.schema).not.toHaveProperty(['functional-overview']);
    expect(memoryBank.schema.ownership.inception).not.toContain('functional-overview');
  });

  it('no inception file names a build-plan page, and the drawing kit stays', () => {
    for (const rel of ['agents/inception-agent.md', 'commands/aidlc-turbo-inception.md', 'skills/inception/plan.md', 'skills/inception/review.md', 'templates/inception/record-template.yaml']) {
      expect(flat(rel), rel).not.toMatch(/build[- ]plan/i);
    }
    for (const kept of ['templates/design', 'scripts/lib/design-assets.cjs', 'scripts/lib/design-routes.cjs']) {
      expect(existsSync(path.join(FLOW, kept)), kept).toBe(true);
    }
  });

  it('an older record with an overview key the flow no longer reads lints clean', () => {
    const lint = req(path.join(FLOW, 'scripts/lib/overview-lint.cjs'));
    const findings: string[] = [];
    const record = {
      stories: [{ id: '001', slug: 'one' }],
      overview: { build_plan: { from: { A: ['009'] }, ghost: { B: 'nowhere' }, notes: { C: { kind: 'unknown' } } } },
    };
    lint.lintOverview(record, (file: string, rule: string, message: string) => findings.push(`${file} ${rule}: ${message}`));
    expect(findings).toEqual([]);
  });
});
