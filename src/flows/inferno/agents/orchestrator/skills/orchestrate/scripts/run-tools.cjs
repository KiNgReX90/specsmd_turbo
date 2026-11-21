'use strict';

/**
 * `run.cjs tools`: the config step's proposal of the tools that fit this host, per role.
 *
 * Why this exists: the config step asked for model tiers, delivery and verification and never
 * which tools the roles should have, so a host could run with whole kinds of file under no check
 * while every role searched with grep and read whole files. An agent asked to judge a stack
 * proposes something else each run and no test holds it; this reads the stack (the tracked
 * files by kind, the manifests, what this machine has installed) against the table in
 * run-tools-table.cjs and prints one proposal per line for the owner to accept per line.
 *
 * Without `--write` it only prints. `--write <id,id>` writes the lines of those proposals into
 * the config the call names and nothing the owner left out: the search line as one
 * `dispatch.constraints` entry, each lint as a scoped check (its command in
 * `verification.integrate`, its globs in `verification.finalize_scopes`), and each tool with the
 * version found here in `dispatch.tools`, the one list every machine of the host installs from.
 * A line the config already holds is not written twice. A tool this machine lacks is refused,
 * because a check that cannot run here turns every integrate that meets it red.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const lib = require('./run-lib.cjs');
const { atomicWrite } = require('./state-store.cjs');
const { addEntries } = require('./run-tools-config.cjs');
const { LINTS, MANIFESTS, MIN_FILES, NOT_PROPOSED, SEARCH } = require('./run-tools-table.cjs');

const { RunError } = lib;
const DEFAULT_CONFIG = path.join(lib.SPECS_DIR, 'config.yaml');
const SEARCH_START = SEARCH.line(['']).split(';')[0];
const MAX_KINDS = 8;

/** Every tracked file of the tree, as git names it. */
function trackedFiles(root) {
  const result = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new RunError(`git ls-files failed in ${root}: ${(result.stderr || '').trim()}`, 'GIT');
  return result.stdout.split('\0').filter(Boolean);
}

/** The program `bin` on this machine, on the PATH or in the tree's own node_modules, or null. */
function locate(bin, root) {
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    try {
      fs.accessSync(path.join(dir, bin), fs.constants.X_OK);
      return path.join(dir, bin);
    } catch {
      // not in this dir
    }
  }
  const local = path.join(root, 'node_modules', '.bin', bin);
  return fs.existsSync(local) ? local : null;
}

/** The version `bin --version` prints, `installed` when it prints none, or null when it is not here. */
function versionOf(bin, root, cache) {
  if (cache.has(bin)) return cache.get(bin);
  const file = locate(bin, root);
  let version = null;
  if (file) {
    const result = spawnSync(file, ['--version'], { cwd: root, encoding: 'utf8', timeout: 10000 });
    const match = /\d+\.\d+(?:\.\d+)?/.exec(`${result.stdout || ''}\n${result.stderr || ''}`);
    version = match ? match[0] : 'installed';
  }
  cache.set(bin, version);
  return version;
}

/** The stack: tracked files by kind, the manifests, and the memory this machine has free. */
function readFacts(root) {
  const files = trackedFiles(root);
  const kinds = new Map();
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (ext) kinds.set(ext, (kinds.get(ext) || 0) + 1);
  }
  const manifests = files.filter((file) => MANIFESTS.includes(path.basename(file)))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  return {
    files,
    kinds: [...kinds].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    manifests,
    freeGb: (os.freemem() / 1024 ** 3).toFixed(1),
  };
}

const countOf = (facts, globs) => facts.files.filter((file) => lib.matchesAny(file, globs)).length;

/** A dispatch.tools block of another shape is refused with the shape it needs, as every config key is. */
function recordedTools(config, file) {
  const tools = config.dispatch && typeof config.dispatch === 'object' ? config.dispatch.tools : undefined;
  if (tools === undefined) return {};
  const valid = tools && typeof tools === 'object' && !Array.isArray(tools) &&
    Object.values(tools).every((version) => typeof version === 'string' && version.trim() !== '');
  if (!valid) {
    throw new RunError(`dispatch.tools in ${file} must be a map of tool name to version, as shellcheck: "0.10.0".`, 'BAD_CONFIG');
  }
  return tools;
}

function status(bin, version, already) {
  if (already) return 'already in the config';
  return version ? `${bin} ${version} on this machine` : `${bin} missing on this machine`;
}

