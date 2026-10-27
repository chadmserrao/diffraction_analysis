// Regression + determinism tests. Run from the project root (paths are relative to it):
//   node tests/regression.js                            16 cases on the lab's data/ folder
//   node tests/regression.js tests/sample_cases.json    the patterns in samples/ (make test)
// A case without "center" checks only the scale bar and determinism; "bar" is the label's expected value.
const DP = require('./load.js'); const fs = require('fs'); const path = require('path');
const cases = JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname, 'regression_cases.json')));
const load = async (f) => { const b = fs.readFileSync(f); return DP.readTIFF(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
(async () => {
  let fail = 0, skip = 0;
  for (const c of cases.centers) {
    if (!fs.existsSync(c.file)) { console.log('SKIP (missing)', c.file); skip++; continue; }
    const im = await load(c.file);
    const sb = DP.detectScaleBar(im.gray, im.width, im.height);
    const a1 = DP.analyze(im.gray, im.width, im.height, { scaleBar: sb });
    const a2 = DP.analyze(im.gray, im.width, im.height, { scaleBar: sb });
    const err = c.center ? Math.hypot(a1.center.x - c.center[0], a1.center.y - c.center[1]) : 0;
    const same = JSON.stringify(a1.features) === JSON.stringify(a2.features) && a1.center.x === a2.center.x && a1.center.y === a2.center.y;
    const barOk = sb && sb.value && (c.bar === undefined || sb.value === c.bar);
    const ok = (!c.center || err <= c.tol) && same && barOk;
    if (!ok) fail++;
    const centre = c.center ? 'centre err ' + err.toFixed(1) + ' px (tol ' + c.tol + ')' : 'centre not checked';
    console.log(ok ? 'PASS' : 'FAIL', path.basename(c.file), centre, 'deterministic', same, 'bar', sb && sb.value, sb && sb.unit);
  }
  // A run that found none of the images tested nothing, so it must not pass.
  if (skip === cases.centers.length) { console.log('NOTHING TESTED: none of the images are here (run from the project root, with data/)'); process.exit(1); }
  console.log((fail ? fail + ' FAILED' : 'ALL PASSED') + (skip ? ' (' + skip + ' skipped: image missing)' : ''));
  process.exit(fail ? 1 : 0);
})();
