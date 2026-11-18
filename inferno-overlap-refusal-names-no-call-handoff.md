# Handoff: two dispatches whose frozen ownership overlaps start side by side without a word, and the refusal verify-item gives afterwards does not print the call that clears it

Row 0ae. Met on the first host on 2026-11-18, on the build at `f3be640a`. Read in the code there and at `1f7a2c07`, and reproduced on both with the script at the end: the tip behaves the same.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of `1f7a2c07`.

## What is wrong

A way on exists, and the runner knows it. It does not say it, and it lets the state arise without a word. A session on the first host read the refusal as final, stopped the item and asked for a hand edit of the signed records.

1. **`dispatch-log` records a dispatch that overlaps an open one, and says nothing.** `dispatchLog` (`S/run-intents.cjs:342`) reads no open record. The orchestrator's text forbids the dispatch (`agents/orchestrator/agent.md:60`, "Never dispatch two items whose `ownership.editable` overlaps"), and the runner, which holds every open record and its frozen ownership, lets it through with exit 0.
2. **A correction named for one item takes its chain's ownership, and only the `logged` line shows it.** `coveredItems` (`S/run-dispatch.cjs:187`) widens `--item b` to every item b's current record covers (`S/run-intents.cjs:352`). The orchestrator asked for an item that owns no shared file and got a dispatch that owns one. The only sign is the list in `logged b, a -> <log>` (`:375`).
3. **The refusal names a remedy in words that read as too late.** Once both are accepted, `verify-item` of the first chain stops in `checkPeerChange` (`S/run-peers.cjs:167-176`): the peer's accepted change to the shared file lies in a stretch beside one of the chain's attempts (`ranBeside`, `:58`). A fresh `dispatch-log` of the chain does not clear it, since that attempt stays in the lineage. The text says "a serial chain one builder builds takes one dispatch-log for all its items, with --items a,b". That reads as a rule for before the dispatch, and both dispatches were chains already. It is in fact the step that clears it afterwards: one `dispatch-log` over an item of each chain joins their histories (`histories`, `S/run-peers.cjs`), `accept-dispatch` with an empty list closes it, and the peer's attempts are then the chain's own. `run.cjs grant` prints that very call in its own refusal (`checkBeside` in `S/run-grant.cjs`, through `chainDispatchCall`). `verify-item` prints no call, no accept and no word that it works after the fact.

## Evidence

The session's line, Delta session c1, intent `candidate-1-the-ground`, mail line 138 of 2026-11-18: "verify-item has no recovery after two correction dispatches ran side by side with overlapping frozen ownership ... 'dispatch ownership overlaps at src-tauri/src/commands/license.rs with dispatch 30d58bf4': the dispatch log keeps that window, so neither a fresh dispatch-log (faa344fb) nor a revert clears it ... workaround: none I can take without editing the dispatch log".

Read on Delta on 2026-11-18 18:26Z to 18:40Z, nothing run there. The tree is `~/dev/Skoft_CRA-inferno-candidate-1-the-ground`, its records are in `~/.cache/specsmd-inferno/Skoft_CRA/dispatch/f921dbd9.../`, the log is `dispatch/candidate-1-the-ground.log` beside that folder.

Two chains own `src-tauri/src/commands/license.rs` by their specs: R is `c1g-every-command-runs-on-any-tauri-runtime` (owns it) with `c1g-one-test-door-registers-every-command` (does not), and L is `c1g-the-licence-a-gated-command-asks-is-managed-state` (owns it) with two more items. Both items of R hold a clean review and are not integrated.

| Dispatch | Chain | Logged (UTC) | before seq, `license.rs` | accepted seq, `license.rs` | `filesModified` |
| --- | --- | --- | --- | --- | --- |
| `aefc55ca` | R | 11-17 17:50:07 | 7, `6f389556` | 9, `35ffa712` | 18 paths, `license.rs` among them |
| `ae3d0843` | L | 11-17 19:48:13 | 11, `35ffa712` | 12, `f15c731a` | 13 paths, `license.rs` among them |
| `c84e82b9` | R, named for the door item | 11-18 16:03:43 | 13, `f15c731a` | 16, `3e94ba03` | `.gitattributes`, a granted path |
| `30d58bf4` | L | 11-18 16:04:19 | 14, `f15c731a` | 15, `3e94ba03` | `license.rs` |
| `faa344fb` | R, the fresh one | 11-18 16:10:17 | 17, `3e94ba03` | 18, `3e94ba03` | none, `.gitattributes` carried |

