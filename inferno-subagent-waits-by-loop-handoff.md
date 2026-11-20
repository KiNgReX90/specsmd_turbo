# Handoff: no Claude role text says how to wait for a command, so a builder's own loop over a finished run's output held its answer for two and a half hours

Row 0ak. Found on the first host on 2026-11-20, in a builder of `the-article-14-drafts-cite-ask-and-print-what-the-law-owes`, on the build at `a8873ebb`, the tip. Read in the builder's and the orchestrator's transcripts, and measured over every subagent transcript on that machine with the script at the end.

Line numbers are those of `163eb980`.

## What is wrong

1. **The Claude texts carry no wait rule.** A Claude Code subagent's Bash call that outlives its timeout is moved to the background, and the runtime notifies the subagent when it exits. None of the six builder files says to wait for that notification: a search for wait, poll, sleep, background, notification or timeout in `agents/builder/agent.md` finds only line 32 (`tail`) and line 121 (`halted`), and the cheap and escalate files and the three `commands/inferno-builder*.md` are the same body. The reviewer and quality reviewer texts say nothing either, and the oracle's "never loop" (`agents/oracle/agent.md:24`) is about a killed run. The Codex builder has the rule (`codex/skills/specsmd-inferno-builder/references/procedure.md:74`: one `wait` at `yield_time_ms` 1800000, "never a shorter poll").
2. **So a subagent writes its own wait.** It loops over the output file of a run whose exit the runtime already reports, often for a line the run can never print, and often with no deadline. The runtime's own note invites it: "Read the file only if ... you need a line it prints before you can go on".
3. **A wait of its own outlives its report.** While a subagent's own background work runs, it gets one report per result: a second report is refused, and what it writes after is delivered only when that work ends. The orchestrator then waits for a notification that comes only when the loop dies.

## Evidence

The first host's Delta (Debian 13), session `art14` (Claude pid 1933445), transcript `~/.claude/projects/-home-ruben-dev-Skoft-CRA/a8374aea-75e7-4a45-8c2c-0204bf35fd32.jsonl`, builder `ad9d125b746456156` (`specsmd-inferno-builder`, Opus 5.5 at high, transcript `.../a8374aea-75e7-4a45-8c2c-0204bf35fd32/subagents/agent-ad9d125b746456156.jsonl`), item `a14-the-distributor-and-the-public-notice-duties-are-asked`, `flow.lock` at `a8873ebb`. Times UTC, from the two transcripts.

- 01:52:26Z, the orchestrator resumes the builder with a review correction.
- 01:53:46Z, the builder runs `bash ~/.local/share/skoft-agent-hooks/remote-run.sh auto $PWD node --test scripts/verify-quotes.test.mjs 2>&1 | grep -E '^ℹ (pass|fail)|^✖|actual:|expected:' | head -12` in the foreground with `timeout: 600000`. At 02:03:47Z the runtime moves it to the background as `bvt0tsag4`: "You will be notified when it completes."
- 02:04:31Z, with `run_in_background`: `until grep -q 'remote-run: delta' <tasks>/bvt0tsag4.output 2>/dev/null || ! [ -s <tasks>/bvt0tsag4.output -o 1 ]; do sleep 10; done; echo done`. The line can never come, since the run's own `grep` passes only the pass, fail and assertion lines, and `! [ -s f -o 1 ]` is false whatever the file holds.
- 02:06:58Z, the notification of `bvt0tsag4` arrives (`completed (exit code 0)`). The builder reads the output at 02:07:02Z and goes on. Its loop runs on.
- The same builder waited the same way three times more: a foreground `sleep 240` at 22:43:49Z and a background `until grep -q ... bv1q5o9m9.output; do sleep 10; done` at 22:44:03Z on 2026-11-19, and `until grep -q 'restored\|differ' <tasks>/bhi8bp374.output; do sleep 10; done` at 02:07:45Z. Each watched a run whose exit the runtime reports.
- 02:19:56Z, the builder's report reaches the orchestrator. 02:21:26Z, the orchestrator sends one more step. 02:22:04Z, the builder's second SubagentHandback is refused. 02:22:10Z, the orchestrator reads: `Agent "Build a14 item 4: distributor and public notice" is waiting on its own background work`, and "Anything it wrote at the end of that run was not delivered, because it gets one report until its background work ends." It waits.
- 04:52:36Z, the lead stops the loop (pid 848972, elapsed 2:47:36), and the orchestrator reads the builder's answer at 04:52:41Z. For 2 h 30 min the orchestrator waited on that answer, with Delta's load at 0.04.

The dispatch carried the host's own constraint, "Nobody polls, ever. Never wait or poll for a port, and never write a loop like: until ! pgrep -f 'playwright test'." (the host's `.specs-inferno/config.yaml:658`). The builder looped anyway, as a wait for a line. A constraint that only forbids does not name the way to wait or why.

Every subagent transcript on Delta from 2026-11-17 05:04Z to 2026-11-20 05:49Z, read with the script below. A loop is a Bash call whose command holds `until` or `while`, then `do`, then `sleep`, each call counted once.

