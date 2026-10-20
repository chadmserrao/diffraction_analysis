# Prompt

What the diffraction tool must do, how we will know it works, and in what order it gets built. This is a structured version of the original request from 2026-09-26, which is kept word for word in the appendix. It was refined after the peer review of 2026-10-14 (`20261014_dcudzich_cmserrao.md`), which asked for numbered milestones, explicit units, and a stated check.

## 1. Who uses it, and for what decision

- **Users:** me and the members of my lab who take selected-area electron diffraction (SAED) patterns on the TEM. Samples are mostly Na in hard carbon, so patterns are often mixed: amorphous carbon halos, Na or Na-compound single-crystal spots, and Au calibration rings.
- **Decision it serves:** which phase, and which plane {hkl}, each spot, ring, or halo belongs to, shown as an annotated figure ready for a slide or paper.
- **What it replaces:** measuring each pattern by hand in Fiji, ImageJ, or DigitalMicrograph, computing d-spacings, and then drawing circles, quarter-arcs, and a coloured legend in PowerPoint.

## 2. Data in

- A folder of patterns, dropped onto a web page that runs locally in the browser. No image data leaves the computer.
- File types: TIFF, PNG, or JPG exports with a burned-in scale bar; DM3 and DM4 files.
- **Calibration**, in nm⁻¹ per pixel:
  - Exports: from the scale bar's length in pixels and its label (e.g. "5 1/nm", "5 nm⁻¹"), in Gatan DM and Thermo Fisher Velox/Ceta styles.
  - DM3/DM4: from the file metadata.
- Optional: the elements that could be in the sample (picked on a periodic table), and custom d-spacing lists for references that are not crystal structures, such as pseudo-graphite.

## 3. Data out, with units

| Quantity | Unit | Notes |
|---|---|---|
| Pattern centre, feature positions | px | In image pixel coordinates |
| Ring radius or spot distance from centre, g | nm⁻¹ | Pixel distance × calibration |
| Spot pair separation | nm⁻¹ | g is half the spot-to-spot distance, so it does not depend on the centre |
| d-spacing | nm | d = 1/g |
| Ring arc span and position | degrees | Quarter circle (90°) by default |
| Feature type | — | Diffuse halo (amorphous), sharp ring (polycrystalline), spotty ring, spot pair (single crystal), single spot |
| Phase candidates | — | Phase name, {hkl}, and the mismatch between measured and reference d, in % |
| Zone axis | [uvw] | Only when two or more spot pairs are found |

This settles the question in the original request: d = 1/g, where g is measured from the centre. Measuring between two opposite spots gives 2g, so that distance is halved first.

Exports: annotated PNG and editable SVG, a CSV of every measurement in the units above, and a ZIP of all images plus the CSV.

## 4. How the result is computed

1. **Calibrate:** read the scale bar (or the DM metadata) to get nm⁻¹ per pixel.
2. **Find the centre:** correlate the pattern with its 180° rotation (Friedel symmetry), then refine by fitting concentric circles to ring peaks.
3. **Find and classify features:** take radial intensity profiles; classify each ring or spot separately, so mixed patterns work.
4. **Measure:** convert each feature's radius to g, then to d = 1/g.
5. **Match phases:** compare measured d-spacings against Materials Project structures, restricted to the chosen elements, using kinematic electron intensities so systematically absent reflections drop out. Rank by fit, allowing a common scale error so that line ratios decide.
6. **Annotate:** draw circles on spots and partial arcs on rings, coloured by label, with a movable legend.

The same file must always give the same result.

## 5. Milestones

| # | Milestone | Done when | Status |
|---|---|---|---|
| M1 | One pattern, calibrated and measured | A single TIFF or DM file gives a centre, a calibration, and d-spacings in nm | Done |
| M2 | Classify features | Halos, rings, spotty rings, spot pairs, and single spots are told apart in mixed patterns | Done |
| M3 | Phase matching | Element picker, built-in Materials Project library, custom lists, and ranked candidates with mismatch; optional live search through `serve.py` | Done |
| M4 | Styling and export | Movable legend, fonts, circle size, solid/dashed/dotted lines, arc span; PNG, SVG, CSV, ZIP, copy to clipboard | Done |
| M5 | Batch a folder | Drop a folder, step through every pattern, save and reload the project | Done |
| M6 | Match the lab's slide conventions | Dashed halo arcs, only identified features in the legend, correct names and subscripts (Pseudo-Graphite, Na₂O), grouped colours where the slides group them, tighter halo tolerance, Au {111} ring found near the beam stop | Open (see `WORKLOG.md`, Open items) |

## 6. Checks the result must pass

