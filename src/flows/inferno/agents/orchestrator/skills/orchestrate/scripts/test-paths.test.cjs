'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

// A host runs the installed scripts and tests from `<host>/.specsmd/inferno`. What the installer does not put
// there is missing: this repository's `evals/` and `src/__tests__/`, a sibling flow, and the flow's own source
// parts the installer renders elsewhere (`codex/`, `claude/`, `commands/`). A require or a file path that reaches
// one of those passes here and fails in every host. This file holds every script and test of the flow to what
// a host has: the installed flow, the host root, and the surfaces the installer writes under it.

const FLOW = path.resolve(__dirname, '../../../../..');
// The flow is installed at <host>/.specsmd/inferno; in this repository the same climb lands on src/.
const HOST = path.resolve(FLOW, '../..');
// What the installer puts under .specsmd/inferno: FLOW_DIRS and FLOW_FILES in src/lib/install/stage.js, and the
// lock it writes beside them.
const INSTALLED = new Set(['agents', 'agent-capabilities', 'bolt-types', 'skills', 'templates', 'shared', 'scripts',
  'memory-bank.yaml', 'context-config.yaml', 'quick-start.md', 'README.md', 'README.codex.md', 'constitution.md',
  'check-lock.cjs', 'flow.lock']);
// What the installer writes under the host root for Claude Code and Codex.
const SURFACES = new Set(['.claude', '.agents', '.codex', 'AGENTS.md']);
// A reach the code cannot avoid, by file and the target it reaches, each with its reason.
const EXCEPTIONS = {
  // The one reader of a Codex skill's text: from the source here, from .agents/skills/ in a host, and a clear
  // failure when neither is there.
  'agents/orchestrator/skills/orchestrate/scripts/test-codex-text.cjs': ['codex/skills'],
};

