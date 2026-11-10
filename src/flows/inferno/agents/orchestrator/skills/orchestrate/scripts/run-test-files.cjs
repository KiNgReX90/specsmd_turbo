'use strict';

/**
 * What a test file is, which added line switches a test off, and which lines a diff adds:
 * the rules verify-item reads for an item's `tests_changed` (run-item-proof.cjs). Ported from
 * the Turbo flow's rules, plus the Rust and node runners the INFERNO scripts run.
 *
 * A test file is known by its path only:
 *
 *   JS/TS    *.test.*, *.spec.*, anything under a __tests__/ folder, and node's
 *            *-test.{js,cjs,mjs} and *_test.{js,cjs,mjs}
 *   Java     *Test.java, *Tests.java, *IT.java, anything under src/test/
 *   Python   test_*.py, *_test.py, anything under a tests/ or test/ folder
 *   Go       *_test.go
 *   Rust     tests.rs, *_test.rs, *_tests.rs, anything under a tests/ folder
 *
 * A switch-off marker is `.skip(`, `.only(` or `.todo(` on it, test, describe, context or
 * suite; it.fails( and test.fails( (vitest); xit(, xdescribe(, xtest(, fit(, fdescribe(;
 * @Disabled, @Ignore; @pytest.mark.skip (and skipif), @pytest.mark.xfail, @unittest.skip,
 * pytest.skip(, pytest.xfail(; Go's t.Skip( (also t.Skipf( and t.SkipNow(); node --test's
 * `skip`, `todo` or `only` option set to anything but false, and its t.skip( and t.todo(;
 * and cargo's #[ignore] attribute, also under cfg_attr. Each one mutes a red test. The list
 * is fixed here, not configured per host.
 *
 * Node builtins only: the scripts run inside projects with no node_modules.
 */

const SWITCH_OFF = [
  /\b(?:it|test|describe|context|suite)\.(?:skip|only|todo)(?:\.each)?\s*\(/,
  /\b(?:it|test)\.fails(?:\.each)?\s*\(/,
  /(?<![\w$.])(?:xit|xdescribe|xtest|fit|fdescribe)\s*\(/,
  /@(?:Disabled|Ignore)\b/,
  /@pytest\.mark\.(?:skip|xfail)/,
  /@unittest\.skip/,
  /\bpytest\.(?:skip|xfail)\s*\(/,
  /\bt\.Skip(?:f|Now)?\s*\(/,
  // node --test: test('x', { skip: true }, ...) and the test context's t.skip() and t.todo().
  /\b(?:it|test|describe|suite)\s*\(\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`|[\w$.]+)\s*,\s*\{[^}]*?\b(?:skip|todo|only)\s*:\s*(?!(?:false|0|null|undefined)\s*[,}])[^\s,}]/,
  /(?<![\w$.])t\.(?:skip|todo)\s*\(/,
  // cargo test: #[ignore], #[ignore = "why"], #[cfg_attr(windows, ignore)].
  /^\s*#\[\s*(?:ignore\b|cfg_attr\s*\(.*\bignore\b)/,
];

/** A path with forward slashes and no leading `./` or trailing `/`. */
const normPath = (file) => String(file || '').trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');

/** True when the repo-relative path is a test file, by its name or folder. */
function isTestFile(relPath) {
  const parts = normPath(relPath).split('/');
  const name = parts[parts.length - 1];
  const folders = parts.slice(0, -1);
  if (/\.(?:test|spec)\./.test(name)) return true;
  if (/[-_]test\.[cm]?js$/.test(name)) return true;
  if (/(?:Test|Tests|IT)\.java$/.test(name)) return true;
  if (/^test_.*\.py$/.test(name) || /_test\.py$/.test(name)) return true;
  if (/_test\.go$/.test(name)) return true;
  if (name === 'tests.rs' || /_tests?\.rs$/.test(name)) return true;
  return folders.some((folder) => folder === '__tests__' || folder === 'tests' || folder === 'test');
}

/** True when the line switches a test off. */
function isSwitchOff(line) {
  const text = String(line);
  return SWITCH_OFF.some((pattern) => pattern.test(text));
}

/** The lines a zero-context unified diff of one file adds: [{ line, text }], 1-based in the new file. */
function parseAddedLines(diff) {
  const out = [];
  let oldLeft = 0;
  let newLeft = 0;
  let next = 0;
  for (const raw of String(diff).split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      if (raw.startsWith('+')) {
        out.push({ line: next, text: raw.slice(1).replace(/\r$/, '') });
        next += 1;
        newLeft -= 1;
      } else if (raw.startsWith('-')) {
        oldLeft -= 1;
      } else if (raw.startsWith(' ')) {
        next += 1;
        oldLeft -= 1;
        newLeft -= 1;
      }
      continue;
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (!hunk) continue;
    oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
    next = Number(hunk[2]);
    newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
  }
  return out;
}

module.exports = { SWITCH_OFF, isSwitchOff, isTestFile, normPath, parseAddedLines };
