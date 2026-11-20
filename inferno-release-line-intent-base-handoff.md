# Handoff: an intent based on a release line cannot run through run.cjs while the primary checkout stays on main, since the config's base pin wins over the intent's base and claim and ship work only on the branch the primary checkout is on

Row 0ar. Met on the first host on 2026-11-20 by the Omega session of `dossierforge-keeps-a-verified-copy-of-the-record-on-its-own`, the host's first intent planned for its release line `release/0.2`, on the build at `a8873ebb`. Read in the code there and reproduced on `a8873ebb` and the tip `ba31f229` with the script at the end.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of `a8873ebb`, whose `src/` the tip holds byte for byte.

## What is wrong

1. **The config's base wins over the intent's.** `resolveBase` (`S/run-intents.cjs:43-50`) returns `delivery.base_branch` when the config sets it, and only then the intent's own `base_branch`. A host that pins its default base (the first host: `delivery.base_branch: main`, "pinned so the orchestrator never pauses to confirm the base mid-run") silently runs every intent on that base: claim commits to main, the run branch is cut from main and every fold folds main. The more specific setting loses.
2. **Claim and ship work only on the branch the primary checkout is on.** `claim` refuses `NOT_ON_BASE` unless the primary checkout is on the base (`S/run-intents.cjs:245`), and so does `ship` (`S/run-ship.cjs:88-91`), which then merges, pushes and tears down from the primary checkout (`:131-145`). A host whose primary checkout stays on its default branch, as the first host's rule keeps it (a branch guard refuses any switch there), can run no intent on another base.
3. **teardown deletes against the primary's branch.** `teardown` takes `--base` (`S/run-ship.cjs:249`), but `removeWorktree` deletes the run branch with `git branch -d` from the primary (`:186`), which asks the primary's HEAD when the branch has no upstream, so a branch merged into the release line and not into main is refused (row 0ao is the same delete).
4. **The ledger splits.** The claim lands on the release line's ledger, while the primary's ledger still lists the intent `pending` until the release line is merged forward, so `select` on the primary can offer it again.

## Evidence

- The Omega session's FLOW line, 2026-11-20, verbatim: "run.cjs cannot run a release-line intent with the primary checkout on main | evidence: config.yaml delivery.base_branch: main wins over the intent's base_branch (run-intents.cjs resolveBase), and claim and ship refuse unless the primary checkout is on the base (run-intents.cjs:245, run-ship.cjs:89) | workaround: claimed with state-transition.cjs claim-intent in a temp detached release/0.2 worktree and pushed 39091a775, cut the branch from origin/release/0.2, and every run.cjs call gets a config with base_branch release/0.2; ship needs the same hand path, and main's ledger lists this intent pending until the forward merge."
- The claim on the release line: `39091a775` (2026-11-20 20:51:45Z), whose ledger reads `base_branch: release/0.2`, `claimed_by: inferno-intent/dossierforge-keeps-a-verified-copy-of-the-record-on-its-own-20261120T205133Z`. The pin: `.specs-inferno/config.yaml:668` on the host's main and `:423` on `release/0.2`.
- No earlier intent ran on the release line through the runner. The intent merges in `release/0.2`'s history from 2026-11-12 to 2026-11-14 are main's, from before the line was cut; after the cut, release-line work was a cherry-pick of main's ship merge (`7a011e329`, 2026-11-15, "release/0.2: the acceptance intent, cherry-picked from main's ship merge 78b0162b0") or a direct build.
- The script's output on Alpha, 2026-11-20 21:0xZ, on `a8873ebb` and the tip: with the pin, `claim` exits 0 and commits the claim to main, so `origin/release` does not hold it; without the pin, `claim` prints `ERROR [NOT_ON_BASE] the primary checkout is on main, not the base branch release. Switch it back first.`; the control passes.
- Cost: every release-line intent is a hand claim, a hand config, a hand ship and a hand teardown, each a place to get the ledger or the merge wrong, on the line that ships to customers.

## How to fix

