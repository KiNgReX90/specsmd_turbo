/**
 * specsmd AI-DLC Turbo - the facts the code tooling proposal starts from.
 *
 * Facts only, no choice: Turbo keeps no list of tools to install. The agent
 * reads these facts and proposes what fits this one project (skills/master/
 * tooling.md). What it gathers:
 *
 * - extensions: the file extensions with their counts, the biggest first
 * - build_files: the build manifests (pom.xml, package.json, go.mod, ...)
 * - tool_configs: files that configure a linter or an analyser
 * - tool_mentions: lines in build files and CI files that name one
 * - language_servers: the Claude Code plugins that bring a language server
 *   for an extension this project has, with whether this machine has them
 * - git: whether the project is a git repository
 *
 * The word lists below only recognise what a project already has; they never
 * decide what it gets.
 *
 * Node builtins only: the target project often has no node_modules at all.
 */

const fs = require('fs');
const path = require('path');
const env = require('./tooling-env.cjs');

const BUILD_FILES = new Set([
    'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts',
    'package.json', 'pyproject.toml', 'setup.cfg', 'setup.py', 'go.mod', 'cargo.toml',
    'gemfile', 'composer.json', 'makefile', 'build.xml', 'cmakelists.txt', 'deno.json',
    'pubspec.yaml', 'mix.exs', 'build.sbt', 'directory.build.props',
]);
const BUILD_EXT = /\.(csproj|fsproj|vbproj|sln)$/i;
const CI_FILES = [
    /^\.gitlab-ci\.ya?ml$/i, /^\.github\/workflows\/[^/]+\.ya?ml$/i, /(^|\/)jenkinsfile$/i,
    /^azure-pipelines\.ya?ml$/i, /^bitbucket-pipelines\.ya?ml$/i, /^\.pre-commit-config\.ya?ml$/i,
    /^\.gitlab\/ci\/[^/]+\.ya?ml$/i,
];

// Linters and analysers by the names their config files and build entries
// carry. Formatters are left out on purpose: they prevent no error.
const TOOL_WORDS = [
    'eslint', 'stylelint', 'biome', 'tslint', 'jshint', 'oxlint', 'checkstyle', 'pmd', 'spotbugs',
    'findbugs', 'error-?prone', 'detekt', 'ktlint', 'semgrep', 'sonar', 'ruff', 'flake8', 'pylint',
    'mypy', 'pyright', 'bandit', 'golangci', 'staticcheck', 'go ?vet', 'rubocop', 'reek', 'phpstan',
    'psalm', 'phpcs', 'phpmd', 'swiftlint', 'clippy', 'sqlfluff', 'tsqllint', 'pl/?sql ?cop',
    'tvdcc', 'db-?linter', 'shellcheck', 'hadolint', 'markdownlint', 'yamllint', 'codeql', 'snyk',
    'dependency-check', 'trivy', 'cppcheck', 'clang-tidy', 'stylecop', 'analyzers?', 'lint',
];
const WORD_RE = new RegExp(`(${TOOL_WORDS.join('|')})`, 'i');
// A config file is named after its tool: .eslintrc.json, checkstyle.xml, ruff.toml, .golangci.yml.
const CONFIG_NAME_RE = new RegExp(`^\\.?(${TOOL_WORDS.join('|')})([._-]|rc|$)`, 'i');

const SKIPPED_DIRS = new Set(['node_modules', '.git', 'target', 'build', 'dist', 'out', '.specsmd',
    'vendor', 'coverage', '__pycache__', '.venv', 'venv', '.idea', '.gradle', '.m2', 'bin', 'obj']);
const ENTRY_CAP = 300000; // entries looked at; a big monorepo still counts in about two seconds
const MAX_EXTENSIONS = 25;
const MAX_LIST = 60;
const MAX_MENTION_FILES = 40;
const MAX_MENTIONS_PER_FILE = 8;
const LINE_CAP = 160;

function read(root, rel) {
    try {
        return fs.readFileSync(path.join(root, rel), 'utf8').slice(0, 400000);
    } catch {
        return '';
    }
}

