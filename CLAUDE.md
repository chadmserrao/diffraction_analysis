# Working on the Diffraction Annotator

These are the things the code doesn't tell you. Read `PROMPT.md` for the task and `ARCHITECTURE.md` for the contract between the analysis and the interface.

## What matters most

- A wrong d-spacing that looks plausible is the worst failure: a scientist will put it on a slide. Treat any change to a radius, centre, calibration or feature kind as a change to results.
- Results must not change unless that's the point of the change. Check with `make bench BENCH_ARGS="--check bench/key.json"`. Regenerate the key (`--save bench/key.json`) only on purpose, and say why in `WORKLOG.md`.
- A new test doesn't count until it has been seen failing on a planted defect. Plant it, run the test, restore the code, and write down what happened.
- The Au {111} ring next to the beam stop is a known miss (plan check 4). Don't loosen a test to hide it.

## How to run things

- Everything goes through `make` in Docker (`make verify` is the gate). Don't install packages on the host or add dependencies; the app needs only the Python standard library and Node.
- After changing anything in `src/`, run `make dist`. `dist/diffraction_annotator.html` is committed because it's the file the lab opens.
- `make lab-test` needs the lab's `data/` folder, which isn't in this repository. Say so instead of skipping it quietly.

## Things learned the hard way

- No image data leaves the computer. The only network call is the optional Materials Project search through `serve.py`. Never commit `.env`.
- Don't use `window.prompt` or `alert`. Some browsers and embedded views block them, and the action silently does nothing (the calibrate tool did this until 2026-11-20).
- A calibration the user typed or clicked must survive re-detection (`reanalyse` keeps it when `cal.edited` or `cal.source === 'manual'`).

## Records

- `WORKLOG.md` gets one dated entry per session: what changed, what was checked and how, and what wasn't verified.
- `feedback/` holds peer reviews, added by the reviewers' pull requests. Don't edit them. Answer them in the README's "Response to …" sections, finding by finding.
