# Diffraction Annotator

Diffraction Annotator turns a folder of TEM selected-area electron diffraction patterns into measured, labelled figures, replacing hand measurement in ImageJ and hand annotation in PowerPoint. For each pattern it calibrates from the scale bar or DM metadata, finds the centre, classifies every spot, ring and amorphous halo, and reports its d-spacing in nm with the best-matching Materials Project phase and {hkl}. Results are deterministic and are accepted only after they match the hand measurements in ImageJ within 2% on 10 patterns covering every feature type.

A single-file web app that measures and labels electron diffraction patterns. It finds spots, rings, and amorphous halos, measures their d-spacings, suggests phases from the Materials Project, and exports publication-ready annotated images.

Everything runs locally in the browser. No image data leaves the computer.

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
| Regression tests (`make lab-test`) | 16 verified centres within tolerance; two runs identical | Passing |
| Synthetic pattern | Known d = 0.2222, 0.1538, 0.1081 nm returned exactly | Passing |
| Calibration | All scale bars read; scale bar and DM4 agree within 0.1% | Passing (541/541, 0.08%) |
| Au standard | Au {111}, {200}, {220}, {311} rings found and labelled Au | Failing: {111} missed |
| Manual comparison | 10 patterns measured by hand in ImageJ, every feature type covered; tool's d within 2% and same phase | Not yet done |

`make test` runs from a fresh clone. The full regression test (`make lab-test`) reads images at the paths in `tests/regression_cases.json`, relative to the project folder (`data/...`), so it needs the lab's `data/` folder, which is not in this repository. Without the data it reports every case as skipped and exits with failure, because nothing was tested.

## Rebuild / maintain

```bash
make dist                                       # bundle src/ into dist/diffraction_annotator.html
make lab-test                                   # needs the lab data; see Verifying results
make shell                                      # a shell in the container, for the two below
python3 tools/build_library.py                  # refresh library from Materials Project (needs key)
node tools/precompute_reflections.js 0.07       # precompute reflection lists
```

Source layout (`src/`):

- `tiff.js`, `dm.js`: file readers
- `imageproc.js`: scale bar, centre, rings, spots
- `crystal.js`: structures, reflections, matching
- `app.js`: UI
- `worker.js`: background analysis
