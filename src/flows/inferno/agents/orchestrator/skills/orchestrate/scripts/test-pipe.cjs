'use strict';
// A command-line entry of the flow run the way an orchestrator pipes it, to `tail` or a JSON reader.

const { spawnSync } = require('node:child_process');

/** More than a pipe takes at once on Linux: an answer this long is cut by an early exit. */
const PIPE = 64 * 1024;

/**
 * Run `node <script> <args>` in `cwd` with stdout and stderr each through a pipe whose reader
 * starts a moment late, so what the pipe did not take at once is still in the process when its
 * last write returns. The exit code is the script's own.
 */
function piped(cwd, env, script, args) {
  const shell = 'set -o pipefail; "$0" "$@" 2> >(sleep 0.2; cat >&2) | { sleep 0.2; cat; }';
  const result = spawnSync('bash', ['-c', shell, process.execPath, script, ...args],
    { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

module.exports = { PIPE, piped };