1. **The intent's base wins.** In `resolveBase`, an intent's `base_branch` comes first and `delivery.base_branch` is the default for an intent that names none. A caller with no intent at hand (teardown, `resolveBase(config, null, primary)`) takes it from the run branch's intent (`intentOf(branch)`) in the tree's ledger.
2. **Claim and ship on a base the primary checkout is not on run in a worktree of that base.** Where the primary checkout is on another branch, `claim` and `ship` add a linked worktree detached at `origin/<base>` (fetched first), do there what they do in the primary today (claim: write the ledger, commit, push `HEAD:<base>`; ship: fold, merge `--no-ff` with its `exception:` lines, push `HEAD:<base>`, prove the tip an ancestor of `origin/<base>`), then remove that worktree. The primary checkout's branch and files are never touched. `NOT_ON_BASE` stays only for a host with no remote.
3. **The delete asks the base.** `removeWorktree` deletes against `origin/<base>`, so a branch merged into a base that is not the primary's HEAD is deleted (with row 0ao: set the branch's upstream to `origin/<base>` before `git branch -d`, which then asks it).
4. **select reads the base's ledger.** For an intent whose `base_branch` is not the primary's branch, `select` and `claim` read its entry in `origin/<base>:.specs-inferno/state.yaml`, so a claim on the release line is seen from main before the forward merge.

Tests, beside the `claim` and `ship` suites (`S/run.test.cjs`, `S/run-ship.test.cjs`); no suite pins `NOT_ON_BASE` today, with the run fixture and a `release` branch on its bare origin. The script's two cases are red on `a8873ebb` and the tip and its control green; after the fix all three are green, and:

- `ship` of an intent based on `release`, with the primary on main, merges into `origin/release`, leaves the primary on main with its files unchanged, and deletes the run branch.
- `select` on the primary does not offer an intent its base's ledger holds `in_progress`.
- An intent that names no base runs on `delivery.base_branch` as today.

## Which part is the flow and which the host

The defect is the flow's. The host's part, not for the builder of the row: once point 1 is installed, the pin `delivery.base_branch: main` is harmless and can stay; the host merges `release/0.2` forward into main as it does today, which brings the release-line ledger to main.

## Until it is built

On the host: claim a release-line intent with `state-transition.cjs claim-intent` in a temp worktree detached at `origin/release/0.2`, push it, cut the run branch from `origin/release/0.2`, and pass every `run.cjs` call a config whose `delivery.base_branch` is `release/0.2`. Ship by hand from a temp worktree detached at `origin/release/0.2` under the host's main lock (merge `--no-ff`, push `HEAD:release/0.2`, prove the ancestor), then point the run branch's upstream at `origin/release/0.2` and run `run.cjs teardown --tree <tree> --base release/0.2 --config <cfg>` from the primary. No session on main claims the intent while main's ledger lists it `pending`.

## The script

Run with `S=<scripts folder of the flow> node --test --test-reporter=tap <file>`. One second on Alpha. It uses the flow's own run fixture, whose config pins `delivery.base_branch: main` as the first host's does.

```js
'use strict';

// An intent planned for a release line names base_branch: release, while the primary checkout stays
// on main, as a host's rule keeps it. The host's config pins delivery.base_branch: main, and
// resolveBase takes that pin over the intent's own base; without the pin, claim still refuses
// because the primary checkout is not on the base. So no intent can run on a release line through
// the runner. Run with S=<the scripts folder of the flow to test> node --test --test-reporter=tap <file>.

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { CONFIG, STATE, git, repo, run } = require(path.join(process.env.S, 'run-fixture.cjs'));

const shown = (result) => result.out + result.err;

/** A host whose intent alpha is based on release, with the primary checkout on main. */
function releaseLine({ pinned }) {
  const config = pinned ? CONFIG : CONFIG.replace(/\n[ \t]*base_branch: main[^\n]*/, '');
  const fixture = repo({ state: STATE.replace('base_branch: main', 'base_branch: release'), config });
  git(fixture.root, ['branch', 'release']);
  git(fixture.root, ['push', '-q', 'origin', 'release']);
  return fixture;
}

function claimsOnRelease(fixture) {
  const result = run(fixture, ['claim', 'alpha']);

  assert.equal(result.code, 0, shown(result));
  assert.equal(git(fixture.root, ['branch', '--show-current']).trim(), 'main');
  git(fixture.root, ['fetch', '-q', 'origin']);
  assert.match(git(fixture.root, ['log', '-1', '--format=%s', 'origin/release']), /claim intent for run/);
}

test('an intent based on release claims onto release while the primary stays on main, config pin and all', () => {
  claimsOnRelease(releaseLine({ pinned: true }));
});

test('an intent based on release claims onto release with no pin in the config', () => {
  claimsOnRelease(releaseLine({ pinned: false }));
});

test('control: an intent based on main claims with the primary on main', () => {
  const fixture = repo();

  const result = run(fixture, ['claim', 'alpha']);

  assert.equal(result.code, 0, shown(result));
});
```
