# Diffraction Annotator

**For materials scientists who take electron diffraction patterns on a transmission electron microscope (TEM) and need to know which crystal phases are in their sample.** Diffraction Annotator turns a folder of those patterns into measured, labelled figures. It replaces measuring each pattern by hand in ImageJ and labelling it by hand in PowerPoint.

For each pattern, it reads the calibration from the scale bar or the DM file metadata and finds the centre. It then classifies every spot, ring and amorphous halo and reports its d-spacing in nm, with the best-matching Materials Project phase and {hkl}. The result is a figure ready for a paper or a group meeting, plus a CSV of every measurement.

It is a single-file web app. Everything runs locally in the browser, and no image data leaves the computer. Results are deterministic. They count as correct only once they match hand measurements in ImageJ within 2% on 10 patterns covering every feature type (see [Verifying results](#verifying-results)).

The requirements, milestones, and acceptance checks are in [PROMPT.md](PROMPT.md). The development history and open items are in [WORKLOG.md](WORKLOG.md).

## Quick start

You need Docker (Docker Desktop on a Mac), Make and git. Nothing else is installed on your computer; everything runs in a small container (Python and Node only).

```sh
git clone https://github.com/chadmserrao/diffraction_analysis.git
cd diffraction_analysis
make up           # build the container and start the app
```

Open <http://127.0.0.1:8765/>, click **Open folder** and choose the `samples` folder: five patterns, one or more of each feature type, described in [samples/README.md](samples/README.md). The app is only reachable from your own machine. `make down` stops it.

`make help` lists every command. `make verify` checks that everything works: a syntax check, the crystallography checks, the tests on the sample patterns, and a smoke test of the running app.

Without Docker, open `dist/diffraction_annotator.html` directly in a browser; everything except the live Materials Project search works the same.

## Use it

1. Open the app (`make up`, above), or open `dist/diffraction_annotator.html` in Chrome, Edge, Safari, or Firefox. You can also share that one file with the lab.
2. Drag a folder of patterns onto the page, or click **Open folder**.
3. Go through the images with the arrow keys. Check the chips next to each file, adjust anything that looks wrong, and export.

The following file types are supported:

- **TIFF, PNG, or JPG exports.** These need a burned-in scale bar. The bar's length and its label ("5 1/nm", "5 nm⁻¹") are read automatically. Gatan DM and Thermo Fisher Velox/Ceta label styles both work.
- **DM3 and DM4 files.** The calibration comes from the file metadata.

## What it does

| Step | Method |
|---|---|
| Calibration | Detects the scale bar, measures its length in pixels, and reads the label with digit templates (Calibri, Arial, Tahoma, Verdana, Helvetica). For DM files it uses the metadata instead. On the lab dataset, all 541 scale bars were read correctly, and the scale-bar and DM4 calibrations agree within 0.08%. |
| Centre | Masked correlation of the pattern with its 180° rotation (Friedel symmetry), constrained to the beam-stop bulb. This is refined by fitting concentric circles to ring peaks along 120 rays. It can be set by hand. |
| Features | Each ring or spot is classified separately, so mixed patterns work: diffuse halo (amorphous), sharp ring (polycrystalline), spotty ring, spot pair (single crystal), and single spot whose partner is hidden by the beam stop. |
| d-spacing | d = 1/g, where g is the distance from the centre in 1/nm. For a spot pair, g is half the spot-to-spot distance, which does not depend on the centre. |
| Phases | The built-in library holds 5,993 Materials Project structures, converted to conventional cells, with kinematic electron intensities so systematically absent reflections drop out. Ranking penalises phases with dense line lists and missing strong rings. It absorbs a common scale error of up to ±tolerance, so line ratios decide. With two or more spot pairs, the angle between them is checked and a zone axis is reported. |

The results are deterministic: the same file always gives the same result. Run the regression tests to check.

## Where everything runs

```text
 your computer
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │  Docker container (make up)                     browser tab                  │
 │  ┌──────────────────────────────┐   page   ┌───────────────────────────────┐ │
 │  │ serve.py  127.0.0.1:8765     │ ───────► │ app.js: UI, state S, export   │ │
 │  │  serves dist/…annotator.html │          │   │ image bytes ▲ results     │ │
 │  │  proxies live MP search ─────┼──┐       │   ▼             │             │ │
 │  └──────────────────────────────┘  │       │ Web Workers: tiff/dm.js,      │ │
 │        ▲ repo mounted at /work     │       │   imageproc.js (the analysis) │ │
 │  git clone of this repository      │       │ crystal.js + built-in library │ │
 │  samples/ (original patterns)      │       └───────────────▲───────────────┘ │
 │                                    │                       │ drop / Open     │
 │                                    │          your pattern files (TIFF, DM)  │
 └────────────────────────────────────┼─────────────────────────────────────────┘
                                      ▼ only if you search live (needs an API key)
                            Materials Project API (internet)
```

- **Code** arrives by `git clone`. The container runs it from the mounted repository, and `make dist` bundles it into one HTML file. That file also works without the container: open it straight in a browser.
- **Your images** never leave the computer. The page reads them from disk, and the workers analyse them in the browser tab. Results are saved only when you export or **Save project**.
- **The phase library** is data built once, by `tools/build_library.py`, and bundled into the page (`library_data.js`, `library_refl.js`), so matching needs no network. The only thing that leaves the computer is an optional live Materials Project search, and only `serve.py` makes it.
- **Original data and backups:** the sample patterns in `samples/` and the reviews in `feedback/` are originals, kept as received; GitHub holds their copy. Everything else (`dist/`, the library files, `bench/key.json`) is rebuilt by a script. Your own patterns stay wherever you keep them; the tool never changes them.

## How the code is organized

Each module in `src/` has one job. Every pattern passes through the same pipeline, in this order:

```text
file ──► worker.js ──► tiff.js / dm.js ──► imageproc.js ──► app.js ──► crystal.js ──► app.js ──► export (zip.js)
         decode         read pixels         scale bar,       calibrate   match          edit,       PNG / SVG /
                                            centre, features to 1/nm     phases         style       CSV / ZIP
```

| Module | Its one job | Its interface: what goes in → what comes out |
|---|---|---|
| `tiff.js` | Read TIFF files | `DP.readTIFF(buffer)` → `{width, height, gray, bits}` |
| `dm.js` | Read Gatan DM3/DM4 files | `DP.readDM(buffer)` → `{width, height, gray, calibration, meta}` |
| `ocr_templates.js` | Digit shapes for reading scale-bar labels | data only, used by `detectScaleBar` |
| `imageproc.js` | Find the scale bar, the centre and every feature, in pixels | `DP.detectScaleBar(gray, W, H)` → scale bar; `DP.analyze(gray, W, H, opts)` → `{center, features[], profile}` |
| `worker.js` | Run decode and analysis off the UI thread, one image per message | message in `{name, buffer, opts}` → message out `{sb, dmCal, an, display, thumb}` |
| `crystal.js` | Crystallography: reflections and phase matching | `DP.crystal.matchPhases(features, phases, {tol})` → ranked phases with {hkl} |
| `library_data.js`, `library_refl.js` | The built-in Materials Project library | data only |
| `zip.js` | Write a ZIP for batch export | `DP.makeZip([{name, data}])` → bytes |
| `app.js` | The UI: calibration, display, editing, styling, export | the only module that holds state |

Design patterns used:

- **One narrow interface per module.** Each module is a self-contained function that adds only its public functions to one shared namespace, `DP`. Nothing else is shared between modules.
- **Plain data between steps.** Modules pass plain objects and typed arrays (`gray`, `features[]`), never UI objects. That is why the same analysis runs in the browser, in the Web Worker and in the Node tests.
- **Worker pool.** `app.js` sends each image to a pool of Web Workers, so a folder of hundreds of patterns is analysed without freezing the page.
- **One state object.** All of the UI's state lives in a single object `S` in `app.js`. Only `app.js` changes it, and **Save project** writes it to JSON.
- **Single-file build.** `build.py` bundles every module into `dist/diffraction_annotator.html`, so the whole tool is one file you can share with the lab.

To change how a step works, edit that step's module and nothing else. For example, phase ranking is only in `crystal.js`, and scale-bar reading is only in `imageproc.js` with `ocr_templates.js`.

## Choosing phases

Open **Phases → Choose elements…** and pick what could be in the sample. Only phases made from those elements are searched.

With no elements chosen, the whole library is ranked, but only your custom lists (e.g. pseudo-graphite) are applied automatically. d-spacings alone are ambiguous across thousands of phases.

Star (★) the phases you expect, e.g. bcc Na. They win ties.

**Custom d-spacing lists** cover references that are not crystal structures, such as turbostratic carbon halos. A "Pseudo-graphite" list ({002} 0.37, {100} 0.212, {110} 0.123 nm) is included.

**Limits worth knowing:**

- Materials Project lattices come from DFT and are often 1–2% too large. The scale fit absorbs this for ring patterns.
- Phases with the same structure type and similar lattice parameters cannot be told apart by d-spacing alone, e.g. Au, Al, and Ag.

## Live Materials Project search (optional)

Browsers cannot call the Materials Project API directly. To search it live, for elements or systems beyond the built-in library, use the helper `serve.py`, which `make up` already runs. Without Docker, run it with `python3 serve.py`.

It serves the app at http://127.0.0.1:8765. It reads the API key from `MP_API_KEY` or from a `.env` file next to `serve.py` containing a line `MP_API_KEY=...` (copy `.env.example` to `.env`). Each lab member should use their own key and must never share the `.env` file; git ignores it.

## Style and export

- Colours and line styles follow the label, so "Na {200}" looks the same in every image.
- Drag the legend. Choose the font, size, and background. Choose spot circle size, line width, dashed or dotted lines, and ring arc span (quarter circle by default) and position.
- **Copy image** puts the annotated PNG on the clipboard for PowerPoint.
- **Export** writes a PNG, an editable SVG, a CSV of all measurements, or a ZIP of every image plus the CSV.
- **Export region → Current view** crops to what you have zoomed into. **Scale bar → Draw a new one** adds a fresh bar when the original is cropped out.
- **Save project** stores all edits. Loading it later restores them when the same folder is opened.

## Response to the plan review

Review by Daniel Cudzich, 2026-10-14 ([20261014_dcudzich_cmserrao.md](20261014_dcudzich_cmserrao.md)). All three findings were accepted; none were pushed back on.

- **Itemise the milestones:** accepted. [PROMPT.md](PROMPT.md) section 5 lists M1–M6, each with what "done" means and its status.
- **Specify units:** accepted. [PROMPT.md](PROMPT.md) section 3 and the Units section below give the unit of every quantity, and settle d = 1/g.
- **State the check formally:** accepted. [PROMPT.md](PROMPT.md) section 6 lists five checks, including a hand comparison in ImageJ on 10 patterns within 2% on d.

## Response to the code review

Review by Linda Lin, 2026-10-20 ([feedback/20261020_ldlin_cmserrao.md](feedback/20261020_ldlin_cmserrao.md)).

- **Split the analysis into one file per function, tied together by `analyze`:** answered, not yet built in. `DP.analyze` remains the single entry point, and its steps (mask, centre, radial profile, peaks, spots, classification) are marked sections in `imageproc.js`. Those steps share working arrays, and the single-file build already keeps each module's interface narrow. Splitting them will be worth it once a step needs to change on its own; until then, the regression and contract tests guard its output.

## Response to the test reviews

Reviews by Linda Lin, 2026-10-27 ([feedback/20261027_ldlin_cmserrao.md](feedback/20261027_ldlin_cmserrao.md)), and Logan Russo, 2026-11-01 ([feedback/20261101_lrusso3_cmserrao.md](feedback/20261101_lrusso3_cmserrao.md)). Each finding is built in or answered in one line, with the reason.

- **There is no backend API; is that allowed?** (Linda): *answered*. The tool runs in the browser on purpose, so no image data leaves the computer and the whole tool is one shareable file. The analysis modules play the backend's role in Web Workers; see [ARCHITECTURE.md](ARCHITECTURE.md).
- **The contract between front and back is only implied** (Linda): *built in*. [ARCHITECTURE.md](ARCHITECTURE.md) now spells out every field `app.js` relies on, and `tests/check_contract.js` (part of `make test`) fails if any of them changes.
- **No test has been shown failing on a planted defect** (Linda): *built in*. Two defects were planted and caught: a spot pair's radius not halved (caught by the contract test) and d-spacings without the square root (caught by `make check`). The sample tests passed the first one, which is why the contract test now checks pair radii.
- **"Clear labels" leaves the marks on the image** (Linda): *built in*. A new **Remove all marks** button clears every spot and ring; **Re-detect features** brings the automatic ones back.
- **Dragging a contrast slider also drags the image** (Logan): *built in*. Clicks on the toolbar no longer reach the image.
- **"Calibrate by clicking…" then + Spot or + Ring froze the page** (Logan): *built in*. Same cause: the click on the tool button was counted as a calibration point. It no longer is.
- **The Open folder / Open files buttons did not work** (Logan): *answered, not reproduced*. They work in Chrome; the VS Code preview browser does not open file dialogs. Use a regular browser or drag and drop.
- **The interface is busy; features and phases fill in automatically** (Linda): *answered*. Auto-detection is the point of the tool, since it replaces hand measurement. **Hide weak** and per-feature hiding already thin the view; grouping the panels by colour is on the open list.
- **Move "Best matches for this image" closer to the front** (Logan): *kept as is*. The reviewer marked it optional, and matches only make sense after the features above them are checked.
- **A built-in tutorial** (Linda): *answered, not yet built*. The hover hints on every tool are the first step; a walkthrough is on the open list.
- **Tests check consistency, not the science; add expected values** (Linda): *answered, not yet built*. The expected d-spacings must come from hand measurement in ImageJ, which is acceptance check 5, still open. They will go into `tests/sample_cases.json` when measured.

## Response to the systems reviews

Reviews by Logan Russo, 2026-11-05 ([feedback/20261104_lrusso3_cmserrao.md](feedback/20261104_lrusso3_cmserrao.md)), and Linda Lin, 2026-11-09 ([feedback/20261108_ldlin_cmserrao.md](feedback/20261108_ldlin_cmserrao.md)), of commit `a2cb5ba`. Each finding is built in or answered in one line, with the reason.

- **Dropping several files at once kept only the first** (Logan): *built in*. The browser empties the list of dropped items as soon as the drop handler pauses, so the page now takes every item before it starts reading any of them.
- **"+ Ring" snapping is touchy; a click on the ring sometimes did not snap** (Logan): *built in*. It snapped to the highest point of the raw, noisy profile within a few percent of the click, which on the Au standard jumped 41 px off a ring clicked right on it. It now snaps to the nearest peak of the profile smoothed the way ring detection smooths it (`DP.snapRing`), says so when there is no peak nearby, and `make test` checks that a click 2 px off each detected ring lands on it.
- **After Remove all marks, Auto-identify does not bring the points back** (Linda): *built in*. Auto-identify only names marks that exist, so with no marks it now re-detects the features first, then identifies them.
- **The slider next to Contrast has no label** (Linda): *built in*. It is labelled **Brightness** (the white level), and both sliders say in their hover text which way brightens faint features.
- **Tell rings and spots apart by colour** (Linda): *built in* as an option. **Style → Colour by → Feature type** draws rings and halos in shades of blue and spots in shades of orange. The default stays **Label**, so a phase keeps one colour across a set of figures.
- **The system is explained mostly in text** (Logan, Linda): *built in*. "Where everything runs", above, draws the container, the browser tab, the workers and the one outside service, with how code and data reach each.
- **The split is confusing because of the materials library** (Logan): *answered*. The library is data bundled into the page, not a service; [ARCHITECTURE.md](ARCHITECTURE.md) now says so, and the only service boundary is the optional live search through `serve.py`.

## Speed: one measured change

`make bench` times what the worker runs on each pattern in `samples/` (read the file, find the scale bar, analyze), stage by stage, as the median of three runs with the spread (min to max). It ran in the development container on a MacBook Air (Apple Silicon).

**Where the time goes.** Analysis takes about 85% of the time, reading the TIFFs about 13%, and the scale bar about 2%. A CPU profile of the analysis put the blur at the top: about a quarter of the time, mostly in its vertical pass. That pass walked the image one column at a time, jumping a whole row in memory between pixels.

**The change.** The vertical pass of both blurs (`blur1d` and `boxPass` in `src/imageproc.js`) now walks whole rows and keeps one running sum per column. Each pixel adds the same terms in the same order, so every result is identical. On its own the blur is about 2× faster.

**The answer key.** `make bench BENCH_ARGS="--save bench/key.json"` saved the full output for every sample before the change: image size, scale bar, centre, every feature, and the radial profile. `make bench BENCH_ARGS="--check bench/key.json"` compares the output against it. After the change it is identical. A planted rounding change in the new blur failed the check on all five samples.

| Stage, all 5 samples | Before | After | Ratio |
|---|---|---|---|
| analyze (the part that dominates) | 17.760 s (17.456 to 17.937) | 15.451 s (15.394 to 19.081) | 1.15× faster |
| whole run | 20.793 s (20.037 to 20.809) | 18.202 s (18.155 to 22.191) | 1.14× faster |

`make verify` is green after the change. The next candidate is the ring fit, which is about 13% of the time and dominated by `Math.hypot`. Replacing it with a plain square root could change a last digit, so it was left as is.

## Units

| Quantity | Unit |
|---|---|
| Calibration | nm⁻¹ per pixel |
| Centre and feature positions | px |
| Distance from centre, g | nm⁻¹ |
| d-spacing, d = 1/g | nm |
| Mismatch to a reference phase | % of d |
| Ring arc span and position | degrees |

For a spot pair, g is half the spot-to-spot distance. The CSV export uses these units.

## Verifying results

The full acceptance checks are in [PROMPT.md](PROMPT.md), section 6. In short:

| Check | Pass condition | Status |
|---|---|---|
| Sample patterns (`make test`) | The 5 patterns in `samples/`: verified centres within tolerance, scale bars read, two runs identical | Passing |
| Contract (`make test`) | Every field the UI reads from the analysis has the documented shape and units ([ARCHITECTURE.md](ARCHITECTURE.md)) | Passing |
| Regression tests (`make lab-test`) | 16 verified centres within tolerance; two runs identical | Passing |
| Synthetic pattern | Known d = 0.2222, 0.1538, 0.1081 nm returned exactly | Passing |
| Calibration | All scale bars read; scale bar and DM4 agree within 0.1% | Passing (541/541, 0.08%) |
| Au standard | Au {111}, {200}, {220}, {311} rings found and labelled Au | Failing: {111} missed |
| Manual comparison | 10 patterns measured by hand in ImageJ, every feature type covered; tool's d within 2% and same phase | Not yet done |

`make test` runs from a fresh clone. The full regression test (`make lab-test`) reads images at the paths in `tests/regression_cases.json`, relative to the project folder (`data/...`), so it needs the lab's `data/` folder, which is not in this repository. Without the data it reports every case as skipped and exits with failure, because nothing was tested.

## Rebuild / maintain

```bash
make dist                                       # bundle src/ into dist/diffraction_annotator.html
make bench BENCH_ARGS="--check bench/key.json"  # time each stage; check results match the answer key
make lab-test                                   # needs the lab data; see Verifying results
make shell                                      # a shell in the container, for the two below
python3 tools/build_library.py                  # refresh library from Materials Project (needs key)
node tools/precompute_reflections.js 0.07       # precompute reflection lists
```

The source layout and each module's interface are in [How the code is organized](#how-the-code-is-organized).
