'use strict';

/**
 * An arm is one planner text: a source tree of the package, as it is or with a patch on it.
 * A patch is the cheapest way to measure a text change: `git diff > change.patch` in this
 * repository, from its root or from `src/`, and the arm is the base tree with it applied in a
 * copy. A second source tree works too. Each arm also says which pins its planner runs on, read
 * from the files the installer copies verbatim.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

class ArmError extends Error {}

/** Files of a package tree the install does not need, so a patched copy leaves them out. */
const LEFT_OUT = new Set(['node_modules', '__tests__', '.git']);

const CLAUDE_PLANNER = path.join('flows', 'inferno', 'commands', 'inferno-planner.md');
const CODEX_PLANNER = path.join('flows', 'inferno', 'codex', 'agents', 'specsmd_inferno_planner.toml');

function isTree(dir) {
  return fs.existsSync(path.join(dir, 'bin', 'cli.js'));
}

/** The paths a patch touches, as `git apply --numstat` reads them, without applying it. */
function patchPaths(patch) {
  // Inside a repository git reads only the paths under the folder it runs in, so it runs in an empty one.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-ab-numstat-'));
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(empty) };
  let result;
  try {
    result = spawnSync('git', ['apply', '--numstat', patch], { cwd: empty, env, encoding: 'utf8' });
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
  if (result.status !== 0) throw new ArmError(`${patch} is no patch git can read: ${(result.stderr || '').trim()}`);
  return result.stdout.split('\n').filter(Boolean).map((line) => line.split('\t')[2]);
}

/** Copies `base` into `dest` without what the install never reads, with its node_modules linked. */
function copyTree(base, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(base)) {
    if (LEFT_OUT.has(name)) continue;
    fs.cpSync(path.join(base, name), path.join(dest, name), { recursive: true, dereference: false });
  }
  const modules = path.join(base, 'node_modules');
  if (fs.existsSync(modules)) fs.symlinkSync(fs.realpathSync(modules), path.join(dest, 'node_modules'), 'dir');
}

/** Where a patch applies: the parent of `src` for a patch made from the repository root, `src` itself else. */
function applyDir(paths, src) {
  // A patch made from the repository root names src/..., one made from src/ names flows/...
  return paths.every((entry) => entry.startsWith('src/')) ? path.dirname(src) : src;
}

/** Applies `patch` in `cwd` (`--reverse` takes it out), or with `check` only says whether it would. */
function apply(patch, cwd, { reverse = false, check = false } = {}) {
  // The ceiling keeps git apply from finding a repository above `cwd` and applying there.
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(cwd) };
  const args = ['apply', '--whitespace=nowarn', ...(reverse ? ['--reverse'] : []), ...(check ? ['--check'] : []), patch];
  return spawnSync('git', args, { cwd, env, encoding: 'utf8' });
}

/** Whether `base` already holds the change of the patch `spec`, as an edited tree does before its diff is reverted. */
function holdsPatch(spec, base) {
  const at = path.resolve(spec);
  if (!fs.existsSync(at) || fs.statSync(at).isDirectory()) return false;
  const paths = patchPaths(at);
  return paths.length > 0 && apply(at, applyDir(paths, base), { check: true }).status !== 0 &&
    apply(at, applyDir(paths, base), { reverse: true, check: true }).status === 0;
}

/**
 * The source tree of one arm under `work`: `spec` itself when it is a tree, else `base` copied
 * to `<work>/src` with the patch `spec` applied, or taken out with `reverse`. A patch that does
 * not apply refuses the arm.
 */
function prepareArm(spec, base, work, { reverse = false } = {}) {
  const at = path.resolve(spec);
  if (!fs.existsSync(at)) throw new ArmError(`${spec} does not exist`);
  if (fs.statSync(at).isDirectory()) {
    if (!isTree(at)) throw new ArmError(`${spec} holds no bin/cli.js, so it is no source tree of the package`);
    return { src: at, label: `tree ${at}` };
  }
  const paths = patchPaths(at);
  if (paths.length === 0) throw new ArmError(`${spec} changes no file`);
  const src = path.join(work, 'src');
  fs.rmSync(work, { recursive: true, force: true });
  copyTree(base, src);
  const applied = apply(at, applyDir(paths, src), { reverse });
  if (applied.status !== 0) throw new ArmError(`${spec} does not apply to ${base}: ${(applied.stderr || '').trim()}`);
  return { src, label: `${base} ${reverse ? 'without' : 'with'} ${path.basename(at)}`, patch: at, paths };
}

function field(text, pattern, what, file) {
  const match = pattern.exec(text);
  if (!match) throw new ArmError(`${file} names no ${what}`);
  return match[1];
}

/** The Claude planner's pins from its agent file: the source command file or the installed agent. */
function claudePins(file) {
  const text = fs.readFileSync(file, 'utf8');
  const head = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!head) throw new ArmError(`${file} has no frontmatter`);
  return {
    agent: field(head[1], /^name:\s*(\S+)\s*$/m, 'name', file),
    model: field(head[1], /^model:\s*(\S+)\s*$/m, 'model', file),
    effort: field(head[1], /^effort:\s*(\S+)\s*$/m, 'effort', file),
  };
}

/** The Codex planner's pins and its developer instructions from its custom agent file. */
function codexPins(file) {
  const text = fs.readFileSync(file, 'utf8');
  return {
    agent: field(text, /^name\s*=\s*"([^"]+)"\s*$/m, 'name', file),
    model: field(text, /^model\s*=\s*"([^"]+)"\s*$/m, 'model', file),
    effort: field(text, /^model_reasoning_effort\s*=\s*"([^"]+)"\s*$/m, 'model_reasoning_effort', file),
    instructions: field(text, /^developer_instructions\s*=\s*"""\n?([\s\S]*?)"""\s*$/m, 'developer_instructions', file).trim(),
  };
}

/** The pins as a source tree holds them. */
function sourcePins(src) {
  return { claude: claudePins(path.join(src, CLAUDE_PLANNER)), codex: codexPins(path.join(src, CODEX_PLANNER)) };
}

/** The pins as an install into `tree` wrote them, which a host config's roles block may have changed. */
function installedPins(tree) {
  return {
    claude: claudePins(path.join(tree, '.claude', 'agents', 'specsmd-inferno-planner.md')),
    codex: codexPins(path.join(tree, '.codex', 'agents', 'specsmd_inferno_planner.toml')),
  };
}

module.exports = { ArmError, prepareArm, holdsPatch, sourcePins, installedPins, isTree };
