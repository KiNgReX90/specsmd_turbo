#!/usr/bin/env node

/**
 * specsmd AI-DLC Turbo - codebase scan
 *
 * Detects the stack of the project it is pointed at and prints the `codebase:`
 * block of repo/repo.yaml. Run at project-init and at inception intake when
 * repo.yaml or its `codebase.scanned_at` is missing.
 *
 *   node .specsmd/aidlc-turbo/scripts/codebase-scan.cjs [--write] [--project <dir>] [--root <dir>]
 *
 * --project is the folder to scan, default the current directory. --root is
 * the artifact root, default .specs-aidlc-turbo inside that folder.
 * --write merges the block into <root>/repo/repo.yaml, creating the file when
 * absent and keeping every other key (the live_test block) verbatim. A root
 * with the old layout is refused: move it first with migrate-layout.cjs.
 * Exit 0 ok, 1 failure, 2 usage error.
 *
 * Node builtins only: the scan has to run in projects that have no
 * node_modules at all (Maven, Gradle, Python, Go, Rust).
 *
 * Evidence is read from the manifests first. A project with no dependencies at
 * all still has to be detected, so the JavaScript and TypeScript sources are
 * read for their imports as well: node:http means a plain Node server,
 * node:test means the built-in test runner.
 */

const fs = require('fs');
const path = require('path');
const { ARTIFACT_DIR, layout, isLegacy, legacyMessage } = require('./lib/paths.cjs');

const FILE_CAP = 20000;

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'target', 'build', 'dist', 'out', '.specsmd',
  'vendor', 'coverage', '__pycache__', '.venv', 'venv'
]);

const LANGUAGE_BY_EXT = {
  '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin', '.scala': 'scala',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.cs': 'csharp', '.go': 'go', '.rs': 'rust',
  '.rb': 'ruby', '.php': 'php', '.swift': 'swift', '.vue': 'vue', '.svelte': 'svelte'
};

// A dependency-free Node project declares its stack nowhere but in its own
// imports, so the scan reads the head of the JavaScript and TypeScript sources
// as well. Bounded twice over: at most SOURCE_SCAN_CAP files, and only until
// every builtin marker has been seen.
const SOURCE_EXT = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const SOURCE_SCAN_CAP = 600;
const SOURCE_HEAD_BYTES = 20000;

/**
 * True when the text imports or requires the module named by `pattern`
 * (a regex fragment). Matches ESM `from '...'`, bare `import '...'`, dynamic
 * `import('...')` and CommonJS `require('...')`, never a plain string literal.
 */
function importsModule(text, pattern) {
  const re = new RegExp(
    `(?:from|require\\s*\\(|import\\s*\\()\\s*['"]${pattern}['"]|import\\s+['"]${pattern}['"]`
  );
  return re.test(text);
}

// ---------------------------------------------------------------------------
// Walking
// ---------------------------------------------------------------------------

/**
 * Walk the tree once, collecting every file path relative to the root.
 * Stops descending once FILE_CAP files have been seen.
 */
function walk(root) {
  const files = [];
  const queue = [''];
  while (queue.length > 0 && files.length < FILE_CAP) {
    const rel = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.specs-')) continue;
        queue.push(childRel);
      } else if (entry.isFile()) {
        files.push(childRel);
        if (files.length >= FILE_CAP) break;
      }
    }
  }
  return files;
}

