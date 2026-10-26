# Sample patterns

Five selected-area electron diffraction (SAED) patterns from the lab's sodium in
hard carbon work, one or more of each feature type the annotator handles. They
are the original 8-bit TIFF exports (2048 to 4096 px square) with the scale bar
burned in, so calibration is read from the bar just as for new data.

| File | What it shows | Scale bar | Verified centre (px) |
|---|---|---|---|
| `250704_0030.tif` | Amorphous carbon halos only | 5 1/nm | 2060, 1987 |
| `250203_HC_cryo_0.05V_newEL_0045.tif` | Amorphous halos plus single-crystal spots | 5 1/nm | not checked |
| `250203_HC_cryo_0.05V_newEL_0003.tif` | Au calibration standard: spotty polycrystalline rings | 5 1/nm | 1000, 984 |
| `241122_HC_cryo_air_free_RT_to_cryo_0092.tif` | Single-crystal spot pairs on top of rings | 5 1/nm | 1990, 1933 |
| `bare-test-10secexposure_OneView_600X_baretest-heatup-cooldown_0065.tif` | Faint halos, a different camera (OneView) and bar length | 10 1/nm | 2129, 1819 |

The verified centres were checked by eye on each pattern; `make test` checks
that the tool finds each one within tolerance (25 to 40 px), reads every scale
bar, and gives the same answer on two runs (see `tests/sample_cases.json`).

Known weak spot: on the Au standard, the {111} ring next to the beam stop is
missed (README, Verifying results).

To try them: `make up`, open http://127.0.0.1:8765/, click **Open folder**
and choose this `samples` folder (or drag the folder onto the page).
