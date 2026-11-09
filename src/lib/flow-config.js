/**
 * Per-flow project config scaffolding for the install wizard.
 *
 * Some flows keep a small per-project config file next to their artifacts
 * (.specs-aidlc-turbo/repo/config.yaml). This module owns
 * the questions the wizard asks for those flows and the pure answers -> YAML
 * renderers; installer.js only decides when to call them.
 *
 * Contract every flow entry honours:
 * - prompting is skipped when the config file already exists, at its place or
 *   at a legacy place (never overwritten)
 * - `prepare`, when set, runs before the config is written (layout upgrades)
 * - prompting is skipped when stdin is not a TTY (piped / CI) -> all defaults
 * - a cancelled questionnaire yields all defaults, never a partial config
 * - the render function is pure, so it is unit-testable without a PTY
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const prompts = require('prompts');
const CLIUtils = require('./cli-utils');

const { theme } = CLIUtils;

// ---------------------------------------------------------------------------
// AI-DLC Turbo (.specs-aidlc-turbo/repo/config.yaml)
// ---------------------------------------------------------------------------

// The flow's own layout module and migration script. The installer runs from
// the package, where the flow sources sit next to this folder.
const TURBO_SCRIPTS = path.join(__dirname, '..', 'flows', 'aidlc-turbo', 'scripts');

const TURBO_CONFIG_DEFAULTS = {
  mode: 'production',
  branching: { project_key: '', base_branch: 'main', story_branches: true, sandbox_finish: 'push' },
  tester: { enabled: false },
  construction: { mutants: 3 },
  sync: { docs: 'none', issues: 'none', jira_project_url: '' },
  sandbox: { code_scaffold: true, scaffold_after_build: true }
};

// The Confluence page names the sync uses when the config names none
// (sync.page_names). Only written as a comment, to show what can be changed.
const TURBO_PAGE_NAMES = {
  intent: '{name} - Documentation',
  stories: '{name} - Stories',
  project: 'Project Documentation',
  overview_section: 'Interactive overview',
  overview_file: 'overview-{slug}.html'
};

// What a sandbox intent does at its end: push puts it straight onto the base
// branch, merge_request pushes the intent branch with one merge request.
const TURBO_SANDBOX_FINISH = ['push', 'merge_request'];

// The tools Turbo can sync with today. Anything else is answered with
// unsupportedSyncMessage and written as `none`. Only production syncs: in
// sandbox mode both are `none`, whatever the answers say.
const TURBO_SYNC_TARGETS = {
  docs: ['confluence', 'none'],
  issues: ['jira', 'none']
};

/**
 * The line shown when someone names a sync tool Turbo does not support yet.
 *
 * @param {string} tool - what the user typed
 * @returns {string}
 */
function unsupportedSyncMessage(tool) {
  const name = textOr(tool, 'That tool');
  return `${name} is not supported yet. For now nothing is synced there.`;
}

/**
 * Coerce a sync answer to a supported target. `other`, a blank answer after
 * `other`, and any unknown value all become `none`: the flow never syncs with
 * a tool it does not know.
 */
function syncTarget(kind, value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const v = String(value).trim().toLowerCase();
  return TURBO_SYNC_TARGETS[kind].includes(v) ? v : 'none';
}

/**
 * Read the site and the project key from a Jira project link: a board or
 * backlog link (`/projects/SHOP/...`), an issue or project link (`/browse/SHOP-12`)
 * or a `projectKey=SHOP` query.
 *
 * @param {string} url
 * @returns {{site: string, key: string}|null} null when it names no project
 */
function parseJiraProjectUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url || '').trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(parsed.protocol)) return null;

  const isKey = value => /^[A-Za-z][A-Za-z0-9_]*$/.test(value || '');
  const segments = parsed.pathname.split('/').filter(Boolean);
  const after = name => segments[segments.indexOf(name) + 1] || '';

  let key = null;
  if (segments.includes('projects') && isKey(after('projects'))) key = after('projects');
  if (!key && segments.includes('browse') && isKey(after('browse').replace(/-\d+$/, ''))) {
    key = after('browse').replace(/-\d+$/, '');
  }
  if (!key && isKey(parsed.searchParams.get('projectKey'))) key = parsed.searchParams.get('projectKey');

  return key ? { site: parsed.host, key: key.toUpperCase() } : null;
}