function readFileSafe(root, rel, limit = 200000) {
  try {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    return text.length > limit ? text.slice(0, limit) : text;
  } catch {
    return '';
  }
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Evidence gathering
// ---------------------------------------------------------------------------

/**
 * Collect the raw evidence every detector needs, in one pass over the file list.
 */
function collectEvidence(root, files) {
  const ev = {
    files,
    byExt: {},
    manifests: { java: '', node: '', python: '', dotnet: '' },
    packageJson: null,
    nodeDeps: {},
    has: {
      pom: false, gradle: false, packageJson: false, pyproject: false,
      requirements: false, csproj: false, goMod: false, cargo: false,
      pytestIni: false, vitestConfig: false, jestConfig: false,
      playwrightConfig: false
    },
    playwrightConfigPath: null,
    ext: new Set(),
    htmlUnderSrc: false,
    templateDir: false,
    importsNodeHttp: false,
    importsNodeTest: false,
    sourcesRead: 0
  };

  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    const base = path.basename(rel).toLowerCase();
    ev.ext.add(ext);
    ev.byExt[ext] = (ev.byExt[ext] || 0) + 1;

    if (base === 'pom.xml') {
      ev.has.pom = true;
      ev.manifests.java += readFileSafe(root, rel);
    } else if (base === 'build.gradle' || base === 'build.gradle.kts') {
      ev.has.gradle = true;
      ev.manifests.java += readFileSafe(root, rel);
    } else if (base === 'package.json') {
      ev.has.packageJson = true;
      const text = readFileSafe(root, rel);
      ev.manifests.node += text;
      const parsed = parseJsonSafe(text);
      if (parsed) {
        if (!ev.packageJson || rel.indexOf('/') === -1) ev.packageJson = parsed;
        Object.assign(ev.nodeDeps, parsed.dependencies || {}, parsed.devDependencies || {});
      }
    } else if (base === 'pyproject.toml') {
      ev.has.pyproject = true;
      ev.manifests.python += readFileSafe(root, rel);
    } else if (base === 'requirements.txt') {
      ev.has.requirements = true;
      ev.manifests.python += readFileSafe(root, rel);
    } else if (ext === '.csproj') {
      ev.has.csproj = true;
      ev.manifests.dotnet += readFileSafe(root, rel);
    } else if (base === 'go.mod') {
      ev.has.goMod = true;
    } else if (base === 'cargo.toml') {
      ev.has.cargo = true;
    } else if (base === 'pytest.ini') {
      ev.has.pytestIni = true;
    } else if (/^vitest\.config\./.test(base)) {
      ev.has.vitestConfig = true;
    } else if (/^jest\.config\./.test(base)) {
      ev.has.jestConfig = true;
    } else if (/^playwright\.config\.(ts|js|mjs|cjs)$/.test(base)) {
      ev.has.playwrightConfig = true;
      if (!ev.playwrightConfigPath || rel.indexOf('/') === -1) ev.playwrightConfigPath = rel;
    }

    if (SOURCE_EXT.has(ext)
      && (!ev.importsNodeHttp || !ev.importsNodeTest)
      && ev.sourcesRead < SOURCE_SCAN_CAP) {
      ev.sourcesRead += 1;
      const head = readFileSafe(root, rel, SOURCE_HEAD_BYTES);
      if (!ev.importsNodeHttp && importsModule(head, '(?:node:)?https?')) ev.importsNodeHttp = true;
      if (!ev.importsNodeTest && importsModule(head, 'node:test')) ev.importsNodeTest = true;
    }
    if (ext === '.html' && /(^|\/)src\//.test(rel)) ev.htmlUnderSrc = true;
    if (/(^|\/)templates\//.test(rel)) ev.templateDir = true;
  }

  return ev;
}

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

function detectLanguages(ev) {
  const counts = {};
  for (const [ext, n] of Object.entries(ev.byExt)) {
    const lang = LANGUAGE_BY_EXT[ext];
    if (lang) counts[lang] = (counts[lang] || 0) + n;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([lang]) => lang);
}

function detectUiStack(ev) {
  const stack = [];
  const dep = name => Object.prototype.hasOwnProperty.call(ev.nodeDeps, name);
  if (dep('react') || dep('react-dom')) stack.push('react');
  if (dep('vue')) stack.push('vue');
  if (dep('@angular/core')) stack.push('angular');
  if (dep('svelte')) stack.push('svelte');
  if (dep('next')) stack.push('next');
  if (dep('nuxt') || dep('nuxt3')) stack.push('nuxt');

  if (ev.ext.has('.jsp') || ev.ext.has('.jspx') || ev.ext.has('.tag')) stack.push('jsp');
  if (/thymeleaf/i.test(ev.manifests.java) || /thymeleaf/i.test(ev.manifests.node)) stack.push('thymeleaf');
  if (/freemarker/i.test(ev.manifests.java) || ev.ext.has('.ftl') || ev.ext.has('.ftlh')) stack.push('freemarker');
  if (ev.ext.has('.cshtml')) stack.push('razor');
  if (ev.ext.has('.razor')) stack.push('blazor');

  if (stack.length === 0 && ev.htmlUnderSrc) stack.push('html-templates');
  return stack;
}

function detectBackendStack(ev) {
  const stack = [];
  const dep = name => Object.prototype.hasOwnProperty.call(ev.nodeDeps, name);
  if (ev.has.pom || ev.has.gradle) {
    stack.push('java');
    if (/spring-boot|springframework/i.test(ev.manifests.java)) stack.push('spring');
    if (/quarkus/i.test(ev.manifests.java)) stack.push('quarkus');
  }
  if (dep('express') || dep('@nestjs/core') || dep('fastify')) {
    stack.push('node');
    if (dep('express')) stack.push('express');
    if (dep('@nestjs/core')) stack.push('nest');
  } else if (ev.importsNodeHttp) {
    // No framework dependency, but the sources speak node:http directly: a
    // plain Node server. Without this the whole block came back empty for a
    // dependency-free project.
    stack.push('node');
    stack.push('node-http');
  }
  if (/\bdjango\b/i.test(ev.manifests.python) || /\bfastapi\b/i.test(ev.manifests.python)
    || /\bflask\b/i.test(ev.manifests.python)) {
    stack.push('python');
    if (/\bdjango\b/i.test(ev.manifests.python)) stack.push('django');
    if (/\bfastapi\b/i.test(ev.manifests.python)) stack.push('fastapi');
    if (/\bflask\b/i.test(ev.manifests.python)) stack.push('flask');
  }
  if (ev.has.csproj) stack.push('dotnet');
  if (ev.has.goMod) stack.push('go');
  if (ev.has.cargo) stack.push('rust');
  return stack;
}

function detectTestRunners(ev) {
  const runners = [];
  const dep = name => Object.prototype.hasOwnProperty.call(ev.nodeDeps, name);
  if (/junit/i.test(ev.manifests.java)) runners.push('junit');
  if (/testng/i.test(ev.manifests.java)) runners.push('testng');
  if (dep('vitest') || ev.has.vitestConfig) runners.push('vitest');
  if (dep('jest') || ev.has.jestConfig) runners.push('jest');
  if (dep('mocha')) runners.push('mocha');
  // The built-in runner has no dependency to find it by: the evidence is an
  // import of node:test, or `node --test` in a package.json script.
  if (ev.importsNodeTest || /node\s+--test\b/.test(ev.manifests.node)) runners.push('node-test');
  if (ev.has.pytestIni || /\bpytest\b/i.test(ev.manifests.python)) runners.push('pytest');
  if (/xunit/i.test(ev.manifests.dotnet)) runners.push('xunit');
  if (/nunit/i.test(ev.manifests.dotnet)) runners.push('nunit');
  if (ev.has.goMod) runners.push('go-test');
  if (ev.has.cargo) runners.push('cargo-test');
  return runners;
}

function detectPlaywright(root, ev) {
  const hasDep = Object.prototype.hasOwnProperty.call(ev.nodeDeps, '@playwright/test');
  if (!hasDep || !ev.has.playwrightConfig) return { playwright: false, testDir: null };
  const text = readFileSafe(root, ev.playwrightConfigPath);
  const match = text.match(/testDir\s*:\s*['"`]([^'"`]+)['"`]/);
  const raw = match ? match[1] : 'tests';
  return { playwright: true, testDir: raw.replace(/^\.\//, '') };
}

function detectCommands(ev) {
  const scripts = (ev.packageJson && ev.packageJson.scripts) || {};
  const commands = { build: null, test: null };
  if (scripts.build) commands.build = 'npm run build';
  if (scripts.test) commands.test = 'npm test';

  if (!commands.build || !commands.test) {
    let build = null;
    let test = null;
    if (ev.has.pom) {
      build = 'mvn -q -DskipTests package';
      test = 'mvn -q test';
    } else if (ev.has.gradle) {
      build = 'gradle build -x test';
      test = 'gradle test';
    } else if (ev.has.csproj) {
      build = 'dotnet build';
      test = 'dotnet test';
    } else if (ev.has.goMod) {
      build = 'go build ./...';
      test = 'go test ./...';
    } else if (ev.has.cargo) {
      build = 'cargo build';
      test = 'cargo test';
    } else if (ev.has.pyproject || ev.has.requirements || ev.has.pytestIni) {
      test = 'pytest';
    }
    commands.build = commands.build || build;
    commands.test = commands.test || test;
  }
  return commands;
}

// ---------------------------------------------------------------------------
// Rendering and merging
// ---------------------------------------------------------------------------

function yamlList(values) {
  return values.length === 0 ? '[]' : `[${values.join(', ')}]`;
}

function yamlString(value) {
  return value === null || value === undefined ? 'null' : `"${String(value).replace(/"/g, '\\"')}"`;
}

function renderCodebaseBlock(scan) {
  return [
    'codebase:',
    `  scanned_at: ${scan.scanned_at}`,
    `  languages: ${yamlList(scan.languages)}`,
    `  has_ui: ${scan.has_ui}`,
    `  ui_stack: ${yamlList(scan.ui_stack)}`,
    `  backend_stack: ${yamlList(scan.backend_stack)}`,
    `  test_runners: ${yamlList(scan.test_runners)}`,
    `  playwright: ${scan.playwright}`,
    `  playwright_test_dir: ${scan.playwright_test_dir === null ? 'null' : yamlString(scan.playwright_test_dir)}`,
    '  commands:',
    `    build: ${scan.commands.build === null ? 'null' : yamlString(scan.commands.build)}`,
    `    test: ${scan.commands.test === null ? 'null' : yamlString(scan.commands.test)}`,
    ''
  ].join('\n');
}

/**
 * Replace the top-level `codebase:` block of an existing repo.yaml, keeping
 * every other key verbatim. Text-level on purpose: no YAML library needed and
 * the user's comments and ordering survive.
 */
function mergeBlock(existing, block) {
  const lines = existing.split('\n');
  const start = lines.findIndex(line => /^codebase:\s*$/.test(line));
  if (start === -1) {
    const head = existing.replace(/\s*$/, '');
    return head.length === 0 ? block : `${head}\n${block}`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[A-Za-z_#]/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const before = lines.slice(0, start).join('\n').replace(/\s*$/, '');
  const after = lines.slice(end).join('\n').replace(/^\s*\n/, '');
  const parts = [];
  if (before.length > 0) parts.push(`${before}\n`);
  parts.push(block);
  if (after.trim().length > 0) parts.push(after.replace(/\s*$/, '') + '\n');
  return parts.join('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { project: process.cwd(), root: null, write: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--write') {
      opts.write = true;
    } else if ((arg === '--project' || arg === '--root') && argv[i + 1]) {
      opts[arg.slice(2)] = path.resolve(argv[++i]);
    } else {
      return { error: `unknown or incomplete argument: ${arg}` };
    }
  }
  if (!opts.root) opts.root = path.join(opts.project, ARTIFACT_DIR);
  return opts;
}

function scan(root) {
  const files = walk(root);
  const ev = collectEvidence(root, files);
  const uiStack = detectUiStack(ev);
  const pw = detectPlaywright(root, ev);
  return {
    scanned_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    languages: detectLanguages(ev),
    has_ui: uiStack.length > 0,
    ui_stack: uiStack,
    backend_stack: detectBackendStack(ev),
    test_runners: detectTestRunners(ev),
    playwright: pw.playwright,
    playwright_test_dir: pw.testDir,
    commands: detectCommands(ev)
  };
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.error) {
    console.error(`codebase-scan: ${opts.error}`);
    console.error('Usage: node codebase-scan.cjs [--write] [--project <dir>] [--root <dir>]');
    return 2;
  }
  if (!fs.existsSync(opts.project)) {
    console.error(`codebase-scan: folder not found: ${opts.project}`);
    return 1;
  }
  if (opts.write && isLegacy(opts.root)) {
    console.error(`codebase-scan: ${legacyMessage(path.relative(opts.project, opts.root) || opts.root)}`);
    return 1;
  }

  const block = renderCodebaseBlock(scan(opts.project));
  process.stdout.write(block);

  if (opts.write) {
    const target = layout(opts.root).repoYaml;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    fs.writeFileSync(target, mergeBlock(existing, block), 'utf8');
    console.error(`codebase-scan: wrote ${path.relative(opts.project, target)}`);
  }
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { scan, renderCodebaseBlock, mergeBlock, importsModule, main };
