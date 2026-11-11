'use strict';

/**
 * A mutant counted once. Pure functions over the rounds of one item, oldest first.
 *
 * On the released flow every round planted new mutants, so the sum of the mutants each recorded
 * version lists was the number run. On the current flow a later round carries the last round's
 * mutants over and runs only the survivors and the proposals that never ran, and the file does
 * not say which of its mutants ran in this record. So a mutant that names the code it breaks
 * (`find`) is keyed by its criterion, find and replace: its first listing makes it a distinct
 * mutant, and a listing counts as run when it carries a verdict (`caught`) that differs from the
 * verdict its key carried before. File, line and test are left out of the key because the flow
 * rewrites them on the same mutant: the runner writes the new line of a line that moved, a line
 * that moved to another file is followed there, and a survivor may be given another test. The
 * flow's own identity of a mutant (`sameMutant` in run-review-file.cjs) has no line either. A survivor run again that survives again reads the
 * same and is not counted again: the file cannot tell it from a carried one.
 *
 * A mutant that names no code is the released flow's `{criterion, test, caught}`, which its
 * reviewer planted and ran itself: every listing of one is distinct and, with a verdict, run,
 * which is how the readout counted it before.
 */

const targeted = (mutant) => mutant.find !== undefined;

/** The key of a mutant that names the code it breaks: what it breaks, how, and for which criterion. */
const keyOf = (mutant) => JSON.stringify([mutant.criterion, mutant.find, mutant.replace]
  .map((value) => (value === undefined || value === null ? '' : String(value))));

const VERDICTS = ['yes', 'no', 'none'];
const verdictOf = (mutant) => (VERDICTS.includes(mutant.caught) ? mutant.caught : null);

/**
 * Each round's mutants split three ways: `fresh`, the listings that are a distinct mutant for the
 * first time; `ran`, the listings counted as run; `survived`, those of `ran` that read caught: no.
 */
function countRounds(mutantLists) {
  const last = new Map();
  return mutantLists.map((mutants) => {
    const fresh = [];
    const ran = [];
    for (const mutant of mutants) {
      const verdict = verdictOf(mutant);
      if (!targeted(mutant)) {
        fresh.push(mutant);
        if (verdict !== null) ran.push(mutant);
        continue;
      }
      const key = keyOf(mutant);
      if (!last.has(key)) fresh.push(mutant);
      if (verdict !== null && last.get(key) !== verdict) ran.push(mutant);
      last.set(key, verdict);
    }
    return { fresh, ran, survived: ran.filter((mutant) => mutant.caught === 'no') };
  });
}

module.exports = { countRounds, keyOf };
