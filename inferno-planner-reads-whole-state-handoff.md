# Handoff: the planner's first batch reads all of state.yaml, which one Read cannot return and which the planner needs only as a list of the open intents, so each planner carries a slice of its own choosing, up to 114k characters, through every call

Row 0bj. Measured on the first host on 2026-11-23 over its planners' transcripts on Alpha, on the planner text that the build at `a8873ebb` carries; the tip `ebbdbc5a` holds the same text (no commit since `a8873ebb` touches `src/`).

## What is wrong

1. **The first batch names the whole file.** "First round, batched: `.specs-inferno/config.yaml`, `.specs-inferno/state.yaml`, the rule files under `.specs-inferno/standards/`, ..." (`src/flows/inferno/agents/planner/agent.md:19`, the same at `src/flows/inferno/commands/inferno-planner.md:19`). The Codex launcher reads it too: "Read applicable `AGENTS.md` files and, when present, `.specs-inferno/state.yaml`" (`src/flows/inferno/codex/skills/specsmd-inferno-planner/SKILL.md:13`).
2. **The planner needs a list, one entry and an anchor.** It classifies the new scope against "every non-completed intent in state.yaml, cheap-first: titles and entry comments rule out a disjoint subsystem" (`agent.md:89`), extends one `pending` intent in APPEND mode (`:92`), and writes its own entry once, re-reading "the anchor region" on a modified-since-read failure (`:180`, `:186`). None of it needs the work items of every intent.
3. **One Read cannot return the file, so each planner makes its own slice.** A Read without offset returned 50.7k and 61.6k characters in two runs, the first 798 and 956 lines, and the file now has 2,509. A planner that follows the text pages through it. The others build an outline with grep and `sed` ranges of their own choosing. What rides in a planner's context from its first calls to its last ranges from 2.6k to 114k characters.

## Evidence

- **The file.** Host `.specs-inferno/state.yaml` on `main` at `8718d8b44` (2026-11-23 15:34:52Z): 163,722 bytes, 2,509 lines, 31 entries, all open (22 pending, 4 in progress, 5 blocked; completed intents live in `archive/state.yaml`), 237 work items. The id, title, status, created, base_branch and depends_on_intents lines: 7.2 KB. The `comment` blocks: about 71 KB. The `work_items` lists: 84 KB. `grep -n '^  - id:\|^    title:\|^    status:\|^    depends_on_intents:'` prints 124 lines, 6.3 KB. `run.cjs select --json` on the same tree prints 10.6 KB, with every open intent's id and the titles of the 27 not in progress.
- **A Read returns the first page.** Alpha, 2026-11-18 04:00Z, "Plan the motion-returns intent" (`~/.claude/projects/-home-ruben-dev-Skoft-CRA/5c148898-9638-48cc-a382-76b8dbbfe359/subagents/agent-a2a8ea96a7bb621ee.jsonl`): its Read of `state.yaml` at call 2 returned lines 1 to 956 (61.6k characters), and a second Read at offset 956, limit 770, 49.2k more. 2026-11-16 09:06Z, "Plan the readiness intent and recipes" (`be46e15f-d5cb-4a42-b98d-4c7e7d6b6777/subagents/agent-a1364f6d354c75e2a.jsonl`): lines 1 to 798 (50.7k characters), then a Read at offset 758.
- **What planners read.** The 14 planner runs on Alpha from 2026-11-15 to 2026-11-23 read 2.6k to 114k characters of `state.yaml` in their first 8 calls (median 24k) and 9.4k to 148k over the run (median 41k). The two that read it with Read are the two above, and the motion-returns planner carried its 114k characters (about 30k tokens) through all 248 of its calls. The other twelve read pieces of their own choosing. The rules-watch planner of 2026-11-23 08:32Z (`e9f9cc10-6dd0-4211-987c-5366be5f8e17/subagents/agent-a9e7d13266ed7d9ae.jsonl`), for one, ran a grep of ids and statuses, `sed -n 1,140p` and two more `sed` ranges, 24k characters. The runs last 86 to 338 calls and stand at 44k to 112k context at call 8.
- **A partial Read is enough to edit.** Checked 2026-11-23 15:58Z on Alpha in Claude Code: a Read at offset 2500, limit 3, of a 3,000-line file, then an Edit of a line in that range, succeeds.

## How to fix