| Role | Subagents | With a loop | Loops | Under `timeout` | Over a task's output file |
| --- | --- | --- | --- | --- | --- |
| builder | 62 | 5 | 25 | 7 | 12 |
| builder-cheap | 5 | 3 | 7 | 2 | 7 |
| builder-escalate | 2 | 0 | 0 | 0 | 0 |
| reviewer | 99 | 21 | 115 | 71 | 56 |
| reviewer-quality | 76 | 6 | 14 | 7 | 13 |
| oracle | 11 | 1 | 4 | 0 | 3 |
| scanner | 80 | 0 | 0 | 0 | 0 |
| planner | 10 | 0 | 0 | 0 | 0 |

So 78 of 165 loops had no deadline, and every role that runs long commands writes them. The scanner and the planner run none.

## How to fix

1. **One sentence in the builder's Constraints**, `agents/builder/agent.md`, after line 21 ("ALWAYS run relevant tests ..."):

   "- Wait for a command you started by its exit notification, never by a loop or `sleep` over its output. A wait for a line it prints runs under `timeout 1800` at most. Return only when nothing you started still runs: your result is held until it ends."

   48 words. The parity tests carry it into `agents/builder-cheap/agent.md`, `agents/builder-escalate/agent.md` and the three `commands/inferno-builder*.md` (`src/__tests__/unit/inferno/inferno-flow.test.ts:37-51`). The flow's ceiling is 2353 words per builder file (`src/__tests__/unit/inferno/text-budget.test.ts:32-34`), and the escalate builder, the largest, counts 2289 installed, so 2337 after.
2. **The same sentence in the other roles that run commands**: the opening paragraph of `agents/reviewer/agent.md` (line 11) and of `agents/reviewer-quality/agent.md`, and the Constraints of `agents/oracle/agent.md` beside line 24, with their command bodies by the parity tests (`inferno-flow.test.ts:84-94`, `src/__tests__/unit/inferno/reviewer-quality.test.ts:30`). These roles have no ceiling in the budget test.
3. **Nothing else.** No new tool: `Monitor` or `TaskStop` would give a subagent a second way to keep work past its return, while the runtime's notification is the one way to wait. No script, no key, no orchestrator text. The Codex texts keep their own rule.

Test, in `src/__tests__/unit/inferno/inferno-flow.test.ts`: one `it.each` over `agents/builder/agent.md`, `agents/reviewer/agent.md`, `agents/reviewer-quality/agent.md` and `agents/oracle/agent.md` that each text contains the sentence. Red on the tip, green after. The parity tests then hold it in every wrapper and command, and `text-budget.test.ts` stays green.

## Which part is the flow and which the host

The texts are the flow's. On the host, Delta's guard `~/.local/share/skoft-agent-hooks/subagent-wait-guard.py` (live since 2026-11-20 05:41:55Z) refuses, in a subagent, a wait whose deadline is missing or over 1800 s. It stays as the enforcement after the build. The host's own budget for a Claude builder reads 4100 of 4100 on its main at `d281cb34c` (`CLAUDE.md` 1427, the escalate builder 2289, `dispatch.constraints` 384), so at its install the host makes room in its own `dispatch.constraints`, first its poll line (`config.yaml:658`), which the flow's sentence then holds. Nothing here is for the builder of the row on the host's side.

## Until it is built

On the host: Delta's guard refuses the loop. An orchestrator adds the sentence of point 1 to every builder, reviewer and oracle dispatch. When a subagent's report has reached the orchestrator and a later notification reads `is waiting on its own background work`, a wait of its own still runs: the lead finds it with `ps` and stops it.

## The script

Run on the machine that holds the transcripts, from `~/.claude/projects/<project folder>/`, with `node - < <file>`. 2 s on Delta.

```js
const fs = require('fs'), path = require('path');
const since = Date.parse('2026-11-17T00:00:00Z'), out = {};
for (const s of fs.readdirSync('.')) {
  const d = path.join(s, 'subagents');
  if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) continue;
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.meta.json')) continue;
    const type = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')).agentType || '';
    const j = path.join(d, f.replace('.meta.json', '.jsonl'));
    if (!fs.existsSync(j) || fs.statSync(j).mtimeMs < since) continue;
    const r = out[type] ||= { subagents: 0, withLoop: 0, loops: 0, timeout: 0, taskOutput: 0 };
    r.subagents++;
    const seen = new Set(); let loops = 0;
    for (const line of fs.readFileSync(j, 'utf8').split('\n')) {
      if (!line.includes('"tool_use"')) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      for (const u of o.message?.content || []) {
        if (u.type !== 'tool_use' || u.name !== 'Bash' || seen.has(u.id)) continue;
        seen.add(u.id);
        const cmd = String(u.input?.command || '');
        if (!/\b(until|while)\b[\s\S]*?\bdo\b[\s\S]*?\bsleep\b/.test(cmd)) continue;
        loops++; r.loops++;
        if (/\btimeout\s+[0-9]/.test(cmd)) r.timeout++;
        if (/tasks\/[a-z0-9]+\.output/.test(cmd)) r.taskOutput++;
      }
    }
    if (loops) r.withLoop++;
  }
}
console.log(JSON.stringify(out, null, 1));
```
