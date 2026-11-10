/**
 * specsmd AI-DLC Turbo - the marker of a running mutant, so a kill never
 * leaves one behind.
 *
 * A kill (a tool timeout, Esc, SIGKILL) skips every `finally`, and the mutant
 * would stay in the worktree: the next story-verify.cjs would hash it into
 * the proof and story-land.cjs could commit it. So before story-mutate.cjs
 * writes a mutant it writes `{proof dir}/{SSS}.mutant.json`:
 *
 *   { file (absolute), original_sha, mutated_sha, original (base64) }
 *
 * and deletes it only after a checked restore. story-verify.cjs (story runs)
 * and story-mutate.cjs call recoverMarker first:
 * - the file still holds the mutant: the original goes back, is checked, the
 *   marker goes, and the note `restored {file}: a mutant run was cut off`;
 * - the file is already the original: only the marker goes;
 * - anything else: an error, and the file and the marker stay as they are.
 *
 * Node builtins only: the target project often has no node_modules at all.
 */

const fs = require('fs');
const path = require('path');
const { sha256, restore } = require('./mutants.cjs');

/** `{proof dir}/{SSS}.mutant.json`. */
const markerPath = (proofDir, storyId) => path.join(proofDir, `${storyId}.mutant.json`);

/** Write the marker before the mutant goes into the file. */
function writeMarker(marker, file, original, mutated) {
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    const record = { file, original_sha: sha256(original), mutated_sha: sha256(mutated), original: original.toString('base64') };
    fs.writeFileSync(marker, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

/** Delete the marker; only after a checked restore. */
const clearMarker = (marker) => fs.rmSync(marker, { force: true });

/**
 * Run fn with the mutated bytes in the file: the marker first, the mutant,
 * then in a `finally` the checked restore, and only then the marker goes. A
 * failed restore throws (code RESTORE) and leaves the marker.
 */
function withMutant(file, original, mutated, marker, fn) {
    writeMarker(marker, file, original, mutated);
    try {
        fs.writeFileSync(file, mutated);
        return fn();
    } finally {
        restore(file, original);
        clearMarker(marker);
    }
}

/** Undo what a cut-off mutant run left. Returns {}, { note } or { error }. */
function recoverMarker(proofDir, storyId) {
    const marker = markerPath(proofDir, storyId);
    if (!fs.existsSync(marker)) return {};
    let record;
    try {
        record = JSON.parse(fs.readFileSync(marker, 'utf8'));
    } catch {
        return { error: `a cut-off mutant run left a marker that cannot be read: ${marker}` };
    }
    const { file } = record;
    const current = file && fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null;
    if (current && current === record.original_sha) {
        clearMarker(marker);
        return {};
    }
    const original = Buffer.from(String(record.original || ''), 'base64');
    if (!current || current !== record.mutated_sha || sha256(original) !== record.original_sha) {
        return { error: `a cut-off mutant run left ${file} changed since: compare it with ${marker} by hand` };
    }
    try {
        restore(file, original);
    } catch (error) {
        return { error: error.message };
    }
    clearMarker(marker);
    return { note: `restored ${file}: a mutant run was cut off` };
}

module.exports = { markerPath, writeMarker, clearMarker, withMutant, recoverMarker };
