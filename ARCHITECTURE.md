# Architecture

Diffraction Annotator runs in the browser. There is no server-side analysis: the
"backend" is the set of analysis modules (`tiff.js`, `dm.js`, `imageproc.js`,
`crystal.js`), which run in Web Workers, and the "frontend" is `app.js`, which draws
and handles interaction. `serve.py` is the only server; it serves the page and
proxies the optional live Materials Project search, because browsers cannot call
that API directly.

This is on purpose: no image data leaves the computer, and the whole tool is one
HTML file (`dist/diffraction_annotator.html`) that can be shared with the lab.

## The pipeline

```text
app.js ──file──► worker.js ──► tiff.js / dm.js ──► imageproc.js ──► worker.js ──result──► app.js ──► crystal.js ──► app.js
 queue           decode         pixels             scale bar,        post back              calibrate   match           draw, edit,
 jobs                                              centre, features                          to 1/nm     phases          export
```

## Contract

`app.js` relies only on the fields below. `tests/check_contract.js` (run by
`make test`) checks every one of them on a sample pattern, so a change that breaks
the contract fails the build.

**Readers.** `DP.readTIFF(buffer)` and `DP.readDM(buffer)` return
`{width, height, gray, bits}`: `gray` is a `Float32Array` of `width × height`.
`readDM` adds `calibration: {scale, units}` (reciprocal-space units per px).

**Scale bar.** `DP.detectScaleBar(gray, W, H)` returns `null` or
`{x0, y0, x1, y1, lengthPx, value, unit, text, confidence}`. `value` is `null` when
the label could not be read; otherwise it is positive, with `unit` such as `1/nm`.

**Analysis.** `DP.analyze(gray, W, H, opts)` returns
`{center, features, profile, ...}`. All coordinates are original-image pixels.

| Field | Type | Meaning |
|---|---|---|
| `center` | `{x, y}` | pattern centre, inside the image |
| `features[]` | list, sorted by `r` | one entry per halo, ring or spot |
| `features[].id` | `"f1"`, `"f2"`, … | stable within one analysis |
| `features[].kind` | `halo`, `ring`, `spotty`, `pair` or `spot` | what the feature is |
| `features[].r` | px, > 0 | distance from the centre. For a `pair`, half the spot-to-spot distance |
| `features[].points` | `[{x, y}]` | marked positions, inside the image |
| `profile` | `[[r, median, background, residual]]` | the radial profile behind the ring detection |

**Worker messages.** In: `{id, name, buffer, opts, want}`. Out:
`{id, width, height, kind, bits, dmCal, meta, sb, an, thumb, display}`, or
`{id, error}`. `an` is the analysis above.

**Phase matching.** `DP.crystal.matchPhases(features, phases, {tol})` takes
`[{id, kind, d, dErr, vec}]` with `d` in nm (`app.js` converts `r` to `d = 1/g`
with the calibration) and returns phases ranked by score, each with its `{hkl}`
assignments.

## Tests

| Kind | Test | Command |
|---|---|---|
| Unit | `tests/check_crystal.js`: reflections and spacings on Au and Na | `make check` |
| Contract | `tests/check_contract.js`: the fields above on a sample pattern | `make test` |
| Integration | `tests/regression.js`: centre, scale bar and determinism on `samples/` | `make test` |
| Smoke | the running app serves the page and a sample | `make smoke` |
| Answer key | `tools/bench.js --check bench/key.json`: every result on `samples/` identical to the saved key | `make bench` |

`make verify` runs all of them. The unit and contract tests were each shown
failing on a planted defect (see `WORKLOG.md`, 2026-11-04). The integration test
was not: it checks centres and determinism, so it passes a wrong d-spacing.
