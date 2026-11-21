'use strict';

/**
 * Which tool fits which kind of file, in one place. `run.cjs tools` reads a host's stack against
 * this table and proposes what fits, one line per proposal, for the owner to accept per line.
 *
 * Why a table and not an agent's judgment: the config step never asked which tools the roles
 * should have, and a host with dozens of shell scripts, workflows and Python files ran with no
 * check on any of them while every role searched with grep and read whole files. A proposal
 * printed by a script is the same on every run and a test holds it.
 *
 * To add a tool, add one entry. A lint entry:
 *   id       the name the owner accepts, unique
 *   kind     what the files are, in the plural, for the proposal line
 *   globs    the files it judges, which are also its scope in verification.finalize_scopes
 *   bin      the program it needs on this machine
 *   run      the command, run from the tree root; it holds no double quote, so it can key its scope
 *   configs  files that configure it, so the line says the project already set it up
 *   needs    optional: a tracked file without which it is not proposed
 * Every tool named here is a public open-source tool.
 */

/** A kind with fewer tracked files than this gets no tool: a handful of stray files is no stack. */
const MIN_FILES = 3;

/** Structural search for the reading roles: the extensions it reads, and its language name for each. */
const SEARCH = {
  id: 'search',
  bin: 'ast-grep',
  languages: [
    { globs: ['**/*.sh', '**/*.bash'], language: 'bash' },
    { globs: ['**/*.py'], language: 'python' },
    { globs: ['**/*.ts'], language: 'typescript' },
    { globs: ['**/*.tsx'], language: 'tsx' },
    { globs: ['**/*.js', '**/*.mjs', '**/*.cjs', '**/*.jsx'], language: 'javascript' },
    { globs: ['**/*.rs'], language: 'rust' },
    { globs: ['**/*.go'], language: 'go' },
    { globs: ['**/*.java'], language: 'java' },
    { globs: ['**/*.kt'], language: 'kotlin' },
    { globs: ['**/*.rb'], language: 'ruby' },
    { globs: ['**/*.cs'], language: 'csharp' },
  ],
  line: (languages) =>
    "Reading roles: search code by its structure with ast-grep (ast-grep run -p '<pattern>' -l <language> <path>) " +
    `before grep, and read only the lines it finds; this repository holds ${languages.join(', ')}.`,
};

const LINTS = [
  {
    id: 'shellcheck',
    kind: 'shell scripts',
    globs: ['**/*.sh', '**/*.bash'],
    bin: 'shellcheck',
    run: "git ls-files -z '*.sh' '*.bash' | xargs -0 shellcheck -f gcc",
    configs: ['.shellcheckrc'],
  },
  {
    id: 'actionlint',
    kind: 'workflows',
    globs: ['.github/workflows/*.yml', '.github/workflows/*.yaml'],
    bin: 'actionlint',
    run: 'actionlint -oneline',
    configs: ['.github/actionlint.yaml', '.github/actionlint.yml'],
  },
  {
    id: 'ruff',
    kind: 'Python files',
    globs: ['**/*.py'],
    bin: 'ruff',
    run: 'ruff check . --output-format concise',
    configs: ['ruff.toml', '.ruff.toml'],
  },
  {
    id: 'tsc',
    kind: 'JavaScript files',
    globs: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    bin: 'tsc',
    run: "git ls-files -z '*.js' '*.mjs' '*.cjs' | xargs -0 npx --no tsc --noEmit --allowJs --checkJs --skipLibCheck --module nodenext --target es2022",
    configs: ['jsconfig.json'],
  },
  {
    id: 'ast-grep-rules',
    kind: 'files the project\'s own ast-grep rules judge',
    globs: null, // the globs of the languages search found
    bin: 'ast-grep',
    run: 'ast-grep scan',
    configs: [],
    needs: 'sgconfig.yml',
  },
];

/** The manifests the stack line names: what builds the host and what configures its tools. */
const MANIFESTS = [
  'package.json', 'tsconfig.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod',
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'Gemfile', 'sgconfig.yml',
];

/**
 * What is deliberately not proposed, each with its reason measured on this machine or read from
 * the stack, so the owner sees the trade. `when` reads the facts and decides whether it applies.
 */
const NOT_PROPOSED = [
  {
    id: 'a language server per agent',
    when: () => true,
    reason: (facts) => 'every builder and reviewer would start its own over the whole repository, and this machine has ' +
      `${facts.freeGb} GB of memory free`,
  },
  {
    id: 'cargo-nextest',
    when: (facts) => facts.manifests.some((file) => /(^|\/)Cargo\.toml$/.test(file)),
    reason: () => 'a test runner, not a lint: it replaces cargo test only after one measured run shows it faster',
  },
  {
    id: 'a formatter',
    when: () => true,
    reason: () => 'it rewrites files and catches no error',
  },
];

module.exports = { LINTS, MANIFESTS, MIN_FILES, NOT_PROPOSED, SEARCH };
