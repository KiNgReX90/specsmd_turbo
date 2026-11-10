/**
 * AI-DLC Turbo - the Code Scaffold in the flow's instructions.
 *
 * Inception draws the Code Scaffold before anything is built: the explorers
 * report where the new code lands, plan draws every part from their findings
 * with its evidence and invents nothing, every arrow into existing code
 * carries its proof (or what the change adds), the cross-checker checks the
 * drawing against the code and the touches, the approval offers "The Code
 * Scaffold is wrong" and asks the open choices in its prompt, and the
 * builder and the reviewer hold the build to it. On a real run a Turbo
 * intake invented two new rights while existing ones sufficed. The scaffold
 * is the approved starting point, never updated: the builder reports where
 * it deviates in two fixed build-notes lines, puts a new right, table or
 * module to the human first, and finish relays the overview's one-line
 * summary of the deviations.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');

const read = (rel: string) => readFileSync(path.join(FLOW, rel), 'utf8');
/** The file with every run of whitespace collapsed, so a phrase may wrap. */
const flat = (rel: string) => read(rel).replace(/\s+/g, ' ');

describe('aidlc-turbo Code Scaffold', () => {
  /** The text of one `### n.` section of a skill, whitespace collapsed. */
  const section = (rel: string, heading: string) => {
    const text = flat(rel);
    const at = text.indexOf(heading);
    expect(at, `${rel}: ${heading}`).toBeGreaterThan(-1);
    const next = text.indexOf('### ', at + heading.length);
    return text.slice(at, next === -1 ? undefined : next);
  };
  const LANDS = "Where does this area's new code land? For every part it adds or changes, name the module it goes in, how that module is laid out and where it is registered in the build, and for a new part the existing one to copy, with file and lines, or say that none fits.";
  const BUILDERS = ['commands/aidlc-turbo-builder.md', 'commands/aidlc-turbo-builder-low.md', 'skills/construction/build-story.md'];

  it('the explorers report where the new code lands: the module, where it is registered and an example, with file and lines', () => {
    const intake = flat('skills/inception/intake.md');
    expect(intake).toContain('The first three are always, word for word');
    expect(intake).toContain(LANDS);
    expect(intake).toContain('The `lands_in` answers go with the rows');
    expect(intake).toContain('`plan.md` draws the Code Scaffold from these rows');

    const explorer = flat('commands/aidlc-turbo-explorer.md');
    expect(explorer).toContain('The first three are always the standard ones');
    expect(explorer).toContain(LANDS);
    expect(explorer).toContain('## Where the new code lands');
    expect(explorer).toContain('`shop-parent/pom.xml` and `shop-app/pom.xml`');
    for (const key of ['lands_in:', 'registered_in:', 'follows:']) expect(explorer).toContain(key);
    expect(explorer).toContain('unanswered: where does {part} land');
    // Plan asks an explorer where an existing part is, before the approval.
    expect(explorer).toContain('A **place check**');
    expect(flat('agents/inception-agent.md')).toContain('and where its new code lands');
  });

  it('plan draws the Code Scaffold from the findings, with evidence, and invents nothing', () => {
    const plan = flat('skills/inception/plan.md');
    const at = plan.indexOf('### 4c. Draw the Code Scaffold');
    expect(at).toBeGreaterThan(plan.indexOf('### 4b. Write the overview data'));
    expect(at).toBeLessThan(plan.indexOf('### 5. Pick the lane'));
    const draw = section('skills/inception/plan.md', '### 4c. Draw the Code Scaffold');
    for (const key of ['`technical_design.drawing`', '`builds`', '`uses`', '`summary`', '`follows`', '`registered_in`', '`open`', '`open_detail`', '`doubt`', '`deviates`']) {
      expect(draw).toContain(key);
    }
    expect(draw).toContain('Nothing is invented');
    expect(draw).toContain('in the order they call each other');
    expect(draw).toContain('never from your feeling, and you can only lower it');
    expect(draw).toContain('A new right always names the decision that creates it');
    // Every existing or changed part has its place checked before the approval.
    expect(draw).toContain('never from memory or from a name alone');
    expect(draw).toContain('as a place check');
    expect(plan).toContain('**The Code Scaffold is wrong** at the approval -> step 4c');
  });

  it('every part says in a few sentences what it is and does, for the details a click opens', () => {
    const plan = flat('skills/inception/plan.md');
    expect(plan).toContain('`what`, two to four plain sentences on what the part is and does');
    expect(plan).toContain('`sub`, a few words under its name in the drawing');
    expect(plan).toContain("Every text of the drawing is in the record's language.");
    // The record template's example parts carry such a what, not a bare label.
    const examples = read('templates/inception/record-template.yaml').split('\n').filter((l) => /^\s*#\s+- \{ id: \w+, name: .*layer:/.test(l));
    expect(examples.length).toBeGreaterThan(0);
    for (const l of examples) expect(l.match(/what: ([^,]+(?:, [^,:]+)*)\./)?.[1].split(' ').length, l).toBeGreaterThan(8);
  });

  it('every link says in one plain sentence what happens in its step, for the card over the drawing', () => {
    expect(flat('skills/inception/plan.md')).toContain('`step`, one plain sentence on what happens in this step');
    expect(read('templates/inception/record-template.yaml')).toMatch(/- \{ from: login, to: users, .*step: /);
  });

  it('the cross-checker checks the drawing against the code and the touches', () => {
    expect(flat('skills/inception/cross-check.md')).toContain(
      'a part drawn new that already exists, a part a story builds whose path is outside that story\'s `touches`, two parts that call each other without a link, and an arrow whose proof does not show what is called',
    );
    const checker = flat('commands/aidlc-turbo-cross-checker.md');
    expect(checker).toContain('**The drawing check**');
    expect(checker).toContain('A part the Code Scaffold draws as new that already exists');
    expect(checker).toContain('whose path is not in that story\'s `touches`');
    expect(checker).toContain('two parts that call each other with no link between them');
    // Still six kinds: the drawing findings are gaps and wrong assumptions.
    expect(checker).toContain('**Look for six kinds of problem**');
  });

  it('the approval offers The Code Scaffold is wrong, as the page names it, and asks the open choices in its prompt', () => {
    const ask = section('skills/inception/review.md', '### 3. Ask whether everything is right');
    expect(ask).toContain("- **The Code Scaffold is wrong**: word for word as the overview page names it, in the record's language (`design.legend.asks.option` of its string table");
    expect(ask).toContain('**The open choices of the Code Scaffold**');
    expect(ask).toContain('are asked in the same prompt, one question each after the approval question');
    expect(ask).toContain('The open choices of the Code Scaffold are the one exception');
    // The routing rule: back to plan, render, draw again before anything is built.
    const route = section('skills/inception/review.md', '### 4. On change, route back');
    expect(route).toContain('| The Code Scaffold (**The Code Scaffold is wrong**)');
    expect(route).toContain('`plan.md` step 4c');
    expect(route).toContain('so a corrected Code Scaffold is drawn again before anything is built');
  });

  it('every arrow into existing code is proven, never invented', () => {
    const draw = section('skills/inception/plan.md', '### 4c. Draw the Code Scaffold');
    expect(draw).toContain('A call into an `existing` part has `proof`: the `file` and `lines` where the callee already offers what is called');
    expect(draw).toContain('A call into a `changed` part has `proof`, or `adds` when the change to the callee adds what is called');
    expect(draw).toContain('a call it does not offer makes it `changed`, with `adds` on the link');
    expect(draw).toContain('when that is a real choice');
    expect(draw).toContain('it goes back to `intake.md` as a question instead. An arrow is never invented.');
    expect(draw).toContain('not a source of truth: it is never updated after the build');
    // The place check proves the calls too.
    const explorer = flat('commands/aidlc-turbo-explorer.md');
    expect(explorer).toContain('per call into an existing or changed part the two parts and what is called');
    expect(explorer).toContain('`where` the file and lines where the callee offers what is called (the method, the endpoint, the column)');
    expect(explorer).toContain('Never guess a call from a name alone');
    // A real choice comes back to intake as a question.
    const intake = flat('skills/inception/intake.md');
    expect(intake).toContain('An arrow that cannot be proven and is a real choice');
    expect(intake).toContain('An arrow is never drawn on a guess');
    // The cross-checker reads every proof.
    expect(flat('skills/inception/cross-check.md')).toContain('an arrow whose proof does not show what is called');
    const checker = flat('commands/aidlc-turbo-cross-checker.md');
    expect(checker).toContain('An arrow of the Code Scaffold whose proof (the file and lines after it) does not show what is called');
    expect(checker).toContain('when they do not show what is called (the method, the endpoint, the column), that is a `wrong_assumption`');
    expect(flat('agents/inception-agent.md')).toContain('Every arrow into an existing or changed part carries its proof too');
  });

  it('the builder follows the story\'s Code Scaffold and reports every deviation, and the reviewer checks the build against it', () => {
    for (const rel of BUILDERS) {
      const text = flat(rel);
      expect(text, rel).toContain('When the story has a `### Code Scaffold`, build what it says the story builds');
      expect(text, rel).toContain('named in the build notes under **Outside the Code Scaffold** and in `decisions`');
      expect(text, rel).toContain('is named under **Different from the Code Scaffold**, with the reason');
      // The five lines, always, in this order, at the end of the build notes: the overview page after the build reads them.
      expect(text, rel).toContain('- **Built**: A user with an expired session');
      expect(text, rel).toContain("in plain words, in the language of the story's product-team half, which is the record's language");
      expect(text, rel).toContain('- **Outside the Code Scaffold**: none. - **Different from the Code Scaffold**: none. - **Not built**: none. ```');
      expect(text, rel).toContain('The last five lines are always there, in this order');
      expect(text, rel).toContain('**Built**: what the story built in two to four plain sentences, first what a user notices, then the parts that do it');
      // an item says what was built and why, never what was planned: the page takes that from the drawing
      expect(text, rel).toContain('then `{what you built}. Why: {why}`');
      expect(text, rel).toContain('Never repeat what was planned: the page takes that from the drawing');
      expect(text, rel).toContain('- **Outside the Code Scaffold**: - `src/auth/TokenCache.java`: Keeps the session per request. Why: needed because');
      expect(text, rel).toContain('- **Not built**: - `src/auth/SessionAudit.java`: Why:');
      expect(text, rel).toContain('no part it names left unbuilt that they do not name under Not built');
      // an existing part the drawing said to use and that was not used goes there too: the page says "not used"
      expect(text, rel).toContain('Not built: a part it names for this story that you did not build, or an existing part it says to use that you did not use, with its planned path');
      expect(text, rel).toContain('with its planned path as the story\'s `### Code Scaffold` shows it');
      expect(text, rel).toContain('with `(approved during the build)`, in that language, at the end of its reason');
      expect(text, rel).toContain('no part it names built another way that they do not name under Different');
    }
    const review = flat('skills/construction/review.md');
    expect(review).toContain('7. **Code Scaffold**: when the story has one');
    expect(review).toContain('Anything built that it does not name and the build notes do not report under Outside is `major`');
    expect(review).toContain('not reported under Different is `major`');
    expect(review).toContain('not built and not reported under Not built is `major` too');
    expect(review).toContain('that no `scaffold_approved` covers, is `major` even when reported');
    expect(review).toContain('A reported deviation is judged as item 4 judges scope');
  });

  it('a new right, table or module the scaffold does not name is put to the human first', () => {
    for (const rel of BUILDERS) {
      const text = flat(rel);
      expect(text, rel).toContain('Only three cases are `blocked`');
      expect(text, rel).toContain('a new right, a new table or a new module that its Code Scaffold does not name and no `scaffold_approved` covers');
      expect(text, rel).toContain('build none of it and start `notes` with `Code Scaffold:`');
      // scaffold_approved is optional, never one of the required build-mode fields.
      expect(text, rel).toContain('Optional, only on a re-dispatch after a `blocked` on the Code Scaffold: `scaffold_approved`');
      expect(text, rel).toContain('Every build-mode field above must be present, except the optional `scaffold_approved`');
    }
    const dispatch = flat('skills/construction/dispatch.md');
    expect(dispatch).toContain('`blocked` with `notes` starting `Code Scaffold:`');
    expect(dispatch).toContain('(on Claude Code: AskUserQuestion), in plain words in the session language');
    expect(dispatch).toContain('**Yes, build it** first and **No, the story stays blocked**');
    expect(dispatch).toContain('The other stories build on meanwhile');
    expect(dispatch).toContain('plus `scaffold_approved: "{what the human approved, in one line}"`, and pass that field to every review of this story');
    expect(dispatch).toContain('No: the story stays blocked');
    expect(dispatch).toContain('or on the Code Scaffold (a new right, table or module it does not name)');
    expect(flat('skills/construction/review.md')).toContain('Optional: `scaffold_approved`');
    expect(flat('agents/construction-agent.md')).toContain('when it needs a new right, table or module that its Code Scaffold does not name');
  });

  it('finish relays the overview\'s one-line summary of where the build deviated', () => {
    const overview = section('skills/construction/finish.md', '### 8. Overview');
    expect(overview).toContain("one line in the record's language, in English `Code Scaffold: built as planned` or `Code Scaffold: {n} different from the design, {m} added`, with `, {k} not built or used` after it when parts of it were not built or not used: keep it verbatim for the summary");
    expect(flat('skills/construction/finish.md')).toContain('Code Scaffold: 1 different from the design, 2 added');
    const finish = flat('skills/construction/finish.md');
    expect(finish).toContain('The `Code Scaffold: ...` line is the one step 8 printed, verbatim');
  });

  it('the docs name the Code Scaffold, how to correct it, and that it is a starting point', () => {
    for (const rel of ['README.md', 'PRD.md', 'skills/master/explain-flow.md', 'agents/inception-agent.md']) {
      expect(flat(rel), rel).toContain('Code Scaffold');
    }
    for (const rel of ['README.md', 'skills/master/explain-flow.md', 'agents/inception-agent.md']) {
      expect(flat(rel), rel).toContain('The Code Scaffold is wrong');
    }
    expect(flat('agents/inception-agent.md')).toContain('| Code Scaffold |');
    expect(flat('README.md')).toContain('The scaffold is the approved starting point of the code');
    expect(flat('README.md')).toContain('where the build deviated from it and why');
    expect(flat('skills/master/explain-flow.md')).toContain('not a source of truth');
    expect(flat('skills/master/explain-flow.md')).toContain('see where the build deviated from it and why');
    expect(flat('PRD.md')).toContain('never updated, with where the build deviated from it and why');
  });
});