1. **Regression tests:** 16 visually verified pattern centres, each within its pixel tolerance, plus a determinism check (two runs give identical results). Run `node tests/regression.js` from the folder that holds the data. Status: passing.
2. **Synthetic pattern:** a pattern generated with known d-spacings (0.2222, 0.1538, 0.1081 nm) must return them exactly. Status: passing.
3. **Calibration:** on the lab dataset, every scale bar must be read, and scale-bar and DM4 calibrations of the same image must agree within 0.1%. Status: 541 of 541 read; agreement within 0.08%.
4. **Au standard:** on a Au calibration pattern, the Au {111}, {200}, {220}, and {311} rings must be found and labelled Au. Status: failing; the {111} ring is missed (part of M6).
5. **Manual comparison with ImageJ:** a person measures 10 patterns by hand in ImageJ, covering every feature type (halo only, rings, halo plus spots, spots only, and the Au standard). For every feature measured in both, the tool's d-spacing must be within **2%** of the manual value, and the identified phase must agree. Status: not yet done.

## 7. How far the result can be trusted

- d-spacings are trustworthy once the checks above pass; phase labels are suggestions to be confirmed by the user.
- Phases with the same structure type and similar lattice parameters (e.g. Au, Al, Ag) cannot be told apart by d-spacing alone.
- Materials Project lattices come from DFT and are often 1–2% too large; the scale fit absorbs this for ring patterns, but not for a single isolated spot pair.
- Patterns flagged with low centre confidence (126 of 542 in the lab dataset) should be checked by eye, and the centre set by hand if needed.

## Appendix: original request (2026-09-26, word for word)

So um, this would maybe be another project, but a much smaller project in the TEM AI automation sort of idea. Um, essentially what I want to do, you know, you have access to my Google Drive and to a lot of this data. Like I want to take uh, diffraction patterns. And so let me tell you about my workflow as it currently stands. Currently, if I want to produce an image with a diffraction pattern, say in a presentation, and I want to be able to, on that image, identify the diffraction spots, so each of the bright spots in the image, and I want to identify maybe, you know, diffraction rings or amorphous rings, right? Um, more diffuse sort of rings. I then have to like go into, you know, either Fiji um, or ImageJ um, or, you know, DM4 and then be able to then, you know, measure it and then, you know, put it into a PowerPoint presentation and I'll add graphics that then like, like a circle, say, that will like go around um, one of the diffraction or the diffraction spots, right? Or I'll, I'll, you know, look at a diffraction ring and I'll overlay on top of that. Um, imagine like I overlay a circle that's perfectly on top of that, you know, that diffraction ring, but then I only like have a quarter of that uh, circle. So that way you can actually see the diffraction ring and then I'll add some sort of, I will add some sort of like labeling, you know, each of the circles around the diffraction spots or like the quarter circle on the ring of a certain color. And then I'll associate that with like a legend um, that will then, you know, show like, okay, it's, you know, that's the two zero zero spot or it's the one one one spot or that's like the carbon, you know, whatever, right? and so, you know, I'm able to then, say that something is like most likely sodium 200 plane or you know 110 plane or whatever because I'm able to you know look at measure the distance between the diffraction spots right and then be able to um you know I basically just like take an intensity scan across the the image to two of the diffraction spots and from peak to peak I then, you know, have um, some distance. I, you know, cut that, um, or I do one over that distance, right, to go from reciprocal space to real space, um, you know, and then that is, um, you know, equal to the despacing. Right, I think so. Or is it the distance divided by two and then one over that? You'll have to remind me. But then basically I want to be able to create like essentially like an HTML web page that I can like share with my lab where they can like drag and drop a folder, right? And then it automatically goes through each of the diffraction patterns and basically does that process and then, you know, labels it accordingly and can be exported, you know, nicely. And you can even move around the legend to show where you want it. Um, and you can have different like, um, you know, I don't know, fonts for the, the legend. You can like have circles be the thing that identifies the diffraction spots or other objects. You can like do like solid or dotted or, you know, whatever. Um, And then just kind of expedite the process. And uh, as far as identification goes, like I think that what would be really useful is that there's a, currently the materials project, right? Um, and I don't know how large their data sets are, but like I'm thinking like, what if, you know, you have a periodic table and you, you know, go ahead and you like pick which elements you think are going to be in there. And then that allows us to call like the API from the materials project and, um, you know, go ahead and, you know, see what matches, um, like see what the despacing are and give a, a list and like of what seems the closest. Right. Um, and so that would be cool. Um, and I mean, maybe there's a way to do it where we don't have to even like, you know, like have a user say, oh, I have sodium in my sample, right? Maybe there's like a way where you just put everything in um, and then have it be able to just like find the despacing it's closest without looking through the database or whatever. I don't know if that would, you know, how that's doable. So yeah, wanted to just see what you think about that project and see if we can do this.