- The log line of `c84e82b9` holds both items of R, as `coveredItems` made it, though the orchestrator named the door item. Its ownership holds `license.rs` through the other item.
- `30d58bf4` was logged 36 seconds later with `license.rs` in its ownership, exit 0.
- The hashes are git's: `git show 14d259217:src-tauri/src/commands/license.rs | sha256sum` starts `f15c731a` and at `4d3f17960` it starts `3e94ba03`. `git diff --numstat 14d259217 4d3f17960` is one line, `2 2 src-tauri/src/commands/license.rs`. So the file changed only between seq 14 and 15, inside L's own window, and R's builder wrote nothing to it.
- `verify-item` of L passes in the same state. Only R is held.

Reproduced on Alpha on 2026-11-18 18:33Z to 18:38Z with the script below, against the scripts of `f3be640a` and of `1f7a2c07`, the same lines on both:

```
dispatch-log --item l1 beside the open dispatch of r1,r2: exit 0
verify r2: exit 2 | ERROR [DISPATCH_PROOF] dispatch ownership overlaps at shared.cjs with dispatch <L fix>: a serial chain one builder builds takes one dispatch-log for all its items, with --items a,b
verify r2 after a fresh dispatch-log: exit 2 | the same
verify l1 (the other chain): exit 0
dispatch-log --items r2,l1: exit 0, logged r2, l1, r1, l2
accept-dispatch <that id> --changed-paths []: exit 0
verify --items r1,r2: exit 0, outside [], unreported [], granted ["other.cjs"]
verify r2, verify l1, verify x (an item of neither chain): exit 0
a later dispatch-log --item r1: logged for r1, r2, l1, l2, and verify r1 after its accept: exit 0
```

Seen beside it, and no part of this row: `verify-item --since HEAD` lists a granted file as outside while it is uncommitted (`sinceOutside`, `S/run-item-proof.cjs:337`, reads the spec lists only), and `--peers []` lists the other chain's files as outside. Neither is a way on.

## How to fix

1. **The refusal prints the calls.** In `checkPeerChange`, the text gives what `checkBeside` gives: the `dispatch-log` call over the items of both dispatches (`chainDispatchCall`, the chain in the order of their first baselines), then `accept-dispatch <its id> --changed-paths '[]'`, then `verify-item` again, and one clause that says this joins the two histories, so the items are one chain from then on. `checkPeerChange` holds the peer's record; the item's ids come from the caller.
2. **`dispatch-log` refuses a dispatch whose frozen ownership overlaps an open record of another lineage.** It has both lists: the new record's `editable` and each open record's `assignment.ownership.editable`, and `ownershipOverlaps` (`S/run-peers.cjs:33`) answers it. Exit 2, naming the open dispatch, its items and the first shared path, with the two ways on: `accept-dispatch` the open one first, or log both as one chain. If a refusal is too hard for a host that runs such dispatches on purpose, the same line as a warning beside exit 0 still ends the silence.
3. **`dispatch-log` says when it took in an item the caller did not name.** One line of its own, with the item and why: its current record covers it.

Tests, in `run-peers-after.test.cjs`, `run-attribution-open.test.cjs` and `run-printed-calls.test.cjs`:

- the script below up to its first `verify`: the refusal holds the `dispatch-log` call with an item of each chain and the `accept-dispatch` call, and running those two as printed makes `verify-item` of the chain exit 0 with the grant still read;
- item b is logged while item a's dispatch is open and both own `shared.cjs`: refused (or warned) with a's dispatch id and the path, and silent once a is accepted. Two items with disjoint ownership are logged side by side as today;
- a correction named for one item of a chain prints the item it took in.

The cases at `run-peers-after.test.cjs:62-91` start two overlapping dispatches side by side on purpose. With a refusal in point 2 they need a record written past the door.

## Which part is the flow and which the host

The dispatch was the host session's error: its orchestrator ran two corrections at once that shared a file, against its own text. No host file changes. The flow's part is that the runner let it through, widened one of them without saying so, and then refused with a sentence instead of the call it prints elsewhere.

## Until it is built

For a chain held by "dispatch ownership overlaps at <file> with dispatch <id>" after both dispatches were accepted:

