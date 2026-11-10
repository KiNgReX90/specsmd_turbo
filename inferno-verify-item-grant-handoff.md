# Handoff: verify-item ignores an ownership grant the orchestrator makes after dispatch

Not built. This file is the whole handoff.

## What is wrong

The orchestrator procedure (`src/flows/inferno/agents/orchestrator/agent.md`, Review and integrate) tells the orchestrator to send a defect back to the same builder with "the minimal ownership extension". `run.cjs verify-item` does not honour such an extension. It attributes changed files against the ownership that `dispatch-log` signed when the builder started (`run-gate.cjs`, `verifyItem` calls `attribute(...)`). A path granted later is reported as `outside <item> ownership.editable` and exits 2. That holds even after the item spec gains the path, because the signed dispatch still holds the old list.

## Evidence (Skoft_CRA, 2026-11-10)

- Intent `the-vulnerability-handling-policy-states-every-duty-it-claims`, item `vhp-the-policy-names-the-one-coordinator-rule-that-applies`.
- The builder returned blocked: the policy grew from 7 to 8 pages, and `dev/browser-bridge/generation.js` (outside its ownership) records that count. The orchestrator granted that one line as a correction.
- `verify-item` under dispatch `6172d105-ce24-46c0-b32e-fc2e747d0064` printed `outside ... ownership.editable: dev/browser-bridge/generation.js` with exit 2. It printed the same after the path was added to the spec's `ownership.editable`.
- Workaround that passed: run `dispatch-log` again (new dispatch `22099943-2304-436f-bca4-cc86c5ad8542`), then `accept-dispatch` with the full list, then `verify-item`. It printed `ownership clean`.
- Side effect of the workaround: the spec edit rode in the item commit. The item reviewer listed the spec in its review `files`, and `run.cjs review` refused it with `BAD_REVIEW ... the ledger is never part of the code a review binds`. It took one more reviewer round.

## How to fix

Give the grant one recorded entry point: `run.cjs grant <dispatch_id> --path <path> --tree <dir>`, or `accept-dispatch --grant <path>`. It appends the path to the signed dispatch's ownership with the orchestrator as signer, and `verify-item` reads it. Then the spec never needs a hand edit, the item commit holds only code, and the review binds only code. Test: a dispatch signed without path P, a change to P, then `grant P`. `verify-item` exits 0, and without the grant it exits 2.
