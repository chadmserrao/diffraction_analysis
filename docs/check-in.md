# Capstone check-in

**Plan:** [PROMPT.md](../PROMPT.md). I wrote it on 2026-10-14 (`e339a30`) and revised it after Daniel's plan review on 2026-10-19 (`b2dc66d`). Everything below is as of commit `3ec021f` on `main`, and every command runs from a fresh clone with Docker and Make.

## What works

- **Reading and measuring a pattern (M1).** Run `make test`. It goes through all five patterns in `samples/`, reads each scale bar (5 or 10 1/nm), and finds each centre within 0.3 to 9 px of the one I checked by eye. It also runs each pattern twice to make sure the answer comes out the same.
- **Sorting out the features (M2).** On the gold standard (`samples/250203_HC_cryo_0.05V_newEL_0003.tif`), the tool finds 18 features: rings, spotty rings, spot pairs and single spots. The other samples cover halos on their own, halos with spots, and spots on top of rings ([samples/README.md](../samples/README.md)).
- **Getting the d-spacings right.** On that same gold pattern, three of the spotty rings come out at 0.2055, 0.1432 and 0.1223 nm. Gold's {200}, {220} and {311} spacings are 0.2039, 0.1442 and 0.1230 nm, so the tool is within about 1%.
- **Matching phases (M3).** Run `make check`. It confirms that gold and sodium give their rings in the right order, and that the built-in library agrees with the crystallography code.
- **Styling, exporting and batches (M4, M5).** Run `make up`, open <http://127.0.0.1:8765/>, and pick the `samples` folder. You can step through every pattern, export a PNG, SVG, CSV or ZIP, and save a project to pick up later.
- **Speed.** `make bench` showed me that the analysis takes about 85% of the time. I rewrote the blur step and it got about 15% faster, with exactly the same results. The README section "Speed: one measured change" has the numbers.
- **Everything at once.** `make verify` runs lint, the crystal checks, the sample tests, the contract test and a smoke test of the running app, and it all passes.

## What failed and what was learned

I assumed `make test` would catch a wrong answer. To find out, I broke the code on purpose: I stopped halving the distance between a pair of spots, which doubles the radius and halves every spot-pair d-spacing. The sample tests still passed. Looking closer, they only check the centre, the scale bar and that two runs agree. They never look at a d-spacing at all.

So I wrote down exactly what the analysis hands to the interface ([ARCHITECTURE.md](../ARCHITECTURE.md)) and added a contract test (`tests/check_contract.js`) to `make test`. When I broke the code the same way, the new test caught it right away. The lesson for me: a test isn't worth much until I've watched it fail on a bug I planted. `WORKLOG.md` (2026-11-04) has the details.

One thing is still broken: plan check 4. On the gold standard, the tool misses the {111} ring right next to the beam stop (d = 0.2355 nm), which is why the list above starts at {200}.

## Cuts and motivation

- **A built-in walkthrough.** Linda suggested one in the test review. Every tool already has a hover hint and the page has a help button, so I'd rather spend the time on the ImageJ comparison.
- **Making all the lab's slide conventions the default (most of M6).** You can already choose dashed or dotted arcs, hide weak or unlabelled features, and colour rings and spots differently. Making each of those the default is mostly a matter of taste, so it can wait until after the draft.
- **Splitting the analysis into one file per step.** It came up in the code review, but nothing needs it yet, and the contract test and the saved answer key already protect it.

**What the 30 November draft will still claim:** you drop in a folder of diffraction patterns and, for each one, get the centre, every halo, ring and spot with a d-spacing within 2% of what you'd measure by hand in ImageJ, a ranked list of likely phases, and a figure ready for a slide, all running on your own computer.

## What gets thrown away and what is kept

- **Throwing away: the "centre only" sample tests.** Right now `tests/sample_cases.json` checks the centre, the scale bar and that runs repeat. That's good enough for now, but once I've measured 10 patterns by hand in ImageJ (plan check 5), those measurements become the expected d-spacings and the tests will check them instead.
- **Keeping: the answer key and the contract test.**
  - `bench/key.json` stores every result on the five samples. `make bench BENCH_ARGS="--check bench/key.json"` fails if a single number changes. I tested that by slipping in a tiny rounding change, and it caught it on all five patterns.
  - `tests/check_contract.js` runs with `make test` and checks every field the interface reads.
  - Both are written up in [ARCHITECTURE.md](../ARCHITECTURE.md) and in the README.
