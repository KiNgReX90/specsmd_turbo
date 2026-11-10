/**
 * specsmd AI-DLC Turbo - what a test file is, and what switches a test off.
 *
 * Shared by story-verify.cjs (which existing tests a story changed, and which
 * added line switches a test off) and story-mutate.cjs (a mutant never breaks
 * a test file). Test files are known by path only:
 *
 *   JS/TS    *.test.*, *.spec.*, anything under a __tests__/ folder
 *   Java     *Test.java, *Tests.java, *IT.java, anything under src/test/
 *   Python   test_*.py, *_test.py, anything under a tests/ or test/ folder
 *   Go       *_test.go
 *   any      anything under codebase.playwright_test_dir of repo.yaml
 *
 * A switch-off marker is `.skip(`, `.only(` or `.todo(` on it, test, describe,
 * context or suite; it.fails( and test.fails( (vitest); xit(, xdescribe(,
 * xtest(, fit(, fdescribe(; @Disabled, @Ignore; @pytest.mark.skip (and
 * skipif), @pytest.mark.xfail, @unittest.skip, pytest.skip(, pytest.xfail(;
 * and Go's t.Skip( (also t.Skipf( and t.SkipNow(). Each one mutes a red test.
 *
 * touchFiles gives test files a newer modification time, so an incremental
 * build compiles them again (story-mutate.cjs, around every mutant run).
 *
 * Node builtins only: the target project often has no node_modules at all.
 */

const fs = require('fs');
const path = require('path');

const SWITCH_OFF = [
    /\b(?:it|test|describe|context|suite)\.(?:skip|only|todo)(?:\.each)?\s*\(/,
    /\b(?:it|test)\.fails(?:\.each)?\s*\(/,
    /(?<![\w$.])(?:xit|xdescribe|xtest|fit|fdescribe)\s*\(/,
    /@(?:Disabled|Ignore)\b/,
    /@pytest\.mark\.(?:skip|xfail)/,
    /@unittest\.skip/,
    /\bpytest\.(?:skip|xfail)\s*\(/,
    /\bt\.Skip(?:f|Now)?\s*\(/,
];

/** A path with forward slashes and no leading `./` or trailing `/`. */
const normPath = (p) => String(p || '').trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');

/** True when the repo-relative path is a test file, by its name or folder. */
function isTestFile(relPath, playwrightDir = null) {
    const file = normPath(relPath);
    const parts = file.split('/');
    const name = parts[parts.length - 1];
    const folders = parts.slice(0, -1);
    const pw = normPath(playwrightDir);
    if (pw && file.startsWith(`${pw}/`)) return true;
    if (/\.(?:test|spec)\./.test(name)) return true;
    if (/(?:Test|Tests|IT)\.java$/.test(name)) return true;
    if (/^test_.*\.py$/.test(name) || /_test\.py$/.test(name)) return true;
    if (/_test\.go$/.test(name)) return true;
    if (folders.some((f) => f === '__tests__' || f === 'tests' || f === 'test')) return true;
    return false;
}

/** True when the line switches a test off. */
function isSwitchOff(line) {
    const text = String(line);
    return SWITCH_OFF.some((re) => re.test(text));
}

/**
 * Give every file under `dir` a modification time later than its last one, so
 * an incremental build compiles it again: Java copies a `static final`
 * constant into every class that uses it, and Maven recompiles a test only when
 * its own source changed. A missing file is skipped; the content never changes.
 */
function touchFiles(dir, files) {
    for (const file of files) {
        const abs = path.resolve(dir, file);
        let stat;
        try { stat = fs.statSync(abs); } catch { continue; }
        const at = new Date(Math.max(Date.now(), stat.mtimeMs + 1));
        fs.utimesSync(abs, at, at);
    }
}

module.exports = { SWITCH_OFF, normPath, isTestFile, isSwitchOff, touchFiles };
