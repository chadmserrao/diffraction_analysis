# Diffraction Annotator: Work Log

A single-file web app that measures and labels electron diffraction patterns (spots, rings, amorphous halos), matches d-spacings against Materials Project phases, and exports annotated figures in the style of the lab's slides.

- **Location:** `tem_ai_automation/diffraction_tool/`
- **Deliverable:** `dist/diffraction_annotator.html` (about 10 MB, self-contained, runs locally in the browser)

---

## 2026-09-26: Scoping and data survey

**Requirements, from the conversation:**
- Replace the manual workflow (Fiji/DM line scan → d = 1/g → PowerPoint circles, quarter arcs, and coloured legend).
- Drag and drop a folder, and process every pattern automatically.
- Styling controls: movable legend, fonts, circle or other markers, and solid, dashed, or dotted lines.
- Phase identification from the Materials Project, with a periodic-table element picker.
- Handle patterns with only one spot pair, polycrystalline rings, and mixed cases (amorphous halo plus single-crystal spots).
- Use the burned-in scale bar for calibration, with DM4 metadata as an option.
- Deterministic results that handle every case in the lab data.

**Physics confirmed with the user:**
- d = 1/g, where g is the distance from the centre in 1/nm.
- Measuring across a Friedel pair gives 2g, so halve the distance before inverting.

**Reference material reviewed:**
- `250606_group_presentation.pptx`, slides 9, 12, 15, and 17.
  - Na {200} spots are marked with circles.
  - Pseudo-graphite {100} (0.212 nm) and {110} (0.123 nm) halos are marked with dashed quarter arcs.
  - Legend format is "Na {200} | 0.213 nm".
- **Key observation:** Na {200} (0.213 nm) and pseudo-graphite {100} (0.212 nm) coincide in radius. Only the spot-versus-halo character tells them apart.

**Test data:**
- 593 diffraction frames are listed in `labeling/site/manifest.json`. After excluding DigiScan frames, 542 are usable.
- They are 8-bit RGB LZW TIFF exports "as displayed", with Gatan scale bars burned in.
- One DM4 file has a matching TIFF export, which allows a cross-check of calibration.

**Materials Project API:**
- The key works. It is stored in `diffraction_tool/.env` (chmod 600) and is not present in any shareable file.
- Browser calls are blocked by CORS. This led to a built-in offline library plus an optional local proxy (`serve.py`).
- Materials Project returns primitive cells, so the app converts them to conventional cells to get standard labels.

## 2026-09-26: Core modules

- **`src/tiff.js`:** TIFF reader (LZW, PackBits, Deflate, strips or tiles, 8/16/32-bit). Output is byte-identical to `tifffile`.
- **`src/dm.js`:** DM3/DM4 reader, including calibration. It reads 0.007037 1/nm per px from the test DM4.

**Scale bar detection and label reading (`src/imageproc.js`):**
- Finds the bar as a long, thin, saturated rectangle.
- Reads the label with digit templates.
  - DM label glyphs were extracted from the dataset. They were later confirmed to be Calibri.
  - Templates for Calibri, Arial, Tahoma, Verdana, and Helvetica were added.
- Fixes along the way:
  - Background-relative threshold, for bright backgrounds.
  - Taller search region, for Velox/Ceta "5 nm⁻¹" labels.
  - Superscript detection, for "nm⁻¹".
  - Slash detection, for tightly spaced "5 1/nm".
  - Skipping stray blobs next to the number.
- **Result:** 541 of 541 bars read at full confidence. The one miss is an exported intensity plot, not a pattern.
- **Cross-check:** scale bar gives 0.0070423 1/nm per px, and DM4 metadata gives 0.0070369. They agree within 0.08%.

**Centre finding (several iterations):**

| Attempt | Outcome |
|---|---|
| FFT self-convolution | Fooled by the stopper arm and asymmetric glow |
| Angular-variance refinement | Drifted |
| Sector-profile alignment | Weak discrimination, diverged |
| Masked normalised cross-correlation with the 180° rotation (log and band-pass versions) | Band-pass verified better visually on 6 patterns |
| Stopper arm false peaks | Fixed first with a stopper-tip constraint. The tip definition was later changed to the "deepest dark point", and interior bulb components were included. |
| Ray-based concentric circle fit, clustering of fits from several starts | Improved precision |
| Soft priors (stopper bulb, glow centre) instead of hard cut-offs | Fixed faint-stopper cases |
| Friedel midpoint voting (midpoint of every symmetric spot pair) | Strong for spot-rich patterns. Overrides at ≥ 20 votes and boosts agreeing clusters otherwise. |

- A centre-confidence flag ("check centre") is raised when the independent estimates disagree by more than 1.5% of the image width.

**Features:**
- Radial median profile, with a background from the lower convex hull in log-log space.
- Peaks are classified as halo, ring, or spotty ring using width and angular coverage.
- Spots are found by local contrast, grouped into rings, then paired by Friedel symmetry. Unpaired strong spots are kept as single spots, since their partner may be hidden by the stopper.
- Fixes along the way:
  - Reject glow-edge rings next to the bulb.
  - Reject rings mostly outside the image.
  - Merge duplicate ring and halo detections.

