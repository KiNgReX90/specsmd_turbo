# Handoff: the planner keeps one mechanism over any number of surfaces in one item, even when each surface has its own sources to read, so one builder carries every surface's reading and work to its last call

Row 0bi. Measured on the first host on 2026-11-23 in one builder on Delta, on an item planned on 2026-11-08 by the planner text that the build at `a8873ebb` carries; the tip `ebbdbc5a` holds the same text (no commit since `a8873ebb` touches `src/`).

## What is wrong

1. **The planner text keeps such an item whole.** "**One mechanism, one item.** An intent applying one mechanism to several surfaces is one item owning every surface, with one test per surface and one per journey, and the grade of its hardest surface. Split by surface only where the mechanisms differ." (`src/flows/inferno/agents/planner/agent.md:102`, the same at `src/flows/inferno/commands/inferno-planner.md:102`). Nothing in it bounds the number of surfaces.
2. **The size rule does not see what a surface reads.** "Split an item past about six required files or past two concerns" (`agent.md:162`, `commands/inferno-planner.md:162`) counts the manifest's `context.required`. The sources a surface needs (a primary text the builder fetches, a research file, a module it reads whole) are not in that list when the builder has to find or fetch them, so an item over five places with five laws passes with five required files. The Codex text has the same gap and no bound on surfaces: "Split an item that spans more than two concerns, needs substantially more than six context files, or is unlikely to finish in one bounded stretch" (`src/flows/inferno/codex/skills/specsmd-inferno-planner/references/procedure.md:127`).
3. **The cost lands on one builder's context, call after call.** A builder keeps what it read and wrote to its last call, so every surface past the first raises the price of every call after it. The orchestrator dispatches one builder per item and sends corrections back to it, so the planner's cut is the only place this is decided.

## Evidence

- **The item.** Host file `.specs-inferno/intents/the-privacy-statement-and-the-register-cover-every-place-a-buyer-comes-from/work-items/r4p-brazil-quebec-japan-korea-and-india-have-their-paragraphs.md`, planned in host commit `1a0507d23` (2026-11-08) by a planner whose text had the same rule at `:102` and the size rule at `:159`. One mechanism (a paragraph and a breach route per place) over five places, each with its own law: LGPD and the ANPD resolutions, Quebec's private-sector act, APPI and the PPC Rules, PIPA and its decree, the DPDP Act and Rules. It says "Retain every text read beyond the oracle's quotes under research/primary-sources/". `context.required` lists five files, and its complexity is high.
- **The build.** Delta, 2026-11-23 11:45:29Z to 14:37:52Z, one `specsmd-inferno-builder` on Opus 5.5, transcript `~/.claude/projects/-home-ruben-dev-Skoft-CRA/eea500c1-70da-48eb-8f18-3c20edae0882/subagents/agent-a89c0519120f22197.jsonl`: 191 calls. Context, as input plus cache read plus cache creation once per message id: 31.5k at call 1, 149k at call 25, past 250k from call 59, 332k at call 100, past 400k from call 143, 458k at call 191.
- **What filled it.** 205 tool results, 555k characters. 73 of them fetched or read primary sources (238k characters). By the place a result names: India 33 results and 107k characters over calls 8 to 190, Brazil 14 and 50k over calls 13 to 141, Japan 3 and 16k, Korea 4 and 12k, Quebec 6 and 2k, and 35 more that name several places, 86k. By call 50 the builder had read into all five places and stood at 210k. The writing, tests and register lines of five places took it to 458k over the next 141 calls.
- **Across the flow.** The host's oracle on token spend (Fable, 2026-11-23, replaying 1,551 subagent calls on Delta) found subagents past 150k at call 12 to 52 and past 250k at call 59 to 77, growing a median 2.5k tokens per call, and decided this row: an item stops at three surfaces when each surface has its own sources to read.

## How to fix

