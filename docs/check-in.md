# Capstone check-in

**Plan:** [PROMPT.md](../PROMPT.md), written 2026-10-14 (`e339a30`) and revised after the plan review on 2026-10-19 (`b2dc66d`). This check-in describes commit `3ec021f` on `main`. Every command below runs from a fresh clone with Docker and Make.

## What works

- **One pattern, calibrated and measured (M1):** `make test` passes at `3ec021f`. On all five patterns in `samples/` it reads the scale bar (5 or 10 1/nm), finds the centre within tolerance (0.3 to 9.0 px off the centre checked by eye), and gives identical results on two runs.
- **Classifying features (M2):** on the Au standard (`samples/250203_HC_cryo_0.05V_newEL_0003.tif`), `make test` reports 18 features: rings, spotty rings, spot pairs and single spots. Each spot pair's radius is exactly half its spot-to-spot distance (worst 0.00 px). The other samples cover halos only, halos plus spots, and spots on rings ([samples/README.md](../samples/README.md)).
- **Measuring d-spacings:** on the Au standard, the tool gives 0.2055, 0.1432 and 0.1223 nm for three spotty rings, against Au {200} 0.2039, {220} 0.1442 and {311} 0.1230 nm: within 0.8%.
- **Phase matching (M3):** `make check` passes at `3ec021f`. Au and Na rings come out in the right order ({111} {200} {220} {311}, and {110} {200} {211} {220}). Spacings follow d = a/√(h²+k²+l²) to within 3e-5, and the precomputed library matches `crystal.js` to within 5e-6 nm.
- **Styling, export and batch (M4, M5):** `make up`, open <http://127.0.0.1:8765/>, then choose the `samples` folder. Every pattern is analysed, and you can step through them, export PNG, SVG, CSV or ZIP, and save and reload a project. `make smoke` checks that the page and a sample are served.
- **Speed:** `make bench` shows that analysis is about 85% of the run. A rewrite of the blur made it 1.15× faster with byte-for-byte identical results (`make bench BENCH_ARGS="--check bench/key.json"`, PASS). See the README, "Speed: one measured change".
- **The whole gate:** `make verify` (lint, crystal checks, sample tests, contract test, smoke test) is green at `3ec021f`.

## What failed, and what I learned

- **What I expected:** that `make test` would catch a wrong answer.
- **What happened:** I planted a defect, so a spot pair's radius was no longer halved and every spot-pair d-spacing came out half its true value. The sample tests still printed `ALL PASSED`: they check centres, scale bars and that two runs agree, never a d-spacing. `WORKLOG.md` (2026-11-04) records this.
- **What I changed:** I wrote down the contract between the analysis and the UI in [ARCHITECTURE.md](../ARCHITECTURE.md), and added `tests/check_contract.js` to `make test`. It failed on the same planted defect (worst 773 px) and passes on the real code.
- **What I learned:** a test that only checks consistency passes a wrong program. Each test has to be seen failing on a planted defect before I trust it.
- **Still failing:** plan check 4. On the Au standard, the {111} ring next to the beam stop (d = 0.2355 nm) is not found: the list above starts at {200}.

## What I am cutting, and why

- **The built-in walkthrough** (suggested in the test review). The hover hint on every tool and the **?** help already explain each step, and the time is better spent on check 5.
- **Making every lab slide convention a default (most of M6).** Dashed or dotted arcs, hiding weak or unassigned features, and colour by feature type are already options. Turning each one into a default is taste rather than correctness, so it goes after the draft.
- **Splitting `analyze` into one file per step.** Nothing needs it yet, and the contract test and the answer key already guard its output.

**The claim the 30 November draft will still make:** drop a folder of SAED patterns and, for each one, get a calibrated centre, every halo, ring and spot with its d-spacing within 2% of a hand measurement in ImageJ, ranked phase candidates, and a slide-ready figure, all locally in the browser.

## Built to throw away, and built to last

- **Throw away: the sample tests' "centre only" checks.** `tests/sample_cases.json` checks the centre, the scale bar and determinism, which is fine while nothing better exists. Before the final write-up, the ImageJ hand measurements (check 5, 10 patterns) will replace them with expected d-spacings, and the tests will check those.
- **Keep: the answer key and the contract test.**
  - `bench/key.json` holds every result on the five samples: centre, features, profile and scale bar. `make bench BENCH_ARGS="--check bench/key.json"` fails if any number changes, and a planted rounding change failed it on all five.
  - `tests/check_contract.js` (part of `make test`) checks every field the UI reads.
  - Both are documented in [ARCHITECTURE.md](../ARCHITECTURE.md) (Contract, Tests) and in the README ("Speed: one measured change", "Verifying results").