// Built in pieces so this file never matches its own rule.
const HERE = '__dir' + 'name';
const LOAD = 'requ' + 'ire';
const STRING = /^(["'`])((?:\\.|(?!\1).)*)\1$/s;
const BINDING = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g;
const JOINED = new RegExp(`\\bpath\\.(?:resolve|join)\\(([^()]*)\\)`, 'g');
const LOADED = new RegExp(`\\b${LOAD}\\(\\s*((["'\`])[^()]*?\\2)\\s*\\)`, 'g');

/** The text of a string literal with every `${NAME}` of a known string put in, or null. */
function literal(source, strings) {
  const match = STRING.exec(source.trim());
  if (!match) return null;
  let unknown = false;
  const text = match[2].replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (_, name) => {
    if (name in strings) return strings[name];
    unknown = true;
    return '';
  });
  return unknown ? null : text;
}

/** Where path.resolve or path.join lands from its arguments, as far as they are known, or null. */
function joined(args, dir, strings, dirs) {
  const parts = args.split(',').map((arg) => arg.trim()).filter(Boolean);
  const base = parts.shift();
  let at = base === HERE ? dir : dirs[base];
  if (!at) return null;
  for (const part of parts) {
    const text = part in strings ? strings[part] : literal(part, strings);
    if (text === null) break;
    at = path.resolve(at, text);
  }
  return at;
}

const lineOf = (source, index) => source.slice(0, index).split('\n').length;

/** Every place a {flow-relative file: source} map reaches with a require or a path built on the file's folder. */
function reaches(files) {
  const found = [];
  for (const [file, source] of Object.entries(files)) {
    const dir = path.join(FLOW, path.dirname(file));
    const strings = {};
    const dirs = {};
    for (const [, name, value] of source.matchAll(BINDING)) {
      const text = literal(value, strings);
      if (text !== null) strings[name] = text;
      const call = /^path\.(?:resolve|join)\(([^()]*)\)$/.exec(value.trim());
      const at = call && joined(call[1], dir, strings, dirs);
      if (at) dirs[name] = at;
    }
    for (const match of source.matchAll(JOINED)) {
      const target = joined(match[1], dir, strings, dirs);
      if (target) found.push({ file, line: lineOf(source, match.index), target });
    }
    for (const match of source.matchAll(LOADED)) {
      const text = literal(match[1], strings);
      if (text && text.startsWith('.')) found.push({ file, line: lineOf(source, match.index), target: path.resolve(dir, text) });
    }
  }
  return found;
}

const inside = (root, target) => target === root || target.startsWith(root + path.sep);
const first = (root, target) => path.relative(root, target).split(path.sep)[0];

/** True when a host has what the target names. */
function inHost(target) {
  if (inside(FLOW, target)) return target === FLOW || INSTALLED.has(first(FLOW, target));
  return target === HOST || (inside(HOST, target) && SURFACES.has(first(HOST, target)));
}

/** Every reach that leaves what a host has, as `file:line reaches target`, the exceptions aside. */
function offenders(files, exceptions = EXCEPTIONS) {
  return reaches(files)
    .filter(({ target }) => !inHost(target))
    .filter(({ file, target }) => !(exceptions[file] || []).some((allowed) => inside(path.join(FLOW, allowed), target)))
    .map(({ file, line, target }) => `${file}:${line} reaches ${path.relative(FLOW, target)}`);
}

function flowSources() {
  const files = {};
  for (const rel of fs.readdirSync(FLOW, { recursive: true, encoding: 'utf8' })) {
    if (rel.endsWith('.cjs')) files[rel] = fs.readFileSync(path.join(FLOW, rel), 'utf8');
  }
  return files;
}

function refusal(found) {
  return `${found.join('\n')}\n` +
    'These lines reach a file the installer does not put in a host, so they fail in every host. Keep what a\n' +
    'shipped test needs inside the installed flow, move a case that needs this repository to a test under evals/,\n' +
    `and read a Codex skill's text through ${path.relative(FLOW, path.join(__dirname, 'test-codex-text.cjs'))}.`;
}

/** A sample source with the folder and loader names put in. */
const sample = (text) => text.replaceAll('HERE', HERE).replaceAll('LOAD', LOAD);
const S = 'agents/orchestrator/skills/orchestrate/scripts';

test('a require or a path that climbs into the repository is found, through a named folder too', () => {
  const files = {
    [`${S}/a.test.cjs`]: sample('const { x } = LOAD(path.join(HERE, "../../../../../../../../evals/review-loop/measure.cjs"));\n'),
    [`${S}/b.test.cjs`]: sample('const x = 1;\nLOAD("../../../../../../../__tests__/unit/a.ts");\n'),
    [`${S}/c.cjs`]: sample('const ROOT = path.resolve(HERE, "../../../../..");\nconst f = path.join(ROOT, "..", "fire", "README.md");\n'),
  };
  assert.deepEqual(offenders(files, {}), [
    `${S}/a.test.cjs:1 reaches ../../../evals/review-loop/measure.cjs`,
    `${S}/b.test.cjs:2 reaches ../../__tests__/unit/a.ts`,
    `${S}/c.cjs:2 reaches ../fire/README.md`,
  ]);
});

test('a path into a part of the flow the installer renders elsewhere is found, through a named string too', () => {
  const files = {
    [`${S}/a.test.cjs`]: sample('const P = "../../../../../codex/skills/x/references/procedure.md";\n\nread(path.resolve(HERE, P));\n'),
    'agents/planner/scripts/b.test.cjs': sample('const SCRIPTS = "../../orchestrator/skills/orchestrate/scripts";\nLOAD(`${SCRIPTS}/run-lib.cjs`);\n' +
      'const AGENTS = path.resolve(HERE, "../..");\nconst CODEX = path.resolve(AGENTS, "../codex/skills");\n'),
  };
  assert.deepEqual(offenders(files, {}), [
    `${S}/a.test.cjs:3 reaches codex/skills/x/references/procedure.md`,
    'agents/planner/scripts/b.test.cjs:4 reaches codex/skills',
  ]);
});

test('the installed flow, the host root, the surfaces under it and plain test data are left alone', () => {
  const files = {
    [`${S}/a.test.cjs`]: sample([
      'const FLOW = path.resolve(HERE, "../../../../..");',
      'read(path.resolve(HERE, "../../../agent.md"));',
      'read(path.resolve(HERE, "../../../../scanner/agent.md"));',
      'const root = path.resolve(FLOW, "../..");',
      'read(path.join(root, ".agents", "skills", "x", "SKILL.md"));',
      'const { a } = LOAD("./run-lib.cjs");',
      'own(["../outside.txt"]);',
      'read(path.join(dir, "../../elsewhere"));',
    ].join('\n')),
    'check-lock.cjs': sample("const root = path.resolve(HERE, '..', '..');\n"),
  };
  assert.deepEqual(offenders(files, {}), []);
});

test('each exception names a file of the flow that still makes the reach it is kept for', () => {
  const files = flowSources();
  for (const [file, targets] of Object.entries(EXCEPTIONS)) {
    assert.ok(file in files, `${file} is not a script of the flow`);
    const made = reaches({ [file]: files[file] }).filter(({ target }) => !inHost(target));
    for (const allowed of targets) {
      assert.ok(made.some(({ target }) => inside(path.join(FLOW, allowed), target)), `${file} no longer reaches ${allowed}`);
    }
  }
});

test('no script or test of the flow reaches a file the installer does not put in a host', () => {
  const files = flowSources();
  // The guard reaches only what it collects, so a test file from each folder of scripts is named here.
  for (const name of [`${S}/run-proofs.test.cjs`, 'agents/planner/scripts/team-work-item-contract.test.cjs']) {
    assert.ok(name in files, `${name} is not collected from ${FLOW}`);
  }
  const found = offenders(files);
  assert.deepEqual(found, [], refusal(found));
});
