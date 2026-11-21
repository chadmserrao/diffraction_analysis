---
name: verify-change
description: Check a change to the Diffraction Annotator end to end before calling it done - the full gate, the answer key, the bundle, and whether any new test was seen failing. Use after every change to src/ or tests/, and before a commit or PR.
allowed-tools: Read, Grep, Glob, Bash(make:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*)
---

# Verify a change

Run these from the repository root, in order, and stop at the first failure.

1. **What changed.** Run `git status --short` and `git diff --stat`. Note which of `src/`, `tests/` and `dist/` were touched.
2. **The bundle.** If `src/` changed but `dist/diffraction_annotator.html` didn't, the bundle is stale. Report that, and run `make dist` only if the user asked you to fix things; otherwise just report it.
3. **The gate.** Run `make verify`: lint, crystal checks, sample tests, the contract test, the known-answer test and the smoke test. Report every FAIL line exactly as printed.
4. **The answer key.** Run `make bench BENCH_ARGS="--check bench/key.json"`. If any result differs, list the files and fields. Then say whether the change was meant to change results; if it wasn't, that's a failure.
5. **New tests.** If `tests/` gained a new check, look in `WORKLOG.md` for a note that it was seen failing on a planted defect. If there isn't one, say so: the test doesn't count yet.
6. **Timing.** Give the total time of each make step from the output, so a slowdown shows up.

## Report

End with one short block:

```
verify-change: PASS | FAIL
gate: ...
answer key: unchanged | changed (intended? yes/no)
bundle: current | stale
new tests seen failing: yes | no | none added
not checked: ...
```

Don't edit any file. This skill only checks and reports; fixing is a separate step the user decides on.