1. A step that prints the outline: `run.cjs intents`, reading `state.yaml` as `select` does (`S/run-intents.cjs:98`, `S/` being `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`). One line per entry: the entry's first and last line in the file, its id, status and title, and `after <id>` per `depends_on_intents`, then the line of any ON HOLD banner. Its own test: a fixture state with a pending, an in-progress and a blocked intent, each with a comment block and work items, prints three lines with no comment or work-item text, and each printed range starts at its entry's `- id:` line and ends on the line before the next entry.
2. `agent.md:19` and its copy: the first batch names `run.cjs intents` in place of `.specs-inferno/state.yaml`. `:89`: classify against the outline's intents, read an entry's range (Read with offset and limit) only when its title is a plausible overlap, and run the file-level sweep only past that. `:92`: APPEND reads the range of the entry it extends. `:180`: the write reads the range at its anchor, never the whole file.
3. The Codex launcher `SKILL.md:13` and `references/procedure.md`: the same.
4. The test that pins the text: `src/flows/inferno/agents/planner/scripts/team-work-item-contract.test.cjs` asserts that no planner text's first batch names `.specs-inferno/state.yaml` and that each names `run.cjs intents`, for `agent.md` and `codexSkillFile("specsmd-inferno-planner", "SKILL.md")`, as the tests at `:116` and `:226` read the Codex texts. It is red today. Then `evals/planner-ab` on both hosts, per the standing rule under section 2 of `inferno-build-next.md`.

## Which part is the flow and which the host

All of it is the flow's. The host owns only the line in its planner briefs until a version holds the row.

## Until it is built

The host's planner briefs carry: "Read `.specs-inferno/state.yaml` as an outline, `grep -n '^  - id:\|^    title:\|^    status:\|^    depends_on_intents:' .specs-inferno/state.yaml`, and an entry's lines only for a plausible overlap, the intent you extend or the anchor you write at. Never read the whole file."

## The measurement

Run with `python3 -I plan.py ~/.claude/projects/-home-ruben-dev-Skoft-CRA 2026-11-15` on Alpha. It prints one line per planner run since that date: calls, context at call 8 and at most, the characters of `state.yaml` its tool results held in the first 8 calls and over the run, and each Read of the whole file, then the medians.

```python
import glob, json, os, statistics, sys
rows = []
for meta in glob.glob(os.path.join(sys.argv[1], "*/subagents/*.meta.json")):
    md = json.load(open(meta))
    path = meta[: -len(".meta.json")] + ".jsonl"
    if md.get("agentType") != "specsmd-inferno-planner" or not os.path.exists(path): continue
    seen, ctx, uses, reads, start = set(), [], {}, [], None
    for line in open(path):
        try: o = json.loads(line)
        except ValueError: continue
        m = o.get("message") or {}
        if o.get("type") == "assistant":
            u = m.get("usage") or {}
            if m.get("id") not in seen:
                seen.add(m.get("id")); start = start or o.get("timestamp")
                ctx.append(u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0))
            for b in m.get("content") or []:
                if isinstance(b, dict) and b.get("type") == "tool_use":
                    i = b.get("input") or {}
                    uses[b["id"]] = (b["name"], str(i.get("file_path") or i.get("command") or ""), i.get("offset") or i.get("limit"))
        elif o.get("type") == "user" and isinstance(m.get("content"), list):
            for b in m["content"]:
                name, key, part = uses.get(b.get("tool_use_id"), ("", "", None)) if isinstance(b, dict) else ("", "", None)
                if isinstance(b, dict) and b.get("type") == "tool_result" and "state.yaml" in key and "archive/" not in key:
                    c = b.get("content")
                    n = sum(len(x.get("text", "")) for x in c if isinstance(x, dict)) if isinstance(c, list) else len(str(c or ""))
                    reads.append((len(ctx), n, name == "Read" and not part))
    if ctx: rows.append((start, md.get("description", ""), len(ctx), ctx[min(7, len(ctx) - 1)], max(ctx), sum(n for c, n, w in reads if c <= 8), sum(n for c, n, w in reads), [(c, n) for c, n, w in reads if w]))
rows = [r for r in sorted(rows) if r[0] >= sys.argv[2]]
for r in rows:
    print(f"{r[0][:16]}Z {r[1][:40]:40s} calls {r[2]:3d}  context at call 8 {r[3]:6d}, max {r[4]:6d}  state.yaml first 8 calls {r[5]:6d}, run {r[6]:6d}  whole Reads (call, chars) {r[7]}")
print(len(rows), "runs; state.yaml characters in the first 8 calls, median", statistics.median(r[5] for r in rows), "; over the run, median", statistics.median(r[6] for r in rows))
```
