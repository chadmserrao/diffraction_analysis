# The referee (homework 8b)

The referee is a Claude Code subagent, [`.claude/agents/referee.md`](../../.claude/agents/referee.md). It has one job: take a change, assume I got it wrong, and try to prove it, with a file, a line and a concrete input for every finding. It can only read. Anything it can't back with an input goes under Questions, and "nothing survives" is an allowed answer.

I ran it twice, each time in a fresh session so it couldn't lean on anything I'd already said:

```bash
claude -p "Use the referee subagent to review the change 234b2df..44725cc ..." \
  --allowedTools "Agent" "Read" "Grep" "Glob" "Bash(git diff:*)" "Bash(git log:*)" "Bash(git show:*)" "Bash(git blame:*)" \
  --disallowedTools "Edit" "Write" "NotebookEdit" "WebFetch" "WebSearch"
```

- **On my last real change**, the round-5 revisions (ring snapping, the multi-file drop, Auto-identify, colour by feature type): [2026-11-20_round5.md](2026-11-20_round5.md).
- **On a defect I planted**: [2026-11-20_planted.md](2026-11-20_planted.md).

## Negative control

In a throwaway worktree I flipped one sign in `snapRing`, the step that finds where between two profile bins a ring's peak sits:

```diff
-  off = den < 0 ? 0.5 * (rs[i - 1] - rs[i + 1]) / den : 0;
+  off = den < 0 ? 0.5 * (rs[i + 1] - rs[i - 1]) / den : 0;
```

I committed it as "Tidy the sub-bin peak estimate in snapRing", the kind of message I might write myself when I think a change is harmless. That puts a hand-marked ring on the wrong side of its peak by up to a bin, so the d-spacing moves a little while still looking believable.

The referee's first finding was exactly this. It worked the parabola fit out by hand, pointed at the two other places in the same file that still use the right sign, and called the commit message misleading. It also noticed that `dist/` no longer matched `src/`. `make test` caught the same defect (the contract test's snap check failed at 0.73 px against a 0.5 px limit), so in this case the test and the referee agree. Afterwards I deleted the worktree and its branch.

## The criticism I accepted, and the one I rejected

**Accepted: Auto-identify could quietly throw away a corrected calibration.** In round 5 I made Auto-identify re-run detection when an image has no marks. The referee followed that path into `reanalyse` and found that it only keeps a calibration whose source is "manual". If you correct a mis-read scale bar in the Calibration card, the source stays "scale bar", so Remove all marks followed by Auto-identify put the old, wrong bar value back, and every d-spacing and phase label with it, without a word. I tried it in the browser before the fix: I changed the bar value from 5 to 5.5, and after the two clicks it was back to 5. Now a correction is marked as edited and re-detection keeps it; the same steps leave 5.5 in place. The same hole was already there for the Re-detect button, so that is fixed too. I accepted this one because it is exactly the failure the project is most afraid of: a wrong number that looks fine. While I was there I also fixed the Contrast slider's hover text, which the referee showed says the opposite of what the slider does.

**Rejected: "+ Ring" should only snap to peaks the detector would accept.** The referee says that a click away from any ring still snaps to a small bump in the profile, up to 5% away, and that the "no peak nearby" message almost never shows. I measured it on the five samples, and it's right about how the code behaves: clicks well away from every detected feature snap most of the time, usually by around 1%. I'm still not taking the fix it proposes. The point of "+ Ring" is to mark rings the detector missed, like the Au {111} ring next to the beam stop. If the snap only accepted peaks the detector already likes, it would refuse exactly the rings I need it for. The ring is drawn where it lands, so you can see it move, and its d-spacing is listed with the others. What I may do later is have the message say how far the ring moved.

## Where the agent runs and what it can reach

| | The referee |
|---|---|
| **Where it runs** | On my Mac, in a fresh non-interactive Claude Code session (`claude -p`) started in this repository. Claude Code's own permission rules are the only sandbox; it runs outside the Docker container, which holds only Python and Node for the app and tests. |
| **What it can write** | Nothing. Edit, Write and NotebookEdit are denied, and Bash is allowed only for `git diff`, `git log`, `git show` and `git blame`. Anything off the list is refused, because nobody is there to approve it. The reports were saved by redirecting the session's output, outside the agent. |
| **What network it reaches** | Only the Anthropic API that Claude Code uses to run the model. WebFetch and WebSearch are denied, and the allowed git commands are all local. |
| **Which credentials it holds** | My Claude Code login, which the session needs to run. My GitHub login is on the same machine, but the referee can't run `gh`, `git push` or any other command that would use it. This clone has no `.env`, so the Materials Project key isn't there. |
| **Private data** | Partly. The repository is public, but Read and Grep aren't limited to this folder, so it could read other files my user account can open. |
| **Untrusted content** | Yes. It reads the code, the commit messages, the work log and the peer reviews in `feedback/`, which other people wrote. |
| **A way out** | Only its report back to me, through the model API. It has no web tools and no shell command that reaches the network. |

So it holds two of the three legs, private data and untrusted content, and the third only through the text it hands back to me. That's why its tools stay read-only and the report is something I read before acting on it.