1. `run.cjs dispatch-log <intent> --items <one item of the held chain>,<one item of the peer's chain> --tier <tier> --agent <builder> --tree <tree>`. Its `logged` line lists every item of both chains.
2. `run.cjs accept-dispatch <the id it printed> --changed-paths '[]' --tree <tree>`. No builder runs in it.
3. `run.cjs verify-item --items <the held chain> --tree <tree>`, then the review and the integrate as always.

From then on those items are one chain: a correction of any of them is one `dispatch-log` for all, one builder at a time. Never edit a record by hand, it is signed. And read the `logged` line of every `dispatch-log`: it lists the items the dispatch covers.

## The script

Run as `node overlap.cjs <S>`. It uses `run-attribution-fixture.cjs` as it is.

```js
'use strict';
const path = require('node:path');
const scripts = path.resolve(process.argv[2]);
const { fixture } = require(path.join(scripts, 'run-attribution-fixture.cjs'));
const cleanups = [];
const t = { after: (fn) => cleanups.push(fn) };
const show = (label, r) => console.log(`${label}: exit ${r.code}${r.code === 0 ? '' : ' | ' + r.out.replace(/\s+/g, ' ').slice(0, 330)}`);
const log = (f, ...selector) => f.call('dispatch-log', 'alpha', ...selector, '--tier', 'strong', '--agent', 'builder', '--tree', f.root);

const f = fixture(t, { r1: ['shared.cjs', 'r1.cjs'], r2: ['r2.cjs'], l1: ['shared.cjs', 'l1.cjs'], l2: ['l2.cjs'], x: ['x.cjs'] });
const X = f.start('--item', 'x');
f.write('x.cjs', 'module.exports = 2;\n');
f.accepted(X, ['x.cjs']);
f.land('x.cjs');
const R = f.start('--items', 'r1,r2');
f.write('shared.cjs', 'r\n'); f.write('r1.cjs', 'module.exports = 2;\n'); f.write('r2.cjs', 'module.exports = 2;\n');
f.accepted(R, ['shared.cjs', 'r1.cjs', 'r2.cjs']);
f.land('shared.cjs', 'r1.cjs', 'r2.cjs');
const L = f.start('--items', 'l1,l2');
f.write('shared.cjs', 'r\nl\n'); f.write('l1.cjs', 'module.exports = 2;\n'); f.write('l2.cjs', 'module.exports = 2;\n');
f.accepted(L, ['shared.cjs', 'l1.cjs', 'l2.cjs']);
f.land('shared.cjs', 'l1.cjs', 'l2.cjs');
// The two corrections side by side: R's, named for r2 alone, and L's.
const Rfix = f.start('--item', 'r2');
f.call('grant', Rfix, '--path', 'other.cjs', '--tree', f.root);
const beside = log(f, '--item', 'l1');
show('dispatch-log --item l1 beside the open dispatch of r1,r2', beside);
f.write('shared.cjs', 'r\nl fixed\n');
f.accepted(beside.data.dispatch_id, ['shared.cjs']);
f.write('other.cjs', 'granted change\n');
f.accepted(Rfix, ['other.cjs']);
f.land('shared.cjs');
show('verify r2', f.verify('r2'));
f.accepted(f.start('--item', 'r2'), ['other.cjs']);
show('verify r2 after a fresh dispatch-log', f.verify('r2'));
show('verify l1 (the other chain)', f.verify('l1'));
// The way on: one dispatch over an item of each chain, accepted with no path.
const joined = log(f, '--items', 'r2,l1');
show('dispatch-log --items r2,l1', joined);
show('accept-dispatch --changed-paths []', f.accept(joined.data.dispatch_id, []));
const all = f.verify('--items', 'r1,r2');
show('verify --items r1,r2', all);
console.log('  outside', JSON.stringify(all.data.outside), 'unreported', JSON.stringify(all.data.unreported), 'granted', JSON.stringify(all.data.dispatches[0].granted));
for (const id of ['r2', 'l1', 'x']) show(`verify ${id}`, f.verify(id));
const later = log(f, '--item', 'r1');
console.log('a later dispatch-log --item r1:', later.data.line.split('\t')[5]);
f.write('r1.cjs', 'module.exports = 3;\n');
f.accepted(later.data.dispatch_id, ['r1.cjs']);
show('verify r1 after it', f.verify('r1'));
for (const fn of cleanups) fn();
```