/** Every proposal for this stack, and every line of what is deliberately not proposed. */
function propose(root, facts, config, cache) {
  const integrate = (config.verification && config.verification.integrate) || [];
  const constraints = (config.dispatch && config.dispatch.constraints) || [];
  const proposals = [];
  const skipped = [];
  const weighted = SEARCH.languages.filter((entry) => countOf(facts, entry.globs) >= MIN_FILES);
  if (weighted.length > 0) {
    const line = SEARCH.line(weighted.map((entry) => entry.language));
    const version = versionOf(SEARCH.bin, root, cache);
    const already = Array.isArray(constraints) && constraints.some((entry) => String(entry).startsWith(SEARCH_START));
    proposals.push({
      id: SEARCH.id, bin: SEARCH.bin, version, already, written: 'dispatch.constraints',
      line: `${SEARCH.id}: ${SEARCH.bin} for the reading roles (planner, scanner, reviewers) over ` +
        `${weighted.map((entry) => entry.language).join(', ')}: dispatch.constraints "${line}"; ${status(SEARCH.bin, version, already)}`,
      additions: [{ section: 'dispatch', key: 'constraints', item: line }],
    });
  }
  for (const lint of LINTS) {
    if (lint.needs && !facts.files.includes(lint.needs)) continue;
    const globs = lint.globs || weighted.flatMap((entry) => entry.globs);
    const count = globs.length > 0 ? countOf(facts, globs) : 0;
    if (count === 0) continue;
    if (count < MIN_FILES) {
      skipped.push(`not proposed: ${lint.id}: ${count} ${lint.kind}, fewer than ${MIN_FILES}`);
      continue;
    }
    const version = versionOf(lint.bin, root, cache);
    const already = Array.isArray(integrate) && integrate.includes(lint.run);
    const configured = lint.configs.filter((file) => facts.files.includes(file));
    const scope = globs.join(', ');
    proposals.push({
      id: lint.id, bin: lint.bin, version, already, written: `verification.integrate, scoped to ${scope}`,
      line: `${lint.id}: lint for ${count} ${lint.kind}: verification.integrate "${lint.run}", scoped to ${scope}` +
        `${configured.length > 0 ? `; configured in the project by ${configured.join(', ')}` : ''}; ${status(lint.bin, version, already)}`,
      additions: [
        { section: 'verification', key: 'integrate', item: lint.run },
        { section: 'verification', key: 'finalize_scopes', name: lint.run, value: globs },
      ],
    });
  }
  for (const entry of NOT_PROPOSED) {
    if (entry.when(facts)) skipped.push(`not proposed: ${entry.id}: ${entry.reason(facts)}`);
  }
  return { proposals, skipped };
}

/** The one list of tools this host uses, recorded and proposed, with what this machine has. */
function toolLines(root, proposals, recorded, cache) {
  const names = [...new Set([...proposals.map((proposal) => proposal.bin), ...Object.keys(recorded)])].sort();
  const missing = [];
  const listed = names.map((name) => {
    const here = versionOf(name, root, cache);
    if (!here) missing.push(`missing: ${name} is not on this machine`);
    if (!recorded[name]) return `${name} ${here || 'missing'}`;
    if (here === recorded[name]) return `${name} ${here}`;
    return `${name} ${recorded[name]} recorded, ${here ? `${here} here` : 'missing'}`;
  });
  return names.length > 0 ? [`tools: ${listed.join(', ')}`, ...missing] : [];
}

/** Write the proposals named in `ids` and nothing else. Refuses before any write. */
function writeAccepted(root, file, ids, proposals, current) {
  const byId = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    throw new RunError(`${unknown.join(', ')} is no proposal here: accept one of ${[...byId.keys()].join(', ') || 'none'}.`, 'BAD_ARGS', 1);
  }
  const chosen = ids.map((id) => byId.get(id));
  const lacking = chosen.filter((proposal) => !proposal.already && !proposal.version);
  if (lacking.length > 0) {
    const names = lacking.map((proposal) => proposal.bin).join(', ');
    throw new RunError(`${names} is not on this machine, so nothing was written: install it and accept again, or accept the others alone.`, 'TOOL_MISSING');
  }
  const additions = [];
  const out = [];
  for (const proposal of chosen) {
    if (proposal.already) {
      out.push(`already in the config: ${proposal.id}`);
      continue;
    }
    additions.push(...proposal.additions, { section: 'dispatch', key: 'tools', name: proposal.bin, value: proposal.version });
    out.push(`written: ${proposal.id} to ${proposal.written}`);
  }
  const rel = path.relative(root, file);
  const { text, made } = addEntries(current, additions, rel);
  if (made.length > 0) {
    atomicWrite(file, text);
    out.push(`wrote ${rel}`);
  }
  return out;
}

function tools(options) {
  const root = lib.repoRoot(options.tree || options.cwd);
  const file = path.resolve(root, options.config || DEFAULT_CONFIG);
  lib.readConfig(root, options.config); // a config the flow would refuse is refused here first
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const config = lib.parseYaml(current);
  const recorded = recordedTools(config, path.relative(root, file));
  const facts = readFacts(root);
  const cache = new Map();
  const { proposals, skipped } = propose(root, facts, config, cache);
  if (options.write !== undefined) {
    const ids = String(options.write).split(',').map((id) => id.trim()).filter(Boolean);
    if (ids.length === 0) throw new RunError('usage: node run.cjs tools --write <id,id>', 'BAD_ARGS', 1);
    const out = writeAccepted(root, file, ids, proposals, current);
    return { exit: 0, payload: { written: out }, out };
  }
  const kinds = facts.kinds.slice(0, MAX_KINDS).map(([ext, count]) => `${ext} ${count}`).join(', ');
  const out = [
    `stack: ${facts.files.length} tracked files; by kind: ${kinds || 'none'}; manifests: ${facts.manifests.join(', ') || 'none'}`,
    ...proposals.map((proposal) => proposal.line),
    ...skipped,
  ];
  if (proposals.some((proposal) => proposal.id !== SEARCH.id && !proposal.already)) {
    out.push('note: a lint judges every file of its kind, so a finding an old file already has turns red the integrate ' +
      'of any item that touches such a file: fix those first, or leave that lint out');
  }
  out.push(...toolLines(root, proposals, recorded, cache));
  const payload = {
    proposals: proposals.map(({ id, line, already, version }) => ({ id, line, already, version })),
    not_proposed: skipped,
    tools: recorded,
  };
  return { exit: 0, payload, out };
}

module.exports = { tools };