/**
 * Walk the project once: every extension counted (hidden folders left out of
 * the count), and the paths the detectors want kept. The codebase scan's own
 * walk stops at 20000 files, too early to weigh the languages of a big repo.
 */
function survey(root) {
    const counts = new Map();
    const kept = [];
    const queue = [''];
    let seen = 0;
    while (queue.length > 0 && seen < ENTRY_CAP) {
        const rel = queue.shift();
        let entries;
        try {
            entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            seen += 1;
            const child = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                if (!SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith('.specs-')) queue.push(child);
                continue;
            }
            if (!entry.isFile()) continue;
            if (!child.split('/').some((part) => part.startsWith('.') && part !== entry.name)) {
                const ext = path.extname(entry.name).toLowerCase();
                if (ext && ext.length <= 12) counts.set(ext, (counts.get(ext) || 0) + 1);
            }
            if (isBuildFile(child) || isCiFile(child) || CONFIG_NAME_RE.test(entry.name)) kept.push(child);
        }
    }
    return { counts, kept, seen, complete: queue.length === 0 };
}

/** [[ext, count]], the biggest first. */
function extensionCounts(counts) {
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, MAX_EXTENSIONS);
}

function isBuildFile(rel) {
    const base = path.basename(rel).toLowerCase();
    return BUILD_FILES.has(base) || BUILD_EXT.test(base) || /^requirements.*\.txt$/.test(base);
}

function isCiFile(rel) {
    return CI_FILES.some((re) => re.test(rel));
}

/** Lines that name a linter or an analyser: [{ file, line, text }]. */
function mentions(root, files) {
    const out = [];
    for (const rel of files.slice(0, MAX_MENTION_FILES)) {
        const lines = read(root, rel).split('\n');
        let found = 0;
        for (let i = 0; i < lines.length && found < MAX_MENTIONS_PER_FILE; i++) {
            if (!WORD_RE.test(lines[i])) continue;
            out.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, LINE_CAP) });
            found += 1;
        }
    }
    return out;
}

/** The language server plugins for the extensions this project has, with this machine's state. */
function languageServers(projectRoot, extensions, environment) {
    const have = new Set(extensions.map(([ext]) => ext));
    return env.languageServerPlugins(environment)
        .map((p) => {
            const servers = p.servers.filter((s) => s.extensions.some((e) => have.has(e)));
            if (servers.length === 0) return null;
            return {
                plugin: p.plugin,
                description: p.description,
                programs: [...new Set(servers.map((s) => s.command))],
                extensions: [...new Set(servers.flatMap((s) => s.extensions.filter((e) => have.has(e))))],
                plugin_state: env.pluginState(p.plugin, projectRoot, environment),
                on_path: servers.every((s) => env.onPath(s.command, environment)),
            };
        })
        .filter(Boolean);
}

function isGitRepo(projectRoot) {
    let dir = path.resolve(projectRoot);
    for (;;) {
        if (fs.existsSync(path.join(dir, '.git'))) return true;
        const up = path.dirname(dir);
        if (up === dir) return false;
        dir = up;
    }
}

/** Every fact of one project. */
function facts(projectRoot, environment = process.env) {
    const { counts, kept: all, seen, complete } = survey(projectRoot);
    const ci = all.filter(isCiFile);
    const build = all.filter(isBuildFile);
    const configs = all.filter((rel) => !isBuildFile(rel) && !isCiFile(rel)
        && CONFIG_NAME_RE.test(path.basename(rel)) && !/\.(md|java|kt|py|go|rs|cs|rb|php|sql)$/i.test(rel));
    const extensions = extensionCounts(counts);
    return {
        project: path.resolve(projectRoot),
        entries_seen: seen,
        complete,
        extensions: Object.fromEntries(extensions),
        build_files: build.slice(0, MAX_LIST),
        tool_configs: configs.slice(0, MAX_LIST),
        tool_mentions: mentions(projectRoot, [...build, ...ci]),
        language_servers: languageServers(projectRoot, extensions, environment),
        git: isGitRepo(projectRoot),
    };
}

module.exports = { facts, isGitRepo, extensionCounts, isBuildFile, isCiFile, CONFIG_NAME_RE };
