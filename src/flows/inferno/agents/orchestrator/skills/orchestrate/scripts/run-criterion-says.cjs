'use strict';

/**
 * The words a review repeats of the acceptance criterion it names, under `says`.
 *
 * A reviewer that numbers its mutants in the order it wrote them, past a criterion it skipped,
 * credits every later one to the wrong criterion, and the number alone parses. So the dispatch of a
 * first item review prints each criterion with its number and its opening words, and each mutant
 * and pin of that review repeats the opening words of the criterion it names. The runner compares
 * them with the criterion at that number and refuses the file on a mismatch, naming the number
 * whose text does open with those words; a refusal never prints the words of the number written,
 * which a reviewer would copy back and pass.
 *
 * The comparison reads words only: letters and digits in lower case, so case, blanks, punctuation,
 * markdown marks and a link's target never matter. `says` holds at least `SAYS_MIN` words (the
 * whole criterion when it has fewer), every one of them the criterion's own from its first word
 * on, and no other criterion of the item may open with the same words unless they are the whole
 * criterion named. A neighbour's text then never passes, however alike two criteria start.
 */

const SAYS_MIN = 3;
/** The words the dispatch shows of each criterion, more when another criterion opens the same way. */
const OPENING = 6;

/** The words of a text as the comparison reads them. */
function wordsOf(text) {
  return String(text).normalize('NFKC').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').toLowerCase()
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Whether the words `criterion` opens with are `said`. */
const opens = (criterion, said) => said.length <= criterion.length && said.every((word, index) => criterion[index] === word);

/** The opening of criterion `index` as the dispatch shows it: its first words, as many as tell it from every other. */
function opening(criteria, index) {
  const all = criteria.map(wordsOf);
  const written = String(criteria[index]).trim().split(/\s+/);
  let count = Math.min(OPENING, written.length);
  const alike = (words) => all.some((other, at) => at !== index && opens(other, words));
  while (count < written.length && alike(wordsOf(written.slice(0, count).join(' ')))) count += 1;
  return written.slice(0, count).join(' ');
}

/** The dispatch lines of a first item review: each criterion by its number, with the words its entries repeat. */
function criteriaLines(criteria) {
  if (criteria.length === 0) return [];
  return [
    '  criteria: each mutant and pin names one by its number below and repeats under says the words shown beside it',
    ...criteria.map((text, index) => `  criterion ${index + 1} says ${JSON.stringify(opening(criteria, index))}`),
  ];
}

/**
 * What is wrong with `says`, the words an entry repeats of criterion `n` of `itemId`, or null.
 * `criteria` are the item's acceptance criteria in order.
 */
function saysProblem(itemId, criteria, n, says) {
  const all = criteria.map(wordsOf);
  const said = wordsOf(says);
  if (said.length === 0) return `says holds no word; repeat the opening words of criterion ${n} as the dispatch shows them`;
  const fits = all.map((words, index) => (opens(words, said) ? index + 1 : null)).filter(Boolean);
  if (!fits.includes(n)) {
    if (fits.length === 0) {
      return `says ${JSON.stringify(says)}, and no acceptance criterion of ${itemId} opens with those words; ` +
        'repeat the opening words of the criterion it names, as the dispatch shows them beside its number';
    }
    const which = fits.length === 1 ? `criterion ${fits[0]}` : `criteria ${fits.join(', ')}`;
    return `names criterion ${n}, and its says is how ${which} opens: name it ${fits.join(' or ')} when that is the criterion ` +
      `it proves, else repeat the opening words of criterion ${n}`;
  }
  const own = all[n - 1];
  const least = Math.min(SAYS_MIN, own.length);
  if (said.length < least) return `says holds ${said.length} word${said.length === 1 ? '' : 's'}; repeat at least ${least} of the criterion's opening words`;
  const others = fits.filter((m) => m !== n);
  if (others.length > 0 && said.length < own.length) {
    return `says opens criteria ${[n, ...others].sort((a, b) => a - b).join(' and ')} alike; repeat more of the words of criterion ${n}`;
  }
  return null;
}

/** The refusal of an entry of a first item review that repeats no words of its criterion. */
const NO_SAYS = 'has no says: repeat the opening words of the criterion it names, as the dispatch shows them beside its number, ' +
  'so a number counted wrong is caught';

module.exports = { NO_SAYS, SAYS_MIN, criteriaLines, opening, saysProblem, wordsOf };
