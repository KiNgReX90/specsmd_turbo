# Handoff: a lane red the host proved intermittent has no recorded exception

Not built. This file is the whole handoff.

## What is wrong

A lane has two ways to hold: green, or an instrument red (exit 11) accepted against a harness fix on the base (`run-lanes.cjs` `accept`, line 259). A product red (exit 10) has no accept. That is right for a red the branch caused. It is wrong for a red the host lane itself classified as intermittent: red on the branch, green on the base, and green again when the lane re-walked it on the branch. The lane prints that verdict and still exits 10, so the gate can only be held by walking the whole lane again and hoping. The lead's exception lives in prose and in a hand-written `exception:` line in the ship commit. No record binds it to the proof hash, and `gate --wait` keeps printing RED for a lane the lead already cleared.

A second, smaller gap: while the gate job still runs its finalize commands, `gate --detach` refuses with `GATE_RUNNING`, and there is no call that starts one lane again on its own. The `--lanes-only` mode on this branch starts every touched lane, not one.

## Evidence (Skoft_CRA, 2026-11-10)

- Intent `the-vulnerability-handling-policy-states-every-duty-it-claims`, tree at `17fef466a`, merge base `5204516`.
- The smoke lane log `lane-smoke-20261110T090717Z.log` (4463 s) ends: `PRODUCT RED integration/smoke.test.mjs "TC-232 startup covers the entire handoff through held frontend loading and actual settlement": red on the branch, green on base 5204516; walked again on the branch: passed, so the red is intermittent`. Exit 10, result `product-red`.
- The intent's diff touches policy templates, the definitions pack and dossier tests. Nothing in it reaches startup. The same case went red for another intent on 2026-10-31 (`the-register-and-the-privacy-page-settle-sl-06`, `lane-smoke-20261031T115529Z.log`), and a host finding of 2026-09-05 names it as a race under load.
- The lead cleared it as a one-time exception and asked for exactly one more walk. Starting that walk took a hand call to `run-jobs.cjs` `detach` with the same arguments `startLanes` uses, because `gate --detach` refused with `GATE_RUNNING` (the gate job was still in its finalize commands).
- Cost: one more full smoke walk, about 75 minutes of a remote box, for a verdict the first walk already held.

## How to fix

1. Add `run.cjs smoke --accept-intermittent --test "<name>" --reason "<why>" --by <lead>`. It refuses unless the last lane result is `product-red` and the lane's verdicts file (the host already writes `verdicts.json`) marks every red test as intermittent: red first, green on the base, green on the re-walk. It writes an accepted record beside the lane proof, bound to the same proof hash, with the test names, the reason, the signer and both log paths. `describeLane` then prints `ACCEPTED lane smoke intermittent: <test>` and holds. `ship` copies the record into the ship commit as one `exception:` line, so no one writes it by hand.
2. A second accept of the same test name on a later intent prints the earlier records (the record dir is the ledger). Two accepts of the same test is the signal that the race is a defect to fix on the host, so `ship` refuses a third until a host commit names the test in its `Cases:` line.
3. Add `gate --detach --lane <name>`: starts that one lane through `startLanes`' own `detach` call while the gate job runs, and refuses only when that lane is already running.

Tests: a lane result `product-red` with a verdicts file marking the red as intermittent, then the accept, makes `gate --wait` exit 0. The same accept against a verdicts file with a red that the re-walk did not clear refuses. An edit to the tree after the accept drops it (hash changed). `gate --detach --lane smoke` while the gate job runs starts only smoke.
