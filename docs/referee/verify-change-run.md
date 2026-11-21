# /verify-change, run in a fresh session

Full output, unedited, from `claude -p "/verify-change"` on 2026-11-20, with only Read, Grep, Glob, `make` and git read commands allowed. It ran on the uncommitted round-6 revisions. The README and work log changed during the run because I was writing them in another session, which it noticed and reported.

---

Verification complete. Details:

**1. What changed** — `src/app.js`, `src/index.html` (calibrate dialog replacing `window.prompt`; brightness slider direction inverted, gamma relabelled), `dist/diffraction_annotator.html`, `Makefile` (wires the new test into `make test`), `ARCHITECTURE.md`, plus untracked `tests/check_known_answers.js`, `CLAUDE.md`, `.claude/skills/`.

Note: `README.md` and `WORKLOG.md` were **not** modified when I took the first `git status` and **were** modified when I re-checked at the end — the working tree changed under me mid-run (docs only, by something outside this session). The gate and bench ran against the code as it stands; no `src/` or `tests/` file moved during the run.

**2. Bundle** — current. `dist/diffraction_annotator.html` contains `askCalibLength`, `calAskOk`, `275 - parseFloat`, and the new slider title; it contains none of the replaced code (`Length clicked:`, `slide left to brighten`, any `prompt(`). I did not run `make dist` (the skill says not to edit files, and a rebuild writes to `dist/`), so this is a content check, not a byte-for-byte rebuild comparison.

**3. The gate** — `make verify` passed. No FAIL lines. Crystal 8/8, sample tests 5/5, contract 12/12, known answers 8/8, smoke passed (page 10.0 MB, sample 14.4 MB).

**4. Answer key** — `PASS: every result is identical to bench/key.json`. The change was not meant to alter results (UI dialog + slider direction only), and it didn't.

**5. New test** — `tests/check_known_answers.js` is new, and `WORKLOG.md` (2026-11-20 entry) records it seen failing: a planted 3% scale on every ring radius in `imageproc.js` failed three of its checks and two contract checks while the sample tests still passed, then the code was restored. It counts.

One thing to fix before committing: `tests/check_known_answers.js` is still untracked while the `Makefile` already calls it. A commit that stages the Makefile without `git add tests/check_known_answers.js` would leave `make test` broken on a clean checkout.

**6. Timing** — `make verify` 1:13 total; `make bench --check` 1:19 total (analyze dominates at 21.4 s, 83%). Per-step times aren't printed inside the make output, only these two wall-clock totals.

```
verify-change: PASS
gate: make verify passed — lint, crystal (8), samples (5), contract (12), known answers (8), smoke. No FAIL lines.
answer key: unchanged (change was not meant to alter results — correct)
bundle: current
new tests seen failing: yes (check_known_answers.js, planted 3% radius scale, WORKLOG 2026-11-20)
not checked: make lab-test (needs the lab's data/ folder, not in this repo); the calibrate dialog and sliders by hand in a real browser (WORKLOG records these as unverified); byte-exact dist rebuild (would have written to dist/); tests/check_known_answers.js is untracked though the Makefile calls it
```
