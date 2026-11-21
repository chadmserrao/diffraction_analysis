// Known answers: the d-spacings and phase labels on the Au standard, against textbook gold.
// The sample tests only check centres, scale bars and that runs repeat; this one checks
// that the numbers a user would put on a slide are right (peer review, Linda, 2026-11-15).
// Run from the project root:  node tests/check_known_answers.js   (part of make test)
const DP = require('./load.js'); const fs = require('fs');
const FILE = 'samples/250203_HC_cryo_0.05V_newEL_0003.tif'; // Au standard, 5 1/nm scale bar
const A_AU = 0.40782; // nm, gold's lattice constant at room temperature
const hkl = (h, k, l) => ({ label: `{${h}${k}${l}}`, d: A_AU / Math.hypot(h, k, l) });
const AU = [hkl(1, 1, 1), hkl(2, 0, 0), hkl(2, 2, 0), hkl(3, 1, 1), hkl(2, 2, 2)];
const MUST = ['{200}', '{220}', '{311}']; // {111} sits next to the beam stop and is a known miss (plan check 4)
const TOL = 0.02; // PROMPT.md check 5: d within 2%

let fail = 0;
const check = (ok, msg) => { console.log(ok ? 'PASS' : 'FAIL', msg); if (!ok) fail++; };

(async () => {
  if (!fs.existsSync(FILE)) { console.log('NOTHING TESTED: missing', FILE, '(run from the project root)'); process.exit(1); }
  const b = fs.readFileSync(FILE);
  const im = await DP.readTIFF(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  const sb = DP.detectScaleBar(im.gray, im.width, im.height);
  check(!!(sb && sb.value === 5 && sb.lengthPx > 0), `scale bar read as 5 1/nm (${sb ? sb.value + ' ' + sb.unit + ' over ' + sb.lengthPx + ' px' : 'none'})`);
  const scale = sb.value / sb.lengthPx; // 1/nm per px, as app.js calibrates from a scale bar
  const a = DP.analyze(im.gray, im.width, im.height, { scaleBar: sb });
  const rings = a.features.filter((f) => f.kind === 'ring' || f.kind === 'spotty').map((f) => ({ id: f.id, kind: f.kind, d: 1 / (f.r * scale) }));

  // 1. d-spacings: each gold ring the tool should find is there, within 2%.
  for (const ref of AU.filter((r) => MUST.includes(r.label))) {
    const best = rings.reduce((m, f) => (!m || Math.abs(f.d / ref.d - 1) < Math.abs(m.d / ref.d - 1) ? f : m), null);
    const err = best ? (best.d / ref.d - 1) * 100 : NaN;
    check(best && Math.abs(err) < TOL * 100, `Au ${ref.label}: d = ${best ? best.d.toFixed(4) : '-'} nm vs ${ref.d.toFixed(4)} nm (${err.toFixed(1)}%, limit ${TOL * 100}%)`);
  }

  // 2. Phase labels: with gold and two look-alikes to choose from, gold ranks first and the
  //    rings above get gold's labels. Na and Cu are listed first so a matcher that takes the
  //    first phase that fits anything would fail.
  const NA = [[1, 1, 0], [2, 0, 0], [2, 1, 1], [2, 2, 0]].map(([h, k, l]) => ({ label: `{${h}${k}${l}}`, d: 0.4291 / Math.hypot(h, k, l) }));
  const CU = [[1, 1, 1], [2, 0, 0], [2, 2, 0], [3, 1, 1]].map(([h, k, l]) => ({ label: `{${h}${k}${l}}`, d: 0.3615 / Math.hypot(h, k, l) })); // same FCC rings, 11% smaller lattice
  const pool = [{ id: 'na', name: 'Na', dlist: NA }, { id: 'cu', name: 'Cu', dlist: CU }, { id: 'au', name: 'Au', dlist: AU }];
  const res = DP.crystal.matchPhases(rings, pool, { tol: 0.03 });
  check(res.length > 0 && res[0].phase.id === 'au', `phase ranking: first is ${res.length ? res[0].phase.name : 'nothing'} (expected Au)`);
  if (res.length && res[0].phase.id === 'au') {
    const got = new Set(Object.values(res[0].assign).map((x) => x.label));
    for (const lb of MUST) check(got.has(lb), `phase labels: Au ${lb} is assigned to a ring`);
  }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
