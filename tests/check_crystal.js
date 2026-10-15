// Checks that need no microscope data, so they also run on GitHub (make check).
// The annotator matches measured rings against spacings that crystal.js computes
// from the Materials Project library; these checks pin both down on two textbook
// cases. Run from anywhere:  node diffraction_tool/tests/check_crystal.js
const DP = require('./load.js'); const fs = require('fs'); const path = require('path');
(0, eval)(fs.readFileSync(path.join(__dirname, '..', 'src', 'library_refl.js'), 'utf8'));
const C = DP.crystal;
const CSN = ['triclinic', 'monoclinic', 'orthorhombic', 'tetragonal', 'trigonal', 'hexagonal', 'cubic'];
const TOL = 0.03; // the annotator's phase-matching tolerance (matchPhases, tol: 0.03)

// FCC gold reflects only where h, k, l are all odd or all even: {111} {200} {220} {311}.
// BCC sodium reflects only where h + k + l is even: {110} {200} {211} {220}.
// Measured lattice constants at room temperature, in angstroms (cooling shrinks Na ~1.5%).
const CASES = [
  { formula: 'Au', sg: 'Fm-3m', rings: ['{111}', '{200}', '{220}', '{311}'], aMeasured: 4.078 },
  { formula: 'Na', sg: 'Im-3m', rings: ['{110}', '{200}', '{211}', '{220}'], aMeasured: 4.291 },
];

let fail = 0;
const check = (ok, msg) => { console.log(ok ? 'PASS' : 'FAIL', msg); if (!ok) fail++; };

function libraryPhase(formula, sg) {
  const row = DP.LIBRARY_ROWS.find((r) => r[1] === formula && r[2] === sg);
  if (!row) throw new Error(`${formula} ${sg} is missing from the phase library`);
  const [id, , , cs, , , lat, sf] = row;
  const sites = []; for (let i = 0; i < sf.length; i += 4) sites.push({ el: sf[i], f: sf.slice(i + 1, i + 4) });
  return { id, st: { id, name: formula, crystalSystem: CSN[cs], lattice: [lat.slice(0, 3), lat.slice(3, 6), lat.slice(6, 9)], sites } };
}

for (const c of CASES) {
  const { id, st } = libraryPhase(c.formula, c.sg);
  const cv = C.conventionalize(st);
  const a = C.params(cv.lattice).a; // angstroms
  const first = C.reflections(cv, 0.1).slice(0, c.rings.length);
  const labels = first.map((r) => r.label);
  check(labels.join(' ') === c.rings.join(' '), `${c.formula} ${c.sg}: first rings ${labels.join(' ')} (expected ${c.rings.join(' ')})`);

  // A cubic crystal's spacings are d = a / sqrt(h^2 + k^2 + l^2). The library stores lattice
  // vectors to 4 decimals, so the rebuilt cell is cubic only to ~3e-5; a wrong formula is off by >1e-2.
  const relErr = first.map((r) => { const want = a / Math.hypot(...r.hkl); return Math.abs(r.d * 10 - want) / want; });
  const worst = Math.max(...relErr);
  check(worst < 1e-4, `${c.formula}: spacings follow d = a/sqrt(h^2+k^2+l^2) with a = ${a.toFixed(3)} A (worst relative error ${worst.toExponential(1)})`);

  // The precomputed table the browser loads (tools/precompute_reflections.js) agrees with crystal.js.
  const pre = DP.LIBRARY_REFL[id].r.slice(0, first.length).map(([d]) => d);
  const diff = Math.max(...pre.map((d, i) => Math.abs(d - first[i].d)));
  check(diff < 1e-4, `${c.formula}: precomputed library spacings match crystal.js (largest difference ${diff.toExponential(1)} nm)`);

  // The library's lattice (a DFT calculation) is close enough to the measured one for matching to work.
  const off = (a - c.aMeasured) / c.aMeasured;
  check(Math.abs(off) < TOL, `${c.formula}: library a = ${a.toFixed(3)} A vs measured ${c.aMeasured} A (${(off * 100).toFixed(1)}%, matching tolerance +/-${TOL * 100}%)`);
}

console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
process.exit(fail ? 1 : 0);