1. `agent.md:102` and its copy at `commands/inferno-planner.md:102` (while row 0az leaves the copy standing): after "Split by surface only where the mechanisms differ." add "An item stops at three surfaces when each surface has its own sources to read (a text the builder fetches, a research file, a module it reads whole). Past three, split by surface: the part the surfaces share (the test file, a table every surface fills) goes in the first item and the others wait on it."
2. `agent.md:162` and its copy: "Split an item past about six required files, counting each surface's own sources as files, or past two concerns".
3. `procedure.md:127`: the same two rules in the Codex procedure.
4. The test: `src/flows/inferno/agents/planner/scripts/team-work-item-contract.test.cjs:30` ("planner body carries the blast radius rule and the per-surface test count") asserts the three-surface sentence in every planner text, `agent.md` and `codexSkillFile("specsmd-inferno-planner", "references/procedure.md")`, as the tests at `:116` and `:226` do. It is red before the change. Then `evals/planner-ab` on one statement of this shape (the host's R4 privacy statement) on both hosts, per the standing rule under section 2 of `inferno-build-next.md`.

## Which part is the flow and which the host

All of it is the flow's planner text. The host owns only its planner briefs until a version holds the row.

## Until it is built

The host's planner briefs carry the sentence of fix 1.

## The measurement

Run with `python3 -I ctx.py <transcript.jsonl>` on the machine that holds the transcript. It prints the calls and the context at the calls named above, the tool results and their characters, those that fetched or read a primary source, and the results by the place their path or command names, a result that names two places counted under several.

```python
import collections, json, re, sys
PLACES = {"Brazil": r"brazil|lgpd|anpd|brasil|planalto|gov\.br", "Quebec": r"quebec|québec|cai\.gouv|legisquebec|p-39|law ?25",
          "Japan": r"japan|appi|ppc\.go|ppc[-_]|e-gov|elaws", "Korea": r"korea|pipa|pipc|kisa|law\.go\.kr|klri",
          "India": r"india|dpdp|meity|egazette|g\.s\.r|gsr"}
SOURCE = r"r4p-src|curl |wget |pdftotext|web\.archive|primary-sources"
seen, ctx, uses, res = set(), [], {}, []
for line in open(sys.argv[1]):
    try: o = json.loads(line)
    except ValueError: continue
    m = o.get("message") or {}
    if o.get("type") == "assistant":
        u = m.get("usage") or {}
        if m.get("id") not in seen:
            seen.add(m.get("id"))
            ctx.append(u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0))
        for b in m.get("content") or []:
            if isinstance(b, dict) and b.get("type") == "tool_use":
                i = b.get("input") or {}
                uses[b["id"]] = str(i.get("file_path") or i.get("url") or i.get("command") or "")
    elif o.get("type") == "user" and isinstance(m.get("content"), list):
        for b in m["content"]:
            if isinstance(b, dict) and b.get("type") == "tool_result":
                c = b.get("content")
                n = sum(len(x.get("text", "")) for x in c if isinstance(x, dict)) if isinstance(c, list) else len(str(c or ""))
                res.append((len(ctx), uses.get(b["tool_use_id"], ""), n))
print("calls", len(ctx), "context at 1, 25, 50, 59, 100, 143 and last:", [ctx[k - 1] for k in (1, 25, 50, 59, 100, 143) if k <= len(ctx)], ctx[-1])
print("results", len(res), "characters", sum(n for _, _, n in res))
src = [n for _, key, n in res if re.search(SOURCE, key, re.I)]
print("fetch or read primary sources:", len(src), "results,", sum(src), "characters")
by = collections.defaultdict(lambda: [0, 0, None, None])
for call, key, n in res:
    hits = [p for p, rx in PLACES.items() if re.search(rx, key, re.I)]
    place = hits[0] if len(hits) == 1 else "several" if hits else "no place"
    b = by[place]; b[0] += 1; b[1] += n; b[2] = b[2] or call; b[3] = call
for place, (k, n, lo, hi) in sorted(by.items(), key=lambda kv: -kv[1][1]):
    print(f"{place}: {k} results, {n} characters, calls {lo} to {hi}")
```
