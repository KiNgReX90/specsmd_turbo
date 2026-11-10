'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

// The kill program of a common Linux toolset reads `-<pid>` as an option and keeps its first digit only: asked to
// signal group 12345 it signals process -1, which is every process of the user, and the desktop session goes
// with it. Code in this flow stops a process or a group with process.kill, which hands the number to the system
// call as it is. This file holds every script and test of the flow to that.

const FLOW = path.resolve(__dirname, '../../../../..');
// Built in two halves so this file never matches its own rule.
const PROGRAM = 'ki' + 'll';
const QUOTE = '["\'`]';
/** The program started as a process of its own. */
const STARTED = new RegExp(`\\b(?:spawn|spawnSync|execFile|execFileSync)\\(\\s*${QUOTE}${PROGRAM}${QUOTE}`);
/** The program in a shell line, with a signal option and then a negative target. */
const SHELL = new RegExp(`\\b${PROGRAM}\\s+(?:-s\\s+\\w+|-[A-Za-z0-9]+)\\s+-[$\\d{]`);

/** Every line in a {file: source} map that hands a negative target to the program. */
function offenders(files) {
  const found = [];
  for (const [file, source] of Object.entries(files)) {
    source.split('\n').forEach((line, at) => {
      if (STARTED.test(line) || SHELL.test(line)) found.push(`${file}:${at + 1}`);
    });
  }
  return found;
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
    `These lines stop a process through the ${PROGRAM} program, which can signal every process of the user.\n` +
    'Stop it with\n' +
    "  process.kill(-child.pid, 'SIGKILL');\n" +
    'inside a try block, so the number reaches the system call as it is.';
}

test('the program started as a process is found, with a group as its target or not', () => {
  const files = {
    'a.test.cjs': `t.after(() => spawnSync("${PROGRAM}", ["-KILL", \`-\${child.pid}\`]));\n`,
    'b.cjs': `const x = 1;\nexecFileSync('${PROGRAM}', ['-TERM', String(pid)]);\n`,
  };
  assert.deepEqual(offenders(files), ['a.test.cjs:1', 'b.cjs:2']);
});

test('a shell line that names a signal and then a negative target is found', () => {
  const files = {
    'a.cjs': `run(\`${PROGRAM} -KILL -\${group}\`);\n`,
    'b.cjs': `run('${PROGRAM} -s TERM -$PGID');\n`,
    'c.cjs': `run('${PROGRAM} -9 -12345');\n`,
  };
  assert.deepEqual(offenders(files), ['a.cjs:1', 'b.cjs:1', 'c.cjs:1']);
});

test('a signal sent by the runtime, or by a shell to a positive target, is left alone', () => {
  const files = {
    'a.cjs': `process.${PROGRAM}(-child.pid, 'SIGKILL');\nchild.${PROGRAM}('SIGKILL');\n`,
    'b.test.cjs': `const result = mutate(f, "sh -c '${PROGRAM} -9 $$'; exit $?");\n`,
    'c.test.cjs': `commands[2] += '; ${PROGRAM} -9 $PPID';\nconst stop = 'p${PROGRAM} -f lane-runner';\n`,
  };
  assert.deepEqual(offenders(files), []);
});

test('no script or test of the flow hands a negative target to the program', () => {
  const found = offenders(flowSources());
  assert.equal(found.length, 0, refusal(found));
});