**Crystallography (`src/crystal.js`):**
- Conventional-cell search guided by crystal system. It gives bcc Na a = 4.208 Å and antifluorite Na₂O.
- Kinematic electron structure factors from a screened-Coulomb form factor, which removes systematic absences.
- Reflection families and multiplicities.
- Matching:
  - Penalises phases with dense line lists (figure-of-merit idea from powder diffraction).
  - Fits a common scale factor, absorbing calibration and DFT lattice error.
  - Penalises missing strong rings.
  - Mild priors for experimental and stable phases.
  - Zone-axis check from the angle between two spot pairs, limited to the top 25 candidates for speed.
- Verified results:
  - Na [001] zone from {200} and {110} at 45°.
  - Au standard ranks face-centred cubic structures first. Au, Al, and Ag are indistinguishable by d alone.

**Library:**
- `tools/build_library.py` builds the phase library from 1,849 chemical systems. After a stability filter, 5,993 phases remain.
- `tools/precompute_reflections.js` precomputes reflection lists, so matching the whole library takes about 50 ms.

## 2026-09-26/27: Web app

- **Files:** `src/index.html`, `style.css`, `app.js`, `worker.js`, `zip.js`, and `build.py`, which bundles everything into `dist/`.
- **Processing:** a pool of background workers.
- **Interface:**
  - File list with status chips.
  - Canvas plus SVG overlay, with zoom and pan.
  - Polar (r–θ) view.
  - Tools: Select, + Spot (snaps and finds the Friedel partner), + Ring (snaps to a profile peak), Centre, and Calibrate.
- **Panels:**
  - **Features:** calibration, centre, and a per-feature kind and label dropdown with candidate phases.
  - **Phases:** periodic table, library options, "exclude molecular gases", tolerance, custom d-spacing lists, preferred-phase stars, and an ambiguity warning.
  - **Style:** font, size, legend background, marker size, line width, arc span and position, per-label colour and dash, export region and resolution, and a redrawn scale bar.
- **Legend:**
  - Placed automatically in the corner away from the arcs and the scale bar.
  - Colours follow labels across images, and are made unique within each image.
- **Export:** PNG, editable SVG, CSV, ZIP of all images plus CSV plus project, copy to clipboard, and project save and load.
- **`serve.py`:** stdlib-only server plus Materials Project proxy. It has test-only `--data` and `--debug-save` options.
- **Bugs found in browser testing and fixed:**
  - A broken regex.
  - The spot-snapping function missing on the main page.
  - Zone-check slowness.
  - Duplicate d-spacing text in the legend.
  - Colour collisions.
  - Default labeling across the whole library, now custom lists only unless elements are chosen.

## 2026-09-27: Validation

- **`tests/regression.js`:** 16 visually verified centres plus a determinism check. **All pass.**
  - Two of my own ground-truth labels were wrong and were corrected using independent evidence (ring-fit consensus and pair-midpoint voting).
- **Full dataset (542 patterns):**
  - 0 errors.
  - 541 calibrated automatically.
  - Centre confidence: 416 high, 126 flagged.
  - Pattern types:

| Type | Count |
|---|---|
| Amorphous + spots | 288 |
| Rings | 138 |
| Amorphous only | 92 |
| Spots only | 11 |
| None | 13 |

- **Synthetic pattern with known answers:** d = 0.2222, 0.1538, and 0.1081 nm, all exact.
- **Speed:** about 1.8 s per 4096² image in Node. It is slower in a hidden or throttled browser tab.

## 2026-09-27: Demo

- Six patterns were exported and shared.
- **Good:** halo-only patterns (250704_0030, Ceta 0004) and halo plus NaF spots (250203_0045).
- **Weak:**
  - 241218_0056: doubtful NaO₂ labels, and a halo labeled 13% off.
  - 250203_0003, Au standard: the Au {111} ring is missed, and the rings are labeled Na₂O.
  - 241122_0092: cluttered legend.

## 2026-09-30: Review against the user's reference slides

The defaults deviate from the annotation style in `250606_group_presentation.pptx`:

1. Halo arcs are solid. The slides use dashed arcs.
2. Every detected feature is drawn and listed, including unlabeled "d = …" entries. The slides show only identified features.
3. Naming: "Pseudo-graphite" instead of "Pseudo-Graphite". "Na2O" is shown without a subscript. Space groups are appended to polymorph names.
4. The built-in interlayer halo is {002} at 0.37 nm. Slide 49 uses "Pseudo-Graphite {200}" at 0.358 nm.
5. {100} and {110} get separate colours and lines. The slides sometimes group them in one colour or one line.
6. Halo tolerance is too loose, which allowed a 13%-off pseudo-graphite label despite the known Na {200} / pseudo-graphite {100} coincidence.

---

## Open items

- [ ] Apply the slide conventions as defaults (items 1–6 above).
- [ ] Detect bright, dense spotty rings near the stopper (Au {111} miss).
- [ ] Tighten the halo matching tolerance.
- [ ] Reduce legend clutter on busy single-crystal patterns, e.g. hide unassigned features by default.
- [ ] Test opening `dist/` directly from disk (file://). The preview browser could not open local files.
- [ ] Consider regenerating the Materials Project API key, since it was pasted in chat.

## How to rebuild and test

```bash
cd diffraction_tool
python3 tools/build_library.py              # refresh library (needs MP key in .env)
node tools/precompute_reflections.js 0.07   # precompute reflections
python3 build.py                            # bundle into dist/
cd .. && node diffraction_tool/tests/regression.js
```