/**
 * The branch name in a base-branch answer: a GitLab (.../-/tree/<branch>) or
 * GitHub (.../tree/<branch>) branch link gives its branch, anything else is
 * kept as typed, trimmed. The `format` of the base-branch question.
 */
function baseBranchName(value) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (!/^https?:\/\//i.test(text)) return text;
  let url;
  try { url = new URL(text); } catch { return text; }
  const m = url.pathname.match(/\/(?:-\/)?tree\/(.+?)\/?$/);
  if (!m) return text;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

/**
 * Whether a name is a branch name git accepts (the check-ref-format rules a
 * typed name can break): no spaces or ~^:?*[\ , no "..", "@{" or "//", no
 * part that starts with a dot, and no leading "-" or "/" or trailing "/",
 * "." or ".lock".
 */
function isBranchName(name) {
  if (!name || name === '@') return false;
  if (/[\s~^:?*[\\\x00-\x1f\x7f]/.test(name)) return false;
  if (/\.\.|@\{|\/\//.test(name)) return false;
  if (/^[-/]|\/$|\.$|\.lock$/.test(name)) return false;
  return !name.split('/').some(part => part.startsWith('.'));
}

/**
 * The `validate` of the base-branch question. It gets the answer as typed, a
 * name or a branch link, so it checks the name the link gives. Empty is fine:
 * Enter keeps the suggestion.
 */
function validateBaseBranch(value) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (text === '') return true;
  const name = baseBranchName(text);
  if (/^https?:\/\//i.test(text) && name === text) return 'Paste the link of a branch, or type its name';
  return isBranchName(name) ? true : 'Type a branch name or paste the branch link';
}

/**
 * Coerce a questionnaire answer to a boolean. Accepts real booleans and the
 * strings yes/no/true/false (any case); anything else falls back.
 */
function toBool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'yes' || v === 'y' || v === 'true') return true;
    if (v === 'no' || v === 'n' || v === 'false') return false;
  }
  return fallback;
}

/**
 * Coerce a text answer to a trimmed string, falling back when it is blank.
 */
function textOr(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text.length > 0 ? text : fallback;
}

/**
 * Render the AI-DLC Turbo per-project config YAML from the install-wizard
 * answers.
 *
 * Pure and side-effect free. Accepts the flat `prompts` answer shape
 * ({ mode, code_scaffold, scaffold_after_build, sandbox_finish,
 * project_key, base_branch, story_branches, tester, sync_docs, sync_issues,
 * jira_project_url }); every missing field
 * falls back to its default, so `undefined` or `{}` (prompt abort / non-TTY)
 * yields the documented all-defaults config. An unknown mode falls back to
 * production, an unknown sandbox_finish to push; blank text answers fall back
 * per key; the yes/no answers accept booleans and yes/no.
 *
 * Both modes use git. Sandbox is production without story branches, and at
 * the end of an intent it does what sandbox_finish says. The branching block
 * is always written in full, so the file doubles as the documentation of the
 * keys a user can edit by hand: story_branches is only read in production,
 * sandbox_finish only in sandbox. The tester block is not:
 * with `enabled: false` it is written as that one key, because nothing is
 * generated and no test folder exists to point at. Test cases are written
 * in the record's language, so there is no language key. They live with their intent, in
 * .specs-aidlc-turbo/docs/{inception}/{intent}/tests/, so there is no folder
 * key at all. There is no live_test block: the live test always runs, and how
 * the app starts and where it answers the agent works out itself. An old
 * live_test answer is ignored. The construction block
 * is `mutants`, the most lines a script breaks per story to prove its tests
 * can fail (0 = off), never asked at install. The sync block names where the
 * intent documentation (confluence | none) and the epic and stories (jira | none)
 * are synced, both none by default and always none in sandbox mode; an
 * unsupported tool is written as `none`, and jira_project_url is only written
 * when issues is jira. With Confluence the page names the sync uses are written
 * as a commented `page_names` block, to show what can be changed by hand. The
 * sandbox block (code_scaffold, scaffold_after_build, both true by default)
 * is only written in sandbox mode: production always makes both parts.
 * Without the Code Scaffold there is no update of it after the build, so
 * scaffold_after_build is then written false.
 *
 * @param {object} [answers] - flat answers from promptTurboConfig
 * @returns {string} YAML document for .specs-aidlc-turbo/repo/config.yaml
 */
function renderTurboConfig(answers = {}) {
  const a = answers || {};
  const mode = a.mode === 'sandbox' ? 'sandbox' : TURBO_CONFIG_DEFAULTS.mode;
  const projectKey = textOr(a.project_key, TURBO_CONFIG_DEFAULTS.branching.project_key);
  const baseBranch = textOr(baseBranchName(a.base_branch), TURBO_CONFIG_DEFAULTS.branching.base_branch);
  const storyBranches = toBool(a.story_branches, TURBO_CONFIG_DEFAULTS.branching.story_branches);
  const sandboxFinish = TURBO_SANDBOX_FINISH.includes(a.sandbox_finish)
    ? a.sandbox_finish
    : TURBO_CONFIG_DEFAULTS.branching.sandbox_finish;
  const testerEnabled = toBool(a.tester, TURBO_CONFIG_DEFAULTS.tester.enabled);
  const syncs = mode === 'production';
  const syncDocs = syncs ? syncTarget('docs', a.sync_docs, TURBO_CONFIG_DEFAULTS.sync.docs) : 'none';
  const syncIssues = syncs ? syncTarget('issues', a.sync_issues, TURBO_CONFIG_DEFAULTS.sync.issues) : 'none';
  const jiraProjectUrl = textOr(a.jira_project_url, TURBO_CONFIG_DEFAULTS.sync.jira_project_url);
  const codeScaffold = toBool(a.code_scaffold, TURBO_CONFIG_DEFAULTS.sandbox.code_scaffold);
  const scaffoldAfterBuild = codeScaffold && toBool(a.scaffold_after_build, TURBO_CONFIG_DEFAULTS.sandbox.scaffold_after_build);

  const pad = (entry, comment) => `${`${entry} `.padEnd(26)}# ${comment}`;

  const lines = [
    '# AI-DLC Turbo project config. Edit by hand or run /specsmd-aidlc-turbo-config.',
    pad(`mode: ${mode}`, 'production | sandbox: sandbox has no story branches and ends on the base branch or in one merge request'),
    'branching:',
    pad(`  project_key: "${projectKey}"`, 'short lowercase prefix for branch names, e.g. "shop"; empty = no prefix'),
    pad(`  base_branch: ${baseBranch}`, 'branch the intent branch is created from and goes back into'),
    pad(`  story_branches: ${storyBranches}`, 'production only: true = a branch per story, pushed at the end once you approve'),
    pad(`  sandbox_finish: ${sandboxFinish}`, 'sandbox only: push = straight onto the base branch, merge_request = one merge request into it'),
    'tester:',
    pad(`  enabled: ${testerEnabled}`, 'a human tester exists: test cases in docs/{inception}/{intent}/tests/')
  ];

  if (mode === 'sandbox') {
    lines.push(
      pad('sandbox:', 'sandbox only, the parts an intent makes; production always makes both'),
      pad(`  code_scaffold: ${codeScaffold}`, 'the Code Scaffold: the drawing of the code, drawn in the inception and saved as code-scaffold.html'),
      pad(`  scaffold_after_build: ${scaffoldAfterBuild}`, 'the Code Scaffold updated as built at the end, saved as code-scaffold-built.html')
    );
  }

  lines.push(
    'construction:',
    pad(`  mutants: ${TURBO_CONFIG_DEFAULTS.construction.mutants}`, 'most lines broken per story to prove its tests can fail; 0 = off'),
    'sync:',
    pad(`  docs: ${syncDocs}`, 'confluence | none: where the intent documentation is pulled from and pushed back to; production only'),
    pad(`  issues: ${syncIssues}`, 'jira | none: where the epic, the stories and the test cases are created; production only')
  );
  if (syncIssues === 'jira') {
    lines.push(
      pad(`  jira_project_url: "${jiraProjectUrl.replace(/"/g, '\\"')}"`, 'link to the Jira project board; empty = asked at the first sync')
    );
  }
  if (syncDocs === 'confluence') {
    lines.push(
      '  # page_names:            # the Confluence page names; {name} = the inception\'s or intent\'s name, {slug} = the intent folder',
      ...Object.entries(TURBO_PAGE_NAMES).map(([key, value]) => `  #   ${key}: "${value}"`)
    );
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * The branch the repository in the current directory treats as its default:
 * origin's HEAD, else the checked-out branch, else `main`. Only the suggestion
 * of the base-branch question, so every failure falls back quietly.
 */
function detectBaseBranch() {
  const git = args => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 })
    .toString().trim();
  try {
    const remote = git(['rev-parse', '--abbrev-ref', 'origin/HEAD']);
    if (remote && remote !== 'origin/HEAD') return remote.replace(/^origin\//, '');
  } catch { /* no origin */ }
  try {
    const current = git(['branch', '--show-current']);
    if (current) return current;
  } catch { /* not a repository */ }
  return TURBO_CONFIG_DEFAULTS.branching.base_branch;
}

// A yes/no question as a select, so each answer can carry its explanation.
const yesNo = (no, yes) => [
  { title: 'No', value: false, description: no },
  { title: 'Yes', value: true, description: yes }
];

// The same with Yes first, for a question where yes is the suggestion.
const yesFirst = (yes, no) => yesNo(no, yes).reverse();

/**
 * The AI-DLC Turbo questions, in three short blocks. Every message fits on one
 * line, and the explanation of a choice is its description, which the terminal
 * shows under the choice the cursor is on. The two parts a sandbox can leave
 * out (the Code Scaffold and its update after the build) come right after the
 * mode and only in sandbox, the update only with the Code Scaffold; then the
 * finish choice, also only in sandbox; a branch per story only in production.
 * The Sync block is production only: a block with `when` is skipped, heading
 * and all, when `when(answers so far)` is false, so sandbox never asks it and
 * never syncs. (A question's own `type` function only sees the answers of its
 * own block, so the mode is checked per block.)
 * How the app starts and where it answers is never asked, and neither is the
 * live test: it always runs and the agent works out how.
 *
 * @param {object} [suggest] - { base_branch } to propose
 * @returns {Array<{title: string, subtitle: string, questions: object[]}>}
 */
function turboQuestionSections(suggest = {}) {
  const production = type => (prev, values) => (values.mode === 'production' ? type : null);
  const sandbox = type => (prev, values) => (values.mode === 'sandbox' ? type : null);
  const withScaffold = type => (prev, values) => (values.mode === 'sandbox' && values.code_scaffold !== false ? type : null);
  return [
    {
      title: 'Git',
      subtitle: 'how the work reaches the repository',
      questions: [
        {
          type: 'select',
          name: 'mode',
          message: 'Production project?',
          choices: [
            { title: 'Yes', value: 'production', description: 'work on branches, pushed with a merge-request link' },
            { title: 'No, a sandbox', value: 'sandbox', description: 'git too, no branch per story; at the end onto the base branch or one merge request' }
          ],
          initial: 0
        },
        {
          type: sandbox('select'),
          name: 'code_scaffold',
          message: 'Code Scaffold?',
          choices: yesFirst(
            'a drawing of the code the stories build, checked at the approval and saved',
            'no drawing: the builders follow the stories alone'
          ),
          initial: 0
        },
        {
          type: withScaffold('select'),
          name: 'scaffold_after_build',
          message: 'Update the scaffold after the build?',
          choices: yesFirst(
            'at the end the drawing shows what was really built, saved next to the first',
            'the drawing stays as approved'
          ),
          initial: 0
        },
        {
          type: sandbox('select'),
          name: 'sandbox_finish',
          message: 'When an intent is done?',
          choices: [
            { title: 'Push to base branch', value: 'push', description: 'it goes straight onto the base branch and is pushed, no merge request' },
            { title: 'One merge request', value: 'merge_request', description: 'the intent branch is pushed with one merge request into the base branch' }
          ],
          initial: 0
        },
        {
          type: 'text',
          name: 'project_key',
          message: 'Branch prefix (Enter = none)',
          initial: ''
        },
        {
          type: 'text',
          name: 'base_branch',
          message: 'Base branch: intents start from it and merge back (name or URL)',
          initial: suggest.base_branch || TURBO_CONFIG_DEFAULTS.branching.base_branch,
          validate: validateBaseBranch,
          format: baseBranchName
        },
        {
          type: production('select'),
          name: 'story_branches',
          message: 'A branch per story?',
          choices: yesFirst(
            'every story gets its own branch and merge request, pushed at the end once you approve',
            'for small pieces of work: every story is committed on the intent branch, pushed once at the end'
          ),
          initial: 0
        }
      ]
    },
    {
      title: 'Testing',
      subtitle: 'what happens once every story is built',
      questions: [
        {
          type: 'select',
          name: 'tester',
          message: 'Human tester?',
          choices: yesNo(
            'no test cases are written',
            'a test case per story a person can check'
          ),
          initial: 0
        }
      ]
    },
    {
      title: 'Sync',
      subtitle: 'optional: Confluence and Jira are supported today',
      when: values => values.mode === 'production',
      questions: [
        {
          type: 'select',
          name: 'sync_docs',
          message: 'Documentation',
          choices: [
            { title: 'Confluence', value: 'confluence', description: 'the inception pulls the pages, resolves every open question and pushes them back' },
            { title: 'Nowhere', value: 'none', description: 'the inception reads local files only' },
            { title: 'Something else', value: 'other', description: 'name the tool' }
          ],
          initial: 1
        },
        {
          type: (prev, values) => (values.sync_docs === 'other' ? 'text' : null),
          name: 'sync_docs_other',
          message: 'Which tool?'
        },
        {
          type: 'select',
          name: 'sync_issues',
          message: 'Epic and stories',
          choices: [
            { title: 'Jira', value: 'jira', description: 'created after the inception, closed with the test cases once built' },
            { title: 'Nowhere', value: 'none', description: 'no issues are created' },
            { title: 'Something else', value: 'other', description: 'name the tool' }
          ],
          initial: 1
        },
        {
          type: (prev, values) => (values.sync_issues === 'other' ? 'text' : null),
          name: 'sync_issues_other',
          message: 'Which tool?'
        },
        {
          type: (prev, values) => (values.sync_issues === 'jira' ? 'text' : null),
          name: 'jira_project_url',
          message: 'Jira project link (Enter = ask later)',
          initial: '',
          validate: value => (String(value || '').trim() === '' || parseJiraProjectUrl(value)
            ? true
            : 'Paste the link of the Jira project board')
        }
      ]
    }
  ];
}

/**
 * Interactively gather the AI-DLC Turbo config answers. Never hangs or throws:
 * skips prompting when stdin is not a TTY and treats a prompt abort as
 * all-defaults. Each block of turboQuestionSections gets its own heading.
 *
 * @returns {Promise<object>} flat answer shape for renderTurboConfig
 */
async function promptTurboConfig() {
  // Non-interactive (piped / CI): don't block waiting for input.
  if (!process.stdin.isTTY) {
    return {};
  }

  console.log('');
  console.log(`  ${CLIUtils.logoGradient('AI-DLC Turbo setup')}`);
  console.log(theme.dim('  A few questions about this project. Enter keeps the suggestion.'));
  console.log(theme.dim('  Change any answer later with /specsmd-aidlc-turbo-config.'));

  let cancelled = false;
  const answers = {};
  try {
    for (const section of turboQuestionSections({ base_branch: detectBaseBranch() })) {
      if (section.when && !section.when(answers)) continue;
      console.log('');
      console.log(`  ${theme.primary.bold(section.title)}  ${theme.dim(section.subtitle)}`);
      const part = await prompts(section.questions, {
        onCancel: () => { cancelled = true; return false; },
        onSubmit: (prompt, answer) => {
          if (prompt.name === 'sync_docs_other' || prompt.name === 'sync_issues_other') {
            // One sentence per line, so the message never wraps.
            for (const sentence of unsupportedSyncMessage(answer).split(/(?<=\.) /)) {
              console.log(theme.warning(`  ${sentence}`));
            }
          }
          const jira = prompt.name === 'jira_project_url' && parseJiraProjectUrl(answer);
          if (jira) console.log(theme.dim(`  Project ${jira.key} on ${jira.site}`));
        }
      });
      // Abort mid-questionnaire -> all-defaults config, never a partial one.
      if (cancelled) return {};
      Object.assign(answers, part);
    }
    return answers;
  } catch {
    // Never fail the install over config prompting - fall back to defaults.
    return {};
  }
}

/**
 * Get an AI-DLC Turbo artifact root ready for the config: a root with the old
 * layout (config.yaml, intents/ and the rest at its top) is moved first with
 * scripts/migrate-layout.cjs, then repo/, project/ and docs/ are created.
 * Nothing that exists is overwritten.
 *
 * @param {string} dir - the artifact root, relative to the project
 * @returns {string[]} one line per thing moved or kept, for the terminal
 */
function prepareTurboRoot(dir) {
  const paths = require(path.join(TURBO_SCRIPTS, 'lib', 'paths.cjs'));
  const lines = [];
  if (paths.isLegacy(dir)) {
    const { migrate, describe } = require(path.join(TURBO_SCRIPTS, 'migrate-layout.cjs'));
    const result = migrate(dir, { write: true });
    lines.push(...describe(result).split('\n').filter(Boolean));
  }
  const layout = paths.layout(dir);
  for (const sub of [layout.repoDir, layout.projectDir, layout.docs]) {
    fs.mkdirSync(sub, { recursive: true });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// The per-flow table installer.js drives
// ---------------------------------------------------------------------------

/**
 * Flows that scaffold a per-project config file at install time. A flow that is
 * absent here asks no extra questions and writes no config.
 */
const FLOW_CONFIGS = {
  'aidlc-turbo': {
    dir: '.specs-aidlc-turbo',
    file: 'repo/config.yaml',
    // Before the repo/, project/, docs/ layout the config sat at the root.
    // prepare moves it, but the questionnaire runs before that.
    legacyFiles: ['config.yaml'],
    prepare: prepareTurboRoot,
    prompt: promptTurboConfig,
    render: renderTurboConfig
  }
};

/**
 * True when the flow's config file exists, at its place or at a legacy place.
 * The installer then asks no questions and writes no config.
 *
 * @param {object} flowConfig - an entry of FLOW_CONFIGS
 * @param {string} [root] - the project root, the working directory by default
 * @returns {boolean}
 */
function flowConfigExists(flowConfig, root = '.') {
  if (!flowConfig) return false;
  return [flowConfig.file, ...(flowConfig.legacyFiles || [])]
    .some(file => fs.existsSync(path.join(root, flowConfig.dir, file)));
}

module.exports = {
  FLOW_CONFIGS,
  flowConfigExists,
  prepareTurboRoot,
  renderTurboConfig,
  promptTurboConfig,
  turboQuestionSections,
  baseBranchName,
  validateBaseBranch,
  parseJiraProjectUrl,
  unsupportedSyncMessage
};
