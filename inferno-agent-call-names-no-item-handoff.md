# Handoff: an orchestrator's Agent call and its correction message name the item and the dispatch only inside their prompt, so a builder's or a reviewer's run cannot be tied to its item without reading prompts

Row 0aq. Asked on the first host on 2026-11-20 by an oracle (Fable 5.2, effort xhigh) that designed a temporary capture of the flow on the host's machines, and measured here over the orchestrator transcript of the shipped intent `candidate-1-the-ground`. The text below is read at `a8873ebb`, whose `src/` the tip `d4a64f2f` holds byte for byte.

## What is wrong

1. **The text gives the spawn no handle.** `agents/orchestrator/agent.md:66` has the orchestrator run `dispatch-log` and keep its `dispatch_id`, and it names nothing for the Agent call that follows: its `description`, the one field the runtime's task notification and every hook payload carry, is free words. A correction goes back to the same builder by message, and the message's `summary` is free words too.
2. **So every reader has to read prompts.** Which subagent built or reviewed which item, how long it ran, how often it was corrected and why it stopped can be joined to the item only through the prompt text, which is long and is not in the notification.

## Evidence

Counted on Alpha 2026-11-20 20:2xZ by script over the orchestrator transcript `779d3570-db74-4eb4-8504-9da390a586e2.jsonl` (the first host's Delta, 2026-11-17 to 2026-11-19):

- 44 Agent calls. No description holds an item id or a dispatch id; they read `Build tray-check item`, `Contract review tray item`, `Quality review tray item`, `Slice check dead-code item`. 39 of the prompts name an item id and 23 a dispatch id.
- 43 SendMessage calls. No summary holds either; they read `Correction: three minor review findings`, `Re-review tray correction range`, `Resume after usage limit`. 34 of the messages name an item id.
- What the runtime hands back is the description: 2026-11-17 20:49:48Z, `<summary>Agent "Contract review door item" failed: Agent terminated early due to an API error ...</summary>`.
- The oracle's probe on claude 2.1.329 (2026-11-20): a subagent's tool calls carry `agent_id` and `agent_type`, its stop carries its transcript path, and its notification carries its tokens, tool uses and ms. With the item and the dispatch in the description, each of those joins to its item with no prompt read; without them the host's capture has to search each prompt for an item id.

## How to fix

1. **The runner prints the handle.** `dispatch-log` and every dispatch line the runner prints for a reviewer, a scanner or an oracle (`run-review.cjs`, `run-review-quality.cjs`, `run-scan.cjs`, `run-intent-review.cjs`, and `dispatchOracle` in `run-intents.cjs`) print one more line, `describe <item-id> <first 8 of the dispatch id> <role>`, with `intent` in place of the item for an intent-level dispatch.
2. **The text says to use it.** One sentence after the `dispatch-log` sentence of `agents/orchestrator/agent.md:66`: "Each spawn's description opens with the `describe` line its dispatch printed, and a correction's message summary opens with the same." About 20 words. The host's text budget for the Claude orchestrator read 4803 of 5100 at its last measure; the Codex procedure has no description field on `spawn_agent` (`codex/skills/specsmd-inferno/references/procedure.md:66`) and needs no change, unless a parity test asks for one.

Tests: the dispatch-log suite and the review, scan and oracle dispatch suites assert the `describe` line; the role text test (`src/__tests__/unit/inferno/inferno-flow.test.ts`) pins the sentence.

## Which part is the flow and which the host

Both changes are the flow's. The host's part, not for the builder of the row: until it is installed, the host's hook takes the item id from the prompt.

## Until it is built

On the host: an orchestrator starts each Agent call's description with the item id and the first 8 characters of its dispatch id, and each correction's summary the same. The capture does not depend on it.
